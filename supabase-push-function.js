// ====================================================================
// KRMAS — Supabase Edge Function: send-push-notification
// ====================================================================
// Sends Web Push notifications to subscribed devices. Driven directly by
// the app (DB.sendPushNotification → supabase.functions.invoke), so no
// database webhook configuration is required. It also accepts a Supabase
// database-webhook payload shape, in case you prefer that trigger instead.
//
// ── ONE-TIME SETUP ─────────────────────────────────────────────────
// 1. Put this file at:  supabase/functions/send-push-notification/index.ts
//    (rename to index.ts — the contents are Deno/TypeScript-compatible JS).
// 2. Set the function secrets (the VAPID PRIVATE key is generated alongside
//    the public key already in index.html — keep it secret, never commit):
//      supabase secrets set VAPID_PUBLIC_KEY=BKjIqdpnID6ZipVeKBdfZbahA1uNS1JweqhbbbMCR2icMlT1-bRfVgaa73f0_S_n3dSZ3SP2DZlsijeCJgyCloE
//      supabase secrets set VAPID_PRIVATE_KEY=4Z9G5koTYpT0lK8XLVCjcvxKi5QcvKY3-A2vdtq7gMQ
//      supabase secrets set VAPID_SUBJECT=mailto:admin@krmas.com.au
//    (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
// 3. Deploy:
//      supabase functions deploy send-push-notification
//
// That's it — the app invokes it automatically when a required-reading post
// or urgent notice is created. To rotate keys, regenerate a VAPID pair,
// update index.html (public) + the secret (private), and redeploy.
// ====================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
    const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@krmas.com.au";
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return json({ error: "VAPID keys not configured" }, 500);
    }
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const input = await req.json().catch(() => ({}));

    // Accept either a direct app payload or a Supabase webhook payload.
    // Webhook shape: { type: 'INSERT', table, record, old_record, schema }
    const isWebhook = input && typeof input.type === "string" &&
      ["INSERT", "UPDATE", "DELETE"].includes(input.type);

    let title = "KRMAS";
    let body = "";
    let tag = "krmas-general";
    let url = "./";
    let schoolId: string | null = null;
    let targetUserIds: string[] | null = null;
    let excludeUserId: string | null = null;

    if (isWebhook) {
      const rec = input.record || {};
      if (input.table === "notices" || rec.type === "urgent") {
        title = "🚨 " + (rec.title || "Urgent notice");
        body = (rec.body || "").slice(0, 140);
        tag = "krmas-notice-" + (rec.id ?? Date.now());
      } else {
        title = rec.required_reading ? "📢 Required reading" : "📣 New post";
        body = (rec.body || "").slice(0, 140);
        tag = "krmas-post-" + (rec.id ?? Date.now());
      }
      schoolId = rec.school_id ?? null;
      excludeUserId = rec.author_id ?? null;
      // Webhooks can't easily resolve group/role targeting; fall back to school.
    } else {
      title = input.title || title;
      body = (input.body || "").slice(0, 140);
      tag = input.tag || tag;
      url = input.url || url;
      schoolId = input.schoolId ?? null;
      targetUserIds = Array.isArray(input.targetUserIds) && input.targetUserIds.length
        ? input.targetUserIds
        : null;
      excludeUserId = input.excludeUserId ?? null;
    }

    // Resolve target subscriptions.
    let query = supabase.from("push_subscriptions").select("*");
    if (targetUserIds) {
      query = query.in("user_id", targetUserIds);      // precise audience
    } else if (schoolId) {
      query = query.eq("school_id", schoolId);          // whole school
    } // else: network-wide → every subscription
    if (excludeUserId) query = query.neq("user_id", excludeUserId);

    const { data: subs, error } = await query;
    if (error) return json({ error: error.message }, 500);
    if (!subs || subs.length === 0) return json({ sent: 0, total: 0 });

    const payload = JSON.stringify({ title, body, tag, url });

    let sent = 0, failed = 0;
    const dead: string[] = [];
    await Promise.all(subs.map(async (s: any) => {
      const subscription = {
        endpoint: s.endpoint,
        keys: { p256dh: s.keys_p256dh, auth: s.keys_auth },
      };
      try {
        await webpush.sendNotification(subscription, payload, { TTL: 86400 });
        sent++;
      } catch (err: any) {
        failed++;
        const code = err?.statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint); // gone — prune
      }
    }));

    // Prune expired/invalid subscriptions.
    if (dead.length) {
      await supabase.from("push_subscriptions").delete().in("endpoint", dead);
    }

    return json({ sent, failed, pruned: dead.length, total: subs.length });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
