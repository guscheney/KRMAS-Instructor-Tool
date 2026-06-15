// Supabase Edge Function: bulk-import
// Privileged bulk student import. The service-role key lives ONLY in this function's
// secrets (Deno.env) and never reaches the browser. The caller's identity, role and
// school are verified server-side from `profiles` before any row is written, so a
// non-admin (or an admin importing into another school) is rejected even though the
// insert itself runs with the service role.
//
// Deploy:  supabase functions deploy bulk-import
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (set via `supabase secrets set`)
//
// Request (from the authenticated client, Authorization: Bearer <user jwt>):
//   { "schoolId": "edgeworth",
//     "students": [{ "id": "...", "name": "...", "dob": "2012-01-01",
//                    "memberNum": "123" }, ...] }
// Response: { imported: N }  | { error: "..." } with an appropriate status.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RANK: Record<string, number> = { superadmin: 4, admin: 3, instructor: 2, junior: 1 };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Server not configured" }, 500);

  // Privileged client — service role. Never exposed to the browser.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // 1. Authenticate the caller from their bearer token.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "Invalid session" }, 401);
  const uid = userData.user.id;

  // 2. Authorize from the server-side source of truth (profiles), not client claims.
  const { data: prof, error: profErr } = await admin
    .from("profiles").select("role, school_id").eq("id", uid).single();
  if (profErr || !prof) return json({ error: "No profile" }, 403);
  if ((RANK[prof.role] ?? 0) < RANK.admin) return json({ error: "Admins only" }, 403);

  // 3. Parse + validate payload.
  let body: { schoolId?: string; students?: any[] };
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const targetSchool = String(body.schoolId ?? "").trim();
  if (!targetSchool) return json({ error: "schoolId required" }, 400);
  if (!Array.isArray(body.students) || body.students.length === 0)
    return json({ error: "students[] required" }, 400);
  if (body.students.length > 2000) return json({ error: "Too many rows" }, 400);

  // 4. School scope: only a superadmin may import into a school other than their own.
  if (prof.role !== "superadmin" && targetSchool !== prof.school_id)
    return json({ error: "Cannot import into another school" }, 403);

  // 5. Build rows. school_id is forced to targetSchool — never taken per-row from the client.
  const rows = body.students
    .filter((s) => s && (s.name ?? "").toString().trim())
    .map((s) => ({
      id: (s.id ?? crypto.randomUUID()).toString(),
      school_id: targetSchool,
      name: s.name.toString().trim(),
      dob: s.dob ? String(s.dob).slice(0, 10) : null,
      member_num: s.memberNum ? String(s.memberNum) : null,
      source: "import",
      updated_by: uid,
    }));
  if (rows.length === 0) return json({ error: "No valid rows" }, 400);

  // 6. Upsert with the service role (bypasses RLS — already authorized above).
  const { error: insErr } = await admin.from("students").upsert(rows, { onConflict: "id" });
  if (insErr) return json({ error: insErr.message }, 400);

  // 7. Lightweight audit (best-effort).
  await admin.from("audit_log").insert({
    actor: uid, actor_role: prof.role, school_id: targetSchool,
    action: "bulk_import", table_name: "students",
    detail: { count: rows.length },
  });

  return json({ imported: rows.length });
});
