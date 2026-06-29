// jsdom test: special-order student name surfaces an Aquila member picker when the
// shop's school is the user's Aquila-connected school; manual entry otherwise.
// Boots the real index.html + data.js + db.js + app.js (run from repo root).
const fs = require('fs');
const { JSDOM } = require('jsdom');

const theClient = { auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) }, from() { return this; }, select() { return this; }, eq() { return this; }, order() { return this; }, in() { return this; }, limit() { return this; }, single() { return this; }, rpc: async () => ({ data: null, error: null }), functions: { invoke: async () => ({ data: null, error: null }) } };

let html = fs.readFileSync('index.html', 'utf8')
  .replace(/<script[^>]*src=[^>]*><\/script>/g, '')
  .replace(/<script>[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/' });
const { window } = dom;
window.SUPABASE_URL = 'https://x.supabase.co';
window.SUPABASE_ANON = 'anon-key';
window.KRMAS_APP_VERSION = '109';
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
  await sleep(60);
  let pass = 0, fail = 0; const fails = [];
  const ck = (label, cond) => { if (cond) pass++; else { fail++; fails.push(label); } };
  const ev = (e) => window.eval(e);
  const btn = () => window.document.getElementById('soAquilaBtn');
  const results = () => window.document.getElementById('soAquilaResults').innerHTML;

  ck('app booted without uncaught errors', errors.length === 0);

  // common setup: superadmin, edgeworth shop = home school, Aquila connected, cached members
  window.eval(`
    state.user = { id:'s', role:'superadmin' };
    state.userSchools = ['edgeworth']; state.schoolId = 'edgeworth'; state.shopStockSchool = 'edgeworth';
    state.aquilaIntegration = { locationId:'loc1', roles:[] };
    state.shop = { categories:[], sizeSets:[], suppliers:[], items:[{ id:'it1', name:'Gi', sized:false, archived:false }] };
    _aquilaCache = { schoolId:'edgeworth', members:[
      { firstName:'Jane', lastName:'Doe', programmes:[] },
      { firstName:'John', lastName:'Smith', programmes:[] }
    ], programmes:[], fetchedAt: Date.now() };
  `);

  ck('schoolHasAquila true when configured', ev('schoolHasAquila()') === true);

  // open the new-order modal → Aquila button should be visible
  window.eval("openSpecialOrder('');");
  ck('Find-in-Aquila button visible for Aquila school', btn() && btn().style.display !== 'none');
  ck('soStudent placeholder hints at Aquila', /Find in Aquila/.test(window.document.getElementById('soStudent').placeholder));

  // open the picker → members render (from cache, no network)
  window.eval('soToggleAquilaPicker();');
  await sleep(20);
  ck('picker lists Aquila members', /Jane/.test(results()) && /Smith/.test(results()));

  // search narrows
  window.eval("soAquilaSearchInput('smith');");
  ck('search filters to Smith', /Smith/.test(results()) && !/Jane/.test(results()));

  // pick fills the student field + closes the picker
  window.eval('soPickAquilaMember(0);');
  ck('pick fills soStudent with full name', window.document.getElementById('soStudent').value === 'John Smith');
  ck('picker hidden after pick', window.document.getElementById('soAquilaPicker').style.display === 'none');

  // NEGATIVE 1: shop school differs from the user's Aquila school → manual only
  window.eval("state.shopStockSchool = 'beecroft'; openSpecialOrder('');");
  ck('button hidden when shop school != home Aquila school', btn() && btn().style.display === 'none');
  ck('placeholder reverts to manual', /Student's name/.test(window.document.getElementById('soStudent').placeholder));

  // NEGATIVE 2: no Aquila configured → manual only
  window.eval("state.shopStockSchool = 'edgeworth'; state.aquilaIntegration = null; openSpecialOrder('');");
  ck('button hidden when Aquila not configured', btn() && btn().style.display === 'none');

  // graceful failure: aquilaMembers errors → fallback message, manual entry intact
  window.eval(`
    state.aquilaIntegration = { locationId:'loc1', roles:[] }; _aquilaCache = null;
    state._soAquila = { members:[], query:'', error:'aquila_unavailable' }; soRenderAquilaResults();
  `);
  ck('error state shows manual-entry fallback', /manually/.test(results()));

  console.log('\n════════════════════════════════════');
  console.log('  jsdom special-order Aquila: PASS=' + pass + ' FAIL=' + fail);
  console.log('════════════════════════════════════');
  if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('  ✓ all green'); process.exit(0);
})();
