#!/usr/bin/env bash
# Local RLS verification. Rebuilds schema from scratch, then asserts the full model.
set -u
PGBIN=/usr/lib/postgresql/16/bin; PORT=5433; DB=krmas_test
SQL(){ su postgres -c "$PGBIN/psql -p $PORT -d $DB -tA -v ON_ERROR_STOP=1 -q -f $1" >/tmp/apply.log 2>&1; }
echo "rebuilding schema..."; SQL security/00_local_test_shims.sql || { cat /tmp/apply.log; exit 1; }
su postgres -c "$PGBIN/psql -p $PORT -d $DB -q -f supabase_schema.sql" >/dev/null 2>&1
SQL security/01_auth_authz.sql || { echo MIGRATION FAILED; cat /tmp/apply.log; exit 1; }
SQL security/seed_test.sql || { echo SEED FAILED; cat /tmp/apply.log; exit 1; }
echo "schema + seed ready"; echo

PASS=0; FAIL=0; declare -a FAILS
# identities (app_role + school in JWT claims, as the access-token hook would set)
SA='{"sub":"00000000-0000-0000-0000-000000000001","app_role":"superadmin","school_id":null,"role":"authenticated"}'
AD_E='{"sub":"00000000-0000-0000-0000-0000000000a1","app_role":"admin","school_id":"edgeworth","role":"authenticated"}'
IN_E='{"sub":"00000000-0000-0000-0000-0000000000b1","app_role":"instructor","school_id":"edgeworth","role":"authenticated"}'
JR_E='{"sub":"00000000-0000-0000-0000-0000000000c1","app_role":"junior","school_id":"edgeworth","role":"authenticated"}'
AD_B='{"sub":"00000000-0000-0000-0000-0000000000a2","app_role":"admin","school_id":"beecroft","role":"authenticated"}'
IN_B='{"sub":"00000000-0000-0000-0000-0000000000b2","app_role":"instructor","school_id":"beecroft","role":"authenticated"}'

_pre(){ case "$1" in anon) echo "set role anon;";; service) echo "set role service_role;";; *) echo "set request.jwt.claims='$1'; set role authenticated;";; esac; }
_run(){ printf '%s\n' "$1" > /tmp/t.sql; chmod 666 /tmp/t.sql; su postgres -c "$PGBIN/psql -p $PORT -d $DB -tA -q -v ON_ERROR_STOP=1 -f /tmp/t.sql" 2>/dev/null; }
cnt(){ # claims sql -> count or -1 on error
  local out; out=$(_run "$(_pre "$1") $2"); [ $? -ne 0 ] && { echo -1; return; }; echo "${out:--1}" | tr -d '[:space:]'; }
writn(){ # claims write_sql -> rows affected (-1 on error/denied), rolled back
  local out; out=$(_run "$(_pre "$1") begin; with x as ($2 returning 1) select count(*) from x; rollback;")
  [ $? -ne 0 ] && { echo -1; return; }; echo "${out:--1}" | tr -d '[:space:]'; }
