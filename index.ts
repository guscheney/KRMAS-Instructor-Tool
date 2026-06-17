// Supabase Edge Function: manage-users
// In-app user administration. Creating or deleting an auth user needs the service
// role, which lives ONLY here (never in the browser). Every action re-verifies the
// caller's role + school from `profiles` server-side, so an instructor can't invite
// anyone and a school admin can't create a superadmin or touch another school.
//
// Deploy:  supabase functions deploy manage-users
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// Request (Authorization: Bearer <caller jwt>):
//   { action: "invite", email, role, school_id, name }   -> { email, tempPassword }
//   { action: "setRole", uid, role, school_id }          -> { ok: true }
//   { action: "remove", uid }                            -> { ok: true }
//   { action: "resetPassword", uid }                     -> { uid, tempPassword }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RANK: Record<string, number> = { superadmin: 4, admin: 3, instructor: 2, junior: 1 };
const ROLES = ["superadmin", "admin", "instructor", "junior"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function tempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const a = new Uint8Array(12); crypto.getRandomValues(a);
  return Array.from(a).map((x) => chars[x % chars.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const URL = Deno.env.get("SUPABASE_URL");
  const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!URL || !KEY) return json({ error: "Server not configured" }, 500);
  const admin = createClient(URL, KEY, { auth: { persistSession: false } });

  // 1. Authenticate caller.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: ud, error: ue } = await admin.auth.getUser(token);
  if (ue || !ud?.user) return json({ error: "Invalid session" }, 401);

  // 2. Authorize from profiles (server-side source of truth).
  const { data: me, error: pe } = await admin
    .from("profiles").select("role, school_id").eq("id", ud.user.id).single();
  if (pe || !me) return json({ error: "No profile" }, 403);
  if ((RANK[me.role] ?? 0) < RANK.admin) return json({ error: "Admins only" }, 403);
  const callerSuper = me.role === "superadmin";

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const action = String(body.action || "");

  // Helper: can the caller assign this role in this school?
  function checkTarget(role: string, schoolId: string | null): string | null {
    if (!ROLES.includes(role)) return "Invalid role";
    if (role === "superadmin" && !callerSuper) return "Only a superadmin can grant superadmin";
    if (!callerSuper && schoolId !== me.school_id) return "You can only manage your own school";
    return null;
  }

  // Resolve the multi-school membership set. Only instructors may belong to more than
  // one school; everyone else is pinned to a single school (null for superadmin). The
  // caller must control every school in the set (superadmin: any; admin: own only).
  function resolveSchools(role: string, schoolId: string | null, raw: any):
    { schools: string[] | null; home: string | null; error: string | null } {
    if (role !== "instructor") {
      return { schools: schoolId ? [schoolId] : null, home: schoolId, error: null };
    }
    let arr: string[] = Array.isArray(raw) ? raw.map((x) => String(x)).filter(Boolean) : [];
    arr = Array.from(new Set(arr));
    if (arr.length === 0 && schoolId) arr = [schoolId];
    if (arr.length === 0) return { schools: null, home: null, error: "An instructor needs at least one school" };
    for (const s of arr) {
      if (!callerSuper && s !== me.school_id) return { schools: null, home: null, error: "You can only assign your own school" };
    }
    const home = (schoolId && arr.includes(schoolId)) ? schoolId : arr[0];
    return { schools: arr, home, error: null };
  }

  if (action === "invite") {
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "junior");
    const schoolId = body.school_id ? String(body.school_id) : me.school_id;
    const name = body.name ? String(body.name) : null;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Valid email required" }, 400);
    const sset = resolveSchools(role, schoolId, body.schools);
    if (sset.error) return json({ error: sset.error }, 403);
    const bad = checkTarget(role, sset.home); if (bad) return json({ error: bad }, 403);

    const pw = tempPassword();
    const { data: created, error: ce } = await admin.auth.admin.createUser({
      email, password: pw, email_confirm: true,
      user_metadata: { must_change: true },
    });
    if (ce || !created?.user) {
      // Most common: the user already exists — surface that clearly.
      return json({ error: ce?.message || "Could not create user" }, 400);
    }
    const { error: ie } = await admin.from("profiles").insert({
      id: created.user.id, role, school_id: sset.home, schools: sset.schools, display_name: name, email,
    });
    if (ie) { // roll back the auth user so we don't leave an orphan
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: ie.message }, 400);
    }
    await admin.from("audit_log").insert({
      actor: ud.user.id, actor_role: me.role, school_id: schoolId,
      action: "user_invite", table_name: "profiles", row_id: created.user.id,
      detail: { email, role },
    });
    return json({ email, tempPassword: pw, uid: created.user.id });
  }

  if (action === "setRole") {
    const uid = String(body.uid || "");
    const role = String(body.role || "");
    if (!uid) return json({ error: "uid required" }, 400);
    const { data: target } = await admin.from("profiles").select("school_id").eq("id", uid).single();
    const schoolId = body.school_id ? String(body.school_id) : (target?.school_id ?? me.school_id);
    // caller must control both the target's current school and the destination school
    if (!callerSuper && target && target.school_id !== me.school_id)
      return json({ error: "That user isn't in your school" }, 403);
    const sset = resolveSchools(role, schoolId, body.schools);
    if (sset.error) return json({ error: sset.error }, 403);
    const bad = checkTarget(role, sset.home); if (bad) return json({ error: bad }, 403);
    // Only rewrite membership when it was explicitly provided, or when the user is
    // leaving the instructor role (non-instructors are always single-school). This
    // stops a single-school admin's edit from silently collapsing a multi-school
    // instructor they didn't intend to touch.
    const upd: Record<string, unknown> = { role, school_id: sset.home };
    if (body.schools !== undefined || role !== "instructor") upd.schools = sset.schools;
    const { error: se } = await admin.from("profiles").update(upd).eq("id", uid);
    if (se) return json({ error: se.message }, 400);
    return json({ ok: true });
  }

  if (action === "remove") {
    const uid = String(body.uid || "");
    if (!uid) return json({ error: "uid required" }, 400);
    if (uid === ud.user.id) return json({ error: "You can't remove yourself" }, 400);
    const { data: target } = await admin.from("profiles").select("school_id, role").eq("id", uid).single();
    if (target) {
      if (!callerSuper && target.school_id !== me.school_id) return json({ error: "Not in your school" }, 403);
      if (target.role === "superadmin" && !callerSuper) return json({ error: "Only a superadmin can remove a superadmin" }, 403);
    }
    const { error: de } = await admin.auth.admin.deleteUser(uid); // cascades profile via FK
    if (de) return json({ error: de.message }, 400);
    await admin.from("audit_log").insert({
      actor: ud.user.id, actor_role: me.role, school_id: me.school_id,
      action: "user_remove", table_name: "profiles", row_id: uid, detail: {},
    });
    return json({ ok: true });
  }

  if (action === "resetPassword") {
    const uid = String(body.uid || "");
    if (!uid) return json({ error: "uid required" }, 400);
    const { data: target } = await admin.from("profiles").select("school_id, role").eq("id", uid).single();
    if (target) {
      if (!callerSuper && target.school_id !== me.school_id) return json({ error: "That user isn't in your school" }, 403);
      if (target.role === "superadmin" && !callerSuper) return json({ error: "Only a superadmin can reset a superadmin" }, 403);
    }
    const pw = tempPassword();
    // Preserve any existing metadata; just flip the must_change flag.
    const { data: got } = await admin.auth.admin.getUserById(uid);
    const meta = { ...((got?.user?.user_metadata) || {}), must_change: true };
    const { error: ue } = await admin.auth.admin.updateUserById(uid, { password: pw, user_metadata: meta });
    if (ue) return json({ error: ue.message }, 400);
    await admin.from("audit_log").insert({
      actor: ud.user.id, actor_role: me.role, school_id: target?.school_id ?? me.school_id,
      action: "user_reset_password", table_name: "profiles", row_id: uid, detail: {},
    });
    return json({ uid, tempPassword: pw });
  }

  return json({ error: "Unknown action" }, 400);
});
