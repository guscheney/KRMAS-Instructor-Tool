// jsdom test: v113 — error telemetry, diagnostics, update prompt, post
// scheduling + auto-archive, supply backorders, notification inbox.
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
window.KRMAS_APP_VERSION = '113';
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
const dbSrc = fs.readFileSync('db.js', 'utf8');
const edgeSrc = fs.readFileSync('/mnt/user-data/outputs/deploy/edge-functions/send-push-notification/index.ts', 'utf8');
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const past = iso(new Date(today.getTime() - 30 * 86400000));
const recentPast = iso(new Date(today.getTime() - 3 * 86400000));
const future = iso(new Date(today.getTime() + 5 * 86400000));

(async () => {
  await sleep(60);
  let pass = 0, fail = 0; const fails = [];
  const ck = (label, cond) => { if (cond) pass++; else { fail++; fails.push(label); } };
  const ev = (e) => window.eval(e);
  const doc = window.document;

  ck('app booted without uncaught errors', errors.length === 0);

  // ── 1. error telemetry ──
  window.eval(`
    state.user = { id:'u1', role:'superadmin' }; state.schoolId = 'edgeworth'; state.view = 'shop';
    window.__logged = [];
    DB.logClientError = async (rec) => { window.__logged.push(rec); return true; };
    reportClientError('toast is not defined', 'stack-line-1');
    reportClientError('toast is not defined', 'dupe should be dropped');
    reportClientError('second distinct error', 's2');
  `);
  await sleep(10);
  ck('errors reported with context', ev("window.__logged.length") === 2 && ev("window.__logged[0].message") === 'toast is not defined' && ev("window.__logged[0].version") === '113' && ev("window.__logged[0].view") === 'shop');
  ck('duplicates deduped', ev("window.__logged.length") === 2);
  window.eval("for (let i=0;i<20;i++) reportClientError('flood-'+i, '');");
  await sleep(10);
  ck('session throttle caps at 10', ev("window.__logged.length") <= 10);
  ck('window error listener wired', /addEventListener\('error', \(e\) => reportClientError/.test(appSrc));
  ck('unhandledrejection wired', /unhandledrejection/.test(appSrc));

  // admin error view
  window.eval(`
    DB.loadClientErrors = async () => [{ created_at: '2026-07-04T10:00:00Z', version:'111', view:'shop', role:'admin', message:'toast is not defined', stack:'at shopOrderSaveDraft' }];
    openClientErrors();
  `);
  await sleep(15);
  const mc = () => doc.getElementById('mainContent').innerHTML;
  ck('error log renders rows', /toast is not defined/.test(mc()) && /v111/.test(mc()));

  // ── 2. diagnostics ──
  window.eval(`
    DB.diagnostics = async () => [
      { name:'table: supply_orders', ok:true, detail:'reachable' },
      { name:'rpc: supply_admin_ids (schema cache)', ok:false, detail:'404 — reload the API schema cache' },
    ];
    openDiagnostics();
  `);
  await sleep(10);
  ck('diagnostics view renders', /Run self-test/.test(mc()));
  window.eval("runDiagnostics();");
  await sleep(20);
  ck('probe results render with pass/fail', /supply_orders/.test(mc()) && /❌/.test(mc()) && /schema cache/.test(mc()));
  ck('problem count surfaces', /[0-9]+ problems? found/.test(mc()));

  // ── 3. update prompt ──
  ck('controllerchange listener present', /controllerchange/.test(appSrc));
  ck('first-install guard present', /hadController/.test(appSrc));
  window.eval("uiToastAction('A new version of KRMAS is ready', 'Reload', () => { window.__reloaded = true; });");
  const toast = () => doc.getElementById('krmasToast');
  ck('action toast renders with button', toast() && /Reload/.test(toast().innerHTML) && toast().classList.contains('show'));
  window.eval("_uiToastActionRun();");
  ck('action fires and toast dismisses', ev('window.__reloaded') === true && !toast().classList.contains('show'));

  // ── 4. scheduling + auto-archive ──
  window.eval(`
    state.user = { id:'u1', role:'superadmin' };
    state._archSweepDone = false;
    window.__saves = [];
    DB.saveFeedPost = async (p) => { window.__saves.push({ id: p.id, archived: p.archived }); return true; };
    state.feed = [
      { id:'f1', authorId:'u1', authorName:'G', body:'normal', targetScope:'school', createdAt:'2026-07-01' },
      { id:'f2', authorId:'u1', authorName:'G', body:'my scheduled', targetScope:'school', createdAt:'2026-07-01', publishAt:'${future}' },
      { id:'f3', authorId:'other', authorName:'X', body:'their scheduled', targetScope:'school', createdAt:'2026-07-01', publishAt:'${future}' },
      { id:'f4', authorId:'u1', authorName:'G', body:'long expired', targetScope:'school', createdAt:'2026-05-01', expiresAt:'${past}' },
      { id:'f5', authorId:'u1', authorName:'G', body:'recently expired', targetScope:'school', createdAt:'2026-06-20', expiresAt:'${recentPast}' },
    ];
    state.notices = []; state.networkNotices = [];
    renderFeed();
  `);
  await sleep(20);
  ck('author sees own scheduled post with band', /my scheduled/.test(mc()) && /Scheduled — publishes/.test(mc()));
  ck("others' future posts hidden", !/their scheduled/.test(mc()));
  ck('auto-archive swept the long-expired post', ev("window.__saves.some(s => s.id==='f4' && s.archived===true)"));
  ck('recently-expired (inside 14d) NOT swept', !ev("window.__saves.some(s => s.id==='f5')"));
  ck('long-expired post moved to Archived section', /Archived \(1\)/.test(mc()));
  ck('composer has publish field', !!doc.getElementById('composerPublish'));
  ck('db round-trips publish_at', /publish_at,/.test(dbSrc) && /publishAt:\s*row\.publish_at/.test(dbSrc) && /publish_at:\s*post\.publishAt/.test(dbSrc));
  ck('editing preserves archived flag', /archived:\s*existing\?\.archived \|\| false/.test(appSrc));

  // ── 5. backorders ──
  window.eval(`
    window.__backorder = null; window.__confirms = [];
    uiConfirm = async (msg) => { window.__confirms.push(String(msg)); return true; };
    state.supplyOrders = [{ id:'ord-1', schoolId:'edgeworth', supplierId:'sup1', status:'shipped',
      lines:[ { itemId:'i1', itemName:'Shorts', size:'M', qtyOrdered:10, qtyConfirmed:10, qtyShipped:8, qtyReceived:0 } ] }];
    DB.supplyOrderReceive = async () => true;
    DB.supplyAdminIds = async () => [];
    DB.loadSupplyOrders = async () => [{ id:'ord-1', schoolId:'edgeworth', supplierId:'sup1', status:'received',
      lines:[ { itemId:'i1', itemName:'Shorts', size:'M', qtyOrdered:10, qtyConfirmed:10, qtyShipped:8, qtyReceived:8 } ] }];
    DB.supplyOrderSave = async (oid, school, sup, notes, lines) => { window.__backorder = { school, sup, notes, lines }; return 'new-draft'; };
    loadShopStock = async () => {};
    shopOrderReceive('ord-1');
  `);
  await sleep(30);
  ck('shortfall prompt offered', ev("window.__confirms.some(c => /2 items from this order went unfilled/.test(c))"));
  ck('backorder draft created with remainder', ev("window.__backorder && window.__backorder.lines.length === 1 && window.__backorder.lines[0].qty === 2 && window.__backorder.lines[0].size === 'M'"));
  ck('backorder notes reference source order', ev("/Backorder from order ord-1/.test(window.__backorder.notes)") || ev("window.__backorder.notes.indexOf('Backorder') === 0"));

  // fully-received order must NOT prompt
  window.eval(`
    window.__confirms = []; window.__backorder = null;
    state.supplyOrders = [{ id:'ord-2', schoolId:'edgeworth', supplierId:'sup1', status:'shipped', lines:[{ itemId:'i1', itemName:'Shorts', size:'M', qtyOrdered:5, qtyConfirmed:5, qtyShipped:5, qtyReceived:0 }] }];
    DB.loadSupplyOrders = async () => [{ id:'ord-2', schoolId:'edgeworth', supplierId:'sup1', status:'received', lines:[{ itemId:'i1', itemName:'Shorts', size:'M', qtyOrdered:5, qtyConfirmed:5, qtyShipped:5, qtyReceived:5 }] }];
    shopOrderReceive('ord-2');
  `);
  await sleep(30);
  ck('full receipt ⇒ no backorder prompt', !ev("window.__confirms.some(c => /unfilled/.test(c))") && ev("window.__backorder") === null);

  // ── 6. notification inbox ──
  ck('bell in header', !!doc.getElementById('notifBell') && !!doc.getElementById('notifBadge'));
  window.eval(`
    DB.isSupabaseOverride = true;
    DB.notifUnreadCount = async () => 3;
    refreshNotifBadge();
  `);
  await sleep(15);
  ck('unread badge shows count', doc.getElementById('notifBadge').textContent === '3' && doc.getElementById('notifBadge').style.display !== 'none');
  window.eval(`
    window.__markedRead = false;
    DB.notifList = async () => [
      { id:'n1', title:'New supply order', body:'Edgeworth submitted an order (2 lines)', created_at: new Date().toISOString(), read_at: null },
      { id:'n2', title:'Order received', body:'Beecroft confirmed receipt', created_at: new Date(Date.now()-3600e3).toISOString(), read_at: new Date().toISOString() },
    ];
    DB.notifMarkAllRead = async () => { window.__markedRead = true; DB.notifUnreadCount = async () => 0; return true; };
    openNotifications();
  `);
  await sleep(25);
  ck('inbox lists notifications', /New supply order/.test(doc.getElementById('notifList').innerHTML) && /Order received/.test(doc.getElementById('notifList').innerHTML));
  ck('opening marks all read + badge clears', ev('window.__markedRead') === true);
  await sleep(15);
  ck('badge hidden at zero', doc.getElementById('notifBadge').style.display === 'none');
  ck('client mirrors explicit-target pushes to inbox', /notifInsert\(payload\.targetUserIds, payload\)/.test(dbSrc));
  ck('edge fn mirrors school-wide sends only', /if \(!targetUserIds\)/.test(edgeSrc) && /from\("notifications"\)\.insert/.test(edgeSrc));

  // ── version ──
  ck('sw.js at 113', /const VERSION = '113'/.test(fs.readFileSync('sw.js', 'utf8')));
  ck('cache busters at 113', (fs.readFileSync('index.html', 'utf8').match(/\?v=113/g) || []).length >= 4);

  console.log('\n════════════════════════════════════');
  console.log('  jsdom v113 ops: PASS=' + pass + ' FAIL=' + fail);
  console.log('════════════════════════════════════');
  if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('  ✓ all green'); process.exit(0);
})();
