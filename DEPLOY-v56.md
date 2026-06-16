# KRMAS Instructor App — v56 (complete bundle)

This is the full current app. There are two kinds of changes in here:

- **Mobile fix (v56)** — frontend only. Fixes the Incident Report and Lesson Plan
  modals rendering at ~half width on phones; they now fill the screen.
- **The earlier security / cover-notifications / admin-editing work** — included for
  completeness in case any of it isn't live on your Supabase project yet.

---

## A. Fix the mobile bug right now  (frontend only — this is all that's needed)

1. Copy these into your repo, overwriting the existing files:
   `index.html`, `app.js`, `db.js`, `sw.js`, `data.js`, `manifest.json`,
   `icon-192.png`, `icon-512.png`, `krmas-logo.svg`
2. From the repo, in PowerShell:
   ```
   git add .
   git commit -m "v56 mobile modal fix"
   git push origin main
   ```
3. Once Cloudflare has redeployed, on your phone **reload the page twice** — the new
   service worker installs on the first load and takes over on the second. If it's
   stubborn, fully close the tab/app and reopen. The app should report **v56** and the
   forms should fill the screen.

The double-reload matters: the old service worker was caching the previous layout on
your phone, which is why the half-width modal stayed on screen. Bumping to v56 changes
the cache name so the old copy is discarded.

---

## B. Full set — only if the security / cover / admin work isn't already live

You deployed most of this earlier; do these **only if needed**.

- **Supabase SQL** (SQL editor): re-run `security/01_auth_authz.sql`. It's idempotent
  and adds the `profiles.email` column the latest build expects. (`supabase_schema.sql`
  and `security/02_data_migration.sql` are included but only needed for a fresh setup.)
- **Edge Functions** (deploy): `security/edge-functions/manage-users` and
  `security/edge-functions/send-push-notification`. `bulk-import` is unchanged.

No other SQL or backend changes.

---

## What's in this bundle

| Area | Files |
|------|-------|
| Frontend (deployed) | `index.html`, `app.js`, `db.js`, `sw.js`, `data.js`, `manifest.json`, `icon-192.png`, `icon-512.png`, `krmas-logo.svg` |
| Local preview only | `serve.py` (not deployed) |
| Supabase schema/policies | `supabase_schema.sql`, `security/01_auth_authz.sql`, `security/02_data_migration.sql` |
| Edge Functions | `security/edge-functions/{manage-users,send-push-notification,bulk-import}/index.ts` |
| Tests | `security/run_rls_tests.sh`, `security/jsdom_client_test.js`, `security/00_local_test_shims.sql`, `security/seed_test.sql` |
| Docs | `KRMAS-DOCUMENTATION.md` (technical reference), `KRMAS-USER-GUIDE.md` (role-based how-to), `NATIVE_APP_PLAN.md` |
| Import templates | `KRMAS_Instructor_Import_Template.csv`, `KRMAS_Event_Import_Template.csv` |

Version: **v56** — confirm with `KRMAS_APP_VERSION` in `index.html` and the cache name in `sw.js`.
