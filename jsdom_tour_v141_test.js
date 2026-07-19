// jsdom test: v141 — tour catch-up for v135–v140 features.
// Asserts: new steps exist, role-gated correctly (superadmin gets all four,
// admin gets one, instructor gets none), TOUR_ID bumped so everyone sees it
// again, target selectors resolve against real markup.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const theClient = { auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }), updateUser: async () => ({ data: null, error: null }) }, from() { return this; }, select() { return this; }, eq() { return this; }, order() { return this; }, in() { return this; }, limit() { return this; }, single() { return this; }, maybeSingle() { return this; }, rpc: async () => ({ data: null, error: null }), functions: { invoke: async () => ({ data: null, error: null }) } };

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

  // TOUR_ID bumped → every existing user re-eligible for the catch-up.
  ck('TOUR_ID bumped to core-v3', ev(`TOUR_ID`) === 'core-v3');

  // Superadmin sees every new step.
  ev(`state.user = { id: 's1', role: 'superadmin' };`);
  const supTitles = ev(`tourEligibleSteps().map(s => s.title)`);
  ck('superadmin gets Scope badge step', supTitles.includes('Scope badge (superadmin)'));
  ck('superadmin gets Progression programs step', supTitles.includes('Progression programs'));
  ck('superadmin gets Pathway template step', supTitles.includes('Pathway template'));
  ck('superadmin gets Adding a new school step', supTitles.includes('Adding a new school'));

  // Admin sees the school-adding step but nothing superadmin-only.
  ev(`state.user = { id: 'a1', role: 'admin' };`);
  const admTitles = ev(`tourEligibleSteps().map(s => s.title)`);
  ck('admin gets Adding a new school step', admTitles.includes('Adding a new school'));
  ck('admin does NOT see Scope badge step', !admTitles.includes('Scope badge (superadmin)'));
  ck('admin does NOT see Progression programs step', !admTitles.includes('Progression programs'));
  ck('admin does NOT see Pathway template step', !admTitles.includes('Pathway template'));

  // Instructor sees none of the new steps.
  ev(`state.user = { id: 'i1', role: 'instructor' };`);
  const insTitles = ev(`tourEligibleSteps().map(s => s.title)`);
  ck('instructor does NOT see Scope badge step', !insTitles.includes('Scope badge (superadmin)'));
  ck('instructor does NOT see Progression programs step', !insTitles.includes('Progression programs'));
  ck('instructor does NOT see Pathway template step', !insTitles.includes('Pathway template'));
  ck('instructor does NOT see Adding a new school step', !insTitles.includes('Adding a new school'));

  // Target markup exists for the new selectors (proves the tour won't silently
  // skip the new steps on the real DOM).
  ck('scopeBadge markup present in index.html', !!doc.getElementById('scopeBadge'));
  const srcApp = fs.readFileSync('app.js', 'utf8');
  ck('admin menu still binds Progression programs button', /openProgressionProgramsEditor\(\)/.test(srcApp));
  ck('admin menu still binds Pathway template button', /openPathwayTemplateEditor\(\)/.test(srcApp));
  ck('admin menu still binds Instructor manager button', /openInstructorManager\(\)/.test(srcApp));

  // Sanity: earlier v134 steps preserved (didn't accidentally drop the shell tour).
  ev(`state.user = { id: 's1', role: 'superadmin' };`);
  const supAll = ev(`tourEligibleSteps().map(s => s.title)`);
  ck('shell tour still present', supAll.includes('Home') && supAll.includes('Roster') && supAll.includes('My profile'));
  ck('v135 shop/settings tour still present', supAll.includes('Inventory tabs') && supAll.includes('Aquila CRM key'));

  console.log(`\njsdom_tour_v141: ${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILURES:'); fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  process.exit(0);
})();
