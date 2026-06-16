# KRMAS Instructor App — Technical Documentation

*Kumiai Ryu Martial Arts System — roster, scheduling, and administration PWA*

This document explains how the application is built and how it works end to end: the
architecture, the data model, the security model, the key workflows, deployment, and
day‑to‑day operations. It reflects the current state of the app (frontend **v54**).

It sits alongside two narrower companions in `security/`:
- **`SECURITY.md`** — the security model in depth.
- **`DEPLOY.md`** — the step‑by‑step deployment runbook.

---

## 1. What it is

KRMAS is a single‑page Progressive Web App for running a multi‑location martial‑arts
organisation. Each **school** (location) has a weekly **timetable** of classes, a roster
of **instructors**, enrolled **students**, and records such as incidents, lesson plans,
grading, compliance, notices, and a social feed. Staff sign in, see their classes, manage
rosters, request cover, and administer their school according to their **role**.

It is installable (PWA), works offline, and syncs to a **Supabase** backend (Postgres +
Auth + Edge Functions) protected by Row‑Level Security.

---

## 2. Architecture & tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JavaScript single‑page app (no framework), one reactive `state` object |
| Backend | Supabase: Postgres 16, Supabase Auth (GoTrue), Edge Functions (Deno/TypeScript) |
| Authorization | Postgres Row‑Level Security (RLS) on every table + JWT claims |
| Hosting | Cloudflare Worker, deployed by `git push` |
| Offline / install | Service Worker (`sw.js`) + Web App Manifest |
| Push | Web Push (VAPID) via a Supabase Edge Function |

There is **no build step**. The browser loads the scripts directly. State lives in one
in‑memory object and is rendered to the DOM by hand‑written render functions.

### Data flow at a glance

```
Browser (app.js / db.js)
   │  authenticated session (JWT with app_role + school_id claims)
   ▼
Supabase
   ├── Auth (GoTrue)              ← email + password login
   ├── Postgres + RLS             ← all reads/writes, scoped by role + school
   │     └── upsert_kv() RPC      ← writes the JSONB "kv_store" blobs
   └── Edge Functions (service role, server‑side only)
         ├── manage-users         ← create / change / remove logins
         ├── bulk-import          ← CSV student import
         └── send-push-notification ← Web Push to devices
```

---

## 3. File layout

| File | Role | Approx size |
|---|---|---|
| `app.js` | All UI, rendering, workflows, capability gates | ~9,800 lines |
| `db.js` | Supabase client, data access, auth surface, offline buffer | ~1,300 lines |
| `index.html` | Markup, modals, config (`window.*`), script loading | ~2,640 lines |
| `data.js` | Seed data and constants (schools, class types, charts) | — |
| `sw.js` | Service worker: cache, offline, push + notification handlers | — |
| `manifest.json` | PWA manifest | — |
| `security/01_auth_authz.sql` | The production security migration (RLS, helpers, triggers) | ~490 lines |
| `security/02_data_migration.sql` | One‑time migration of legacy blob data into tables | — |
| `security/00_local_test_shims.sql` | Local‑only Supabase emulation for testing (never deployed) | — |
| `supabase_schema.sql` | Base schema (tables, `upsert_kv`) deployed before `01` | — |
| `security/edge-functions/*` | The three Edge Functions | — |
| `security/run_rls_tests.sh` | RLS test suite (runs on local Postgres) | 104 assertions |
| `security/jsdom_client_test.js` | Client‑wiring test suite (runs under jsdom) | 51 assertions |

`DB` is a `const` global created by an IIFE in `db.js` (`const DB = (()=>{…})()`), not
`window.DB`.

---

## 4. Configuration

All runtime configuration is set on `window` in `index.html` **before** `db.js` loads:

```js
window.SUPABASE_URL      = 'https://<project>.supabase.co';
window.SUPABASE_ANON     = 'sb_publishable_…';   // anon/publishable key (safe in client)
window.VAPID_PUBLIC_KEY  = 'B…';                 // Web Push public key (safe in client)
window.KRMAS_APP_VERSION = '54';                 // shown in‑app; bump on every release
```

The service worker has its own version constant that **must be bumped together** with
`KRMAS_APP_VERSION`:

```js
const CACHE = 'krmas-roster-v54';   // sw.js
```

