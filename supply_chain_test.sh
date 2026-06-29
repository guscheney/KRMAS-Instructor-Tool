#!/usr/bin/env bash
# Self-contained verification of 22_supply_chain.sql. Builds a minimal but FAITHFUL
# dependency schema (auth stubs + the real helper-fn semantics + apply_movement),
# applies migration 22, then asserts: schema, RLS read-isolation, the full order
# lifecycle (draft→submit→confirm→ship→receive) with stock posting through
# apply_movement, the disjoint school/supply auth hats, and partial/cancel paths.
# Does NOT need supabase_schema.sql, so it survives the container reset.
set -u
PGBIN=/usr/lib/postgresql/16/bin; PORT=5433; DB=supply_test
SQLF(){ su postgres -c "$PGBIN/psql -p $PORT -d $DB -tA -v ON_ERROR_STOP=1 -q -f $1" >/tmp/sup_apply.log 2>&1; }
su postgres -c "$PGBIN/psql -p $PORT -d postgres -c 'drop database if exists $DB'" >/dev/null 2>&1
su postgres -c "$PGBIN/psql -p $PORT -d postgres -c 'create database $DB'" >/dev/null 2>&1

cat > /tmp/sup_deps.sql <<'DEPS'
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb, '{}'::jsonb) $$;
grant usage on schema auth to authenticated, anon, service_role;  -- real Supabase grants this

-- faithful helper-fn semantics (mirrors 01 + 08)
create or replace function public.role_rank(r text) returns int language sql immutable as $$
  select case r when 'superadmin' then 4 when 'admin' then 3 when 'instructor' then 2 when 'junior' then 1 else 0 end $$;
create or replace function public.has_min_role(min_role text) returns boolean language sql stable as $$
  select role_rank(coalesce(auth.jwt()->>'app_role','')) >= role_rank(min_role) $$;
create or replace function public.is_superadmin() returns boolean language sql stable as $$
  select coalesce(auth.jwt()->>'app_role','') = 'superadmin' $$;
create or replace function public.current_school_id() returns text language sql stable as $$
  select auth.jwt()->>'school_id' $$;
create or replace function public.my_schools() returns text[] language sql stable as $$
  select case
    when auth.jwt() ? 'schools' and jsonb_array_length(auth.jwt()->'schools') >= 1
      then array(select jsonb_array_elements_text(auth.jwt()->'schools'))
    when current_school_id() is not null then array[current_school_id()]
    else array[]::text[] end $$;
create or replace function public.can_read_scope(row_school text) returns boolean language sql stable as $$
  select is_superadmin() or row_school is null or row_school = any(my_schools()) $$;
create or replace function public.is_shop_admin() returns boolean language sql stable as $$
  select coalesce(case when auth.jwt() ? 'shop_admin' then (auth.jwt()->>'shop_admin')::boolean end, false) $$;
create or replace function public.can_edit_school_stock(row_school text) returns boolean language sql stable as $$
  select is_superadmin() or is_shop_admin() or (has_min_role('admin') and row_school = any(my_schools())) $$;
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
  begin new.updated_at = now(); return new; end $$;

-- dependency tables (minimal columns 22 touches)
create table public.profiles (
  id uuid primary key, role text, school_id text, schools text[],
  display_name text, is_shop_admin boolean not null default false,
  is_supply_admin boolean not null default false, updated_at timestamptz default now());
create table public.suppliers (
  id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz default now());
create table public.inventory_categories (id uuid primary key default gen_random_uuid(), name text, sort int);
create table public.inventory_size_sets (id uuid primary key default gen_random_uuid(), name text, sizes jsonb, sort int);
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(), name text not null,
  category_id uuid, supplier_id uuid references public.suppliers(id) on delete set null,
  unit_cost numeric(10,2), unit text, sku text, sized boolean default false,
  size_set_id uuid, grade_ref text, archived boolean default false);