ck(){ local got=$(cnt "$2" "$3"); if [ "$got" = "$4" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILS+=("CNT  $1 | got=$got want=$4"); fi; }
allow(){ local n=$(writn "$2" "$3"); if [ "${n:--1}" -ge 1 ] 2>/dev/null; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILS+=("ALLOW $1 | n=$n"); fi; }
block(){ local n=$(writn "$2" "$3"); if [ "${n:--1}" -le 0 ] 2>/dev/null; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILS+=("BLOCK $1 | n=$n"); fi; }
# RPC path: the app writes kv via the upsert_kv() function (SECURITY INVOKER), so the
# INSERT/UPDATE inside it must still satisfy kv RLS. void return => check exit code.
_rpc(){ _run "$(_pre "$1") begin; select upsert_kv($2); rollback;" >/dev/null 2>&1; }
rpc_allow(){ if _rpc "$2" "$3"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILS+=("RPC-ALLOW $1"); fi; }
rpc_block(){ if _rpc "$2" "$3"; then FAIL=$((FAIL+1)); FAILS+=("RPC-BLOCK $1"); else PASS=$((PASS+1)); fi; }

echo "── A. Negative-auth: unauthenticated (anon) over EVERY table ──"
for T in profiles students incidents notices feed_posts feed_comments feed_likes groups group_members class_assignments post_acks calendar_events event_types documents compliance_requirements instructor_compliance push_subscriptions onboarding_checklists audit_log kv_store; do
  ck "anon SELECT $T blocked" anon "select count(*) from $T" -1
done
block "anon INSERT students" anon "insert into students(id,school_id,name) values('z','edgeworth','z')"
block "anon INSERT incidents" anon "insert into incidents(id,school_id) values('z','edgeworth')"
block "anon INSERT kv" anon "insert into kv_store(school_id,key,value) values('edgeworth','grading','{}')"
block "anon UPDATE notices" anon "update notices set title='h' where id='N-E'"

echo "── B. Cross-tenant isolation ──"
ck "IN_E sees 2 edgeworth students"     "$IN_E" "select count(*) from students" 2
ck "IN_E sees 0 beecroft students"      "$IN_E" "select count(*) from students where school_id='beecroft'" 0
ck "IN_E sees 1 edgeworth incident"     "$IN_E" "select count(*) from incidents" 1
ck "IN_E sees 0 beecroft incidents"     "$IN_E" "select count(*) from incidents where school_id='beecroft'" 0
ck "SA sees all 3 students"             "$SA"   "select count(*) from students" 3
ck "SA sees all 2 incidents"            "$SA"   "select count(*) from incidents" 2
ck "IN_B sees only beecroft incident"   "$IN_B" "select count(*) from incidents" 1
ck "IN_E reads 0 beecroft kv"           "$IN_E" "select count(*) from kv_store where school_id='beecroft'" 0

echo "── C. Students matrix (view IN+, add/edit JR+, delete AD+) ──"
allow "JR_E add student (own school)"   "$JR_E" "insert into students(id,school_id,name) values('S-NEW','edgeworth','New')"
block "JR_E add student (other school)" "$JR_E" "insert into students(id,school_id,name) values('S-X','beecroft','X')"
block "JR_E DELETE student"             "$JR_E" "delete from students where id='S-E1'"
block "IN_E DELETE student"             "$IN_E" "delete from students where id='S-E1'"
allow "AD_E DELETE student (own)"       "$AD_E" "delete from students where id='S-E1'"
block "AD_E DELETE student (other sch)" "$AD_E" "delete from students where id='S-B1'"
allow "SA DELETE any student"           "$SA"   "delete from students where id='S-B1'"

echo "── D. Incidents matrix (view IN+, file JR+ stamped, edit/delete AD+) ──"
allow "JR_E file incident (self-stamp)" "$JR_E" "insert into incidents(id,school_id,created_by) values('I-NEW','edgeworth','00000000-0000-0000-0000-0000000000c1')"
block "JR_E file incident (spoof author)" "$JR_E" "insert into incidents(id,school_id,created_by) values('I-SP','edgeworth','00000000-0000-0000-0000-0000000000b1')"
block "IN_E EDIT incident (admin only)" "$IN_E" "update incidents set data='{}' where id='I-E1'"
allow "AD_E EDIT incident"              "$AD_E" "update incidents set data='{\"e\":1}' where id='I-E1'"
block "AD_B edit edgeworth incident"    "$AD_B" "update incidents set data='{}' where id='I-E1'"

echo "── E. Record-table matrix (spot) ──"
block "IN_E write class_assignment"     "$IN_E" "insert into class_assignments(school_id,instructor_id,slot_key) values('edgeworth','x','s2')"
allow "AD_E write class_assignment"     "$AD_E" "insert into class_assignments(school_id,instructor_id,slot_key) values('edgeworth','x','s2')"
block "AD_E create NETWORK notice"      "$AD_E" "insert into notices(id,school_id,title) values('N2',null,'net')"
allow "SA create network notice"        "$SA"   "insert into notices(id,school_id,title) values('N3',null,'net')"
allow "AD_E create school notice"       "$AD_E" "insert into notices(id,school_id,title) values('N4','edgeworth','e')"
block "AD_E create OTHER-school notice" "$AD_E" "insert into notices(id,school_id,title) values('N5','beecroft','b')"
allow "IN_E post feed as SELF"          "$IN_E" "insert into feed_posts(id,school_id,author_id,author_name,body) values('P2','edgeworth','00000000-0000-0000-0000-0000000000b1','x','b')"
block "IN_E post feed as SOMEONE ELSE"  "$IN_E" "insert into feed_posts(id,school_id,author_id,author_name,body) values('P3','edgeworth','00000000-0000-0000-0000-0000000000a1','x','b')"
block "IN_E create calendar event"      "$IN_E" "insert into calendar_events(id,school_id,title,start_date,end_date) values('C2','edgeworth','x','2026-07-02','2026-07-02')"
allow "AD_E create calendar event"      "$AD_E" "insert into calendar_events(id,school_id,title,start_date,end_date) values('C3','edgeworth','x','2026-07-02','2026-07-02')"
ck   "IN_E reads OWN compliance (1)"    "$IN_E" "select count(*) from instructor_compliance where instructor_id='00000000-0000-0000-0000-0000000000b1'" 1
ck   "IN_B sees 0 edgeworth compliance" "$IN_B" "select count(*) from instructor_compliance" 0
ck   "IN_E sees only OWN push (1)"      "$IN_E" "select count(*) from push_subscriptions" 1

echo "── F. kv_store (school + per-namespace role; legacy blobs denied) ──"
ck   "IN_E reads kv grading (1)"        "$IN_E" "select count(*) from kv_store where key='grading' and school_id='edgeworth'" 1
ck   "JR_E CANNOT read kv grading (0)"  "$JR_E" "select count(*) from kv_store where key='grading' and school_id='edgeworth'" 0
ck   "JR_E reads kv lesson-plans (1)"   "$JR_E" "select count(*) from kv_store where key='lesson-plans'" 1
ck   "legacy kv students DENIED to SA"  "$SA"   "select count(*) from kv_store where key='students'" 0
ck   "legacy kv incidents DENIED AD_E"  "$AD_E" "select count(*) from kv_store where key='incidents'" 0
ck   "legacy kv pin-overrides DENIED"   "$AD_E" "select count(*) from kv_store where key='pin-overrides'" 0
block "IN_E write kv grading (admin)"   "$IN_E" "update kv_store set value='{}' where key='grading' and school_id='edgeworth'"
allow "AD_E write kv grading"           "$AD_E" "update kv_store set value='{\"y\":1}' where key='grading' and school_id='edgeworth'"
allow "JR_E write kv lesson-plans"      "$JR_E" "update kv_store set value='{\"y\":1}' where key='lesson-plans' and school_id='edgeworth'"
block "JR_E write legacy kv students"   "$JR_E" "update kv_store set value='{}' where key='students'"
# Same writes through the function the app actually calls (proves RPC honors RLS):
rpc_block "JR_E upsert_kv grading DENIED (RPC)"    "$JR_E" "'edgeworth','grading','{}'::jsonb"
rpc_allow "AD_E upsert_kv grading OK (RPC)"        "$AD_E" "'edgeworth','grading','{\"z\":1}'::jsonb"
rpc_allow "JR_E upsert_kv lesson-plans OK (RPC)"   "$JR_E" "'edgeworth','lesson-plans','{\"z\":1}'::jsonb"
rpc_block "IN_B upsert_kv into edgeworth DENIED"   "$IN_B" "'edgeworth','lesson-plans','{}'::jsonb"

echo "── G. Privilege escalation (all must be blocked) ──"
block "JR_E escalate OWN role->admin"   "$JR_E" "update profiles set role='admin' where id='00000000-0000-0000-0000-0000000000c1'"
block "JR_E change OWN school"          "$JR_E" "update profiles set school_id='beecroft' where id='00000000-0000-0000-0000-0000000000c1'"
block "AD_E grant SUPERADMIN"           "$AD_E" "update profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000c1'"
block "AD_E move user to OTHER school"  "$AD_E" "update profiles set school_id='beecroft' where id='00000000-0000-0000-0000-0000000000c1'"
allow "AD_E promote jr->instructor"     "$AD_E" "update profiles set role='instructor' where id='00000000-0000-0000-0000-0000000000c1'"
allow "SA may grant superadmin"         "$SA"   "update profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000c1'"
block "AD_E edit OTHER-school profile"  "$AD_E" "update profiles set display_name='x' where id='00000000-0000-0000-0000-0000000000b2'"
ck   "JR_E cannot see other profile"    "$JR_E" "select count(*) from profiles where id='00000000-0000-0000-0000-0000000000b2'" 0
ck   "JR_E can see OWN profile"          "$JR_E" "select count(*) from profiles where id='00000000-0000-0000-0000-0000000000c1'" 1
ck   "AD_E sees 3 edgeworth profiles"   "$AD_E" "select count(*) from profiles where school_id='edgeworth'" 3

echo "── H. Service role (Edge Functions) bypasses RLS ──"
ck   "service_role sees ALL push (2)"   service "select count(*) from push_subscriptions" 2
ck   "service_role sees ALL students(3)" service "select count(*) from students" 3

echo "── I. Audit log (committed role change) ──"
printf "%s\n" "set request.jwt.claims='$SA'; set role authenticated; update profiles set role='instructor' where id='00000000-0000-0000-0000-0000000000c1';" > /tmp/commit.sql; chmod 666 /tmp/commit.sql
su postgres -c "$PGBIN/psql -p $PORT -d $DB -q -f /tmp/commit.sql" >/dev/null 2>&1
ck   "audit captured role_change"       "$SA"   "select count(*) from audit_log where action='role_change'" 1
ck   "AD_E can read audit (own school)" "$AD_E" "select count(*) from audit_log where action='role_change'" 1
ck   "JR_E cannot read audit (0)"       "$JR_E" "select count(*) from audit_log" 0

echo "── J. School admin edits their OWN school (timetable, staff, roster, notices, events) ──"
# Timetable + rostered-staff defaults live in the global custom-schools blob: admin writes, others don't.
rpc_allow "AD_E writes timetable/staff (custom-schools)"  "$AD_E" "'global','custom-schools','{\"x\":1}'::jsonb"
rpc_block "IN_E CANNOT write custom-schools"              "$IN_E" "'global','custom-schools','{}'::jsonb"
rpc_block "JR_E CANNOT write custom-schools"              "$JR_E" "'global','custom-schools','{}'::jsonb"
# Per-day roster overrides (roster-edits): admin reassigns; instructor flags cover; junior volunteers — all own-school.
rpc_allow "AD_E writes roster-edits (own school)"         "$AD_E" "'edgeworth','roster-edits','{\"x\":1}'::jsonb"
rpc_allow "IN_E writes roster-edits (flag cover)"         "$IN_E" "'edgeworth','roster-edits','{\"x\":1}'::jsonb"
rpc_allow "JR_E writes roster-edits (volunteer cover)"    "$JR_E" "'edgeworth','roster-edits','{\"x\":1}'::jsonb"
rpc_block "IN_B CANNOT write edgeworth roster-edits"      "$IN_B" "'edgeworth','roster-edits','{}'::jsonb"
# Default staff per slot (class_assignments table): admin own-school only.
allow "AD_E inserts class_assignment (own school)"  "$AD_E" "insert into class_assignments(school_id,instructor_id,slot_key,role) values('edgeworth','x','9-09:00-karate','lead')"
block "AD_E CANNOT insert class_assignment for beecroft" "$AD_E" "insert into class_assignments(school_id,instructor_id,slot_key,role) values('beecroft','x','9-09:00-karate','lead')"
block "IN_E CANNOT insert class_assignment"         "$IN_E" "insert into class_assignments(school_id,instructor_id,slot_key,role) values('edgeworth','x','9-10:00-karate','lead')"
# Notices + calendar for their school: admin yes, cross-school no, instructor no.
allow "AD_E inserts notice (own school)"            "$AD_E" "insert into notices(id,school_id,type,title) values('NJ-1','edgeworth','info','Hi')"
block "AD_E CANNOT insert notice for beecroft"      "$AD_E" "insert into notices(id,school_id,type,title) values('NJ-2','beecroft','info','Hi')"
block "IN_E CANNOT insert notice"                   "$IN_E" "insert into notices(id,school_id,type,title) values('NJ-3','edgeworth','info','Hi')"
allow "AD_E inserts calendar_event (own school)"    "$AD_E" "insert into calendar_events(id,school_id,title,start_date,end_date) values('CJ-1','edgeworth','X',current_date,current_date)"
block "AD_E CANNOT insert calendar_event beecroft"  "$AD_E" "insert into calendar_events(id,school_id,title,start_date,end_date) values('CJ-2','beecroft','X',current_date,current_date)"
# Grading (kv, admin floor): admin own-school yes, instructor no.
rpc_allow "AD_E writes grading (own school)"        "$AD_E" "'edgeworth','grading','{\"x\":1}'::jsonb"
rpc_block "IN_E CANNOT write grading"               "$IN_E" "'edgeworth','grading','{}'::jsonb"
# A school admin may NOT touch network-wide rows (superadmin only).
block "AD_E CANNOT insert network notice"           "$AD_E" "insert into notices(id,school_id,type,title) values('NJ-4',null,'info','Net')"

echo; echo "════════════════════════════════════"
echo "PASS=$PASS  FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then printf '✗ %s\n' "${FAILS[@]}"; exit 1; else echo "✓ ALL GREEN"; fi