Bumping both is what forces clients to pick up new code (the SW cache name changing
triggers re‑install and refresh).

---

## 5. Data model

### 5.1 The 20 tables

Every table below has RLS enabled and forced (so even the table owner is subject to
policy), with one deliberate exception noted under audit.

**Identity & security**
- `profiles` — one row per login. `id` → `auth.users.id`, plus `display_name`, `email`,
  `role`, `school_id`, `pin_hash`. This is the server‑side source of truth for *who you are*.
- `audit_log` — append‑only record of sensitive changes (e.g. role changes). Admin‑readable.

**Core records (per school)**
- `students` — enrolled students (normalized out of the old kv blob).
- `incidents` — incident reports (normalized out of the old kv blob).
- `class_assignments` — default staff per timetable slot (`slot_key = "{dow}-{start}-{type}"`).
- `calendar_events`, `event_types` — events calendar.
- `notices` — banner notices.
- `documents` — instructor documents.
- `onboarding_checklists` — onboarding progress.
- `compliance_requirements`, `instructor_compliance` — compliance tracking.

**Social feed**
- `feed_posts`, `feed_comments`, `feed_likes`, `post_acks` — posts, comments, likes, and
  required‑reading acknowledgements.

**Groups**
- `groups`, `group_members`.

**Push**
- `push_subscriptions` — one row per device that enabled notifications
  (`user_id`, `school_id`, `endpoint`, keys).

**Blob store**
- `kv_store` — JSONB blobs keyed by `(school_id, key)`. See §5.4.

### 5.2 Roles

Four roles, ranked. Higher ranks inherit the abilities of lower ranks.

```
superadmin (4)  >  admin (3)  >  instructor (2)  >  junior (1)
```

- **superadmin** — the owner. No home school (`school_id` is null). Can see and manage
  every school and network‑wide records.
- **admin** — a school administrator. Full control of **their own school**.
- **instructor** — teaches classes, files incidents, flags classes for cover.
- **junior** — junior instructor; can volunteer to cover and edit lesson plans.

A user's role and school come from their `profiles` row, surfaced into the JWT (§6.1) and
into the app as `state.user.role` / `state.schoolId`.

### 5.3 Schools

The 17 schools are defined in `data.js` (`KRMAS_SCHOOLS`): beecroft, cootamundra, cowra,
dubbo, edgeworth, harden, lithgow, orange, parkes, port‑mac, rutherford, taree, weston,
gin‑gin, gympie, maryborough, port‑denison. The default working school is `edgeworth`.

### 5.4 The `kv_store` blobs

Some data is stored as JSONB documents rather than tables. Each blob is one row keyed by
`(school_id, key)`. The client addresses them as `"<key>:<school_id>"`; `db.js` splits on
the **last** colon, so `"custom-schools:global"` becomes `school_id='global', key='custom-schools'`.

Writes go through the `upsert_kv()` Postgres function, which is **SECURITY INVOKER** — it
runs with the caller's privileges, so the insert/update inside it is still subject to the
kv RLS policy below. (It does **not** bypass RLS.)

**Namespaces and their role floors (v54):**

| Namespace (`key`) | Scope | Read floor | Write floor | Holds |
|---|---|---|---|---|
| `custom-schools` | global (one row, all schools) | junior | **admin** | Timetables, instructor rosters, slot defaults, contact, active days |
| `roster-edits` | per school | junior | **junior** | Per‑day roster overrides (assignments, status, cover) |
| `lesson-plans` | per school | junior | junior | Lesson plans by class |
| `progressions` | per school | junior | junior | Student progressions |
| `class-type-overrides` | per school | junior | admin | Class‑type remapping |
| `pathways` | per school | instructor | admin | Grading pathways |
| `grading` | per school | instructor | admin | Grading sessions/results |
| `last-login` | per school | instructor | junior | Last‑login stamps |

Legacy namespaces `students`, `incidents`, and `pin-overrides` are **denied entirely** —
that data moved to tables (students/incidents) or was removed (pins).

> **Note on `roster-edits` write floor.** It is `junior` so that instructors can flag a
> class "needs cover" and juniors can volunteer — both persist through this blob. The
> consequence is discussed in §15.

---

## 6. Security model

The guiding rule: **a user's role and school are never trusted from the client.** They are
derived server‑side from `profiles` and enforced by RLS on every table.

