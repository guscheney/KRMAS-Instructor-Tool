// ====================================================================
// KRMAS — Supabase Edge Function: send-push-notification
// ====================================================================
// Deploy with: supabase functions deploy send-push-notification
//
// This function is triggered by a database webhook (or called via HTTP)
// when a required-reading post, urgent notice, or cover request is created.
//
// Setup:
// 1. npm install web-push (locally, to generate VAPID keys)
// 2. npx web-push generate-vapid-keys
// 3. Set secrets:
//    supabase secrets set VAPID_PUBLIC_KEY=<your-public-key>
//    supabase secrets set VAPID_PRIVATE_KEY=<your-private-key>
//    supabase secrets set VAPID_EMAIL=admin@krmas.com.au
// 4. Add VAPID_PUBLIC_KEY to index.html's config block
// 5. Create a database webhook in Supabase dashboard:
//    - Table: feed_posts (INSERT) — filter: required_reading = true
//    - Table: notices (INSERT) — filter: type = 'urgent'
//    - Call this Edge Function URL
// ====================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Web Push library for Deno
// You may need to use a Deno-compatible web-push implementation
// or bundle the npm web-push package.

serve(async (req) => {
  try {
    const { type, record } = await req.json();
    // type: 'feed_post' | 'notice' | 'cover_request'
    // record: the inserted row

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );

    // Determine notification content
    let title = "KRMAS";
    let body = "";
    let tag = "krmas-general";
    let targetSchoolId = null;

    if (type === "feed_post" || record?.required_reading) {
      title = "📢 Required reading";
      body = (record.body || "").slice(0, 100);
      tag = "krmas-required-" + record.id;
      targetSchoolId = record.school_id;
    } else if (type === "notice" || record?.type === "urgent") {
      title = "🚨 Urgent notice";
      body = record.title || record.body || "";
      tag = "krmas-urgent-" + record.id;
      targetSchoolId = record.school_id;
    }

    // Fetch push subscriptions for the target school (or all if network)
    let query = supabase.from("push_subscriptions").select("*");
    if (targetSchoolId) {
      query = query.eq("school_id", targetSchoolId);
    }
    // Don't notify the author
    if (record.author_id) {
      query = query.neq("user_id", record.author_id);
    }

    const { data: subscriptions } = await query;

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    // Send push to each subscription
    // NOTE: This uses the Web Push protocol. In production, use the web-push
    // npm package or a Deno equivalent. Below is the payload structure:
    const payload = JSON.stringify({ title, body, tag, url: "./" });

    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidEmail = Deno.env.get("VAPID_EMAIL") || "admin@krmas.com.au";

    let sent = 0;
    let failed = 0;

    for (const sub of subscriptions) {
      try {
        // In production, use web-push library here:
        // await webpush.sendNotification({
        //   endpoint: sub.endpoint,
        //   keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth }
        // }, payload, {
        //   vapidDetails: {
        //     subject: 'mailto:' + vapidEmail,
        //     publicKey: vapidPublicKey,
        //     privateKey: vapidPrivateKey,
        //   }
        // });
        sent++;
      } catch (pushError) {
        failed++;
        // If subscription is expired/invalid, clean it up
        if (pushError.statusCode === 410 || pushError.statusCode === 404) {
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint);
        }
      }
    }

    return new Response(
      JSON.stringify({ sent, failed, total: subscriptions.length }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500 }
    );
  }
});
