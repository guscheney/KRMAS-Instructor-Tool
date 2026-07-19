// jsdom test: v136 — pathway recommenders constrained to school users +
// superadmins. Covers: option building (school users listed, network
// superadmins appended with tag, dedupe), legacy free-text preservation,
// empty-value default, the template editor no longer offering a recommenders
// list, and the template save blob omitting recommenders.
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
window.KRMAS_APP_VERSION = '136';
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(60);
  let pass = 0, fail = 0; const fails = [];
  const ck = (label, cond) => { if (cond) pass++; else { fail++; fails.push(label); } };
  const ev = (e) => window.eval(e);
  const doc = window.document;

  ck('scripts loaded without errors', errors.length === 0);
  ev(`uiConfirm = async () => true;`);

  // School users via allInstructors(); a network superadmin elsewhere via
  // allInstructorsAllSchools(). Stub both accessors directly.
  ev(`allInstructors = () => [ { id: 'i1', name: 'Sensei Jen', role: 'instructor' }, { id: 'i2', name: 'Sempai Pete', role: 'junior' }, { id: 'i3', name: 'Sensei Jen', role: 'instructor' } ];`);
  ev(`allInstructorsAllSchools = () => [ { id: 'g1', name: 'Gus', role: 'superadmin', schoolId: 'edgeworth' }, { id: 'x1', name: 'Outsider Instructor', role: 'instructor', schoolId: 'beecroft' } ];`);

  const opts = ev(`pathwayRecommenderOptions()`);
  ck('school users listed', opts.some(o => o.name === 'Sensei Jen') && opts.some(o => o.name === 'Sempai Pete'));
  ck('school user list deduped', opts.filter(o => o.name === 'Sensei Jen').length === 1);
  ck('network superadmin included with tag', opts.some(o => o.name === 'Gus' && /superadmin/.test(o.tag)));
  ck('other-school non-superadmin excluded', !opts.some(o => o.name === 'Outsider Instructor'));

  // Select population + legacy preservation
  ev(`populatePathwayRecommenders('Shidoin')`); // legacy free-text name, not a user
  const sel = doc.getElementById('pwRecommendedBy');
  ck('field is a select, not free text', sel && sel.tagName === 'SELECT');
  ck('legacy value preserved and selected', sel.value === 'Shidoin' && /\(legacy\)/.test(sel.innerHTML));
  ev(`populatePathwayRecommenders('Gus')`);
  ck('known user value selects normally without legacy tag', sel.value === 'Gus' && !/\(legacy\)/.test(sel.innerHTML));
  ev(`populatePathwayRecommenders('')`);
  ck('empty record defaults to the placeholder', sel.value === '');

  // Template editor: recommenders list gone, save blob omits it
  const pwSaves = [];
  window.__pwSaves = pwSaves;
  ev(`DB.savePathwayTemplate = (d) => { window.__pwSaves.push(JSON.parse(JSON.stringify(d))); return Promise.resolve(true); };`);
  ev(`state.user = { id: 's1', role: 'superadmin' };`);
  ev(`openPathwayTemplateEditor()`);
  const body = doc.getElementById('pathwayTemplateBody').innerHTML;
  ck('template editor no longer lists recommenders', !/one per line/.test(body) && !/textarea/.test(body));
  ck('template editor explains the new behaviour', /superadmins automatically/.test(body));
  await ev(`savePathwayTemplate()`);
  await sleep(20);
  ck('template save blob omits recommenders', pwSaves.length === 1 && !('recommenders' in pwSaves[0]));
  ck('legacy blobs with recommenders still apply harmlessly', (() => { ev(`applyPathwayTemplateOverrides({ recommenders: ['Old Name'] })`); const ok = ev(`INSTRUCTOR_PATHWAY_RECOMMENDERS[0]`) === 'Old Name'; ev(`applyPathwayTemplateOverrides(null)`); return ok; })());

  // ── v137: temp password shown persistently, not in a transient toast ──
  const confirmMsgs = [], toastMsgs = [];
  window.__confirmMsgs = confirmMsgs; window.__toastMsgs = toastMsgs;
  ev(`uiConfirm = async (msg) => { window.__confirmMsgs.push(String(msg)); return true; };`);
  ev(`uiToast = (msg) => { window.__toastMsgs.push(String(msg)); };`);
  ev(`requireRole = () => true;`);
  ev(`state.editingUserId = 'u9'; allInstructors = () => [ { id: 'u9', uid: 'AUTH-9', name: 'Cross School Casey', email: 'c@x.com' } ];`);
  ev(`DB.users.resetPassword = () => Promise.resolve({ ok: true, tempPassword: 'Temp-1234-Pass' });`);
  await ev(`adminResetPassword()`);
  await sleep(30);
  ck('temp password lands in the persistent dialog', confirmMsgs.some(m => /Temp-1234-Pass/.test(m)));
  ck('temp password never passes through a toast', !toastMsgs.some(m => /Temp-1234-Pass/.test(m)));
  ck('edge function implements resetPassword', /action === "resetPassword"/.test(fs.readFileSync('security/edge-functions/manage-users/index.ts', 'utf8')));
  ck('reset preserves existing user_metadata (tours_seen safe)', /user_metadata \?\? \{\}\), must_change: true/.test(fs.readFileSync('security/edge-functions/manage-users/index.ts', 'utf8')));

  console.log(`\njsdom_recommender_v136: ${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILURES:'); fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  process.exit(0);
})();
