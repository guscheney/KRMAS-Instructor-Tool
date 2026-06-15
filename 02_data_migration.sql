-- ============================================================================
-- KRMAS — Data migration (run AFTER 01_auth_authz.sql, as the postgres/service role)
-- Idempotent: re-running inserts nothing new (on conflict do nothing) and re-scrubs.
-- Legacy kv blobs are kept until you have verified the cutover; the final DELETEs at
-- the bottom are commented out for that reason.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Explode kv_store 'students' blobs ({id -> {name,dob,memberNum,...}}) → students
-- ----------------------------------------------------------------------------
insert into public.students (id, school_id, name, dob, member_num, source)
select coalesce(rec.value->>'id', rec.key),
       kv.school_id,
       rec.value->>'name',
       case when (rec.value->>'dob') ~ '^\d{4}-\d{2}-\d{2}' then (rec.value->>'dob')::date end,
       rec.value->>'memberNum',
       coalesce(nullif(rec.value->>'source',''),'migrated')
from public.kv_store kv
     cross join lateral jsonb_each(kv.value) rec
where kv.key = 'students'
  and jsonb_typeof(kv.value)  = 'object'
  and jsonb_typeof(rec.value) = 'object'
  and coalesce(rec.value->>'name','') <> ''
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Explode kv_store 'incidents' blobs ({id -> {...}}) → incidents
--    Whole record preserved in data; created_by stays null (predates auth).
-- ----------------------------------------------------------------------------
insert into public.incidents (id, school_id, data, created_at)
select coalesce(rec.value->>'id', rec.key),
       kv.school_id,
       rec.value,
       case when (rec.value->>'date') ~ '^\d{4}-\d{2}-\d{2}'
            then (rec.value->>'date')::timestamptz else now() end
from public.kv_store kv
     cross join lateral jsonb_each(kv.value) rec
where kv.key = 'incidents'
  and jsonb_typeof(kv.value)  = 'object'
  and jsonb_typeof(rec.value) = 'object'
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Scrub plaintext PINs. Recursively remove any "pin" key at any depth from the
--    custom-schools blob, and drop the pin-overrides blob entirely.
-- ----------------------------------------------------------------------------
create or replace function public.strip_pins(j jsonb) returns jsonb
language sql immutable as $$
  select case jsonb_typeof(j)
    when 'object' then (
      select coalesce(jsonb_object_agg(k, public.strip_pins(v)), '{}'::jsonb)
      from jsonb_each(j) e(k,v) where k <> 'pin' )
    when 'array' then (
      select coalesce(jsonb_agg(public.strip_pins(v)), '[]'::jsonb)
      from jsonb_array_elements(j) a(v) )
    else j end;
$$;

update public.kv_store set value = public.strip_pins(value)
  where key = 'custom-schools' and value::text ~* '"pin"';

delete from public.kv_store where key = 'pin-overrides';

-- ----------------------------------------------------------------------------
-- 4. Seed profiles for existing instructors.
--    auth.users can only be created via Supabase Auth (invite / admin API) — an
--    OWNER step (see SECURITY owner checklist). Once each instructor has been
--    invited (which creates their auth.users row by email), run this to create
--    their profile from the custom-schools instructor data, matching on email:
--
--    insert into public.profiles (id, role, school_id, display_name)
--    select u.id, i.role, i.school_id, i.name
--    from auth.users u
--    join ( <select instructor rows: email, role, school_id, name
--             extracted from your custom-schools blob> ) i on lower(i.email) = lower(u.email)
--    on conflict (id) do update set role = excluded.role, school_id = excluded.school_id;
--
--    (Template only — the exact extraction depends on your custom-schools shape.)

-- ----------------------------------------------------------------------------
-- 5. Final cutover (UNCOMMENT only after verifying students/incidents migrated):
--    delete from public.kv_store where key in ('students','incidents');
-- ============================================================================
-- ROLLBACK NOTES
--   1/2: truncate public.students, public.incidents;  (kv blobs are still intact
--        unless step 5 was run — do NOT run step 5 until verified).
--   3:   PIN scrub is irreversible (by design — plaintext PINs must not persist).
--        If you must keep a copy, snapshot kv_store before running.
--   4:   delete from public.profiles where ...;
-- ============================================================================
