// jsdom test: v111.1 — feed post archiving (migration 24) + the live-found
// order-save regression ("toast is not defined": v109 supply code called a
// helper that never existed; guarded sites no-op'd silently, unguarded threw).
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
window.KRMAS_APP_VERSION = '111';
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
(() => { const s = window.document.createElement('script'); s.textContent = "uiConfirm = async () => true; (function(){ const _o = uiToast; uiToast = function(m,k,d){ window.__lastAlert = String(m); window.__lastKind = k; try { _o(m,k,d); } catch(e){} }; })();"; window.document.body.appendChild(s); })(); // v111 harness shim

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const appSrc = fs.readFileSync('app.js', 'utf8');

(async () => {
  await sleep(60);
  let pass = 0, fail = 0; const fails = [];
  const ck = (label, cond) => { if (cond) pass++; else { fail++; fails.push(label); } };
  const ev = (e) => window.eval(e);
  const doc = window.document;
  const today = new Date(); const past = new Date(today.getTime() - 5 * 86400000).toISOString().slice(0, 10);
  const future = new Date(today.getTime() + 5 * 86400000).toISOString().slice(0, 10);

  ck('app booted without uncaught errors', errors.length === 0);

  // ── A. the live bug class is extinct ──
  ck('no bare toast( calls anywhere', !/(?<![\w.])toast\(/.test(appSrc));
  ck('no guarded typeof-toast fossils', !/typeof toast ===/.test(appSrc));

  // ── B. order save-draft reaches the toast (the exact failing flow) ──
  window.eval(`
    state.user = { id:'u1', role:'superadmin' };
    state.userSchools = ['edgeworth']; state.schoolId = 'edgeworth'; state.shopStockSchool = 'edgeworth';
    state.shop = { categories:[], sizeSets:[], suppliers:[{ id:'sup1', name:'KRMAS Shop', isInternal:true }], items:[{ id:'it1', name:'Gi', sized:false, archived:false, supplierId:'sup1' }] };
    state.supplyOrders = [];
    DB.supplyOrderSave = async () => 'oid-1';
    DB.supplyOrderSubmit = async () => true;
    DB.loadSupplyOrders = async () => [];
    window.__lastAlert = null;
    state.orderEdit = { orderId:null, supplierId:'sup1', schoolId:'edgeworth', notes:'', lines:[{ itemId:'it1', itemName:'Gi', size:'', qty:2, forWhom:'' }] };
    shopOrderSaveDraft(false);
  `);
  await sleep(20);
  ck('draft save completes and toasts', /Draft saved/.test(ev('window.__lastAlert') || ''));
  window.eval("window.__lastAlert=null; state.orderEdit = { orderId:null, supplierId:'sup1', schoolId:'edgeworth', notes:'', lines:[{ itemId:'it1', itemName:'Gi', size:'', qty:2, forWhom:'' }] }; shopOrderSaveDraft(true);");
  await sleep(20);
  ck('save+submit completes and toasts', /Order submitted/.test(ev('window.__lastAlert') || ''));

  // ── C. feed archiving ──
  window.eval(`
    state.feed = [
      { id:'p1', authorId:'u1', authorName:'Gus', body:'active post', targetScope:'school', schoolId:'edgeworth', createdAt:'2026-07-01', expiresAt:'${future}' },
      { id:'p2', authorId:'u1', authorName:'Gus', body:'expired post', targetScope:'school', schoolId:'edgeworth', createdAt:'2026-06-01', expiresAt:'${past}' },
      { id:'p3', authorId:'u1', authorName:'Gus', body:'archived post', targetScope:'school', schoolId:'edgeworth', createdAt:'2026-05-01', expiresAt:'${past}', archived:true },
    ];
    state.notices = []; state.networkNotices = [];
    state.view = 'feed'; renderFeed();
  `);
  const mc = () => doc.getElementById('mainContent').innerHTML;
  ck('feed shows active + expired', /active post/.test(mc()) && /expired post/.test(mc()));
  ck('feed hides archived post', !/archived post/.test(mc()));
  ck('archived section offers show toggle', /Archived \(1\)/.test(mc()));
  window.eval("state._showArchivedFeed = true; renderFeed();");
  ck('expanded section reveals archived post', /archived post/.test(mc()));

  // menu affordances
  window.eval("openPostMenu('p2');");
  let sheet = doc.getElementById('actionSheetBody').innerHTML;
  ck('expired post offers Archive', /Archive post/.test(sheet));
  window.eval("closeModal('modalActions'); openPostMenu('p1');");
  sheet = doc.getElementById('actionSheetBody').innerHTML;
  ck('active post does NOT offer Archive', !/Archive post/.test(sheet));
  window.eval("closeModal('modalActions'); openPostMenu('p3');");
  sheet = doc.getElementById('actionSheetBody').innerHTML;
  ck('archived post offers Unarchive', /Unarchive post/.test(sheet));
  window.eval("closeModal('modalActions');");

  // archive flow end-to-end (DB stubbed)
  // v117: archiveFeedPost persists via DB.setPostArchived (targeted UPDATE, success === true),
  // not via a full-row saveFeedPost upsert — stub that path, and capture uiToast for errors.
  window.eval("window.uiToast = function (m) { window.__lastAlert = m; };");
  window.eval("window.__saved = null; DB.setPostArchived = async (p, val) => { window.__saved = { id: p.id, archived: !!val }; return true; };");
  window.eval("archiveFeedPost('p2', true);");
  await sleep(15);
  ck('archive persists archived=true', ev("window.__saved && window.__saved.id === 'p2' && window.__saved.archived === true"));
  ck('feed no longer shows the archived post', !/expired post/.test(mc()) || /Archived \(2\)/.test(mc()));
  window.eval("archiveFeedPost('p2', false);");
  await sleep(15);
  ck('unarchive persists archived=false', ev("window.__saved && window.__saved.archived === false"));
  ck('post returns to the feed', /expired post/.test(mc()));

  // failure path rolls back optimistic flag — v117 failure shape is a truthy {error}, not false
  window.eval("DB.setPostArchived = async () => ({ error: 'column missing' }); archiveFeedPost('p2', true);");
  await sleep(15);
  ck('failed save rolls back + error toast', ev("state.feed.find(p=>p.id==='p2').archived") === false && /Could not update/.test(ev('window.__lastAlert') || ''));

  // permission: non-author instructor gets no archive
  window.eval("state.user = { id:'someone-else', role:'instructor' }; openPostMenu('p2');");
  sheet = doc.getElementById('actionSheetBody').innerHTML;
  ck('non-author instructor cannot archive', !/Archive post/.test(sheet));

  // ── D. db.js round-trip ──
  const dbSrc = fs.readFileSync('db.js', 'utf8');
  ck('select list includes archived', /expires_at, archived,/.test(dbSrc));
  ck('read mapper includes archived', /archived:\s*row\.archived \|\| false/.test(dbSrc));
  ck('row builder includes archived', /archived:\s*post\.archived \|\| false/.test(dbSrc));

  console.log('\n════════════════════════════════════');
  console.log('  jsdom feed-archive + order-save: PASS=' + pass + ' FAIL=' + fail);
  console.log('════════════════════════════════════');
  if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('  ✓ all green'); process.exit(0);
})();
