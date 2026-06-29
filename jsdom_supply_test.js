// jsdom test for the supply-chain client layer: DB surface, pure forecast/demand/
// dashboard math, permission gating, and that the Orders + Supply tabs render.
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
  const ev = (expr) => window.eval(expr);
  const DB = ev('DB');

  ck('app booted without uncaught errors', errors.length === 0);

  // ── DB surface ──
  ['loadSupplyOrders', 'supplyOrderSave', 'supplyOrderSubmit', 'supplyOrderConfirm', 'supplyOrderSetStatus', 'supplyOrderShip', 'supplyOrderReceive', 'supplyOrderCancel', 'supplyAdminIds', 'setSupplyAdmin', 'supplyLoc'].forEach(m => {
    ck('DB.' + m + ' present', typeof DB[m] === 'function');
  });
  ck('DB.supplyLoc deterministic', DB.supplyLoc('abc-123') === '__supply__:abc-123');

  // ── pure forecast math ──
  ck('computeSuggestedRun base', ev('computeSuggestedRun(10, 10, 15, 8)') === 95 - 10);      // 15 + ceil(80) - 10 = 85
  ck('computeSuggestedRun zero when stocked', ev('computeSuggestedRun(100, 0, 0, 8)') === 0);
  ck('computeSuggestedRun no-stock', ev('computeSuggestedRun(0, 2, 5, 4)') === 13);           // 5 + ceil(8) - 0
  ck('computeSuggestedRun floors negatives', ev('computeSuggestedRun(50, 0, 3, 0)') === 0);

  // velocity: one in-window outflow of 10 over a 7-day window = 10/week; positive + out-of-window ignored
  window.eval(`state._vtest = [
    { itemId:'it1', size:'M', delta:-10, createdAt:new Date().toISOString() },
    { itemId:'it1', size:'M', delta: 5,  createdAt:new Date().toISOString() },
    { itemId:'it1', size:'M', delta:-99, createdAt:'2000-01-01T00:00:00Z' },
    { itemId:'it1', size:'L', delta:-7,  createdAt:new Date().toISOString() }
  ];`);
  ck('computeVelocityPerWeek window+sign filter', Math.abs(ev("computeVelocityPerWeek(state._vtest,'it1','M',7,Date.now())") - 10) < 0.001);
  ck('computeVelocityPerWeek size filter', Math.abs(ev("computeVelocityPerWeek(state._vtest,'it1','L',7,Date.now())") - 7) < 0.001);

  // ── set up shop + orders state for aggregation + render tests ──
  window.eval(`
    state.shop = {
      categories: [], sizeSets: [{ id:'ss1', name:'Std', sizes:['S','M','L'] }],
      suppliers: [{ id:'sup1', name:'Apparel Co', isInternal:true }, { id:'ext', name:'Belts Inc', isInternal:false }],
      items: [{ id:'it1', name:'Shorts', supplierId:'sup1', sized:true, sizeSetId:'ss1', archived:false }]
    };
    state.supplyOrders = [
      { id:'o1', schoolId:'edgeworth', supplierId:'sup1', status:'submitted',
        lines:[{ id:'l1', itemId:'it1', itemName:'Shorts', size:'M', qtyOrdered:10, qtyConfirmed:0, qtyShipped:0, qtyReceived:0, forWhom:'Juniors' }] },
      { id:'o2', schoolId:'beecroft', supplierId:'sup1', status:'confirmed', etaDate:'2026-08-01',
        lines:[{ id:'l2', itemId:'it1', itemName:'Shorts', size:'M', qtyOrdered:5, qtyConfirmed:5, qtyShipped:0, qtyReceived:0 }] },
      { id:'o3', schoolId:'edgeworth', supplierId:'sup1', status:'received',
        submittedAt:'2026-05-20T00:00:00Z', etaDate:'2026-06-01', receivedDate:'2026-05-30',
        lines:[{ id:'l3', itemId:'it1', itemName:'Shorts', size:'M', qtyOrdered:3, qtyConfirmed:3, qtyShipped:3, qtyReceived:3 }] },
      { id:'o4', schoolId:'x', supplierId:'ext', status:'submitted',
        lines:[{ id:'l4', itemId:'z', itemName:'Belt', size:'', qtyOrdered:99 }] }
    ];
    state.supplyStock = [{ schoolId:'__supply__:sup1', itemId:'it1', size:'M', qty:20, reorderLevel:0, targetLevel:0 }];
    state.supplyMovements = state._vtest;
    state.supplyActingSupplier = 'sup1';
  `);

  // ── demand aggregation ──
  const demand = ev('supplyDemandRows("sup1")');
  ck('demand: one SKU row', demand.length === 1);
  ck('demand: outstanding = 10 + 5 = 15', demand[0] && demand[0].total === 15);
  ck('demand: per-school split', demand[0] && demand[0].bySchool.edgeworth === 10 && demand[0].bySchool.beecroft === 5);
  ck('demand: excludes received + other suppliers', JSON.stringify(demand).indexOf('Belt') === -1);

  // ── dashboard ──
  const dash = ev('supplyDashboard("sup1")');
  ck('dashboard openCount = 2', dash.openCount === 2);
  ck('dashboard pipeline = 15', dash.pipeline === 15);
  ck('dashboard overdue = 0', dash.overdueCount === 0);
  ck('dashboard on-time = 100%', dash.onTimePct === 100);
  ck('dashboard avg lead = 10d', dash.avgLeadDays === 10);
  ck('dashboard received = 1', dash.receivedCount === 1);

  // ── permission gating ──
  window.eval("state.user = { id:'s', role:'superadmin' }; state.userSchools = [];");
  ck('superadmin is supply admin', ev('can.supplyAdmin()') === true);
  window.eval("state.user = { id:'d', role:'instructor', isSupplyAdmin:true }; state.userSchools = ['edgeworth'];");
  ck('flagged instructor is supply admin', ev('can.supplyAdmin()') === true);
  ck('supply admin can see shop', ev('can.seeShop()') === true);
  ck('supply admin can edit supply loc', ev("can.editStock('__supply__:sup1')") === true);
  ck('supply admin cannot edit real school', ev("can.editStock('edgeworth')") === false);
  window.eval("state.user = { id:'a', role:'admin', isSupplyAdmin:false }; state.userSchools = ['edgeworth'];");
  ck('plain admin is NOT supply admin', ev('can.supplyAdmin()') === false);
  ck('plain admin cannot edit supply loc', ev("can.editStock('__supply__:sup1')") === false);

  // ── render: Supply tab (supply admin) ──
  window.eval(`
    state.user = { id:'d', role:'instructor', isSupplyAdmin:true };
    state.userSchools = []; state.schoolId = null; state.shopStockSchool = '__supply__:sup1';
    state.shopView = 'supply'; state.supplyView = 'queue'; state.supplyActingSupplier = 'sup1';
    if (!document.getElementById('mainContent')) { const d=document.createElement('div'); d.id='mainContent'; document.body.appendChild(d); }
    renderShop();
  `);
  let supHtml = window.document.getElementById('mainContent').innerHTML;
  ck('supply console renders sub-tabs', /Queue/.test(supHtml) && /Forecast/.test(supHtml) && /Dashboard/.test(supHtml));
  ck('supply queue shows the submitted order school', /edgeworth/i.test(supHtml));

  // forecast sub-view renders the suggested run (vel 10/wk, on-hand 20, open 15, horizon 8 -> 15+80-20=75)
  window.eval("state.supplyView = 'forecast'; renderShop();");
  let fcHtml = window.document.getElementById('mainContent').innerHTML;
  ck('forecast view renders a table', /Make/.test(fcHtml) && /On hand/.test(fcHtml));
  ck('forecast suggested run present', ev('computeSuggestedRun(20, 10, 15, 8)') === 75);

  // ── render: Orders tab (school admin) ──
  window.eval(`
    state.user = { id:'a', role:'admin', isSupplyAdmin:false, schools:['edgeworth'] };
    state.userSchools = ['edgeworth']; state.schoolId = 'edgeworth'; state.shopStockSchool = 'edgeworth';
    state.shopView = 'orders'; state.orderEdit = null;
    renderShop();
  `);
  let ordHtml = window.document.getElementById('mainContent').innerHTML;
  ck('orders view renders New order button', /New order/.test(ordHtml));
  ck('orders view lists the school order', /Apparel Co/.test(ordHtml));
  ck('orders view shows a status badge', /Submitted|Confirmed/.test(ordHtml));

  // tabs gating: supply tab only when supplyAdmin; orders tab needs an internal supplier
  window.eval("state.shopView='stock'; renderShop();");
  // admin (no supply): supply tab absent, orders tab present (internal supplier exists + seeShop)
  ck('admin sees Orders tab', /setShopView\('orders'\)/.test(window.document.getElementById('mainContent').innerHTML));
  ck('admin does NOT see Supply tab', !/setShopView\('supply'\)/.test(window.document.getElementById('mainContent').innerHTML));

  // ── orderableSchools gating (bug-fix coverage) ──
  const setUser = (u, schools) => window.eval('state.user=' + JSON.stringify(u) + '; state.userSchools=' + JSON.stringify(schools || []) + ';');
  setUser({ id: 'sh', role: 'instructor', isShopAdmin: true }, ['edgeworth']);
  ck('orderable: shop admin = all schools (>1)', ev('orderableSchools().length') > 1);
  setUser({ id: 'a', role: 'admin' }, ['edgeworth']);
  ck('orderable: admin = own school only', JSON.stringify(ev('orderableSchools()')) === JSON.stringify(['edgeworth']));
  setUser({ id: 'd', role: 'instructor', isSupplyAdmin: true }, ['edgeworth']);
  ck('orderable: pure supply admin = none', ev('orderableSchools().length') === 0);
  setUser({ id: 'i', role: 'instructor' }, ['edgeworth']);
  ck('orderable: plain instructor = none', ev('orderableSchools().length') === 0);

  // pure supply admin: Supply tab yes, Orders tab no (the bug we fixed)
  window.eval("state.user={id:'d',role:'instructor',isSupplyAdmin:true}; state.userSchools=[]; state.schoolId=null; state.shopStockSchool='__supply__:sup1'; state.shopView='stock'; renderShop();");
  let saTabs = window.document.getElementById('mainContent').innerHTML;
  ck('pure supply admin sees Supply tab', /setShopView\('supply'\)/.test(saTabs));
  ck('pure supply admin does NOT see (broken) Orders tab', !/setShopView\('orders'\)/.test(saTabs));

  // ── interactive order editor flow (school admin) ──
  window.eval("state.user={id:'a',role:'admin',isSupplyAdmin:false,schools:['edgeworth']}; state.userSchools=['edgeworth']; state.schoolId='edgeworth'; state.shopStockSchool='edgeworth'; state.shopView='orders'; state.orderEdit=null; shopOrderNew();");
  ck('shopOrderNew opens editor for orderable school', ev('state.orderEdit && state.orderEdit.schoolId') === 'edgeworth');
  ck('shopOrderNew preselects internal supplier', ev('state.orderEdit.supplierId') === 'sup1');
  window.eval('orderEditAddLine();');
  ck('orderEditAddLine adds a line', ev('state.orderEdit.lines.length') === 1);
  window.eval("orderEditSetLine(0,'itemId','it1');");
  ck('line item set', ev('state.orderEdit.lines[0].itemId') === 'it1');
  ck('line auto-picks first size for sized item', ev('state.orderEdit.lines[0].size') === 'S');
  window.eval("orderEditSetLine(0,'qty','7'); orderEditSetLine(0,'forWhom','Comp team');");
  ck('line qty coerced to int', ev('state.orderEdit.lines[0].qty') === 7);
  ck('line forWhom set', ev('state.orderEdit.lines[0].forWhom') === 'Comp team');
  window.eval('renderShop();');
  let edHtml = window.document.getElementById('mainContent').innerHTML;
  ck('editor renders Save draft + submit', /Save draft/.test(edHtml) && /submit/i.test(edHtml));
  window.eval('orderEditRemoveLine(0);');
  ck('orderEditRemoveLine removes the line', ev('state.orderEdit.lines.length') === 0);

  console.log('\n════════════════════════════════════');
  console.log('  jsdom supply-chain: PASS=' + pass + ' FAIL=' + fail);
  console.log('════════════════════════════════════');
  if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('  ✓ all green'); process.exit(0);
})();
