// ====================================================================
// KRMAS — Supabase Edge Function: send-push-notification  (consolidated)
// ====================================================================
// Sends Web Push to subscribed devices. The app invokes it directly
// (DB.sendPushNotification -> supabase.functions.invoke) for every push it
// sends: cover requests, new notices, new feed posts, and the test button.
//
// This version REQUIRES the caller to be authenticated and restricts a
// non-superadmin to their OWN school, so a cover/notice/post push can never
// be aimed at another school's devices. (The earlier version did no caller
// check -- anyone who could reach the URL could push anyone.)
//
// The DB-webhook path was removed on purpose: the app already triggers every
// push directly, so a webhook would double-fire. If you have a Supabase
// database webhook pointed at this function, delete it.
//
// -- ONE-TIME SETUP --------------------------------------------------
// 1. File path:  supabase/functions/send-push-notification/index.ts
// 2. Secrets — ALREADY SET in this project (16 Jun 2026), verified by digest:
//      VAPID_PUBLIC_KEY  = the BKjIqd… key (matches window.VAPID_PUBLIC_KEY in index.html)
//      VAPID_PRIVATE_KEY = its private half
//      VAPID_SUBJECT     = mailto:guscheney@gmail.com
//    Nothing to change here. (Only if you ever ROTATE the pair: update BOTH the
//    secret AND window.VAPID_PUBLIC_KEY in index.html so they stay matched.)
//    (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
// 3. Deploy:
//      supabase functions deploy send-push-notification
// ====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const RANK: Record<string, number> = { superadmin: 4, admin: 3, instructor: 2, junior: 1 };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SB_URL = Deno.env.get("SUPABASE_URL");
  const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
  const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
  const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@krmas.com.au";
  if (!SB_URL || !KEY) return json({ error: "Server not configured" }, 500);
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: "VAPID keys not configured" }, 500);

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  const admin = createClient(SB_URL, KEY, { auth: { persistSession: false } });

  // 1. Authenticate the caller from their bearer token (no anonymous push).
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: ud, error: ue } = await admin.auth.getUser(token);
  if (ue || !ud?.user) return json({ error: "Invalid session" }, 401);

  // 2. Look the caller up in profiles (server-side source of truth).
  const { data: me, error: pe } = await admin
    .from("profiles").select("role, school_id").eq("id", ud.user.id).single();
  if (pe || !me || !(RANK[me.role] ?? 0)) return json({ error: "No profile" }, 403);
  const callerSuper = me.role === "superadmin";

  let input: any;
  try { input = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }

  const title = String(input.title || "KRMAS");
  const body = String(input.body || "").slice(0, 140);
  const tag = typeof input.tag === "string" ? input.tag : "krmas-" + Date.now();
  const url = typeof input.url === "string" ? input.url : "./";
  const targetUserIds: string[] | null =
    Array.isArray(input.targetUserIds) && input.targetUserIds.length ? input.targetUserIds : null;
  const excludeUserId = typeof input.excludeUserId === "string" ? input.excludeUserId : null;

  // 3. Resolve the audience. A non-superadmin is confined to their own school,
  //    so a school-wide post or cover alert cannot leak to another school.
  let query = admin.from("push_subscriptions")
    .select("endpoint, keys_p256dh, keys_auth, user_id, school_id");
  if (targetUserIds) query = query.in("user_id", targetUserIds);
  if (!callerSuper) query = query.eq("school_id", me.school_id);
  if (excludeUserId) query = query.neq("user_id", excludeUserId);

  const { data: subs, error: se } = await query;
  if (se) return json({ error: se.message }, 500);
  if (!subs || subs.length === 0) return json({ sent: 0, total: 0 });

  const payload = JSON.stringify({ title, body, tag, url });

  let sent = 0, failed = 0;
  const dead: string[] = [];
  await Promise.all(subs.map(async (s: any) => {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.keys_p256dh, auth: s.keys_auth } };
    try {
      await webpush.sendNotification(subscription, payload, { TTL: 86400 });
      sent++;
    } catch (err: any) {
      failed++;
      const code = err?.statusCode;
      if (code === 404 || code === 410) dead.push(s.endpoint); // gone -- prune
    }
  }));

  // 4. Prune expired/unsubscribed endpoints.
  if (dead.length) await admin.from("push_subscriptions").delete().in("endpoint", dead);

  return json({ sent, failed, pruned: dead.length, total: subs.length });
});
