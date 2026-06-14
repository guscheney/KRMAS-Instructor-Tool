-- ====================================================================
-- KRMAS Roster — Supabase Schema v2
-- Run this entire script in Supabase SQL Editor (Dashboard → SQL Editor)
-- It is idempotent — safe to run again if already partially applied.
-- ====================================================================

-- ── kv_store — blob storage for per-school app data ─────────────────
-- Stores roster edits, lesson plans, incidents, students, progressions,
-- pathways, pin overrides, grading data, and custom school config.
create table if not exists kv_store (
  id         bigserial    primary key,
  school_id  text         not null default 'global',
  key        text         not null,
  value      jsonb        not null default '{}',
  updated_at timestamptz  not null default now(),
  updated_by text,
  constraint kv_store_school_key unique (school_id, key)
);
create index if not exists kv_store_lookup on kv_store (school_id, key);

-- Helper: upsert a kv row (used by the app's sbSet function)
create or replace function upsert_kv(
  p_school_id  text,
  p_key        text,
  p_value      jsonb,
  p_updated_by text default null
) returns void language plpgsql as $$
begin
  insert into kv_store (school_id, key, value, updated_at, updated_by)
  values (p_school_id, p_key, p_value, now(), p_updated_by)
  on conflict (school_id, key)
  do update set
    value      = excluded.value,
    updated_at = now(),
    updated_by = excluded.updated_by;
end;
$$;

-- ── notices ──────────────────────────────────────────────────────────
create table if not exists notices (
  id         text         primary key,
  school_id  text,                    -- null = network-wide (all schools)
  type       text         not null default 'info'
             check (type in ('info','alert','urgent')),
  title      text         not null,
  body       text,
  expires_at date,
  pinned     boolean      not null default false,
  created_by text,
  created_at timestamptz  not null default now(),
  updated_at timestamptz  not null default now()
);
create index if not exists notices_school   on notices (school_id)       where school_id is not null;
create index if not exists notices_network  on notices (created_at desc) where school_id is null;

-- ── feed_posts ───────────────────────────────────────────────────────
create table if not exists feed_posts (
  id            text        primary key,
  school_id     text,                  -- null = network-wide post
  author_id     text        not null,
  author_name   text        not null,
  author_role   text,
  body          text        not null,
  media_urls    jsonb       not null default '[]',
  -- Who can see this post
  target_scope  text        not null default 'school'
                check (target_scope in ('network','school','group','role')),
  target_ids    jsonb       not null default '[]', -- group ids / role names / school ids
  -- Cached counters (refreshed on write)
  like_count    int         not null default 0,
  comment_count int         not null default 0,
  pinned        boolean     not null default false,
  edited        boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists feed_posts_school  on feed_posts (school_id, created_at desc);
create index if not exists feed_posts_network on feed_posts (created_at desc) where target_scope = 'network';

-- ── feed_comments ────────────────────────────────────────────────────
create table if not exists feed_comments (
  id          text        primary key,
  post_id     text        not null references feed_posts(id) on delete cascade,
  author_id   text        not null,
  author_name text        not null,
  author_role text,
  body        text        not null,
  edited      boolean     not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists feed_comments_post on feed_comments (post_id, created_at asc);

-- ── feed_likes ───────────────────────────────────────────────────────
create table if not exists feed_likes (
  post_id    text        not null references feed_posts(id) on delete cascade,
  user_id    text        not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ── groups ───────────────────────────────────────────────────────────
-- Both dynamic (rule-based) and static (manual member list).
create table if not exists groups (
  id          text        primary key,
  school_id   text,                    -- null = network-wide group
  name        text        not null,
  description text,
  -- Dynamic rules: [{field: 'state'|'role'|'school'|'syllabus', op: 'eq'|'in', value: any}]
  rules       jsonb       not null default '[]',
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── group_members — static additions to a group ──────────────────────
create table if not exists group_members (
  group_id   text        not null references groups(id) on delete cascade,
  user_id    text        not null,
  school_id  text,
  added_by   text,
  added_at   timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- ── class_assignments — default instructor per recurring slot ────────
-- Represents the designated lead/assist for a weekly schedule slot.
-- Different from roster_edits (date-specific overrides stored in kv_store).
create table if not exists class_assignments (
  id            bigserial   primary key,
  school_id     text        not null,
  instructor_id text        not null,
  -- Slot key matches rosterForDay key: "{dow}-{start}-{type}"
  -- e.g. "1-16:00-little-ninjas"
  slot_key      text        not null,
  role          text        not null default 'lead'
                check (role in ('lead','assist','junior','backup')),
  created_at    timestamptz not null default now(),
  constraint class_assignments_slot_role unique (school_id, slot_key, role)
);
create index if not exists class_assignments_school on class_assignments (school_id, instructor_id);

-- ── Realtime — enable for live feed/notice updates ───────────────────
alter table feed_posts    replica identity full;
alter table feed_comments replica identity full;
alter table feed_likes    replica identity full;
alter table notices       replica identity full;

-- ── Row Level Security — using anon key ──────────────────────────────
-- The app manages its own auth via PIN. All Supabase operations use the
-- anon key with permissive policies. Tighten in production with JWT auth.
alter table kv_store          enable row level security;
alter table notices           enable row level security;
alter table feed_posts        enable row level security;
alter table feed_comments     enable row level security;
alter table feed_likes        enable row level security;
alter table groups            enable row level security;
alter table group_members     enable row level security;
alter table class_assignments enable row level security;

-- Drop existing policies first (safe re-run)
do $$ begin
  drop policy if exists "anon_all_kv"          on kv_store;
  drop policy if exists "anon_all_notices"      on notices;
  drop policy if exists "anon_all_posts"        on feed_posts;
  drop policy if exists "anon_all_comments"     on feed_comments;
  drop policy if exists "anon_all_likes"        on feed_likes;
  drop policy if exists "anon_all_groups"       on groups;
  drop policy if exists "anon_all_members"      on group_members;
  drop policy if exists "anon_all_assignments"  on class_assignments;
exception when others then null;
end $$;

create policy "anon_all_kv"         on kv_store          for all to anon using (true) with check (true);
create policy "anon_all_notices"    on notices           for all to anon using (true) with check (true);
create policy "anon_all_posts"      on feed_posts        for all to anon using (true) with check (true);
create policy "anon_all_comments"   on feed_comments     for all to anon using (true) with check (true);
create policy "anon_all_likes"      on feed_likes        for all to anon using (true) with check (true);
create policy "anon_all_groups"     on groups            for all to anon using (true) with check (true);
create policy "anon_all_members"    on group_members     for all to anon using (true) with check (true);
create policy "anon_all_assignments" on class_assignments for all to anon using (true) with check (true);

-- ── v25 additions: notice posts, required reading, acknowledgements ──
-- Idempotent — safe to run on existing databases.
alter table feed_posts add column if not exists notice_type      text;
alter table feed_posts add column if not exists required_reading boolean not null default false;
alter table feed_posts add column if not exists expires_at       date;

create table if not exists post_acks (
  post_id   text        not null references feed_posts(id) on delete cascade,
  user_id   text        not null,
  user_name text,
  acked_at  timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table post_acks enable row level security;
alter table post_acks replica identity full;

do $$ begin
  drop policy if exists "anon_all_acks" on post_acks;
exception when others then null;
end $$;
create policy "anon_all_acks" on post_acks for all to anon using (true) with check (true);

-- ── v26 additions: calendar events + event types ─────────────────────
create table if not exists calendar_events (
  id          text        primary key,
  school_id   text,                 -- null = network-wide (head office)
  title       text        not null,
  description text,
  location    text,                 -- free-text address (Google Maps link in app)
  start_date  date        not null,
  end_date    date        not null, -- inclusive; equals start_date for single-day
  start_time  text,                 -- 'HH:MM', null = all-day
  end_time    text,
  type_id     text,                 -- loose reference to event_types.id
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists calendar_events_school on calendar_events (school_id, start_date);
create index if not exists calendar_events_network on calendar_events (start_date) where school_id is null;

create table if not exists event_types (
  id         text        primary key,
  school_id  text,                  -- null = network type (head office)
  name       text        not null,
  colour     text        not null default '#3b82f6',
  created_by text,
  created_at timestamptz not null default now()
);

alter table calendar_events enable row level security;
alter table event_types     enable row level security;

do $$ begin
  drop policy if exists "anon_all_cal_events" on calendar_events;
  drop policy if exists "anon_all_event_types" on event_types;
exception when others then null;
end $$;
create policy "anon_all_cal_events" on calendar_events for all to anon using (true) with check (true);
create policy "anon_all_event_types" on event_types     for all to anon using (true) with check (true);

-- ── v28 additions: document library ──────────────────────────────────
create table if not exists documents (
  id          text        primary key,
  school_id   text,                 -- null = network-wide (all schools)
  title       text        not null,
  description text,
  category    text,                 -- e.g. 'Syllabus', 'Policy', 'Form'
  filename    text        not null,
  mime_type   text        not null,
  file_size   bigint      not null default 0,
  file_data   text,                 -- base64 data URL
  uploaded_by text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists documents_school on documents (school_id, category, created_at desc);

-- v41: per-instructor (personal) documents — instructor_id non-null means a personal doc
alter table documents add column if not exists instructor_id text;
create index if not exists documents_instructor on documents (instructor_id) where instructor_id is not null;

alter table documents enable row level security;
do $$ begin
  drop policy if exists "anon_all_documents" on documents;
exception when others then null;
end $$;
create policy "anon_all_documents" on documents for all to anon using (true) with check (true);

-- ── v30 additions: instructor compliance ─────────────────────────────
create table if not exists compliance_requirements (
  id          text        primary key,
  school_id   text,                 -- null = network-wide (all schools)
  name        text        not null, -- e.g. 'Working With Children Check'
  has_expiry  boolean     not null default true,
  description text,
  created_by  text,
  created_at  timestamptz not null default now()
);

create table if not exists instructor_compliance (
  id              text        primary key,
  school_id       text        not null,
  instructor_id   text        not null,
  requirement_id  text        not null,
  status          text        not null default 'pending'
                  check (status in ('valid','expired','pending','exempt','not_started')),
  expiry_date     date,
  reference_number text,      -- cert number, WWC number, etc.
  notes           text,
  updated_by      text,
  updated_at      timestamptz not null default now(),
  constraint instructor_compliance_unique unique (school_id, instructor_id, requirement_id)
);
create index if not exists compliance_instr on instructor_compliance (school_id, instructor_id);

alter table compliance_requirements enable row level security;
alter table instructor_compliance   enable row level security;

do $$ begin
  drop policy if exists "anon_all_comp_reqs"    on compliance_requirements;
  drop policy if exists "anon_all_comp_records"  on instructor_compliance;
exception when others then null;
end $$;
create policy "anon_all_comp_reqs"   on compliance_requirements for all to anon using (true) with check (true);
create policy "anon_all_comp_records" on instructor_compliance   for all to anon using (true) with check (true);

-- ── v30 additions: push notification subscriptions ───────────────────
create table if not exists push_subscriptions (
  id            bigserial   primary key,
  user_id       text        not null,
  school_id     text        not null,
  endpoint      text        not null unique,
  keys_p256dh   text        not null,
  keys_auth     text        not null,
  created_at    timestamptz not null default now()
);
create index if not exists push_sub_user on push_subscriptions (user_id, school_id);

alter table push_subscriptions enable row level security;
do $$ begin
  drop policy if exists "anon_all_push" on push_subscriptions;
exception when others then null;
end $$;
create policy "anon_all_push" on push_subscriptions for all to anon using (true) with check (true);

-- ── v39 additions: instructor onboarding ─────────────────────────────
create table if not exists onboarding_checklists (
  id              text        primary key,
  school_id       text        not null,
  instructor_id   text        not null,
  items           jsonb       not null default '[]',
  -- items: [{ key, label, required, completed, completedAt }]
  status          text        not null default 'pending'
                  check (status in ('pending','in_progress','complete')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint onboarding_unique unique (school_id, instructor_id)
);
alter table onboarding_checklists enable row level security;
do $$ begin
  drop policy if exists "anon_all_onboarding" on onboarding_checklists;
exception when others then null;
end $$;
create policy "anon_all_onboarding" on onboarding_checklists for all to anon using (true) with check (true);
