# KRMAS — Security model

## The one thing to remember

**The browser is not trusted. Every rule is enforced in the database by Row-Level Security (RLS).**
The `SUPABASE_ANON` key in `index.html` is public on purpose — it only lets the app *talk* to Supabase. What a request can actually read or write is decided by the logged-in user's identity, role and school, checked by Postgres on every query. The `can.*` checks in `app.js` only decide what buttons to show; they are **not** the security boundary and never were after this rebuild.

## How a user is identified

1. The user signs in with a **magic link** (email → one-tap link). No passwords, no PINs for sign-in.
2. Supabase issues a session (JWT), refreshed automatically and persisted on the device.
3. Their **role and school come from the `profiles` table** (one row per user), never from anything the browser sends. A custom access-token hook copies `app_role` + `school_id` into the JWT; if it's not present, the policies look it up directly. Either way the value is server-controlled.

Roles, highest to lowest: `superadmin` (network-wide) › `admin` (one school) › `instructor` › `junior`.

## Where each rule lives

| Concern | Enforced by |
|---|---|
| Who can read/write each row | RLS policies in `01_auth_authz.sql` (one per table) |
| Role + school of the caller | `profiles` table + `current_app_role()` / `current_school_id()` helpers |
| No self-promotion | `guard_profile_changes()` trigger on `profiles` |
| Sensitive student/incident rows | normalized `students` / `incidents` tables, per-row RLS |
| Privileged bulk import | `bulk-import` Edge Function (service role, server-side only) |
| Who did what (role changes, deletes) | `audit_log` + `audit_writer()` trigger |
| Plaintext PINs | removed; optional on-device lock stored only as a salted hash |

## What each role can do (enforced, not cosmetic)

- **Students** — view: instructor+ · add/edit: junior+ · **delete: admin+** · only within your school (superadmin: any).
- **Incidents** — view: instructor+ · file: junior+ (stamped with your id) · **edit/delete: admin+** · within your school.
- **Roster / schedule / class assignments** — view: signed-in users in that school · edit: admin+.
- **Calendar & event types** — view: all · **create/edit: admin+ only** (network-wide entries: superadmin).
- **Notices / posts / documents / groups** — read within school (plus network-wide items); posts are stamped to their author and can't be spoofed; admin manages school content, superadmin manages network content.
- **Profiles / roles** — you can edit your own display name but not your own role or school; a school admin manages roles within their school but cannot grant `superadmin` or move someone to another school; only a superadmin can do those.
- **Audit log** — admins read their school's entries; juniors/instructors cannot read it.

Cross-school isolation is absolute for everyone except superadmin: an Edgeworth user cannot read or write any Beecroft row, and vice-versa.

## The optional on-device PIN lock

Kept as a convenience "quick unlock" on shared devices. It is **not** a login mechanism — you still need a valid session. It is stored only as `SHA-256(user-id : pin)` in `profiles.pin_hash`; there is no plaintext PIN anywhere. (`db.auth.setPin` / `checkPin` / `hasPin` are wired; a lock-screen UI is a small follow-up if you want it.)

## How to extend this safely

**Add a new table:** enable RLS (`alter table ... enable row level security`), then write policies using the helpers — `my_school(school_id)` for "same school or superadmin", `has_min_role('instructor')` for role floors, `is_admin()` / `is_superadmin()`. Add `grant ... to authenticated` and `force row level security`. If you add no policy, the table is deny-all by default (safe). Never write `using (true)` for `authenticated` on anything sensitive.

**Add a new role:** extend `role_rank()` and the `profiles.role` check constraint, then audit every `has_min_role` call to see where the new rank lands.

**Add a privileged operation** (anything that must bypass a user's own permissions, e.g. cross-school admin tooling): do it in an **Edge Function** with the service role and re-check the caller's `profiles` role/school there — exactly like `bulk-import`. Never put the service-role key in the browser.

## Verifying

- `bash security/run_rls_tests.sh` — 82 assertions against a real Postgres (negative-auth on all tables, cross-tenant, full role matrix, every escalation attempt, audit). Must stay green.
- `node security/jsdom_client_test.js` — boots the app and checks the sign-in gate, profile-derived role/school, and that the client uses the new tables.

## Known residual (low risk, documented)

The `custom-schools` instructor list is still a single global `kv` blob (now PIN-free). Its writes require `admin`, but the blob is shared across schools, so a school admin's write isn't school-scoped at the row level the way the normalized tables are. Roles are authoritative in `profiles`, so this is display data only. Splitting it per-school is a clean future improvement.
