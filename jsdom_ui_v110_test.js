// jsdom test: v110 UI overhaul — tokens/CSS repair, quick-find, admin menu
// filter, modal a11y (Escape/focus), shop tab loading states.
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
window.KRMAS_APP_VERSION = '134';
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

const css = fs.readFileSync('styles.css', 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(60);
  let pass = 0, fail = 0; const fails = [];
  const ck = (label, cond) => { if (cond) pass++; else { fail++; fails.push(label); } };
  const ev = (e) => window.eval(e);
  const doc = window.document;
  const key = (k, opts) => doc.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {})));

  ck('app booted without uncaught errors', errors.length === 0);

  // ── A. CSS tokens & repairs (text-level; jsdom does not load external css) ──
  ck('missing vars now defined (--grey-600)', /--grey-600:\s*#/.test(css));
  ck('--ink alias defined', /--ink:\s*var\(--black\)/.test(css));
  ck('aquila-screen tokens defined (--red-700, --amber-50)', /--red-700:/.test(css) && /--amber-50:/.test(css));
  ck('.btn-sm finally defined', /\.btn-sm\s*\{/.test(css));
  ck('.btn-warn is amber (distinct from primary)', /\.btn-warn\s*\{[^}]*--amber/.test(css));
  ck('.btn-danger exists for destructive actions', /\.btn-danger\s*\{[^}]*--red/.test(css));
  ck('shared empty/loading classes present', /\.ui-empty\s*\{/.test(css) && /\.ui-loading\s*\{/.test(css) && /@keyframes uiSpin/.test(css));
  ck(':focus-visible ring present', /:focus-visible\s*\{/.test(css));
  const appSrc = fs.readFileSync('app.js', 'utf8');
  ck('no 10.5px stragglers left', !/10\.5px/.test(appSrc));
  ck('delete buttons switched to btn-danger', /btn-danger" onclick="deleteDraftAudit/.test(appSrc));

  // ── B. helpers ──
  ck('uiLoading outputs spinner markup', /ui-spin/.test(ev("uiLoading('x')")));
  ck('uiEmpty outputs icon+title+hint', /ui-empty-title/.test(ev("uiEmpty('📦','None','hint')")));

  // ── C. quick-find ──
  window.eval(`
    state.user = { id:'u1', role:'superadmin' };
    state.userSchools = ['edgeworth']; state.schoolId = 'edgeworth';
    state.students = { s1: { name:'Alice Johnson' }, s2: { name:'Bob Ng' } };
    state.shop = { categories:[], sizeSets:[], items:[], suppliers:[{ id:'sup1', name:'KRMAS Shop', isInternal:true }] };
    state.supplyOrders = [];
  `);
  window.eval('openQuickFind();');
  await sleep(5);
  ck('quick-find modal opens', doc.getElementById('modalQuickFind').classList.contains('open'));
  ck('default list shows views + admin tools', /User management/.test(doc.getElementById('qfResults').innerHTML) && /Roster/.test(doc.getElementById('qfResults').innerHTML));
  window.eval("qfInputChange('alice');");
  ck('typing filters to the student', /Alice Johnson/.test(doc.getElementById('qfResults').innerHTML));
  window.eval("qfInputChange('krmas shop');");
  ck('suppliers are findable', /KRMAS Shop/.test(doc.getElementById('qfResults').innerHTML));
  window.eval("qfInputChange('user man');");
  const inp = doc.getElementById('qfInput');
  inp.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await sleep(5);
  ck('Enter runs the highlighted action (modal closed)', !doc.getElementById('modalQuickFind').classList.contains('open'));

  // role gating: instructor should get no admin tools
  window.eval("state.user = { id:'u2', role:'instructor' }; openQuickFind();");
  ck('instructor sees no admin tools in default list', !/User management/.test(doc.getElementById('qfResults').innerHTML));
  window.eval("closeModal('modalQuickFind');");

  // ── D. Escape + focus management ──
  window.eval("openModal('modalQuickFind');");
  await sleep(5);
  ck('focus moves into the dialog on open', doc.activeElement && doc.activeElement.id === 'qfInput');
  key('Escape');
  ck('Escape closes the topmost modal', !doc.getElementById('modalQuickFind').classList.contains('open'));
  ck('dialog got aria-modal', doc.getElementById('modalQuickFind').getAttribute('aria-modal') === 'true');
  window.eval("openModal('modalPinLock');");
  key('Escape');
  ck('Escape does NOT close the PIN lock', doc.getElementById('modalPinLock').classList.contains('open'));
  window.eval("closeModal('modalPinLock');");

  // Escape must run wrapper cleanup, not bare closeModal (audit fix)
  window.eval(`
    window._pdfDelegateRan = false;
    window.closePdfViewer = function(){ window._pdfDelegateRan = true; closeModal('modalPdfViewer'); };
    openModal('modalPdfViewer');
  `);
  key('Escape');
  ck('Escape on PDF viewer runs the close wrapper', ev('window._pdfDelegateRan') === true && !doc.getElementById('modalPdfViewer').classList.contains('open'));
  ck('branding modal registered for delegated close', /modalBranding/.test(appSrc.match(/_modalCloseDelegate = \{[\s\S]*?\};/)[0]));
  ck('qf student actions use JSON-escaped ids', /openStudent\(\$\{JSON\.stringify\(id\)\}\)/.test(appSrc));
  // Ctrl+K opens quick-find
  key('k', { ctrlKey: true });
  ck('Ctrl+K opens quick-find', doc.getElementById('modalQuickFind').classList.contains('open'));
  window.eval("closeModal('modalQuickFind');");

  // ── E. admin menu search ──
  window.eval(`
    state.user = { id:'u1', role:'superadmin' };
    state.view = 'admin'; renderAdmin();
  `);
  await sleep(5);
  ck('admin menu has a filter box', !!doc.getElementById('adminMenuSearch'));
  const items = () => Array.from(doc.querySelectorAll('[data-menu-item]'));
  ck('menu items carry data attrs', items().length >= 15);
  window.eval("adminMenuFilter('aquila');");
  const visible = items().filter(b => b.style.display !== 'none');
  ck('filter narrows to matching tools', visible.length === 1 && /Aquila/.test(visible[0].textContent));
  const hiddenSecs = Array.from(doc.querySelectorAll('[data-menu-sec]')).filter(s => s.style.display === 'none');
  ck('empty sections hide while filtering', hiddenSecs.length >= 4);
  window.eval("adminMenuFilter('');");
  ck('clearing filter restores all', items().every(b => b.style.display !== 'none'));

  // ── F. shop tab loading state ──
  window.eval(`
    state.user = { id:'u1', role:'superadmin' };
    state.shopStockSchool = 'edgeworth';
    state.shopTabLoading = 'special'; state.shopView = 'special'; renderShop();
  `);
  ck('special tab shows spinner while loading', /ui-loading/.test(doc.getElementById('mainContent').innerHTML));
  window.eval("state.shopTabLoading = null; renderShop();");
  ck('spinner clears when load completes', !/ui-loading/.test(doc.getElementById('mainContent').innerHTML));

  // ── G. version ──
  ck('sw.js bumped to 134', /const VERSION = '134'/.test(fs.readFileSync('sw.js', 'utf8')));
  ck('index.html cache busters at 134', (fs.readFileSync('index.html', 'utf8').match(/\?v=134/g) || []).length >= 4);
  ck('quick-find button present in header', /openQuickFind\(\)/.test(fs.readFileSync('index.html', 'utf8')));

  console.log('\n════════════════════════════════════');
  console.log('  jsdom v110 UI overhaul: PASS=' + pass + ' FAIL=' + fail);
  console.log('════════════════════════════════════');
  if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('  ✓ all green'); process.exit(0);
})();
