# KRMAS Instructor App

A self-contained PWA for Kumiai Ryu Martial Arts instructor teams — roster, lesson plans, incidents, grading, students, social feed, notices, and a shared events calendar. Works fully offline on localStorage; syncs across devices and instructors when Supabase is configured.

**Live:** https://instructor-tool.guscheney.workers.dev/ (GitHub → Cloudflare Pages, ~30s auto-deploy)

## Features (v27)

- **Feed (home)** — Facebook-style wall: posts with likes, threaded comments, @mention autocomplete, photo/file attachments (auto-resized images, lightbox), targeting by school / group / role / network. Realtime updates (posts, likes, comments) when Supabase is connected.
- **Notices** — posts with a notice type (Info / Alert / Urgent), optional expiry, pin-to-top. Pinned/urgent notices also banner across the app.
- **Required reading** — admins mark posts as required; readers confirm with one tap; admins see live read receipts (who has / hasn't read). Unread required posts badge the Feed tab and sort first.
- **Events calendar** — month grid + agenda per school, head-office network events, colour-coded admin-managed event types, multi-day & all-day events, Google Maps location links, weekly/fortnightly/monthly recurrence, per-event and whole-calendar **.ics export**, upcoming-events strip on the Feed, CSV/XLSX bulk import with template.
- **Roster** — day view per school timetable (17 schools seeded), per-date edits, default class assignments per slot, cover requests (Take it / Assign) with urgency badges.
- **Lesson plans & incidents** — plan editor, topic library, incident reports with analytics, print / download / email export.
- **Grading manager** — 8 syllabi, sessions & candidates, printable A4 exam forms, belt stocktake, belt order calculator.
- **Students** — register, progressions, leadership pathways.
- **Admin panel** — instructor manager (roles, status, PIN reset, last-login), bulk user import (CSV/XLSX + template), groups (dynamic rules + static buckets), class assignments, event types, event import, audit log, roster export, Supabase migration.
- **Auth** — per-device PIN login, role hierarchy: superadmin > admin > instructor > junior > guest. On-leave instructors can still log in.

## Files

| File | Purpose |
|---|---|
| `index.html` | Shell, styles, all modals |
| `app.js` | Application logic |
| `db.js` | Storage adapter — Supabase with automatic localStorage fallback |
| `data.js` | Class types, topics, seed data |
| `schools.js` | 17 school timetables |
| `grading.js` | Syllabi, grade ladders, belt colours |
| `sw.js` / `manifest.json` / `icon-*.png` | PWA install & offline |
| `supabase_schema.sql` | Full database schema (idempotent — safe to re-run) |
| `KRMAS_Instructor_Import_Template.csv` | Bulk user import template |
| `KRMAS_Event_Import_Template.csv` | Bulk event import template |

## Enabling Supabase sync

1. Create a project at supabase.com
2. SQL Editor → paste `supabase_schema.sql` → Run
3. Settings → API → copy Project URL + anon key
4. In `index.html`, uncomment the config block and fill in:
   ```html
   <script>
     window.SUPABASE_URL  = 'https://YOUR_PROJECT.supabase.co';
     window.SUPABASE_ANON = 'YOUR_ANON_KEY';
   </script>
   ```
5. Deploy. The sync dot in the header turns green.
6. On a device with existing data: Me → Admin panel → ☁ Migrate data to Supabase (once).

Without Supabase everything still works — data just stays on each device.

## Deploying updates

Push to GitHub; Cloudflare Pages redeploys automatically. Bump the `CACHE` version in `sw.js` with every release so installed PWAs pick up the new files.
