// jsdom test: v138 — owner-operator school setup. The step-0 admin can be
// added as the (sole) instructor with one tap on step 1. Covers: button
// appears when an admin name exists, tap adds them with role admin + email
// attached, button disappears once listed, duplicate guard, review step
// passes with the single admin-instructor, and no button when no admin name.
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
window.KRMAS_APP_VERSION = '138';
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
  const toasts = [];
  window.__toasts = toasts;
  ev(`uiToast = (m) => { window.__toasts.push(String(m)); };`);

  // Start the wizard for a real (unseeded) school and land on step 1 with an admin set.
  const sid = ev(`(KRMAS_SCHOOLS.find(s => !(SCHOOL_DATA_SEED[s.id] && SCHOOL_DATA_SEED[s.id].schedule && SCHOOL_DATA_SEED[s.id].schedule.length)) || KRMAS_SCHOOLS[0]).id`);
  ev(`startSchoolWizard(${JSON.stringify(sid)})`);
  ev(`state.wizardData.contact = { adminName: 'Sensei Owner', adminEmail: 'owner@krmas.com.au', locationLabel: 'X' };`);
  ev(`state.wizardStep = 1; renderWizardStep();`);
  let body = doc.getElementById('wizardBody').innerHTML;
  ck('one-tap admin button offered on step 1', /Add Sensei Owner \(the admin\) as instructor/.test(body));
  ck('owner-operator hint shown', /Owner-operator school/.test(body));

  ev(`wizardAddAdminAsInstructor()`);
  const added = ev(`state.wizardData.instructors[0]`);
  ck('admin added as instructor', added && added.name === 'Sensei Owner');
  ck('added with admin role', added.role === 'admin');
  ck('admin email attached for login linking', added.email === 'owner@krmas.com.au');
  body = doc.getElementById('wizardBody').innerHTML;
  ck('button disappears once listed', !/Add Sensei Owner \(the admin\) as instructor/.test(body));
  ck('listed in the instructor list', /Sensei Owner/.test(body));

  ev(`wizardAddAdminAsInstructor()`);
  ck('duplicate guarded', ev(`state.wizardData.instructors.length`) === 1 && toasts.some(m => /already listed/.test(m)));

  // Review passes with the single admin-instructor (no zero-instructor warning).
  ev(`state.wizardStep = 3; renderWizardStep();`);
  body = doc.getElementById('wizardBody').innerHTML;
  ck('review shows one instructor configured', /1 configured/.test(body));
  ck('review does not warn about missing instructors', !/Add at least one instructor/.test(body));

  // No admin name → no one-tap button, manual add still works.
  ev(`state.wizardData.instructors = []; state.wizardData.contact.adminName = ''; state.wizardStep = 1; renderWizardStep();`);
  body = doc.getElementById('wizardBody').innerHTML;
  ck('no button without an admin name', !/the admin\) as instructor/.test(body));
  ck('manual add form still present', !!doc.getElementById('wizNewInstrName'));

  console.log(`\njsdom_wizard_v138: ${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILURES:'); fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  process.exit(0);
})();
