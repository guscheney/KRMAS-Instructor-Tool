// jsdom test: v114 — role-aware roster assignment. Reproduces the live bug
// (instructor self-assigning to a part-staffed class landed in the junior slot)
// and proves the fix across roles, including the volunteer-to-cover path.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const theClient = { auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) }, from() { return this; }, select() { return this; }, eq() { return this; }, order() { return this; }, in() { return this; }, limit() { return this; }, single() { return this; }, maybeSingle() { return this; }, rpc: async () => ({ data: null, error: null }), functions: { invoke: async () => ({ data: null, error: null }) } };

let html = fs.readFileSync('index.html', 'utf8')
  .replace(/<script[^>]*src=[^>]*><\/script>/g, '')
  .replace(/<script>[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/' });
const { window } = dom;
window.SUPABASE_URL = 'https://x.supabase.co';
window.SUPABASE_ANON = 'anon-key';
window.KRMAS_APP_VERSION = '114';
window.supabase = { createClient: () => theClient };
window.XLSX = {};
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
const errors = [];
window.addEventListener('error', (e) => errors.push(e.error ? e.error.message : e.message));

['data.js', 'db.js', 'app.js'].forEach((f) => {
  const s = window.document.createElement('script');
  s.textContent = fs.readFileSync(f, 'utf8');
  window.document.body.appendChild(s);
});
(() => { const s = window.document.createElement('script'); s.textContent = "uiConfirm = async () => true; (function(){ const _o = uiToast; uiToast = function(m,k,d){ window.__lastAlert = String(m); try { _o(m,k,d); } catch(e){} }; })();"; window.document.body.appendChild(s); })(); // v111 harness shim

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(60);
  let pass = 0, fail = 0; const fails = [];
  const ck = (label, cond) => { if (cond) pass++; else { fail++; fails.push(label); } };
  const ev = (e) => window.eval(e);

  ck('app booted without uncaught errors', errors.length === 0);

  // ── A. pure slot logic ──
  ck('instructor prefers lead', ev("firstOpenRoleFor({}, 'instructor')") === 'lead');
  ck('instructor: lead taken → assist', ev("firstOpenRoleFor({lead:'x'}, 'instructor')") === 'assist');
  ck('THE BUG: lead+assist taken → instructor gets backup, NEVER junior', ev("firstOpenRoleFor({lead:'x',assist:'y'}, 'instructor')") === 'backup');
  ck('instructor with everything full → null', ev("firstOpenRoleFor({lead:'x',assist:'y',junior:'z',backup:'w'}, 'instructor')") === null);
  ck('junior prefers the junior slot', ev("firstOpenRoleFor({lead:'x'}, 'junior')") === 'junior');
  ck('junior never auto-slots as lead', ev("firstOpenRoleFor({assist:'y',junior:'z'}, 'junior')") === 'backup');
  ck('assistant prefers assist', ev("firstOpenRoleFor({lead:'x'}, 'assistant')") === 'assist');
  ck("assistant doesn't auto-take lead", ev("firstOpenRoleFor({assist:'y'}, 'assistant')") === 'backup');
  ck("'other' only ever backup", ev("firstOpenRoleFor({}, 'other')") === 'backup');
  ck('superadmin/admin records treated as instructor', ev("firstOpenRoleFor({}, 'superadmin')") === 'lead' && ev("firstOpenRoleFor({}, 'admin')") === 'lead');

  // ── B. myRosterRole resolution ──
  window.eval(`
    state.user = { id:'u1', role:'superadmin', instructorId:'inst1' };
    window.getInstructor = (id) => id === 'inst1' ? { id:'inst1', name:'Gus', role:'instructor' } : null;
  `);
  ck('instructor record role wins', ev('myRosterRole()') === 'instructor');
  window.eval("getInstructor = () => null;");
  ck('no record → account superadmin maps to instructor', ev('myRosterRole()') === 'instructor');
  window.eval("state.user = { id:'u2', role:'junior', instructorId:null };");
  ck('account junior stays junior', ev('myRosterRole()') === 'junior');

  // ── C. assignMeToClass end-to-end (the reported scenario) ──
  window.eval(`
    state.user = { id:'u1', role:'superadmin', instructorId:'inst1' };
    getInstructor = (id) => ({ id, name:'Gus', role:'instructor' });
    classForDateKey = (dk) => ({ dateKey: dk, lead:'other1', assist:'other2', junior:null, backup:null });
    isMyClass = () => false;
    saveEdits = async () => { window.__saved = true; };
    renderDay = () => {};
    checkSupervisionAfterAssign = () => {};
    state.edits = {};
    assignMeToClass('mon-1800');
  `);
  await sleep(15);
  ck('instructor in part-staffed class lands as BACKUP not junior',
    ev("state.edits['mon-1800'] && state.edits['mon-1800'].backup === 'inst1'") &&
    !ev("state.edits['mon-1800'] && state.edits['mon-1800'].junior === 'inst1'"));

  window.eval(`
    classForDateKey = (dk) => ({ dateKey: dk, lead:null, assist:null, junior:null, backup:null });
    state.edits = {};
    assignMeToClass('tue-1800');
  `);
  await sleep(15);
  ck('instructor in empty class lands as LEAD', ev("state.edits['tue-1800'] && state.edits['tue-1800'].lead === 'inst1'"));

  // junior-record user, junior slot filled → backup, with friendly message when nothing fits
  window.eval(`
    state.user = { id:'u3', role:'instructor', instructorId:'instJ' };
    getInstructor = (id) => ({ id, name:'Sam', role:'junior' });
    classForDateKey = (dk) => ({ dateKey: dk, lead:null, assist:null, junior:'kid1', backup:'kid2' });
    state.edits = {}; window.__lastAlert = null;
    assignMeToClass('wed-1800');
  `);
  await sleep(15);
  ck('junior with junior+backup filled gets a role-fit message, not the lead slot',
    ev("Object.keys(state.edits).length") === 0 && /suits your role/.test(ev('window.__lastAlert') || ''));

  // ── D. volunteer-to-cover ──
  window.eval(`
    state.user = { id:'u1', role:'superadmin', instructorId:'inst1' };
    getInstructor = (id) => ({ id, name:'Gus', role:'instructor' });
    state.edits = { 'thu-1800': { status:'needs-cover' } };
    volunteerToCover('thu-1800');
  `);
  await sleep(15);
  ck('instructor volunteering covers as LEAD + confirmed',
    ev("state.edits['thu-1800'].lead === 'inst1' && state.edits['thu-1800'].status === 'confirmed'"));

  window.eval(`
    state.user = { id:'u3', role:'instructor', instructorId:'instJ' };
    getInstructor = (id) => ({ id, name:'Sam', role:'junior' });
    classForDateKey = (dk) => ({ dateKey: dk, lead:null, assist:null, junior:null, backup:null });
    state.edits = { 'fri-1800': { status:'needs-cover' } };
    volunteerToCover('fri-1800');
  `);
  await sleep(15);
  ck('junior volunteering joins in the junior slot, NOT lead',
    ev("state.edits['fri-1800'].junior === 'instJ'") && !ev("state.edits['fri-1800'].lead === 'instJ'"));
  ck('class still flagged needs-cover after junior joins', ev("state.edits['fri-1800'].status === 'needs-cover'"));

  console.log('\n════════════════════════════════════');
  console.log('  jsdom roster role assignment: PASS=' + pass + ' FAIL=' + fail);
  console.log('════════════════════════════════════');
  if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('  ✓ all green'); process.exit(0);
})();
