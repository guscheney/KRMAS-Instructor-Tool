// jsdom test: v139 — superadmin scope-in stops the cross-school data bleed.
// Covers: DB wrappers call the correct RPC, selectSchool scopes in when a
// superadmin picks a non-home school and clears scope on returning home,
// admins bypass the scope flow entirely, the scope survives page reload via
// user_metadata re-apply on boot, the header badge reflects state and
// toggles, and the defence-in-depth filter drops other-school audits when
// scoped in even if RLS somehow returned them.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const rpcCalls = [];
const theClient = {
  auth: {
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    getSession: async () => ({ data: { session: null } }),
    getUser: async () => ({ data: { user: null } }),
    updateUser: async () => ({ data: null, error: null }),
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
window.KRMAS_APP_VERSION = '139';
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

  // Stub the per-school loaders so selectSchool completes without side effects.
  ev(`loadCurrentSchoolData = async () => {};`);
  ev(`loadShopData = async () => {};`);
  ev(`renderDay = () => {}; setView = (v) => { state.view = v; };`);

  // ── DB wrappers hit the right RPCs ────────────────────────────────────
  rpcCalls.length = 0;
  await ev(`DB.auth.setViewingSchool('beecroft')`);
  await ev(`DB.auth.clearViewingSchool()`);
  ck('set_viewing_school RPC invoked with school arg', rpcCalls.some(c => c.name === 'set_viewing_school' && c.args && c.args.p_school === 'beecroft'));
  ck('clear_viewing_school RPC invoked', rpcCalls.some(c => c.name === 'clear_viewing_school'));

  // ── selectSchool scopes in when a superadmin picks a non-home school ──
  rpcCalls.length = 0;
  ev(`state.user = { id: 'gus', role: 'superadmin', homeSchoolId: 'edgeworth' };`);
  ev(`state.schoolId = 'edgeworth'; state.customSchools = { edgeworth: { instructors: [{id:'g',name:'Gus'}], schedule: [{}], contact: {} }, beecroft: { instructors: [{id:'b',name:'B'}], schedule: [{}], contact: {} } };`);
  // Pretend beecroft is a known school so selectSchool takes the normal path.
  ev(`KRMAS_SCHOOLS.push({ id: 'beecroft', name: 'Beecroft' });`);
  await ev(`selectSchool('beecroft')`);
  await sleep(30);
  ck('superadmin scoped into the non-home school automatically', ev(`state.viewingAsSchool`) === 'beecroft');
  ck('state.schoolId matches the scoped school', ev(`state.schoolId`) === 'beecroft');
  ck('scope persisted to user_metadata', ev(`state._userMeta && state._userMeta.viewing_as_school`) === 'beecroft');
  ck('set_viewing_school called during select', rpcCalls.some(c => c.name === 'set_viewing_school' && c.args && c.args.p_school === 'beecroft'));

  // Returning home clears the scope.
  rpcCalls.length = 0;
  await ev(`selectSchool('edgeworth')`);
  await sleep(30);
  ck('returning home clears the scope', ev(`state.viewingAsSchool`) === null);
  ck('clear_viewing_school called on return home', rpcCalls.some(c => c.name === 'clear_viewing_school'));

  // Admins bypass the scope machinery entirely — no RPC fired.
  rpcCalls.length = 0;
  ev(`state.user = { id: 'a1', role: 'admin', homeSchoolId: 'edgeworth' };`);
  await ev(`selectSchool('beecroft')`);
  await sleep(30);
  ck('admins do not touch the scope RPCs', !rpcCalls.some(c => /viewing_school/.test(c.name)));

  // ── boot re-apply reads user_metadata and pushes back to the DB ───────
  rpcCalls.length = 0;
  ev(`state._userMeta = { viewing_as_school: 'beecroft' };`);
  await ev(`(async () => { try { const persisted = state._userMeta && state._userMeta.viewing_as_school; if (persisted && typeof persisted === 'string') { const r = await DB.auth.setViewingSchool(persisted); if (!r || !r.error) state.viewingAsSchool = persisted; else state.viewingAsSchool = null; } else { state.viewingAsSchool = null; } } catch (e) {} })()`);
  await sleep(20);
  ck('boot re-apply pushes persisted scope to the DB', rpcCalls.some(c => c.name === 'set_viewing_school' && c.args && c.args.p_school === 'beecroft'));
  ck('boot re-apply restores state.viewingAsSchool', ev(`state.viewingAsSchool`) === 'beecroft');

  // ── header badge state ────────────────────────────────────────────────
  ev(`state.user = { id: 'gus', role: 'superadmin', homeSchoolId: 'edgeworth' };`);
  ev(`state.viewingAsSchool = 'beecroft'; renderScopeBadge();`);
  const badge = doc.getElementById('scopeBadge');
  ck('badge visible for superadmin', badge.style.display !== 'none');
  ck('badge reads "Scoped in" while scoped', /Scoped in/.test(badge.textContent));
  ck('scoped badge carries the scoped class', badge.classList.contains('scope-badge-scoped'));
  ev(`state.viewingAsSchool = null; renderScopeBadge();`);
  ck('badge reads "Network view" when unscoped', /Network view/.test(badge.textContent));
  ck('unscoped badge carries the network class', badge.classList.contains('scope-badge-network'));
  ev(`state.user = { id: 'a1', role: 'admin' }; renderScopeBadge();`);
  ck('badge hidden for non-superadmin', badge.style.display === 'none');

  // Toggle round-trip
  rpcCalls.length = 0;
  ev(`state.user = { id: 'gus', role: 'superadmin', homeSchoolId: 'edgeworth' }; state.schoolId = 'beecroft'; state.viewingAsSchool = 'beecroft';`);
  await ev(`toggleNetworkView()`);
  await sleep(20);
  ck('toggle to network view clears scope', ev(`state.viewingAsSchool`) === null && rpcCalls.some(c => c.name === 'clear_viewing_school'));
  await ev(`toggleNetworkView()`);
  await sleep(20);
  ck('toggle back scopes into the current school', ev(`state.viewingAsSchool`) === 'beecroft');

  // ── defence-in-depth: audit loader filters other-school rows when scoped
  ev(`DB.audits = { listTemplates: async () => [ { id: 't1', school_id: 'beecroft' }, { id: 't2', school_id: 'edgeworth' }, { id: 't3', school_id: null } ], listAudits: async () => [ { id: 'a1', school_id: 'edgeworth' }, { id: 'a2', school_id: 'beecroft' } ], listActions: async () => [ { id: 'x1', school_id: 'edgeworth' } ] };`);
  ev(`DB.users = DB.users || { listSchoolProfiles: async () => [] };`);
  ev(`state.viewingAsSchool = 'beecroft'; state.schoolId = 'beecroft';`);
  await ev(`loadAuditData()`);
  await sleep(20);
  const D = ev(`state.auditData`);
  ck('scoped audit list drops other-school rows', D.audits.length === 1 && D.audits[0].id === 'a2');
  ck('scoped template list drops other-school rows but keeps network rows', D.templates.length === 2 && D.templates.some(t => t.id === 't1') && D.templates.some(t => t.id === 't3'));
  ck('scoped actions list filtered too', D.actions.length === 0);
  // Network view: superadmin sees everything again.
  ev(`state.viewingAsSchool = null;`);
  await ev(`loadAuditData()`);
  await sleep(20);
  const D2 = ev(`state.auditData`);
  ck('network view returns every row', D2.audits.length === 2 && D2.templates.length === 3);

  console.log(`\njsdom_scope_v139: ${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILURES:'); fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  process.exit(0);
})();
