-- ============================================================================
-- KRMAS — Authentication & Authorization migration (production)
-- Apply order is top-to-bottom; every statement is idempotent (re-runnable).
-- Pairs with Supabase Auth (magic-link). The anon key stays public; RLS is the boundary.
-- ============================================================================

create extension if not exists pgcrypto;

-- Idempotency: drop every existing policy on public tables so this migration is
-- safely re-runnable (recreated below). Also clears the legacy anon "using(true)" policies.
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 1. profiles — single source of truth for who a user is and what they may do
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email        text,
  role         text not null default 'junior'
               check (role in ('superadmin','admin','instructor','junior')),
  school_id    text,                       -- null only for superadmin (network-wide)
  pin_hash     text,                       -- optional on-device quick-unlock (hashed)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.profiles add column if not exists email text;  -- for existing installs
-- Multi-school membership. `school_id` stays the "home" school (drives the default
-- view + the school_id JWT claim); `schools` is the full set a user may act in. Only
-- instructors are multi-school; admins/superadmin keep one (or null for superadmin).
alter table public.profiles add column if not exists schools text[];
update public.profiles
   set schools = array[school_id]
 where (schools is null or array_length(schools,1) is null)
   and school_id is not null;
alter table public.profiles enable row level security;

-- ----------------------------------------------------------------------------
-- 2. Helper functions (SECURITY DEFINER → bypass RLS safely, no recursion)
--    Hot path reads role/school from the JWT claim; falls back to a definer
--    lookup so freshly-changed roles still resolve before the next token refresh.
-- ----------------------------------------------------------------------------
create or replace function public.current_app_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(auth.jwt() ->> 'app_role',''),
    (select role from public.profiles where id = auth.uid()),
    'guest'
  );
$$;

create or replace function public.current_school_id() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(auth.jwt() ->> 'school_id',''),
    (select school_id from public.profiles where id = auth.uid())
  );
$$;

-- The full set of schools the caller may act in. Prefers the JWT 'schools' claim;
-- falls back to profiles.schools so a freshly-changed membership resolves before the
-- next token refresh; finally falls back to the single home school.
create or replace function public.my_schools() returns text[]
language sql stable security definer set search_path = public as $$
  with j as (
    select case when jsonb_typeof(auth.jwt() -> 'schools') = 'array'
                then array(select jsonb_array_elements_text(auth.jwt() -> 'schools'))
                else null end as s
  ),
  p as ( select schools as s from public.profiles where id = auth.uid() )
  select coalesce(
    (select s from j where s is not null and array_length(s,1) >= 1),
    (select s from p where s is not null and array_length(s,1) >= 1),
    case when current_school_id() is not null then array[current_school_id()]
         else array[]::text[] end
  );
$$;

create or replace function public.role_rank(r text) returns int
language sql immutable as $$
  select case r when 'superadmin' then 4 when 'admin' then 3
                when 'instructor' then 2 when 'junior' then 1 else 0 end;
$$;

create or replace function public.has_min_role(min_role text) returns boolean
language sql stable as $$ select role_rank(current_app_role()) >= role_rank(min_role); $$;

create or replace function public.is_admin()      returns boolean
language sql stable as $$ select has_min_role('admin'); $$;

create or replace function public.is_superadmin() returns boolean
language sql stable as $$ select current_app_role() = 'superadmin'; $$;

-- Row belongs to the caller's school (superadmin sees all). For tables that ALSO
-- have network rows (school_id null) readable by everyone, see can_read_scope().
create or replace function public.my_school(row_school text) returns boolean
language sql stable as $$ select is_superadmin() or row_school = any(my_schools()); $$;

create or replace function public.can_read_scope(row_school text) returns boolean
language sql stable as $$
  select is_superadmin() or row_school is null or row_school = any(my_schools());
$$;

