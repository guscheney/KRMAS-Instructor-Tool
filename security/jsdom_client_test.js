const fs = require('fs');
const { JSDOM } = require('jsdom');

// ---- Mock Supabase client (singleton so we can inspect calls) ----
function makeClient() {
  const calls = { upserts: [], deletes: [], invokes: [] };
  const data = {
    students: [{ id: 'S1', school_id: 'edgeworth', name: 'Ann', dob: '2012-01-01', member_num: '1', source: null }],
    profiles: [
      { id: 'u1',  role: 'admin',      school_id: 'edgeworth', display_name: 'Admin',      email: 'a@b.com' },
      { id: 'sa',  role: 'superadmin', school_id: null,        display_name: 'Sara Super',  email: 'sa@krmas.app' },
      { id: 'ade', role: 'admin',      school_id: 'edgeworth', display_name: 'Ed Admin',    email: 'ade@krmas.app' },
      { id: 'ine', role: 'instructor', school_id: 'edgeworth', display_name: 'Ivy Instr',   email: 'ine@krmas.app' },
      { id: 'jre', role: 'junior',     school_id: 'edgeworth', display_name: 'Jo Junior',   email: 'jre@krmas.app' },
      { id: 'adb', role: 'admin',      school_id: 'beecroft',  display_name: 'Bea Admin',   email: 'adb@krmas.app' },
      { id: 'inb', role: 'instructor', school_id: 'beecroft',  display_name: 'Ben Instr',   email: 'inb@krmas.app' },
    ],
    incidents: [],
  };
  let authCb = null; let session = null;
  function builder(table) {
    const b = { _table: table, _op: 'select', _del: false };
    const ch = (fn) => (...a) => { fn(...a); return b; };
    b.select = ch(() => { b._op = 'select'; });
    b.upsert = ch((row) => { calls.upserts.push({ table, row }); b._op = 'upsert'; });
    b.insert = ch((row) => { calls.upserts.push({ table, row, insert: true }); b._op = 'insert'; });
    b.update = ch(() => { b._op = 'update'; });
    b.delete = ch(() => { b._del = true; b._op = 'delete'; });
    b.eq = ch((c, v) => { if (b._del) calls.deletes.push({ table, col: c, val: v }); if (c === 'id') b._eqId = v; });
    ['order', 'or', 'is', 'in', 'neq', 'limit', 'gte', 'lte', 'contains', 'overlaps', 'range', 'filter', 'match'].forEach((m) => { b[m] = ch(() => {}); });
    b.single = () => {
      let rows = data[table] || [];
      if (table === 'profiles' && b._eqId != null) rows = rows.filter((r) => r.id === b._eqId);
      return Promise.resolve(b._op === 'select' ? { data: rows[0] || null, error: null } : { data: null, error: null });
    };
    b.maybeSingle = b.single;
    b.then = (res, rej) => Promise.resolve(b._op === 'select' ? { data: data[table] || [], error: null } : { data: null, error: null }).then(res, rej);
    return b;
  }
  return {
    _calls: calls,
    _setSession: (u) => { session = u ? { user: u } : null; },
    from: (t) => builder(t),
    auth: {
      getSession: () => Promise.resolve({ data: { session }, error: null }),
      getUser: () => Promise.resolve({ data: { user: session ? session.user : null }, error: null }),
      onAuthStateChange: (cb) => { authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: ({ email, password }) => {
        calls.signins = (calls.signins || 0) + 1;
        if (password === 'wrong') return Promise.resolve({ data: {}, error: { message: 'Invalid login credentials' } });
        const p = (data.profiles || []).find((x) => x.email === email);
        session = { user: { id: p ? p.id : 'u1', email } };
        setTimeout(() => authCb && authCb('SIGNED_IN', session), 0);
        return Promise.resolve({ data: { session }, error: null });
      },
      signInWithOtp: () => Promise.resolve({ data: {}, error: null }),
      signOut: () => { session = null; setTimeout(() => authCb && authCb('SIGNED_OUT', null), 0); return Promise.resolve({ error: null }); },
    },
    functions: { invoke: (name, opts) => {
      calls.invokes.push({ name, opts });
      const body = (opts && opts.body) || {};
      if (name === 'manage-users' && body.action === 'invite') return Promise.resolve({ data: { email: body.email, tempPassword: 'TEMP1234', uid: 'uid-' + Math.random().toString(36).slice(2) }, error: null });
      if (name === 'manage-users') return Promise.resolve({ data: { ok: true }, error: null });
      if (name === 'send-push-notification') return Promise.resolve({ data: { sent: 1, failed: 0, removed: 0 }, error: null });
      return Promise.resolve({ data: { imported: 1 }, error: null });
    } },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  };
}
const theClient = makeClient();

// ---- jsdom ----
let html = fs.readFileSync('index.html', 'utf8')
  .replace(/<script[^>]*src=[^>]*><\/script>/g, '')
  .replace(/<script>[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/' });
const { window } = dom;
window.SUPABASE_URL = 'https://x.supabase.co';
window.SUPABASE_ANON = 'anon-key';
window.KRMAS_APP_VERSION = '46';
window.supabase = { createClient: () => theClient };
window.XLSX = {};
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
window.alert = () => {};
window.confirm = () => true;
try { window.crypto = require('crypto').webcrypto; } catch (e) {}

const errors = [];
window.addEventListener('error', (e) => errors.push(e.error ? e.error.message : e.message));
window.onerror = (m) => errors.push(m);

['data.js', 'db.js', 'app.js'].forEach((f) => {
  const s = window.document.createElement('script');
  s.textContent = fs.readFileSync(f, 'utf8');
  window.document.body.appendChild(s);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await sleep(60); // let async init() settle
  let pass = 0, fail = 0; const fails = [];
  const ck = (label, cond) => { if (cond) pass++; else { fail++; fails.push(label); } };
  const DB = window.eval('DB');

  ck('app booted without uncaught errors', errors.length === 0);
  ck('DB defined', !!DB);
  ck('DB.auth surface present', !!(DB && DB.auth && DB.auth.signInWithEmail && DB.auth.getSession && DB.auth.myProfile));
  ck('DB.bulkImportStudents present', !!(DB && DB.bulkImportStudents));
  ck('login gate shown when no session (modalLogin.open)', window.document.getElementById('modalLogin').classList.contains('open'));
  ck('email field rendered in login modal', !!window.document.getElementById('loginEmail'));
  ck('PIN pad removed from login modal', !window.document.getElementById('pinDisplay'));
  ck('password field present', !!window.document.getElementById('loginPassword'));
  ck('password show/hide toggle present', !!window.document.getElementById('loginPwToggle'));
  window.eval('togglePasswordVisibility()');
  ck('toggle reveals password (type=text)', window.document.getElementById('loginPassword').type === 'text');
  window.eval('togglePasswordVisibility()');
  ck('toggle hides password again (type=password)', window.document.getElementById('loginPassword').type === 'password');

  // Password sign-in must COMPLETE and leave the gate (this is the "nothing happens" fix).
  window.document.getElementById('loginEmail').value = 'a@b.com';
  window.document.getElementById('loginPassword').value = 'goodpass';
  window.eval('signIn()');
  await sleep(80);
  ck('signIn calls signInWithPassword', (theClient._calls.signins || 0) >= 1);
  ck('sign-in CLOSES the gate (app entered)', !window.document.getElementById('modalLogin').classList.contains('open'));
  ck('user role derived from profile', window.eval('typeof state!=="undefined" && state.user && state.user.role') === 'admin');

  // App-logins manager (we're signed in as admin now)
  ck('DB.users API present', !!(DB.users && DB.users.list && DB.users.invite && DB.users.setRole && DB.users.remove));
  await window.eval('openUserManager()');
  await sleep(50);
  ck('logins manager opens', window.document.getElementById('modalUsers').classList.contains('open'));
  ck('logins list rendered from profiles', /Admin/.test((window.document.getElementById('usersList') || {}).innerHTML || ''));
  window.document.getElementById('inviteEmail').value = 'new@example.com';
  await window.eval('userInvite()');
  await sleep(50);
  ck('invite calls manage-users (invite)', theClient._calls.invokes.some((i) => i.name === 'manage-users' && i.opts.body.action === 'invite'));
  ck('invite shows temp password to share', /TEMP1234/.test((window.document.getElementById('inviteResult') || {}).innerHTML || ''));

  // Unified people model: adding a person WITH an email creates a linked login.
  try { window.eval('closeModal("modalUsers")'); } catch (e) {}
  await window.eval('openUserEditor(null)');
  const ff = window.document.getElementById('userFirst'); if (ff) ff.value = 'Casey';
  const fe = window.document.getElementById('userEmail'); if (fe) fe.value = 'casey@example.com';
  await window.eval('saveUser()');
  await sleep(70);
  ck('adding a person with an email invites a login', theClient._calls.invokes.some((i) => i.name === 'manage-users' && i.opts.body.action === 'invite' && i.opts.body.email === 'casey@example.com'));

  // Unified role sync: changing a linked person's role updates their login. The client
  // sends NO school, so the server keeps the user in their existing school (no wipe/forge).
  await window.eval('instrSetRole("casey","instructor")');
  await sleep(50);
  ck('changing a linked person role syncs to their login (by uid)', theClient._calls.invokes.some((i) => i.name === 'manage-users' && i.opts.body.action === 'setRole' && /^uid-/.test(i.opts.body.uid || '')));
  ck('role sync does not forge a school (server preserves the user own)', theClient._calls.invokes.filter((i) => i.name === 'manage-users' && i.opts.body.action === 'setRole').every((i) => i.opts.body.school_id === undefined));

  // Bad credentials must be rejected outright (no app entry).
  const badRes = await window.eval('(async()=>{ return await DB.auth.signInWithPassword("ade@krmas.app","wrong"); })()');
  ck('wrong password is rejected (error returned)', !!(badRes && badRes.error));

  // students table -> map
  const map = await DB.loadStudents('edgeworth');
  ck('loadStudents maps row→record', map.S1 && map.S1.name === 'Ann' && map.S1.memberNum === '1' && map.S1.schoolId === 'edgeworth');

  // minimal-diff write: add S2 only → only S2 upserted
  theClient._calls.upserts.length = 0;
  const m2 = Object.assign({}, map, { S2: { id: 'S2', name: 'Bob', memberNum: '2' } });
  await DB.saveStudents('edgeworth', m2);
  ck('save upserts only the CHANGED row (S2)', theClient._calls.upserts.length === 1 && theClient._calls.upserts[0].row.id === 'S2');
  ck('upsert row uses school_id + member_num columns', theClient._calls.upserts[0].row.school_id === 'edgeworth' && theClient._calls.upserts[0].row.member_num === '2');

  // delete propagates: remove S1 → delete issued
  theClient._calls.deletes.length = 0; theClient._calls.upserts.length = 0;
  const m3 = { S2: m2.S2 };
  await DB.saveStudents('edgeworth', m3);
  ck('removing a student issues a DELETE', theClient._calls.deletes.some((d) => d.table === 'students' && d.val === 'S1'));

  // bulk import → Edge Function
  await DB.bulkImportStudents('edgeworth', [{ name: 'New Kid' }]);
  ck('bulkImportStudents calls Edge Function bulk-import', theClient._calls.invokes.some((i) => i.name === 'bulk-import' && i.opts.body.schoolId === 'edgeworth'));

  // ===== AUTHENTICATION MATRIX: Edgeworth, other schools, superadmins =====
  // Each user signs in for real (session → myProfile → role/school). We assert the
  // role and school are derived from THAT user's profile, and that switching users
  // never leaks the previous user's school.
  const IDByEmail = { 'sa@krmas.app': 'sa', 'ade@krmas.app': 'ade', 'ine@krmas.app': 'ine', 'jre@krmas.app': 'jre', 'adb@krmas.app': 'adb', 'inb@krmas.app': 'inb' };
  async function signInAs(email) {
    // Real sign-in so the client's tracked uid updates to THIS user...
    await window.eval('(async()=>{ await DB.auth.signInWithPassword("' + email + '", "x"); })()');
    await sleep(20);
    // ...then run the post-login boot that derives role + school from the profile.
    try {
      await window.eval('(async()=>{ const s = await DB.auth.getSession(); state._pinUnlocked=true; await enterAppWithSession(s); })()');
    } catch (e) { /* role/school are set before any render; render hiccups in the mock are not auth failures */ }
    await sleep(20);
  }
  const roleOf = () => window.eval('state.user && state.user.role');
  const schoolOf = () => window.eval('state.schoolId');

  await signInAs('sa@krmas.app');
  ck('superadmin authenticates as superadmin', roleOf() === 'superadmin');

  await signInAs('ade@krmas.app');
  ck('Edgeworth admin → admin @ edgeworth', roleOf() === 'admin' && schoolOf() === 'edgeworth');

  await signInAs('ine@krmas.app');
  ck('Edgeworth instructor → instructor @ edgeworth', roleOf() === 'instructor' && schoolOf() === 'edgeworth');

  await signInAs('jre@krmas.app');
  ck('Edgeworth junior → junior @ edgeworth', roleOf() === 'junior' && schoolOf() === 'edgeworth');

  await signInAs('adb@krmas.app');
  ck('Beecroft admin → admin @ beecroft (not edgeworth)', roleOf() === 'admin' && schoolOf() === 'beecroft');

  await signInAs('inb@krmas.app');
  ck('Beecroft instructor → instructor @ beecroft', roleOf() === 'instructor' && schoolOf() === 'beecroft');

  // No school leak: a user from another school re-derives their own school.
  await signInAs('ade@krmas.app');
  ck('switching back to Edgeworth re-derives edgeworth (no leak from beecroft)', schoolOf() === 'edgeworth');
  ck('session identity tracks the signed-in user (uid=ade, not stale)', window.eval('state.user && state.user.id') === 'ade');

  // Superadmin (school_id null) is not pinned to a school but keeps a usable one selected.
  await signInAs('sa@krmas.app');
  ck('superadmin keeps a valid working school after switching', typeof schoolOf() === 'string' && schoolOf().length > 0);

  // ===== COVER → BACKUP NOTIFICATION (in-app banner + push), and the uid↔instructor bridge =====
  try {
    const dow = new Date().getDay();
    window.eval(`
      state.schoolId = 'edgeworth'; state.classTypeOverrides = {}; state.edits = {}; state.plans = {};
      state.customSchools = state.customSchools || {};
      state.customSchools['edgeworth'] = {
        activeDays: [${dow}],
        instructors: [ { id:'lead1', name:'Lead One', uid:'uid-lead' }, { id:'back1', name:'Back Up', uid:'uid-back' } ],
        schedule: [ { day:${dow}, start:'16:00', end:'17:00', type:'karate', label:null } ],
        defaults: { '${dow}-16:00-karate': { lead:'lead1', assist:null, junior:null, backup:'back1' } },
        contact: {}
      };
      state.user = { id:'uid-lead', name:'Lead One', role:'instructor', email:null, instructorId:'lead1' };
    `);
    const ck0 = theClient._calls.invokes.length;
    const dateKey = window.eval("isoDate(new Date()) + '-16:00-karate'");

    // Keystone: the auth uid resolves to the roster instructor id.
    const resolved = window.eval("(function(){ var saved=state.user.instructorId; state.user.instructorId=null; var r=resolveMyInstructorId(); state.user.instructorId=saved; return r; })()");
    ck('uid↔instructor bridge: resolveMyInstructorId maps uid → instructor id', resolved === 'lead1');
    ck('isMyClass true for a slot I hold', window.eval("isMyClass({ lead:'lead1' })") === true);
    ck('isMyClass false for a slot I do not hold', window.eval("isMyClass({ lead:'someone-else' })") === false);

    // Path B: flagging cover pushes the listed backup (and excludes the sender).
    await window.eval("(async()=>{ await markNeedsCover('" + dateKey + "'); })()");
    await sleep(30);
    ck('markNeedsCover sets needs-cover', window.eval("(state.edits['" + dateKey + "']||{}).status") === 'needs-cover');
    ck('cover push targets the backup uid, excludes sender (Path B)', theClient._calls.invokes.slice(ck0).some((i) => i.name === 'send-push-notification' && Array.isArray(i.opts.body.targetUserIds) && i.opts.body.targetUserIds[0] === 'uid-back' && i.opts.body.excludeUserId === 'uid-lead'));

    // Path A: the backup sees an in-app banner on render.
    window.eval("state.user = { id:'uid-back', name:'Back Up', role:'instructor', email:null, instructorId:'back1' };");
    window.eval("renderNoticeBanners()");
    const bannerHtml = (window.document.getElementById('noticeBanners') || {}).innerHTML || '';
    ck('backup sees in-app cover banner (Path A)', /backup/i.test(bannerHtml) && /cover needed/i.test(bannerHtml));
    ck('cover banner names the class', /karate/i.test(bannerHtml));

    // Negative: someone who is NOT the backup gets no banner.
    window.eval("state.user = { id:'uid-lead', name:'Lead One', role:'instructor', email:null, instructorId:'lead1' };");
    window.eval("renderNoticeBanners()");
    ck('non-backup sees no cover banner', !/cover needed/i.test((window.document.getElementById('noticeBanners') || {}).innerHTML || ''));
  } catch (e) {
    ck('cover-notification scenario ran without throwing', false);
    console.log('  cover scenario error: ' + (e && e.message));
  }

  // ===== SCHOOL ADMIN EDITS THEIR OWN SCHOOL (timetable/setup), scoped to own school =====
  try {
    window.eval("try{closeModal('modalSchoolManager')}catch(e){} try{closeModal('modalScheduleEditor')}catch(e){}");
    window.eval("state.user = { id:'uid-ade', name:'Ed Admin', role:'admin', email:null, instructorId:null }; state.schoolId='edgeworth';");
    window.eval("openSchoolManager()");
    ck('admin can open the school manager', window.document.getElementById('modalSchoolManager').classList.contains('open'));
    ck('school manager scoped to own school (note shown)', /manage your own school/i.test((window.document.getElementById('schoolManagerBody') || {}).innerHTML || ''));
    ck('add-school button hidden for non-superadmin', (window.document.getElementById('addSchoolBtn') || {}).style.display === 'none');
    window.eval("openScheduleEditor('edgeworth')");
    ck('admin can open OWN-school timetable editor', window.document.getElementById('modalScheduleEditor').classList.contains('open') && window.eval("state._editingScheduleSchool") === 'edgeworth');
    window.eval("state._editingScheduleSchool=null; try{closeModal('modalScheduleEditor')}catch(e){}");
    window.eval("openScheduleEditor('beecroft')");
    ck('admin CANNOT open ANOTHER school timetable', window.eval("state._editingScheduleSchool") !== 'beecroft');
    window.eval("try{closeModal('modalSchoolManager')}catch(e){} state.user = { id:'uid-ine', name:'Ivy', role:'instructor', email:null, instructorId:null };");
    window.eval("openSchoolManager()");
    ck('instructor CANNOT open the school manager', !window.document.getElementById('modalSchoolManager').classList.contains('open'));
  } catch (e) {
    ck('admin-edit scenario ran without throwing', false);
    console.log('  admin-edit scenario error: ' + (e && e.message));
  }

  console.log(`\nPASS=${pass} FAIL=${fail}`);
  if (errors.length) { console.log('first errors:'); errors.slice(0, 5).forEach((e) => console.log('  • ' + e)); }
  if (fail) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('✓ CLIENT WIRING GREEN');
  process.exit(0);
})();

setTimeout(() => { console.log('WATCHDOG: timed out before asserts finished'); process.exit(2); }, 9000);
