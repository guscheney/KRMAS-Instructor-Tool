# KRMAS — How to deploy the auth/security rebuild

**Read this first.** Your usual flow —

```powershell
git add .
git commit -m "More Updates"
git push origin main
```

— only ships the **frontend** (Cloudflare Pages / GitHub Pages watches your repo and redeploys the static files). It does **nothing** to your Supabase database. This rebuild has a database half that has to be applied separately, **once**, in the Supabase dashboard. If you only `git push`, the new app will load but every signed-out user will be locked out and nothing will read, because the database isn't set up yet.

Do the steps in order. Steps 1–5 are one-time setup. Step 6 is your normal `git push`.

---

## Step 1 — Apply the database migration

1. Open your project at **https://supabase.com/dashboard** → project `daxwvgnkzvpokzrywzeo` → **SQL Editor** → **New query**.
2. Open `security/01_auth_authz.sql`, copy the whole file, paste, **Run**. It's safe to re-run.
3. New query → open `security/02_data_migration.sql`, paste, **Run**. This moves any existing students/incidents into the new tables and scrubs plaintext PINs.

> Do **not** run `00_local_test_shims.sql` — that file only exists so the tests can run on a plain Postgres. Supabase already provides everything in it.

## Step 2 — Register the JWT hook (recommended)

This puts each user's role + school straight into their login token.

- Dashboard → **Authentication** → **Hooks** → **Customize Access Token (JWT) Claims** → enable it and select the function **`public.custom_access_token_hook`** → Save.

> The app still works correctly without this (the policies fall back to a direct `profiles` lookup), so if you can't find the Hooks screen on your plan, skip it — it's an optimisation, not a requirement.

## Step 3 — Point Auth at your real URL

The sign-in link has to redirect back to your live app.

- Dashboard → **Authentication** → **URL Configuration**:
  - **Site URL**: your deployed address (e.g. `https://krmas.pages.dev` — whatever your Cloudflare/Pages URL is, or your custom domain).
  - **Redirect URLs**: add that same URL (and any other domain you open the app from, including a trailing-slash version). This **must** match where the app is served, or the magic link will bounce.
- **Email**: magic links work out of the box on Supabase's built-in email for low volume. For production reliability, set up your own SMTP under **Authentication → Emails → SMTP Settings**.

## Step 4 — Deploy the bulk-import Edge Function

Needed only for CSV student import. Two ways:

**Dashboard:** Edge Functions → **Create a function** → name it exactly `bulk-import` → paste the contents of `security/edge-functions/bulk-import/index.ts` → Deploy.

**Or CLI (PowerShell):**
```powershell
npm install -g supabase
supabase login
supabase link --project-ref daxwvgnkzvpokzrywzeo
supabase functions deploy bulk-import
```
The function reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the environment — **Supabase injects both automatically**, so you don't need to set any secrets. (The service-role key lives only inside the function, never in the app.)

## Step 5 — Create the first super-admin (you)

Nobody can sign in until at least one profile exists. Bootstrap yourself:

1. Dashboard → **Authentication** → **Users** → **Add user** → your email (tick "Auto Confirm" or send the invite). This creates your `auth.users` row.
2. Dashboard → **SQL Editor** → run (swap in your email):
   ```sql
   insert into public.profiles (id, role, school_id, display_name)
   select id, 'superadmin', null, 'Owner'
   from auth.users where email = 'you@yourschool.com'
   on conflict (id) do update set role = 'superadmin';
   ```
3. From now on you (super-admin) add everyone else: invite their email under **Authentication → Users**, then insert a `profiles` row with their `role` (`admin` / `instructor` / `junior`) and `school_id`. (A proper in-app "manage users" screen can come later — for now the dashboard is the source.)

## Step 6 — Ship the frontend (your normal flow)

Copy these four files from `outputs/` over the ones in your repo, then push:

- `app.js`
- `db.js`
- `index.html`
- `sw.js`

```powershell
git add .
git commit -m "Auth + RLS security rebuild"
git push origin main
```

The version bump (v46) makes the app offer existing users a one-tap update so they pick up the new sign-in.

---

## After deploying — smoke test (5 minutes)

1. Open the live app in a private window → you should see the **email sign-in** screen (no "view as guest").
2. Enter your email → "check your email" → tap the link → it should return to the app **signed in as super-admin**.
3. Invite a second email as an `instructor` for one school → sign in as them in another browser → confirm they see only that school and can't see admin-only actions.
4. Try the CSV student import as an admin → confirm students appear.

## What I could not verify for you (needs the live project)

Everything below depends on your Supabase project + email + domain, so you must confirm it yourself after Step 6:
- the magic-link round-trip and email delivery (Step 3),
- the Edge Function actually deployed (Step 4),
- the migration applied to your real data (Step 1),
- PWA install / offline / session-persistence on a real device.

The database policies themselves are verified: `security/run_rls_tests.sh` passes 82/82 against a real Postgres, and the client wiring passes its jsdom test 12/12.