-- ----------------------------------------------------------------------------
-- 3. Custom access-token hook — injects app_role + school_id into the JWT.
--    Registered in the Supabase dashboard (Auth → Hooks). GoTrue calls it.
-- ----------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable as $$
declare claims jsonb; r text; s text; sch text[];
begin
  select role, school_id, schools into r, s, sch
    from public.profiles where id = (event->>'user_id')::uuid;
  claims := coalesce(event->'claims','{}'::jsonb);
  if r is not null then
    claims := jsonb_set(claims, '{app_role}',  to_jsonb(r));
    claims := jsonb_set(claims, '{school_id}', coalesce(to_jsonb(s), 'null'::jsonb));
    -- Full membership set; defaults to [home] when not explicitly set.
    claims := jsonb_set(claims, '{schools}',
      coalesce(to_jsonb(case when sch is not null and array_length(sch,1) >= 1 then sch
                             when s is not null then array[s]
                             else array[]::text[] end), '[]'::jsonb));
  end if;
  return jsonb_set(event, '{claims}', claims);
end; $$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on public.profiles to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- ----------------------------------------------------------------------------
-- 4. profiles RLS + privilege-escalation guard
-- ----------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using ( id = auth.uid()
          or is_superadmin()
          or (is_admin() and school_id = current_school_id()) );

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check ( is_superadmin() or (is_admin() and school_id = current_school_id()) );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using ( id = auth.uid() ) with check ( id = auth.uid() );

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated
  using ( is_superadmin() or (is_admin() and school_id = current_school_id()) )
  with check ( is_superadmin() or (is_admin() and school_id = current_school_id()) );

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated
  using ( is_superadmin() or (is_admin() and school_id = current_school_id()) );

-- Trigger enforces: nobody escalates their own role/school; school admins may not
-- grant superadmin nor move users to another school. Superadmin may do anything.
create or replace function public.guard_profile_changes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- This guard only constrains authenticated END-USERS acting through the app.
  -- Trusted backend contexts (SQL editor as postgres, Edge Functions as service_role)
  -- carry no end-user JWT, so auth.uid() is null — let them through.
  if auth.uid() is null then return new; end if;
  if is_superadmin() then return new; end if;
  if is_admin() then
    if new.role = 'superadmin' then
      raise exception 'Only a superadmin may grant the superadmin role';
    end if;
    if new.school_id is distinct from current_school_id() then
      raise exception 'Admins may only manage their own school';
    end if;
    return new;
  end if;
  -- non-admin editing own profile: role, school and membership are immutable
  if new.role is distinct from old.role
     or new.school_id is distinct from old.school_id
     or new.schools is distinct from old.schools then
    raise exception 'You cannot change your own role or school';
  end if;
  return new;
end; $$;
drop trigger if exists trg_guard_profiles on public.profiles;
create trigger trg_guard_profiles before update on public.profiles
  for each row execute function public.guard_profile_changes();

