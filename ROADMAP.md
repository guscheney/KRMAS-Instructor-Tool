# KRMAS Instructor App — Roadmap

## ✅ Shipped (v38)

### Core
- Social feed (likes, comments, @mentions, attachments, required-reading with read receipts)
- Notices (unified into feed with type/expiry/pin)
- Calendar (month grid, multi-day, recurrence, colour-coded types, .ics export, bulk import)
- Roster (per-date edits, class assignments, cover requests with urgency badges)
- Lesson plans, incidents, topic library
- Grading manager (8 syllabi, sessions, belt stocktake/ordering)
- Student progressions and leadership pathways

### Admin
- Full school/location management (add, edit, delete, timetable editor)
- Instructor manager (roles, status, PIN, last login, bulk CSV/XLSX import)
- Groups (dynamic rules + static buckets)
- Class assignments per slot
- Class type mapping (override auto-detected timetable labels)
- Event types (colour-coded, school + network)
- Compliance (configurable requirements, expiry tracking, per-instructor status)
- Document library (superadmin PDF upload, in-app viewer)
- Dashboard (network overview, alerts, compliance summary, school breakdown)
- Reports (compliance, instructor, roster, events — downloadable CSV)
- Audit log, roster export

### Platform
- Supabase backend with localStorage fallback
- Realtime feed/comments/likes
- Dark mode (auto + manual toggle)
- Push notification client-side (VAPID ready)
- PWA with app icons, offline support
- KRMAS branding (logo, colours)

---

## 🔜 Next up

### Dashboard enhancements
- Cross-school compliance view (all schools in one table, not just current)
- Trend charts (instructor hours over time, class attendance patterns)
- Alert notifications for expiring compliance (email digest)

### Instructor onboarding workflow
- When a new instructor is added (manually or bulk import), auto-create a "welcome" checklist:
  - Set PIN
  - Read and acknowledge required documents
  - Upload compliance documents (WWC, First Aid)
  - Review code of conduct
- Track completion percentage per instructor
- Admin view showing who's completed onboarding vs who hasn't

### Reporting
- PDF report generation (formatted, branded — not just CSV)
- Scheduled email reports (weekly compliance digest to admins)
- Cross-school rollup reports for superadmins
- Grading history report per student
- Incident summary report (for insurance)

---

## 🗓 Planned

### Google Calendar sync
- Two-way sync: KRMAS events → instructor's personal Google Calendar
- Class roster changes create/update calendar events for assigned instructors
- Uses Google Calendar API (OAuth flow needed in-app)

### Parent/student portal
- Read-only view for parents/students
- Child's grading progress, upcoming events, school notices
- Separate access (link-based or simple PIN, no admin features)
- Could be a separate lightweight page served from the same deployment

### Messaging / DMs
- Instructor-to-instructor private messages
- Admin-to-instructor direct communication
- Sensitive topics that don't belong on the public feed

---

## 🔮 Future possibilities

### API layer
- REST API exposing Supabase data for external integrations
- Webhook endpoints for third-party systems (website forms, payment processors)
- OpenAPI spec for documentation

### Multi-tenant / white-label
- Make logo, colours, syllabi, and terminology configurable
- Any martial arts org (or sports club) with multiple locations could use it
- Separate config file per organisation

### Advanced features
- Recurring event exceptions (edit/cancel single occurrence)
- Offline write queue (retry failed Supabase writes when connection returns)
- Supabase Auth (proper JWT-based auth replacing PIN login)
- Supabase Storage (file uploads to buckets instead of base64 in database)
- Push notifications server-side (Supabase Edge Function deployment)
- Role-based data access via Supabase RLS (tighter security)
