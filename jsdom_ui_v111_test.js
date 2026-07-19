// jsdom test: v111 — feedback layer (uiToast/uiConfirm + full native-dialog
// migration), hex→token sweep (doc-builders excluded), 3-state dark mode
// (live-applied), and mobile table scrolling.
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
window.matchMedia = (q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
const errors = [];
window.addEventListener('error', (e) => errors.push(e.error ? e.error.message : e.message));

['data.js', 'db.js', 'app.js'].forEach((f) => {
  const s = window.document.createElement('script');
  s.textContent = fs.readFileSync(f, 'utf8');
  window.document.body.appendChild(s);
});

const appSrc = fs.readFileSync('app.js', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(60);
  let pass = 0, fail = 0; const fails = [];
  const ck = (label, cond) => { if (cond) pass++; else { fail++; fails.push(label); } };
  const ev = (e) => window.eval(e);
  const doc = window.document;

  ck('app booted without uncaught errors', errors.length === 0);

  // ── A. dialog migration is total ──
  ck('zero bare alert( calls remain', !/(?<![.\w])alert\(/.test(appSrc.replace(/\/\/[^\n]*/g, '')));
  ck('zero bare confirm( calls remain', !/(?<![.\w])confirm\(/.test(appSrc.replace(/\/\/[^\n]*/g, '')));
  ck('283+ uiToast call sites', (appSrc.match(/uiToast\(/g) || []).length >= 280);
  ck('55+ uiConfirm call sites', (appSrc.match(/await uiConfirm\(/g) || []).length >= 55);

  // ── B. uiToast behaviour ──
  window.eval("uiToast('Order saved')");
  const toast = () => doc.getElementById('krmasToast');
  ck('toast renders', toast() && toast().classList.contains('show'));
  ck('auto-classifies success wording', toast().classList.contains('ui-toast-success'));
  window.eval("uiToast('Could not delete: boom')");
  ck('auto-classifies error wording', toast().classList.contains('ui-toast-error'));
  window.eval("uiToast('Could not delete: boom', 'info')");
  ck('explicit kind beats auto-classification', toast().classList.contains('ui-toast-info'));

  // ── C. uiConfirm behaviour ──
  let resolved = null;
  window.eval("window.__p = uiConfirm('Really?');");
  await sleep(5);
  ck('confirm modal opens', doc.getElementById('modalConfirm').classList.contains('open'));
  ck('message rendered', /Really\?/.test(doc.getElementById('uicMsg').textContent));
  window.eval("_uiConfirmDone(true);");
  resolved = await window.eval('window.__p');
  ck('OK resolves true', resolved === true);
  window.eval("window.__p2 = uiConfirm('Again?');");
  await sleep(5);
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  resolved = await window.eval('window.__p2');
  ck('Escape resolves false (never strands the promise)', resolved === false);
  ck('modal closed after Escape', !doc.getElementById('modalConfirm').classList.contains('open'));

  // ── D. a migrated flow end-to-end (deleteDraftAudit) ──
  let deleted = null;
  window.eval(`
    state.user = { id:'u1', role:'superadmin' };
    DB.audits = DB.audits || {};
    window.__delCalled = false;
    DB.audits.deleteAudit = async (id) => { window.__delCalled = id; return {}; };
    uiConfirm = async () => false;   // user cancels
    deleteDraftAudit('a1');
  `);
  await sleep(10);
  ck('cancel ⇒ delete NOT called', ev('window.__delCalled') === false);
  window.eval("uiConfirm = async () => true; deleteDraftAudit('a2');");
  await sleep(10);
  ck('confirm ⇒ delete called with id', ev('window.__delCalled') === 'a2');

  // ── E. hex sweep ──
  ck('audit score buttons use tokens now', !/border:1px solid \$\{on \? '#d62828'/.test(appSrc));
  ck('doc-builders kept raw hex (print must not depend on styles.css)', /#d62828/.test(appSrc));
  ck('amber-500 token exists for swept #f59e0b', /--amber-500:\s*#f59e0b/.test(css));
  const nonDocD62828 = appSrc.split('\n').filter(l => l.includes('#d62828') && !l.includes('var(')).length;
  ck('remaining #d62828 lines are few (doc builders only)', nonDocD62828 <= 20);

  // ── F. dark mode ──
  ck('deriveDark covers the new tokens', /--grey-600.*#e6e8eb|'--grey-600': '#e6e8eb'/.test(appSrc));
  window.eval("localStorage.setItem('krmas-dark-mode','auto'); applyThemeFromPref();");
  ck('auto + light system ⇒ light', !doc.body.classList.contains('dark-mode'));
  window.eval("toggleDarkMode();"); // auto -> dark
  ck('cycle to dark applies class live', doc.body.classList.contains('dark-mode'));
  ck('dark tokens actually re-derived (inline --white overridden)', ev("document.documentElement.style.getPropertyValue('--white').trim()") === '#1b1d22');
  window.eval("toggleDarkMode();"); // dark -> light
  ck('cycle to light removes class', !doc.body.classList.contains('dark-mode'));
  ck('pref persisted', ev("localStorage.getItem('krmas-dark-mode')") === '0');
  window.eval("toggleDarkMode();"); // light -> auto
  ck('third tap returns to auto', ev("getThemePref()") === 'auto');
  ck('quick-find offers the toggle', /Toggle dark mode/.test(appSrc));
  ck('Me view uses 3-state label', /themeLabel\(\)/.test(appSrc));

  // ── G. mobile tables ──
  ck('all tables wrapped in .table-scroll', (appSrc.match(/<div class="table-scroll"><table/g) || []).length >= 20);
  ck('open/close wrap counts match', (appSrc.match(/<div class="table-scroll"><table/g) || []).length === (appSrc.match(/<\/table><\/div>/g) || []).length);
  ck('table-scroll css present', /\.table-scroll\s*\{[^}]*overflow-x:\s*auto/.test(css));

  // ── H. version ──
  ck('sw.js at 138', /const VERSION = '138'/.test(fs.readFileSync('sw.js', 'utf8')));
  ck('cache busters at 138', (fs.readFileSync('index.html', 'utf8').match(/\?v=138/g) || []).length >= 4);

  console.log('\n════════════════════════════════════');
  console.log('  jsdom v111 UI: PASS=' + pass + ' FAIL=' + fail);
  console.log('════════════════════════════════════');
  if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('  ✓ all green'); process.exit(0);
})();
