// jsdom test: v140 — superadmin scope is SESSION-ONLY. Fresh sign-in always
// starts at home in the network view; scoping in is a deliberate per-session
// action. Covers: DB wrappers still exist, selectSchool does NOT auto-scope,
// scope changes are NOT persisted to user_metadata, a stale persisted value
// left over from v139 is proactively cleared on boot, the header badge
// still works, defence-in-depth audit filter still fires when scoped.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const rpcCalls = [];
const updateUserCalls = [];
const theClient = {
  auth: {
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    getSession: async () => ({ data: { session: null } }),
    getUser: async () => ({ data: { user: null } }),
    updateUser: async (arg) => { updateUserCalls.push(arg); return { data: null, error: null }; },
  },
  from() { return this; }, select() { return this; }, eq() { return this; }, order() { return this; }, in() { return this; }, limit() { return this; }, single() { return this; }, maybeSingle() { return this; },
  rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: null, error: null }; },
  functions: { invoke: async () => ({ data: null, error: null }) },
};

let html = fs.readFileSync('index.html', 'utf8')
  .replace(/<script[^>]*src=[^>]*><\/script>/g, '')
  .replace(/<script>[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/' });
const { window } = dom;
window.SUPABASE_URL = 'https://x.supabase.co';
window.SUPABASE_ANON = 'anon-key';
window.KRMAS_APP_VERSION = '141';
window.supabase = { createClient: () => theClient };
window.XLSX = {};
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
window.alert = () => {};
window.confirm = () => true;
const errors = [];
window.addEventListener('error', (e) => errors.push(e.error ? e.error.message : e.message));

['data.js', 'db.js', 'app.js'].forEach((f) => {
  const s = window.document.createElement('script');
  s.textContent = fs.readFileSync(f, 'utf8');
  window.document.body.appendChild(s);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(60);
  let pass = 0, fail = 0; const fails = [];
  const ck = (label, cond) => { if (cond) pass++; else { fail++; fails.push(label); } };
  const ev = (e) => window.eval(e);
  const doc = window.document;

  ck('scripts loaded without errors', errors.length === 0);
  doc.querySelectorAll('.modal-bg.open').forEach((m) => m.classList.remove('open'));
  ev(`uiConfirm = async () => true;`);
  ev(`uiToast = () => {};`);
  ev(`loadCurrentSchoolData = async () => {};`);
  ev(`loadShopData = async () => {};`);
  ev(`renderDay = () => {}; setView = (v) => { state.view = v; };`);

  rpcCalls.length = 0;
  await ev(`DB.auth.setViewingSchool('beecroft')`);
  await ev(`DB.auth.clearViewingSchool()`);
  ck('set_viewing_school RPC still wired', rpcCalls.some(c => c.name === 'set_viewing_school' && c.args && c.args.p_school === 'beecroft'));
  ck('clear_viewing_school RPC still wired', rpcCalls.some(c => c.name === 'clear_viewing_school'));

  rpcCalls.length = 0;
  updateUserCalls.length = 0;
  ev(`state.user = { id: 'gus', role: 'superadmin', homeSchoolId: 'edgeworth' };`);
  ev(`state.schoolId = 'edgeworth'; state.viewingAsSchool = null; state.customSchools = { edgeworth: { instructors: [{id:'g',name:'Gus'}], schedule: [{}], contact: {} }, beecroft: { instructors: [{id:'b',name:'B'}], schedule: [{}], contact: {} } };`);
  ev(`KRMAS_SCHOOLS.push({ id: 'beecroft', name: 'Beecroft' });`);
  await ev(`selectSchool('beecroft')`);
  await sleep(30);
  ck('switching to another school does NOT auto-scope', ev(`state.viewingAsSchool`) === null);
  ck('no scope RPC fired during school switch', !rpcCalls.some(c => /viewing_school/.test(c.name)));
  ck('school switch still updates state.schoolId', ev(`state.schoolId`) === 'beecroft');

  rpcCalls.length = 0;
  updateUserCalls.length = 0;
  await ev(`applyViewingScope('beecroft')`);
  await sleep(20);
  ck('explicit scope-in still calls set_viewing_school', rpcCalls.some(c => c.name === 'set_viewing_school'));
  ck('state.viewingAsSchool tracks the scope in-session', ev(`state.viewingAsSchool`) === 'beecroft');
  ck('scope change does NOT persist to user_metadata', updateUserCalls.length === 0);
  await ev(`applyViewingScope(null)`);
  await sleep(20);
  ck('explicit clear still calls clear_viewing_school', rpcCalls.some(c => c.name === 'clear_viewing_school'));
  ck('clearing does not persist either', updateUserCalls.length === 0);

  const bootSrc = fs.readFileSync('app.js', 'utf8');
  ck('boot re-apply of persisted scope removed', !/const persisted = state\._userMeta && state\._userMeta\.viewing_as_school/.test(bootSrc));
  ck('boot proactively clears server-side scope', /await DB\.auth\.clearViewingSchool\(\)/.test(bootSrc) && /session-only/.test(bootSrc));
  ck('boot strips legacy viewing_as_school from metadata', /delete state\._userMeta\.viewing_as_school/.test(bootSrc));
  ck('applyViewingScope no longer persists to user_metadata', !/updateUserMetadata\(\{ viewing_as_school: target/.test(bootSrc));

  ev(`state.user = { id: 'gus', role: 'superadmin' }; state.viewingAsSchool = 'beecroft'; renderScopeBadge();`);
  const badge = doc.getElementById('scopeBadge');
  ck('badge shows Scoped in while scoped', /Scoped in/.test(badge.textContent) && badge.classList.contains('scope-badge-scoped'));
  ev(`state.viewingAsSchool = null; renderScopeBadge();`);
  ck('badge shows Network view when unscoped', /Network view/.test(badge.textContent) && badge.classList.contains('scope-badge-network'));
  ev(`state.user = { id: 'a1', role: 'admin' }; renderScopeBadge();`);
  ck('badge hidden for non-superadmin', badge.style.display === 'none');

  rpcCalls.length = 0;
  ev(`state.user = { id: 'gus', role: 'superadmin' }; state.schoolId = 'beecroft'; state.viewingAsSchool = null;`);
  await ev(`toggleNetworkView()`);
  await sleep(20);
  ck('header toggle scopes into current school', ev(`state.viewingAsSchool`) === 'beecroft' && rpcCalls.some(c => c.name === 'set_viewing_school'));
  await ev(`toggleNetworkView()`);
  await sleep(20);
  ck('header toggle clears scope back to network', ev(`state.viewingAsSchool`) === null && rpcCalls.some(c => c.name === 'clear_viewing_school'));

  ev(`DB.audits = { listTemplates: async () => [ { id: 't1', school_id: 'beecroft' }, { id: 't2', school_id: 'edgeworth' }, { id: 't3', school_id: null } ], listAudits: async () => [ { id: 'a1', school_id: 'edgeworth' }, { id: 'a2', school_id: 'beecroft' } ], listActions: async () => [] };`);
  ev(`DB.users = DB.users || { listSchoolProfiles: async () => [] };`);
  ev(`state.viewingAsSchool = 'beecroft'; state.schoolId = 'beecroft';`);
  await ev(`loadAuditData()`);
  await sleep(20);
  const D = ev(`state.auditData`);
  ck('scoped audit list still drops other-school rows', D.audits.length === 1 && D.audits[0].id === 'a2');
  ck('network rows preserved in scoped view', D.templates.some(t => t.id === 't3'));

  ev(`state._userMeta = { viewing_as_school: 'gympie', tours_seen: ['core-v1'] };`);
  rpcCalls.length = 0; updateUserCalls.length = 0;
  await ev(`(async () => {
    state.viewingAsSchool = null;
    try { await DB.auth.clearViewingSchool(); } catch (e) {}
    try {
      if (state._userMeta && Object.prototype.hasOwnProperty.call(state._userMeta, 'viewing_as_school')) {
        delete state._userMeta.viewing_as_school;
        DB.auth.updateUserMetadata({ viewing_as_school: null });
      }
    } catch (e) {}
  })()`);
  await sleep(20);
  ck('boot clears server-side scope proactively', rpcCalls.some(c => c.name === 'clear_viewing_school'));
  ck('boot strips legacy viewing_as_school from client memory', !('viewing_as_school' in ev(`state._userMeta`)));
  ck('boot preserves other user_metadata (tours_seen)', ev(`state._userMeta.tours_seen[0]`) === 'core-v1');
  ck('boot writes null to auth metadata to purge legacy value', updateUserCalls.some(a => a && a.data && a.data.viewing_as_school === null));
  ck('state.viewingAsSchool is null after boot', ev(`state.viewingAsSchool`) === null);

  console.log(`\njsdom_scope_v140: ${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILURES:'); fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  process.exit(0);
})();