### 6.1 Authentication & JWT claims

1. The user signs in with **email + password** (Supabase Auth).
2. A registered Auth hook, `custom_access_token_hook(event jsonb)`, injects two custom
   claims into the access token: `app_role` and `school_id`, read from the user's
   `profiles` row.
3. RLS helper functions read those claims (falling back to a `profiles` lookup if the hook
   isn't registered), so policies can ask "what is this caller's role and school?" cheaply.

Registering the hook is **optional** — the helpers fall back to a direct `profiles` read —
but registering it is faster.

### 6.2 SECURITY DEFINER helper functions

These run with elevated privilege but contain no user input branching that could leak; they
exist so policies don't recurse and stay readable:

| Function | Returns |
|---|---|
| `current_app_role()` | the caller's role (claim → profiles fallback) |
| `current_school_id()` | the caller's school |
| `role_rank(text)` / `has_min_role(text)` | numeric rank / "is caller ≥ this role?" |
| `is_admin()` / `is_superadmin()` | role shortcuts |
| `my_school(text)` | "is this the caller's school?" (superadmin always true) |
| `can_read_scope(text)` | combined read‑scope check |
| `kv_min_read_role(text)` / `kv_min_write_role(text)` | per‑namespace floors for `kv_store` |

### 6.3 Row‑Level Security

Every table has policies. The recurring patterns:

- **Per‑school records** (notices, calendar_events, documents, class_assignments, groups,
  …): readable within your school; **writable by an admin of that school**; network‑wide
  rows (`school_id` null) are **superadmin‑only**. Cross‑school writes are blocked.
- **Students** — view: instructor+; add/edit: junior+; delete: admin+ — all own‑school.
- **Incidents** — view: instructor+; file: junior+ (stamped `created_by = auth.uid()`);
  edit/delete: admin+ — all own‑school.
- **Feed** — posts are author‑stamped (`author_id = auth.uid()`) to prevent spoofing;
  likes/acks are own‑row.
- **Push subscriptions** — a user manages only their own rows; the Edge Function reads all
  via the service role.
- **kv_store** — see §5.4; gated by namespace floor **and** school.

A migration step **forces** RLS on all public tables (so the table owner is also subject to
policy), with **one exception: `audit_log`** is left unforced so the audit trigger
(SECURITY DEFINER) can insert rows that no client is allowed to insert directly.

### 6.4 Escalation guards

Two layers stop privilege escalation:

1. **`guard_profile_changes()` trigger** on `profiles`: you cannot change your own role or
   school; a school admin cannot grant superadmin or move a user to another school. (The
   trigger no‑ops when `auth.uid()` is null, so the SQL editor / service role can still
   administer.)
2. **Edge Function checks** (§8): `manage-users` re‑verifies the caller from `profiles` and
   blocks a non‑superadmin from granting superadmin or touching another school.

### 6.5 Audit

The `audit_writer()` trigger records sensitive changes into `audit_log` using `to_jsonb()`
(table‑agnostic). Admins can read their school's audit entries; no client can write them.

---

## 7. Identity model (important)

This is the subtlest part of the app and the source of past bugs, so it's worth stating
plainly.

There are **two identifier spaces**:

- **Auth UID** — `state.user.id`, the Supabase `auth.users.id` (a UUID). Used for anything
  keyed to the *account*: feed authorship, likes, acks, documents, push subscriptions, and
  the `profiles` row.
- **Instructor ID** — the id of a roster instructor (e.g. `"gus"`, `"alysia"`), stored
  inside the `custom-schools` blob. Used for anything on the *roster*: the lead / assist /
  junior / backup of a class.

These are bridged by a `uid` field stored on each roster instructor (set when their login
is created). On sign‑in, the app resolves the current user's instructor id and caches it:

```
state.user.id            = auth UID (account)
state.user.instructorId  = roster instructor id (resolved via instr.uid === auth UID)
```

`resolveMyInstructorId()` does this resolution; `myInstructorId()`, `uidForInstructorId()`,
and `isMyClass()` use it. **All "is this my class?" logic compares against
`state.user.instructorId`, never the raw UID.** (Comparing the UID to instructor ids was a
real bug that broke the "Me" view, "my classes," avatars, and cover routing.)

### Unified people & logins

A person on the roster and a login are **one thing**. Adding a person through the people
manager:

1. Creates/updates their roster instructor record (in `custom-schools`).
2. If they have an **email**, creates (or links) their login via the `manage-users` Edge
   Function and stores the returned `uid` on the instructor record.
3. Their **role** here *is* their access level — changing it syncs to their login; deleting
   them removes the login; bulk‑imported people are linked the same way.

A person with no email is roster‑only (cannot sign in). A login with no roster entry (e.g.
the bootstrap superadmin) appears under "All sign‑in accounts."

---

## 8. Edge Functions

Edge Functions hold the **service‑role key**, which never appears in the browser. Each one
authenticates the caller from the `Authorization: Bearer <jwt>` header via
`auth.getUser(token)` and then authorizes from `profiles` — the caller cannot forge their
role or school.

### `manage-users`
In‑app login administration.

| Action | Effect | Returns |
|---|---|---|
| `invite` | create auth user (auto‑confirmed) + profile, generate temp password | `{ email, tempPassword, uid }` |
| `setRole` | update a user's role (school preserved if omitted) | `{ ok: true }` |
| `remove` | delete the auth user (cascades the profile) | `{ ok: true }` |

Guards: caller must be admin+; a non‑superadmin cannot grant superadmin, cannot touch
another school (verified against `me.school_id`, not the request body), and cannot remove
themselves. Orphaned auth users are rolled back if the profile insert fails. Every action
writes an audit row.

### `bulk-import`
Student CSV import. Verifies the caller is admin+, forces the target `school_id`, upserts
students, writes an audit row.

### `send-push-notification`
Web Push sender (the only piece that uses VAPID).

- Request: `{ title, body, url?, tag?, schoolId?, targetUserIds: string[], excludeUserId? }`.
- Caller must be instructor+. A non‑superadmin can only push to devices in **their own
  school** (so a cover alert can't fan across schools).
- Looks up the targets' `push_subscriptions`, sends via `web-push` with the VAPID secrets,
  excludes the sender's own devices, and **prunes dead endpoints** (404/410).
- Requires secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

---

## 9. Key workflows

### 9.1 Login & session

```
init()
 └─ Supabase configured? ── no ──▶ offline fallback
        │ yes
        ▼
   getSession() ── none ──▶ show login gate (email + password)
        │ session
        ▼
   enterAppWithSession(session)
        ├─ myProfile()  → state.user = { id, name, role, email }
        │                 state.schoolId = profile.school_id (superadmin keeps default)
        ├─ load custom schools + current school data (each wrapped in try/catch)
        ├─ state.user.instructorId = resolveMyInstructorId()
        └─ finishBootRender()
```

`DB.auth.onChange` re‑enters on sign‑in and gates on sign‑out. The callback is **deferred**
(`setTimeout`) and `myProfile` uses the cached `_uid` — this avoids a Supabase auth‑lock
deadlock that otherwise hangs sign‑in. A device PIN lock (if set) is a *local* screen lock
layered on top; it does not replace authentication.

### 9.2 Adding a person
People manager → **+ Add person** → name, email, role. With an email they're added to the
roster **and** get a login; you're shown a one‑time temporary password to share. See §7.

### 9.3 Timetable & roster

- **Timetable structure** (class slots/times) and **school setup** (contact, active days)
  are edited in the **school manager** (`openSchoolManager`). An **admin** sees only their
  own school there; a **superadmin** sees all and can add schools. The schedule and
  school‑details editors refuse any school that isn't the admin's own (open *and* save are
  guarded by `canEditSchool`).
- **Default staff per slot** → `class_assignments` table (admin, own school).
- **Per‑day roster** (who teaches a specific class instance, plus status/notes) →
  `openEdit`/`saveEdit`, the `roster-edits` blob. The full reassignment save is admin‑gated.

### 9.4 Cover notifications

When a class is flagged for cover, the listed **backup** is notified two ways:

1. **In‑app banner** (no setup needed) — `myBackupCoverAlerts()` derives, on every render,
   any upcoming class in the next 28 days that needs cover *and* lists the current user as
   backup, and shows a "Cover needed — you're the backup / Take it" banner.
2. **Push** — `markNeedsCover` (instructor+) resolves the backup's `uid` and calls
   `send-push-notification`, which pushes their devices (even with the app closed).

`volunteerToCover` (junior+) assigns the volunteer as lead and confirms the class. Both
persist through `roster-edits` (write floor `junior`, §5.4).

### 9.5 Students & incidents
Stored in normalized tables with per‑operation RLS (§6.3). The client edits whole maps;
`db.js` performs a **snapshot diff** so only changed rows are written (e.g. a junior filing
one incident issues one INSERT, not a rewrite of everything).

---

## 10. Offline & sync

The app is offline‑first:

- Reads/writes go through `db.js`. On a write failure (offline, transient error), `sbSet`
  **buffers** to `localStorage` and **enqueues** the change, returning success to the UI;
  the queue flushes when connectivity returns.
- The service worker caches the app shell for offline loads.
- Pure local mode (no Supabase configured) is supported for development.

Because of buffering, a write that is **RLS‑denied** appears to succeed locally but never
syncs and reverts on reload — a useful signal that a permission is wrong rather than a
crash.

---

## 11. Client capability gates (`can.*`)

The UI hides/shows actions via a central `can` object. These are convenience gates for UX;
**RLS is the real enforcement**. Current gates:

| Capability | Min role | | Capability | Min role |
|---|---|---|---|---|
| `editRoster` | admin | | `viewStudents` | instructor |
| `editPlans` | junior | | `deleteStudents` | admin |
| `deletePlans` | instructor | | `managePathway` | admin |
| `viewIncidents` | instructor | | `manageGrading` | admin |
| `fileIncidents` | junior | | `viewGrading` | instructor |
| `editIncidents` | admin | | `manageStocktake` | admin |
| `volunteerCover` | junior | | `exportRoster` | admin |
| `markNeedsCover` | instructor | | `manageInstructors` | admin |
| `changePin` | junior | | `manageRoles` | admin |
| `switchAnySchool` | superadmin | | `viewAuditLog` | admin |

Plus `canEditSchool(schoolId)` — admin of that school, or any school for a superadmin.

---

## 12. Deployment

Four independent surfaces. The frontend deploys by `git push`; the rest are manual Supabase
steps.

### 12.1 Frontend
```powershell
git add .
git commit -m "…"
git push origin main      # → Cloudflare Worker rebuilds
```
Then hard‑refresh. The live app should report the new `KRMAS_APP_VERSION`. **Always bump
`KRMAS_APP_VERSION` (index.html) and the `CACHE` name (sw.js) together.**

### 12.2 Database (run in order, once)
1. `supabase_schema.sql` — base tables + `upsert_kv` (already deployed; the security
   migration attaches policies to these).
2. `security/01_auth_authz.sql` — the security layer. **Idempotent** (it drops and recreates
   all public policies at the top), so it is safe to re‑run after changes such as a kv role
   floor.
3. `security/02_data_migration.sql` — one‑time move of legacy blob students/incidents into
   tables. Idempotent; review before the final blob delete.

> `00_local_test_shims.sql` is for the local test harness only and must **not** be deployed.

### 12.3 Edge Functions
```bash
supabase functions deploy manage-users
supabase functions deploy bulk-import
supabase functions deploy send-push-notification
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically. After any change
to a function, redeploy it — and keep it in sync with the frontend (e.g. the frontend
expects `manage-users` to return `uid`).

### 12.4 Auth configuration (one time)
- **Auth → Hooks → Customize Access Token** → Postgres function `public.custom_access_token_hook`
  (optional; policies fall back without it).
- **Auth → URL Configuration** → Site URL = the Worker URL; Redirect URLs = that URL and
  its `/**`.
- New invited users are auto‑confirmed by `manage-users` (`email_confirm: true`); pre‑existing
  unconfirmed users need `update auth.users set email_confirmed_at = now()` once.

### 12.5 Push (VAPID), one time
1. Generate a keypair: `npx web-push generate-vapid-keys`.
2. Put the **public** key in `index.html` (`window.VAPID_PUBLIC_KEY`).
3. Set the secrets:
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@example.com
   ```
The public key already in `index.html` and the secret private key **must be the same pair**.
Changing the public key invalidates existing device subscriptions (users re‑enable once).

---

## 13. Operations runbook

**Add a new staff member who can log in** → People manager → **+ Add person** → name, email,
role → share the temporary password shown. They appear with a green "Can sign in".

**Give an existing roster instructor a login** → edit them, add an email, save.

**Change someone's access** → change their role in the people manager (syncs to their login).

**Remove someone** → delete them in the people manager (removes roster entry *and* login).

**Edit your school's timetable (admin)** → Admin → Schools / locations → your school →
Timetable.

**Add a new school (superadmin)** → Admin → Schools / locations → + Add new school.

**Request cover** → on a class, "Need cover" (instructor+). The backup gets an in‑app banner
and a push.

**Enable phone notifications** → a staff member taps "🔔 Enable notifications" on their
device (one‑time, per device).

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| App shows an old version after deploy | SW cache not bumped, or push not picked up | Bump `CACHE` + `KRMAS_APP_VERSION` together; hard‑refresh |
| New person shows "No login — re‑save to enable" | Old `manage-users` deployed (no `uid` returned) | Redeploy `manage-users` |
| Password login silently fails | Email not confirmed | `update auth.users set email_confirmed_at = now()` for that user |
| A change "saves" but reverts on reload | RLS denied the write (buffered locally) | Check the actor's role vs the namespace/table floor |
| Cover flagged but doesn't stick | (Fixed in v54) `roster-edits` write floor | Ensure the v54 `kv_min_write_role` is deployed |
| Push test does nothing | Function not deployed, or VAPID secret missing/mismatched | Deploy `send-push-notification`; set matching VAPID secrets |
| "Sign in" hangs on a phone | (Fixed) auth‑lock deadlock | Ensure current `db.js` is deployed |

---

## 14. Testing

Two reproducible suites back the security and wiring:

- **`security/run_rls_tests.sh`** — 104 assertions on a local Postgres 16. Covers
  unauthenticated denial across all 20 tables, cross‑tenant isolation, the students and
  incidents matrices, kv per‑namespace roles (including writes through the `upsert_kv` RPC),
  privilege‑escalation guards, service‑role bypass, audit, and the "admin edits own school"
  matrix.
- **`security/jsdom_client_test.js`** — 51 assertions under jsdom. Covers sign‑in for every
  role and school, the uid↔instructor bridge, the unified add‑person‑creates‑login flow,
  cover routing (in‑app banner + push), and the scoped school‑manager gates.

The Edge Functions' logic is reviewed but cannot be executed locally (no Deno/live
Supabase); their live behaviour is confirmed in Supabase.

---

## 15. Known limitations & trade‑offs

- **Blob‑level (not field‑level) isolation.** Two stores are single JSONB rows:
  `custom-schools` is one *global* row holding every school's timetable and roster;
  `roster-edits` is one row per school. RLS gates them at the row level (admin can write
  `custom-schools`; junior+ can write `roster-edits`), and the **client** enforces *who edits
  what within them* (an admin is scoped to their own school; a junior can only volunteer or
  flag cover). A determined user editing requests directly could therefore craft a write the
  RLS can't field‑distinguish. For a single trusted organisation this is acceptable; full
  per‑field enforcement would mean splitting these blobs into per‑school rows.
- **PIN lock is a local convenience**, not server‑enforced auth.
- **Push requires per‑device opt‑in** and the VAPID setup; the in‑app banner does not.
- **Live round‑trips** of the Edge Functions (invite, push delivery) and the **production
  data migration** outcome are confirmed in the live environment, not by the local suites.

---

## 16. Quick reference

```
Roles:        superadmin > admin > instructor > junior
Identity:     state.user.id = auth UID   |   state.user.instructorId = roster id
Bridge:       instr.uid === auth UID  (set when a login is created)
kv address:   "<key>:<school_id>"  (split on LAST colon)  → upsert_kv() (invoker)
Global blob:  custom-schools  (school_id='global', admin write)
Per‑school:   roster-edits, lesson-plans, grading, pathways, progressions, …
Edge fns:     manage-users · bulk-import · send-push-notification  (service role only)
Deploy FE:    git push  → Cloudflare Worker  (bump KRMAS_APP_VERSION + sw CACHE)
Deploy DB:    supabase_schema.sql → 01_auth_authz.sql → 02_data_migration.sql
Tests:        run_rls_tests.sh (104) · jsdom_client_test.js (51)
```

*End of document.*