create table public.inventory_stock (
  school_id text not null, item_id uuid not null references public.inventory_items(id) on delete cascade,
  size text not null default '', qty int not null default 0,
  reorder_level int not null default 0, target_level int not null default 0,
  updated_at timestamptz default now(), updated_by text, primary key (school_id, item_id, size));
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(), school_id text not null, item_id uuid, size text,
  delta int, kind text, note text, ref_type text, ref_id text, created_by text, created_at timestamptz default now());
grant select,insert,update,delete on all tables in schema public to authenticated;

-- apply_movement (mirrors 09 semantics: ledger insert + stock upsert, floor 0)
create or replace function public.apply_movement(
  p_school text, p_item uuid, p_size text, p_delta int, p_kind text,
  p_note text default null, p_ref_type text default null, p_ref_id text default null
) returns int language plpgsql security invoker as $$
declare new_qty int;
begin
  insert into public.inventory_movements(school_id,item_id,size,delta,kind,note,ref_type,ref_id,created_by)
    values (p_school,p_item,coalesce(p_size,''),p_delta,p_kind,p_note,p_ref_type,p_ref_id,auth.uid()::text);
  insert into public.inventory_stock(school_id,item_id,size,qty,updated_at,updated_by)
    values (p_school,p_item,coalesce(p_size,''),greatest(0,p_delta),now(),auth.uid()::text)
  on conflict (school_id,item_id,size) do update
    set qty=greatest(0,inventory_stock.qty+p_delta), updated_at=now(), updated_by=auth.uid()::text
  returning qty into new_qty;
  return new_qty;
end; $$;
grant execute on function public.apply_movement(text,uuid,text,int,text,text,text,text) to authenticated;
DEPS

SQLF /tmp/sup_deps.sql || { echo "DEPS FAILED"; cat /tmp/sup_apply.log; exit 1; }
SQLF security/22_supply_chain.sql || { echo "MIGRATION 22 FAILED"; cat /tmp/sup_apply.log; exit 1; }

# ---- seed (as owner/superuser; bypasses RLS) ----
su postgres -c "$PGBIN/psql -p $PORT -d $DB -q" >/dev/null 2>&1 <<'SEED'
insert into public.profiles(id,role,school_id,schools,is_shop_admin,is_supply_admin) values
  ('00000000-0000-0000-0000-000000000001','superadmin',null,null,false,false),
  ('00000000-0000-0000-0000-0000000000a1','admin','edgeworth',array['edgeworth'],false,false),
  ('00000000-0000-0000-0000-0000000000a2','admin','beecroft',array['beecroft'],false,false),
  ('00000000-0000-0000-0000-0000000000d1','instructor','edgeworth',array['edgeworth'],false,true); -- pure supply admin
insert into public.suppliers(id,name) values
  ('00000000-0000-0000-0000-0000000000f1','Sub-Business Apparel'),
  ('00000000-0000-0000-0000-0000000000f2','External Belts Co');
update public.suppliers set is_internal=true where id='00000000-0000-0000-0000-0000000000f1';
insert into public.inventory_items(id,name,supplier_id,sized) values
  ('00000000-0000-0000-0000-000000000011','Training Shorts','00000000-0000-0000-0000-0000000000f1',true),
  ('00000000-0000-0000-0000-000000000012','Club Shirt','00000000-0000-0000-0000-0000000000f1',true);
-- finished-goods stock at the supply location so shipping has stock to move
insert into public.inventory_stock(school_id,item_id,size,qty) values
  (public.supply_loc('00000000-0000-0000-0000-0000000000f1'),'00000000-0000-0000-0000-000000000011','M',100),
  (public.supply_loc('00000000-0000-0000-0000-0000000000f1'),'00000000-0000-0000-0000-000000000012','L',100);
SEED