-- ----------------------------------------------------------------------------
-- 5. Normalized sensitive tables (moved out of kv_store blobs)
-- ----------------------------------------------------------------------------
create table if not exists public.students (
  id         text primary key,
  school_id  text not null,
  name       text not null,
  dob        date,                          -- full DOB retained (owner decision); read-gated
  member_num text,
  source     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.students enable row level security;

create table if not exists public.incidents (
  id         text primary key,
  school_id  text not null,
  data       jsonb not null default '{}',   -- incident detail payload
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.incidents enable row level security;

-- students: view IN+, add/edit JR+, delete AD+
create policy students_select on public.students for select to authenticated
  using ( has_min_role('instructor') and my_school(school_id) );
create policy students_insert on public.students for insert to authenticated
  with check ( has_min_role('junior') and my_school(school_id) );
create policy students_update on public.students for update to authenticated
  using ( has_min_role('junior') and my_school(school_id) )
  with check ( has_min_role('junior') and my_school(school_id) );
create policy students_delete on public.students for delete to authenticated
  using ( has_min_role('admin') and my_school(school_id) );

-- incidents: view IN+, file JR+ (stamped author), edit/delete AD+
create policy incidents_select on public.incidents for select to authenticated
  using ( has_min_role('instructor') and my_school(school_id) );
create policy incidents_insert on public.incidents for insert to authenticated
  with check ( has_min_role('junior') and my_school(school_id) and created_by = auth.uid() );
create policy incidents_update on public.incidents for update to authenticated
  using ( has_min_role('admin') and my_school(school_id) )
  with check ( has_min_role('admin') and my_school(school_id) );
create policy incidents_delete on public.incidents for delete to authenticated
  using ( has_min_role('admin') and my_school(school_id) );

-- ----------------------------------------------------------------------------
-- 6. Drop ALL legacy anon "using(true)" policies on the 16 existing tables
-- ----------------------------------------------------------------------------
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
      and policyname like 'anon\_all\_%'
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 7. RLS on the record tables (per the role × table × operation matrix)
-- ----------------------------------------------------------------------------

-- notices: read all (school ∪ network); write admin (network → superadmin)
create policy notices_select on public.notices for select to authenticated
  using ( can_read_scope(school_id) );
create policy notices_write on public.notices for all to authenticated
  using ( case when school_id is null then is_superadmin()
               else is_admin() and school_id = current_school_id() end )
  with check ( case when school_id is null then is_superadmin()
                    else is_admin() and school_id = current_school_id() end );

-- feed_posts: read (network ∪ own-school ∪ role-target ∪ group-member); author-stamped writes
create policy feed_posts_select on public.feed_posts for select to authenticated
  using (
    can_read_scope(school_id)
    and (
      target_scope in ('network','school')
      or (target_scope = 'role'  and target_ids ? current_app_role())
      or (target_scope = 'group' and exists (
            select 1 from public.group_members gm
            where gm.user_id = auth.uid()::text and gm.group_id = any (
              select jsonb_array_elements_text(target_ids))))
      or author_id = auth.uid()::text
    )
  );
create policy feed_posts_insert on public.feed_posts for insert to authenticated
  with check ( author_id = auth.uid()::text and can_read_scope(school_id) );
create policy feed_posts_update on public.feed_posts for update to authenticated
  using ( author_id = auth.uid()::text or is_admin() )
  with check ( author_id = auth.uid()::text or is_admin() );
create policy feed_posts_delete on public.feed_posts for delete to authenticated
  using ( author_id = auth.uid()::text or is_admin() );

-- feed_comments: visible if the parent post is; author-stamped
create policy feed_comments_select on public.feed_comments for select to authenticated
  using ( exists (select 1 from public.feed_posts fp where fp.id = post_id) );
create policy feed_comments_insert on public.feed_comments for insert to authenticated
  with check ( author_id = auth.uid()::text );
create policy feed_comments_update on public.feed_comments for update to authenticated
  using ( author_id = auth.uid()::text or is_admin() )
  with check ( author_id = auth.uid()::text or is_admin() );
create policy feed_comments_delete on public.feed_comments for delete to authenticated
  using ( author_id = auth.uid()::text or is_admin() );

-- feed_likes / post_acks: a user manages only their own row
create policy feed_likes_select on public.feed_likes for select to authenticated using ( true );
create policy feed_likes_ins on public.feed_likes for insert to authenticated
  with check ( user_id = auth.uid()::text );
create policy feed_likes_del on public.feed_likes for delete to authenticated
  using ( user_id = auth.uid()::text );

create policy post_acks_select on public.post_acks for select to authenticated
  using ( user_id = auth.uid()::text or is_admin() );
create policy post_acks_ins on public.post_acks for insert to authenticated
  with check ( user_id = auth.uid()::text );
create policy post_acks_del on public.post_acks for delete to authenticated
  using ( user_id = auth.uid()::text );

-- groups / group_members: read all; write admin (network groups → superadmin)
create policy groups_select on public.groups for select to authenticated
  using ( can_read_scope(school_id) );
create policy groups_write on public.groups for all to authenticated
  using ( case when school_id is null then is_superadmin()
               else is_admin() and school_id = current_school_id() end )
  with check ( case when school_id is null then is_superadmin()
                    else is_admin() and school_id = current_school_id() end );
create policy gm_select on public.group_members for select to authenticated using ( true );
create policy gm_write on public.group_members for all to authenticated
  using ( is_admin() ) with check ( is_admin() );

-- class_assignments: read own-school; write admin (editRoster)
create policy ca_select on public.class_assignments for select to authenticated
  using ( my_school(school_id) );
create policy ca_write on public.class_assignments for all to authenticated
  using ( is_admin() and my_school(school_id) )
  with check ( is_admin() and my_school(school_id) );

-- calendar_events / event_types: read all; write admin+ only (owner decision)
create policy cal_select on public.calendar_events for select to authenticated
  using ( can_read_scope(school_id) );
create policy cal_write on public.calendar_events for all to authenticated
  using ( case when school_id is null then is_superadmin()
               else is_admin() and school_id = current_school_id() end )
  with check ( case when school_id is null then is_superadmin()
                    else is_admin() and school_id = current_school_id() end );
create policy et_select on public.event_types for select to authenticated
  using ( can_read_scope(school_id) );
create policy et_write on public.event_types for all to authenticated
  using ( case when school_id is null then is_superadmin()
               else is_admin() and school_id = current_school_id() end )
  with check ( case when school_id is null then is_superadmin()
                    else is_admin() and school_id = current_school_id() end );

-- documents: read all (school ∪ network); write admin
create policy docs_select on public.documents for select to authenticated
  using ( can_read_scope(school_id) );
create policy docs_write on public.documents for all to authenticated
  using ( case when school_id is null then is_superadmin()
               else is_admin() and school_id = current_school_id() end )
  with check ( case when school_id is null then is_superadmin()
                    else is_admin() and school_id = current_school_id() end );

-- compliance_requirements: read IN+; write admin
create policy compreq_select on public.compliance_requirements for select to authenticated
  using ( has_min_role('instructor') and can_read_scope(school_id) );
create policy compreq_write on public.compliance_requirements for all to authenticated
  using ( case when school_id is null then is_superadmin()
               else is_admin() and school_id = current_school_id() end )
  with check ( case when school_id is null then is_superadmin()
                    else is_admin() and school_id = current_school_id() end );

-- instructor_compliance: admin of school; an instructor may read only their OWN records
create policy ic_select on public.instructor_compliance for select to authenticated
  using ( (is_admin() and my_school(school_id))
          or instructor_id = auth.uid()::text );
create policy ic_write on public.instructor_compliance for all to authenticated
  using ( is_admin() and my_school(school_id) )
  with check ( is_admin() and my_school(school_id) );

-- push_subscriptions: a user manages only their own (Edge Fn reads all via service_role)
create policy push_select on public.push_subscriptions for select to authenticated
  using ( user_id = auth.uid()::text );
create policy push_write on public.push_subscriptions for all to authenticated
  using ( user_id = auth.uid()::text ) with check ( user_id = auth.uid()::text );

-- ----------------------------------------------------------------------------
-- 8. kv_store — remaining JSONB blobs. key = namespace, school_id = school.
--    students/incidents migrated out; pin-overrides dropped → all denied here.
-- ----------------------------------------------------------------------------
create or replace function public.kv_min_read_role(ns text) returns text
language sql immutable as $$
  select case ns
    when 'lesson-plans'         then 'junior'
    when 'progressions'         then 'junior'
    when 'roster-edits'         then 'junior'
    when 'class-type-overrides' then 'junior'
    when 'custom-schools'       then 'junior'
    when 'school-seed'          then 'junior'
    when 'pathways'             then 'instructor'
    when 'grading'              then 'instructor'
    when 'last-login'           then 'instructor'
    else 'superadmin' end;     -- unknown / migrated-away keys: locked
$$;
create or replace function public.kv_min_write_role(ns text) returns text
language sql immutable as $$
  select case ns
    when 'lesson-plans'         then 'junior'
    when 'progressions'         then 'junior'
    when 'last-login'           then 'junior'
    when 'roster-edits'         then 'junior'   -- instructors flag cover, juniors volunteer (school-scoped)
    when 'pathways'             then 'admin'
    when 'grading'              then 'admin'
    when 'class-type-overrides' then 'admin'
    when 'custom-schools'       then 'admin'
    when 'school-seed'          then 'admin'
    else 'superadmin' end;
$$;

create policy kv_select on public.kv_store for select to authenticated
  using (
    key not in ('students','incidents','pin-overrides')
    and has_min_role(kv_min_read_role(key))
    and ( is_superadmin() or school_id = any(my_schools()) or school_id in ('network','global') )
  );
create policy kv_write on public.kv_store for all to authenticated
  using (
    key not in ('students','incidents','pin-overrides')
    and has_min_role(kv_min_write_role(key))
    and ( is_superadmin() or school_id = any(my_schools())
          or (school_id in ('network','global') and is_admin()) )
  )
  with check (
    key not in ('students','incidents','pin-overrides')
    and has_min_role(kv_min_write_role(key))
    and ( is_superadmin() or school_id = any(my_schools())
          or (school_id in ('network','global') and is_admin()) )
  );

-- ----------------------------------------------------------------------------
-- 9. Audit log — admin-readable; written only via SECURITY DEFINER triggers
-- ----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  actor_role text,
  school_id  text,
  action     text not null,             -- e.g. 'role_change','delete','incident_edit'
  table_name text,
  row_id     text,
  detail     jsonb
);
alter table public.audit_log enable row level security;
create policy audit_select on public.audit_log for select to authenticated
  using ( is_admin() and (is_superadmin() or school_id = current_school_id()) );
-- No insert/update/delete policy → clients cannot write it; only definer triggers can.

create or replace function public.audit_writer() returns trigger
language plpgsql security definer set search_path = public as $$
declare nj jsonb := coalesce(to_jsonb(new),'{}'::jsonb);
        oj jsonb := coalesce(to_jsonb(old),'{}'::jsonb);
        rid text; sch text; act text; det jsonb;
begin
  rid := coalesce(nj->>'id', oj->>'id');
  sch := coalesce(nj->>'school_id', oj->>'school_id');
  if tg_table_name = 'profiles' and tg_op = 'UPDATE'
       and ( (nj->>'role')      is distinct from (oj->>'role')
          or (nj->>'school_id') is distinct from (oj->>'school_id') ) then
    act := 'role_change';
    det := jsonb_build_object('from_role',oj->>'role','to_role',nj->>'role',
                              'from_school',oj->>'school_id','to_school',nj->>'school_id');
  elsif tg_op = 'DELETE' then
    act := 'delete'; det := oj;
  elsif tg_table_name = 'incidents' and tg_op = 'UPDATE' then
    act := 'incident_edit'; det := jsonb_build_object('id',rid);
  else
    return coalesce(new, old);
  end if;
  insert into public.audit_log(actor, actor_role, school_id, action, table_name, row_id, detail)
  values (auth.uid(), current_app_role(), sch, act, tg_table_name, rid, det);
  return coalesce(new, old);
end; $$;

drop trigger if exists trg_audit_profiles  on public.profiles;
create trigger trg_audit_profiles  after update on public.profiles
  for each row execute function public.audit_writer();
drop trigger if exists trg_audit_students_del on public.students;
create trigger trg_audit_students_del after delete on public.students
  for each row execute function public.audit_writer();
drop trigger if exists trg_audit_incidents on public.incidents;
create trigger trg_audit_incidents after update or delete on public.incidents
  for each row execute function public.audit_writer();

-- onboarding_checklists: admin of school manages; an instructor may read their own
create policy onb_select on public.onboarding_checklists for select to authenticated
  using ( (is_admin() and my_school(school_id)) or instructor_id = auth.uid()::text );
create policy onb_write on public.onboarding_checklists for all to authenticated
  using ( is_admin() and my_school(school_id) )
  with check ( is_admin() and my_school(school_id) );

-- ----------------------------------------------------------------------------
-- 10. Grants + FORCE RLS. PostgREST exposes tables via anon/authenticated GRANTs;
--     RLS is what restricts. anon gets NO table grants → unauthenticated is shut out.
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
-- anon: deliberately no privileges on protected tables.
revoke all on all tables in schema public from anon;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname='public'
           and tablename <> 'audit_log'   -- definer audit trigger must be able to insert here
  loop
    execute format('alter table public.%I force row level security', t.tablename);
  end loop;
end $$;
