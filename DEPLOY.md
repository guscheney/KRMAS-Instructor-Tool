# KRMAS Instructor App — Complete Deployment Guide (from scratch)

You need three things: a GitHub repo (stores the code), Cloudflare Pages (hosts the website), and Supabase (shared database so instructors see each other's data). All three have free tiers that will handle this forever.

---

## Step 1: Supabase (database)

1. Go to **https://supabase.com** → Sign up (GitHub login works)
2. Click **New Project**
   - Organisation: create one or use default
   - Name: `krmas-roster`
   - Database password: generate one and **save it** (you won't need it in the app but keep it safe)
   - Region: pick **Southeast Asia (Singapore)** — closest to AU
   - Click **Create new project** — takes ~2 minutes

3. Once ready, go to **SQL Editor** (left sidebar) → **New query**
4. Paste the **entire contents** of `supabase_schema.sql` into the editor
5. Click **Run** — you should see "Success. No rows returned" for each statement
6. If any statement fails, that's OK — the schema is idempotent, just re-run it

7. Go to **Settings** (gear icon, bottom left) → **API**
8. Copy two values:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon public** key — the long string under "Project API keys"

9. Now enable Realtime for the tables that need it:
   - Go to **Database** → **Replication** (left sidebar, under Database)
   - Under "Supabase Realtime", make sure these tables have the toggle ON:
     - `feed_posts`
     - `feed_comments`
     - `feed_likes`
     - `notices`
   - (The schema already set `replica identity full` on these, but the Realtime toggle in the dashboard needs to be on too)

---

## Step 2: Configure the app

Open `index.html` in any text editor. Find this block near the bottom (around line 2023):

```html
<!-- Supabase config — set your project URL and anon key here to enable sync.
     Leave blank to use localStorage only.
<script>
  window.SUPABASE_URL  = 'https://YOUR_PROJECT.supabase.co';
  window.SUPABASE_ANON = 'YOUR_ANON_KEY';
</script>
-->
```

Replace it with (removing the comment wrappers):

```html
<!-- Supabase config -->
<script>
  window.SUPABASE_URL  = 'https://abcdefgh.supabase.co';
  window.SUPABASE_ANON = 'eyJhbGci...your-actual-anon-key...';
</script>
```

Save the file.

---

## Step 3: GitHub (code storage)

1. Go to **https://github.com** → Sign up or sign in
2. Click the **+** (top right) → **New repository**
   - Name: `krmas-roster`
   - Visibility: **Private** (your instructor PINs are in the code)
   - Don't tick "Add a README" (we have one)
   - Click **Create repository**

3. GitHub shows you a page with commands. You need to **push existing files**. On your computer:

**Option A — if you have Git installed (Mac/Linux/WSL):**
```bash
cd ~/Downloads/krmas-roster          # wherever you saved the files
git init
git add .
git commit -m "KRMAS Instructor App v27"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/krmas-roster.git
git push -u origin main
```

**Option B — no Git, just upload via browser:**
- On the GitHub repo page, click **"uploading an existing file"**
- Drag ALL 14 files into the upload area:
  - `index.html`, `app.js`, `db.js`, `data.js`, `schools.js`, `grading.js`
  - `sw.js`, `manifest.json`, `README.md`, `DEPLOY.md`
  - `supabase_schema.sql`
  - `icon-192.png`, `icon-512.png`
  - `KRMAS_Instructor_Import_Template.csv`, `KRMAS_Event_Import_Template.csv`
- Click **Commit changes**

---

## Step 4: Cloudflare Pages (hosting)

1. Go to **https://dash.cloudflare.com** → Sign up or sign in
2. Left sidebar → **Workers & Pages**
3. Click **Create** → **Pages** tab → **Connect to Git**
4. Authorise Cloudflare to access your GitHub account
5. Select the `krmas-roster` repository
6. Configure build:
   - **Project name:** `instructor-tool` (or whatever you want — this becomes the URL)
   - **Production branch:** `main`
   - **Framework preset:** `None`
   - **Build command:** leave **empty** (it's a static site, no build step)
   - **Build output directory:** `/` (just a forward slash — serve the root)
7. Click **Save and Deploy**
8. Wait ~30 seconds — Cloudflare deploys it
9. Your app is now live at: **https://instructor-tool.pages.dev**

---

## Step 5: Verify everything works

1. Open your live URL in a browser
2. You should see:
   - The KRMAS logo in the header
   - The Feed tab active (home page)
   - The sync dot in the header should be **green** (meaning Supabase is connected)
3. Select Edgeworth as your school
4. Sign in as **Gus** (PIN: 0000)
5. Go to **Me** → **⚙ Admin panel** → you should see all the buttons
6. Create a test post on the Feed — it should save
7. Open the same URL on a different device/browser → sign in as a different instructor → you should see the same post

If the sync dot is grey/not green, the Supabase config isn't being read — double-check you removed the `<!--` and `-->` comment wrappers around the `<script>` block.

---

## Step 6: Migrate existing local data (if any)

If you've been using the app locally and have existing roster edits, plans, incidents etc:

1. Sign in as superadmin (Gus)
2. Go to **Me** → **⚙ Admin panel**
3. Tap **☁ Migrate data to Supabase**
4. Confirm — it copies everything from localStorage to the cloud
5. Do this once per device that has data you want to keep

---

## Updating the app

Whenever you get new files from a build session:

1. Replace the files in your local copy
2. Push to GitHub:
   ```bash
   cd ~/krmas-roster
   git add .
   git commit -m "v28 — description of changes"
   git push
   ```
   Or drag-and-drop the changed files on GitHub's web UI
3. Cloudflare automatically redeploys within ~30 seconds
4. Users' PWAs pick up the new service worker and update on next visit

---

## Custom domain (optional)

If you want `roster.krmas.com.au` instead of `instructor-tool.pages.dev`:

1. In Cloudflare Pages → your project → **Custom domains** → **Set up a custom domain**
2. Enter `roster.krmas.com.au`
3. Add the CNAME record Cloudflare tells you to your DNS (wherever krmas.com.au is hosted)
4. Wait for SSL — usually takes a few minutes

---

## File inventory (14 files)

| File | What it does |
|---|---|
| `index.html` | App shell, all styles, all 27 modals, Supabase config |
| `app.js` | All application logic (6500+ lines) |
| `db.js` | Storage adapter — Supabase ↔ localStorage |
| `data.js` | Class types, topics, seed data |
| `schools.js` | 17 school timetables |
| `grading.js` | 8 syllabi, grade ladders, belt colours |
| `sw.js` | Service worker for offline/PWA |
| `manifest.json` | PWA manifest (name, icons, theme) |
| `icon-192.png` | App icon (home screen) |
| `icon-512.png` | App icon (splash screen) |
| `supabase_schema.sql` | Database schema (run once in Supabase SQL editor) |
| `README.md` | Project documentation |
| `DEPLOY.md` | This guide |
| `KRMAS_Instructor_Import_Template.csv` | Bulk user import template |
| `KRMAS_Event_Import_Template.csv` | Bulk event import template |

---

## Troubleshooting

**App loads but sync dot is grey:**
→ Supabase config not active. Open `index.html`, make sure the `<script>` with `SUPABASE_URL` is NOT inside HTML comments.

**"Failed to register service worker":**
→ The site must be served over HTTPS. Cloudflare Pages handles this automatically. If testing locally, use `python3 -m http.server` but SW won't work without HTTPS (use localhost which is exempted).

**Posts/events don't appear on other devices:**
→ Supabase not connected (check sync dot). Or RLS policies not applied — re-run `supabase_schema.sql`.

**"relation kv_store does not exist":**
→ Schema hasn't been run. Go to Supabase → SQL Editor → paste and run `supabase_schema.sql`.

**Old service worker cached:**
→ Users on the old version need to close all tabs and reopen. The new `sw.js` cache version (`krmas-roster-v27`) forces the old cache to be deleted.
