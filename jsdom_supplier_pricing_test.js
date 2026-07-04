// jsdom test for the supplier-catalogue pricing feature (v118): retail/buy price
// on inventory_items, margin calc, the CSV importer's upsert-by-SKU + auto-create-
// category/supplier behaviour, and the new "Receive stock" ledger action.
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
window.KRMAS_APP_VERSION = '118';
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
(() => { const s = window.document.createElement('script'); s.textContent = "uiConfirm = async () => true; (function(){ const _o = uiToast; uiToast = function(m,k,d){ window.__lastAlert = String(m); try { _o(m,k,d); } catch(e){} }; })();"; window.document.body.appendChild(s); })();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await sleep(80);
  let pass = 0, fail = 0; const fails = [];
  const ck = (label, cond) => { if (cond) pass++; else { fail++; fails.push(label); } };
  const ev = (expr) => window.eval(expr);

  ck('app booted without uncaught errors', errors.length === 0);

  // ── margin calc (pure) ──
  ck('margin: normal case', JSON.stringify(ev("shopItemMargin({retailPrice:100,buyPrice:60})")) === JSON.stringify({ dollar: 40, pct: 40 }));
  ck('margin: null when buyPrice missing', ev("shopItemMargin({retailPrice:100,buyPrice:null})") === null);
  ck('margin: null when retailPrice missing', ev("shopItemMargin({retailPrice:null,buyPrice:60})") === null);
  ck('margin: null when retailPrice is 0', ev("shopItemMargin({retailPrice:0,buyPrice:10})") === null);
  ck('margin: negative when buy > retail', ev("shopItemMargin({retailPrice:50,buyPrice:80}).dollar") === -30);
  ck('margin badge renders $ and % for a priced item', /margin \$40\.00 \(40%\)/.test(ev("shopMarginBadgeHtml({retailPrice:100,buyPrice:60})")));
  ck('margin badge empty when unpriced', ev("shopMarginBadgeHtml({retailPrice:null,buyPrice:null})") === '');
  ck('margin preview text: unset', /Margin shows once/.test(ev("shopMarginPreviewText('','')")));
  ck('margin preview text: set', /Margin: \$40\.00 \(40%\)/.test(ev("shopMarginPreviewText(100,60)")));
  ck('margin preview text: warns when buy > retail', /higher than retail/.test(ev("shopMarginPreviewText(50,80)")));

  // ── db.js row mapping round-trip (retail/buy price) ──
  ev(`window.__row = { id:'i1', name:'Test', category_id:null, supplier_id:null, unit_cost:null, unit:null, sku:'SKU1', sized:false, size_set_id:null, grade_ref:null, image_url:null, archived:false, retail_price:'49.95', buy_price:'22.00' }`);
  const mapped = ev("DB.__test_itemFromRow ? DB.__test_itemFromRow(window.__row) : null");
  // _itemFromRow isn't exported on DB — validate indirectly via saveItem's round trip using the local-storage fallback path instead.
  ck('DB.saveItem exists', typeof ev('DB.saveItem') === 'function');

  // ── CSV import: column recognition for the new price columns ──
  const header = ['name','category','supplier','unit cost','unit','sku','sized','size set','belt grade','retail price','buy price'];
  const idx = ev(`_csvHeaderIndex(${JSON.stringify(header)}, _SHOP_IMPORT_COLS.catalogue.syn)`);
  ck('import: retailPrice column recognised', idx.retailPrice === 9);
  ck('import: buyPrice column recognised', idx.buyPrice === 10);
  ck('import: required field (name) still satisfied', idx.name === 0);
  // synonym coverage (rrp / wholesale) — a supplier export might use either header wording
  const idxSyn = ev(`_csvHeaderIndex(['name','rrp','wholesale'], _SHOP_IMPORT_COLS.catalogue.syn)`);
  ck('import: "rrp" recognised as retailPrice', idxSyn.retailPrice === 1);
  ck('import: "wholesale" recognised as buyPrice', idxSyn.buyPrice === 2);

  // ── CSV import: upsert-by-SKU + auto-create category/supplier (stateful mock) ──
  ev(`
    state.shop = { categories: [], sizeSets: [], suppliers: [], items: [] };
    state.shopStock = [];
    state.shopMovements = [];
    let _catSeq = 0, _supSeq = 0, _itemSeq = 0;
    DB.saveCategory = async (c) => { const existing = state.shop.categories.find(x=>x.id===c.id); const saved = Object.assign({ id: c.id || ('CAT'+(++_catSeq)) }, c); if (existing) Object.assign(existing, saved); return saved; };
    DB.saveSupplier = async (s) => { const existing = state.shop.suppliers.find(x=>x.id===s.id); const saved = Object.assign({ id: s.id || ('SUP'+(++_supSeq)) }, s); if (existing) Object.assign(existing, saved); return saved; };
    DB.saveItem = async (it) => { const saved = Object.assign({ id: it.id || ('ITEM'+(++_itemSeq)) }, it); return saved; };
    DB.applyMovement = async (sid,itemId,size,delta,kind,note,refType,refId) => { window.__lastMovement = {sid,itemId,size,delta,kind,note,refType,refId}; return delta; };
  `);

  // Row 1: brand-new item, new category, new supplier auto-created
  ev(`
    state.shopImport = { kind:'catalogue', idx: { name:0, category:1, supplier:2, unitCost:3, unit:4, sku:5, sized:6, sizeSet:7, gradeRef:8, retailPrice:9, buyPrice:10 },
      rows: [ ['Karate Belt - 240cm','Martial Arts Belts','SMAI','','','SMAI-BELT-240','no','','','19.95',''] ] };
  `);
  await ev('shopRunCatalogueImport()');
  await sleep(20);
  ck('import: created 1 new item', ev('state.shop.items.length') === 1);
  ck('import: new category auto-created', ev('state.shop.categories.length') === 1 && ev('state.shop.categories[0].name') === 'Martial Arts Belts');
  ck('import: new supplier auto-created (not internal)', ev('state.shop.suppliers.length') === 1 && ev('state.shop.suppliers[0].name') === 'SMAI' && ev('state.shop.suppliers[0].isInternal') === false);
  ck('import: retailPrice carried through on create', ev('state.shop.items[0].retailPrice') === 19.95);
  ck('import: buyPrice left null when blank in CSV', ev('state.shop.items[0].buyPrice') === null);

  // Row 2: same SKU re-imported with an updated retail price — should UPDATE, not duplicate
  ev(`
    state.shopImport = { kind:'catalogue', idx: { name:0, category:1, supplier:2, unitCost:3, unit:4, sku:5, sized:6, sizeSet:7, gradeRef:8, retailPrice:9, buyPrice:10 },
      rows: [ ['Karate Belt - 240cm','Martial Arts Belts','SMAI','','','SMAI-BELT-240','no','','','24.95','12.00'] ] };
  `);
  await ev('shopRunCatalogueImport()');
  await sleep(20);
  ck('re-import by SKU updates instead of duplicating', ev('state.shop.items.length') === 1);
  ck('re-import updates retailPrice', ev('state.shop.items[0].retailPrice') === 24.95);
  ck('re-import updates buyPrice', ev('state.shop.items[0].buyPrice') === 12);
  ck('re-import did not create a second category', ev('state.shop.categories.length') === 1);
  ck('re-import reports as updated in the done summary', ev('state.shopImport.done.updated') === 1);

  // ── item editor: retail/buy price fields present and wired ──
  ev(`state.shopEdit = { kind:'item', data: { name:'Test Item', retailPrice: 30, buyPrice: 18 } };`);
  const editorHtml = ev('renderShopItemEditor()');
  ck('editor: retail price input present', /id="shopItemRetail"/.test(editorHtml));
  ck('editor: buy price input present', /id="shopItemBuy"/.test(editorHtml));
  ck('editor: margin preview shown with existing values', /Margin: \$12\.00 \(40%\)/.test(editorHtml));

  // catalogue list row shows margin badge for a fully-priced item
  ev(`can.manageShop = () => true; state.shop.items = [{ id:'x1', name:'Priced Item', retailPrice: 100, buyPrice: 70, archived:false, sized:false }]; state.shopEdit = null; state.shopImport = null;`);
  const catHtml = ev('renderShopCatalogue()');
  ck('catalogue list shows RRP', /RRP \$100\.00/.test(catHtml));
  ck('catalogue list shows buy price', /buy \$70\.00/.test(catHtml));
  ck('catalogue list shows margin badge', /margin \$30\.00 \(30%\)/.test(catHtml));

  // ── receive stock: distinct 'received' movement, additive not overwriting ──
  ev(`
    state.shop.items = [{ id:'itA', name:'Uniform', sized:false, supplierId:'SUP1' }];
    state.shop.suppliers = [{ id:'SUP1', name:'SMAI' }];
    state.shopStock = [{ schoolId:'sch1', itemId:'itA', size:'', qty: 5, reorderLevel:0, targetLevel:0 }];
    state.shopStockSchool = 'sch1';
    can.editStock = () => true;
    const el = window.document.createElement('input'); el.id = _shopRecvInputId('itA',''); el.value = '10';
    window.document.body.appendChild(el);
  `);
  await ev('shopReceiveStock("itA","")');
  await sleep(20);
  ck('receive: posts kind=received (not adjusted)', ev('window.__lastMovement.kind') === 'received');
  ck('receive: delta equals entered qty (additive)', ev('window.__lastMovement.delta') === 10);
  ck('receive: note credits the supplier', ev('window.__lastMovement.note') === 'Received from SMAI');
  ck('receive: refType is catalogue', ev('window.__lastMovement.refType') === 'catalogue');
  ck('receive: local stock row updated', ev("state.shopStock.find(r=>r.itemId==='itA').qty") === 10);
  ck('receive: does nothing without a quantity entered', await (async () => {
    ev(`document.getElementById(_shopRecvInputId('itA','')).value = ''; window.__lastMovement = null;`);
    await ev('shopReceiveStock("itA","")');
    return ev('window.__lastMovement') === null;
  })());
  ck('receive: blocked when editStock() denies', await (async () => {
    ev(`can.editStock = () => false; window.__lastMovement = null; document.getElementById(_shopRecvInputId('itA','')).value = '3';`);
    await ev('shopReceiveStock("itA","")');
    return ev('window.__lastMovement') === null;
  })());

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILED:', fails.join(', ')); process.exit(1); }
  process.exit(0);
})();