PASS=0; FAIL=0; declare -a FAILS
SA='{"sub":"00000000-0000-0000-0000-000000000001","app_role":"superadmin","role":"authenticated"}'
AE='{"sub":"00000000-0000-0000-0000-0000000000a1","app_role":"admin","school_id":"edgeworth","schools":["edgeworth"],"role":"authenticated"}'
AB='{"sub":"00000000-0000-0000-0000-0000000000a2","app_role":"admin","school_id":"beecroft","schools":["beecroft"],"role":"authenticated"}'
SUP='{"sub":"00000000-0000-0000-0000-0000000000d1","app_role":"instructor","school_id":"edgeworth","schools":["edgeworth"],"supply_admin":true,"role":"authenticated"}'
run(){ printf "set role authenticated; set request.jwt.claims='%s'; %s" "$1" "$2" > /tmp/sup_t.sql; chmod 666 /tmp/sup_t.sql; su postgres -c "$PGBIN/psql -p $PORT -d $DB -tA -q -v ON_ERROR_STOP=1 -f /tmp/sup_t.sql" 2>/tmp/sup_err.log; }
val(){ run "$1" "$2" | tr -d '[:space:]'; }
valr(){ run "$1" "$2" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | head -1; }  # keep internal spaces
chk(){ local d="$1" g="$2" e="$3"; if [ "$g" = "$e" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILS+=("$d (got '$g' want '$e')"); fi; }
# ok = statement SUCCEEDS, fail = statement RAISES
ok(){ local d="$1"; run "$2" "$3" >/dev/null 2>/tmp/sup_err.log; if [ $? -eq 0 ] && ! grep -qi 'ERROR' /tmp/sup_err.log; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILS+=("$d (expected success: $(tail -1 /tmp/sup_err.log))"); fi; }
no(){ local d="$1"; run "$2" "$3" >/dev/null 2>/tmp/sup_err.log; if grep -qi 'ERROR' /tmp/sup_err.log; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILS+=("$d (expected FAILURE but it succeeded)"); fi; }

echo "── A. schema ──"
chk "supply_orders table"      "$(val "$SA" "select count(*) from information_schema.tables where table_name='supply_orders';")" "1"
chk "supply_order_lines table" "$(val "$SA" "select count(*) from information_schema.tables where table_name='supply_order_lines';")" "1"
chk "suppliers.is_internal col" "$(val "$SA" "select count(*) from information_schema.columns where table_name='suppliers' and column_name='is_internal';")" "1"
chk "profiles.is_supply_admin col" "$(val "$SA" "select count(*) from information_schema.columns where table_name='profiles' and column_name='is_supply_admin';")" "1"
chk "no cost cols on orders" "$(val "$SA" "select count(*) from information_schema.columns where table_name in ('supply_orders','supply_order_lines') and (column_name like '%cost%' or column_name like '%price%' or column_name like '%amount%');")" "0"
chk "supply_loc deterministic" "$(val "$SA" "select supply_loc('00000000-0000-0000-0000-0000000000f1');")" "__supply__:00000000-0000-0000-0000-0000000000f1"
chk "is_supply_admin true for supply hat" "$(val "$SUP" "select is_supply_admin();")" "t"
chk "is_supply_admin false for plain admin" "$(val "$AE" "select is_supply_admin();")" "f"
chk "supply admin CAN edit supply loc" "$(val "$SUP" "select can_edit_school_stock(supply_loc('00000000-0000-0000-0000-0000000000f1'));")" "t"
chk "supply admin CANNOT edit real school" "$(val "$SUP" "select can_edit_school_stock('edgeworth');")" "f"
chk "plain admin CANNOT edit supply loc" "$(val "$AE" "select can_edit_school_stock(supply_loc('00000000-0000-0000-0000-0000000000f1'));")" "f"
chk "plain admin CAN edit own school" "$(val "$AE" "select can_edit_school_stock('edgeworth');")" "t"

echo "── B. lifecycle happy path ──"
LINES='[{"item_id":"00000000-0000-0000-0000-000000000011","item_name":"Training Shorts","size":"M","qty":10,"for_whom":"Junior squad"},{"item_id":"00000000-0000-0000-0000-000000000012","item_name":"Club Shirt","size":"L","qty":5,"for_whom":"General restock"}]'
OID=$(val "$AE" "select supply_order_save(null,'edgeworth','00000000-0000-0000-0000-0000000000f1','first order','$LINES'::jsonb);")
chk "save returns order id (uuid len)" "$(printf '%s' "$OID" | wc -c | tr -d ' ')" "36"
chk "draft status" "$(val "$SA" "select status from supply_orders where id='$OID';")" "draft"
chk "two lines saved" "$(val "$SA" "select count(*) from supply_order_lines where order_id='$OID';")" "2"
chk "for_whom captured" "$(valr "$SA" "select for_whom from supply_order_lines where order_id='$OID' and size='M';")" "Junior squad"
ok  "school submits draft" "$AE" "select supply_order_submit('$OID');"
chk "status submitted" "$(val "$SA" "select status from supply_orders where id='$OID';")" "submitted"
chk "submitted_at set" "$(val "$SA" "select (submitted_at is not null) from supply_orders where id='$OID';")" "t"
ok  "supply confirms with ETA" "$SUP" "select supply_order_confirm('$OID','2026-07-20'::date,null);"
chk "status confirmed" "$(val "$SA" "select status from supply_orders where id='$OID';")" "confirmed"
chk "eta set" "$(val "$SA" "select eta_date::text from supply_orders where id='$OID';")" "2026-07-20"
chk "qty_confirmed defaulted to ordered" "$(val "$SA" "select qty_confirmed from supply_order_lines where order_id='$OID' and size='M';")" "10"
SLOC=$(val "$SA" "select supply_loc('00000000-0000-0000-0000-0000000000f1');")
ok  "supply ships w/ tracking" "$SUP" "select supply_order_ship('$OID','TRK-123','AusPost','2026-07-18'::date,null);"
chk "status shipped" "$(val "$SA" "select status from supply_orders where id='$OID';")" "shipped"
chk "tracking captured" "$(val "$SA" "select tracking_number from supply_orders where id='$OID';")" "TRK-123"
chk "carrier captured" "$(val "$SA" "select carrier from supply_orders where id='$OID';")" "AusPost"
chk "supply-loc stock decremented 100->90" "$(val "$SA" "select qty from inventory_stock where school_id='$SLOC' and item_id='00000000-0000-0000-0000-000000000011' and size='M';")" "90"
chk "ship posted a movement row" "$(val "$SA" "select count(*) from inventory_movements where ref_type='supply_order' and ref_id='$OID' and kind='transfer_out';")" "2"
chk "school stock still 0 pre-receipt" "$(val "$SA" "select coalesce((select qty from inventory_stock where school_id='edgeworth' and item_id='00000000-0000-0000-0000-000000000011' and size='M'),0);")" "0"
ok  "school confirms receipt" "$AE" "select supply_order_receive('$OID',null);"
chk "status received" "$(val "$SA" "select status from supply_orders where id='$OID';")" "received"
chk "received_date set" "$(val "$SA" "select (received_date is not null) from supply_orders where id='$OID';")" "t"
chk "school stock now 10" "$(val "$SA" "select qty from inventory_stock where school_id='edgeworth' and item_id='00000000-0000-0000-0000-000000000011' and size='M';")" "10"
chk "receive posted transfer_in" "$(val "$SA" "select count(*) from inventory_movements where ref_type='supply_order' and ref_id='$OID' and kind='transfer_in';")" "2"

echo "── C. RLS read isolation ──"
chk "edgeworth admin sees own order" "$(val "$AE" "select count(*) from supply_orders where id='$OID';")" "1"
chk "beecroft admin CANNOT see it" "$(val "$AB" "select count(*) from supply_orders where id='$OID';")" "0"
chk "supply admin sees all orders" "$(val "$SUP" "select count(*) from supply_orders where id='$OID';")" "1"
chk "beecroft cannot see its lines" "$(val "$AB" "select count(*) from supply_order_lines where order_id='$OID';")" "0"

echo "── D. auth separation (disjoint hats) ──"
D2='[{"item_id":"00000000-0000-0000-0000-000000000011","item_name":"Training Shorts","size":"M","qty":4,"for_whom":"x"}]'
OID2=$(val "$AE" "select supply_order_save(null,'edgeworth','00000000-0000-0000-0000-0000000000f1','o2','$D2'::jsonb);")
no  "plain admin cannot confirm" "$AE" "select supply_order_confirm('$OID2','2026-07-20'::date,null);"
no  "supply admin cannot submit (not school stock editor)" "$SUP" "select supply_order_submit('$OID2');"
no  "beecroft cannot submit edgeworth draft" "$AB" "select supply_order_submit('$OID2');"
no  "order against EXTERNAL supplier rejected" "$AE" "select supply_order_save(null,'edgeworth','00000000-0000-0000-0000-0000000000f2','x','$D2'::jsonb);"
no  "empty order cannot submit" "$AE" "select supply_order_submit((select supply_order_save(null,'edgeworth','00000000-0000-0000-0000-0000000000f1','empty','[]'::jsonb)));"
ok  "submit o2 ok (setup)" "$AE" "select supply_order_submit('$OID2');"
no  "editing non-draft rejected" "$AE" "select supply_order_save('$OID2','edgeworth','00000000-0000-0000-0000-0000000000f1','edit','$D2'::jsonb);"
no  "supply admin cannot receive" "$SUP" "select supply_order_receive('$OID2',null);"

echo "── E. cancel + partial receipt ──"
no  "cannot cancel a received order" "$AE" "select supply_order_cancel('$OID');"
ok  "cancel submitted order (school)" "$AE" "select supply_order_cancel('$OID2');"
chk "status cancelled" "$(val "$SA" "select status from supply_orders where id='$OID2';")" "cancelled"
# partial: new order shipped 8, received 5
D3='[{"item_id":"00000000-0000-0000-0000-000000000012","item_name":"Club Shirt","size":"L","qty":8,"for_whom":"team"}]'
OID3=$(val "$AE" "select supply_order_save(null,'edgeworth','00000000-0000-0000-0000-0000000000f1','o3','$D3'::jsonb);")
run "$AE" "select supply_order_submit('$OID3');" >/dev/null 2>&1
run "$SUP" "select supply_order_confirm('$OID3','2026-08-01'::date,null);" >/dev/null 2>&1
run "$SUP" "select supply_order_ship('$OID3','T2','StarTrack','2026-08-01'::date,null);" >/dev/null 2>&1
LID=$(val "$SA" "select id from supply_order_lines where order_id='$OID3' and size='L';")
OV="[{\"line_id\":\"$LID\",\"qty\":5}]"
ok  "partial receive (5 of 8)" "$AE" "select supply_order_receive('$OID3', '$OV'::jsonb);"
chk "qty_received = 5" "$(val "$SA" "select qty_received from supply_order_lines where id='$LID';")" "5"
chk "school shirt stock = 5(OID)+5(partial)=10" "$(val "$SA" "select qty from inventory_stock where school_id='edgeworth' and item_id='00000000-0000-0000-0000-000000000012' and size='L';")" "10"

echo ""
echo "════════════════════════════════════"
echo "  supply-chain migration 22: PASS=$PASS FAIL=$FAIL"
echo "════════════════════════════════════"
if [ $FAIL -gt 0 ]; then printf '  ✗ %s\n' "${FAILS[@]}"; exit 1; fi
echo "  ✓ all green"
