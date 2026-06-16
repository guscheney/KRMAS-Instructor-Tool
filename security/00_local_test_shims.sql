-- ============================================================================
-- LOCAL TEST SHIMS ONLY  — Supabase provides all of this in production.
-- DO NOT include in the real migrations. This makes auth.uid()/auth.jwt()/
-- the anon & authenticated roles behave like Supabase so RLS is the real gate.
-- ============================================================================
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- auth.uid()/jwt()/role() read the per-request JWT claims, exactly like Supabase.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')::uuid;
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb, '{}'::jsonb);
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role', 'anon');
$$;

-- The roles Supabase ships with. service_role bypasses RLS (used only by Edge Fns).
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon')                then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated')       then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role')        then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;

grant usage on schema auth, public to anon, authenticated, service_role, supabase_auth_admin;
grant select on auth.users to supabase_auth_admin, service_role;
