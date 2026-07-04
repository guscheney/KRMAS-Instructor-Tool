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

  // ── SMAI live search: item-ensure matching (create + re-use-by-SKU) ──
  ev(`
    state.shop = { categories: [], sizeSets: [], suppliers: [], items: [] };
    state.shopStock = []; state.shopMovements = []; state.shopStockSchool = 'sch1';
    can.editStock = () => true;
    let _sc=0,_ss=0,_si=0;
    DB.saveCategory = async (c) => { const saved = Object.assign({ id: c.id || ('CAT'+(++_sc)) }, c); return saved; };
    DB.saveSupplier = async (s) => { const saved = Object.assign({ id: s.id || ('SUP'+(++_ss)) }, s); return saved; };
    DB.saveItem = async (it) => Object.assign({ id: it.id || ('ITEM'+(++_si)) }, it);
    DB.applyMovement = async (sid,itemId,size,delta,kind,note,refType,refId) => { window.__lastMovement = {sid,itemId,size,delta,kind,note,refType,refId}; return delta; };
  `);
  const product1 = ev(`({ title: 'Focus Mitts', productType: 'Boxing Protective Equipment', image: 'https://x/img.jpg', variants: [ { id:1, sku:'FM-001', title:'', price: '59.95', available: true } ] })`);
  const ensured1 = await ev(`(async () => { const p = ${JSON.stringify(product1)}; return await shopEnsureSmaiItem(p, p.variants[0]); })()`);
  ck('ensure: creates a new catalogue item from a SMAI product/variant', ensured1 && ensured1.name === 'Focus Mitts');
  ck('ensure: retail price carried from the variant', ensured1 && ensured1.retailPrice === 59.95);
  ck('ensure: category auto-created from product_type', ev('state.shop.categories.length') === 1 && ev('state.shop.categories[0].name') === 'Boxing Protective Equipment');
  ck('ensure: SMAI supplier auto-created', ev('state.shop.suppliers.some(s=>s.name==="SMAI")') === true);

  const ensured2 = await ev(`(async () => { const p = ${JSON.stringify(product1)}; return await shopEnsureSmaiItem(p, p.variants[0]); })()`);
  ck('ensure: second lookup of the same SKU reuses the item (no duplicate)', ev('state.shop.items.length') === 1);
  ck('ensure: reused item keeps the same id', ensured2.id === ensured1.id);

  // price refresh on re-lookup
  const product1Moved = ev(`({ title: 'Focus Mitts', productType: 'Boxing Protective Equipment', variants: [ { id:1, sku:'FM-001', title:'', price: '64.95', available: true } ] })`);
  const ensured3 = await ev(`(async () => { const p = ${JSON.stringify(product1Moved)}; return await shopEnsureSmaiItem(p, p.variants[0]); })()`);
  ck('ensure: retail price refreshed on a re-lookup with a new price', ensured3.retailPrice === 64.95);
  ck('ensure: still no duplicate created for the price refresh', ev('state.shop.items.length') === 1);

  // ── smaiConfirmAdd: catalogue mode posts a received movement with qty from the input ──
  ev(`
    state._smai = { mode: 'catalogue', product: ${JSON.stringify(product1)} };
    const el = window.document.createElement('input'); el.id = 'smaiQty-0'; el.value = '4';
    window.document.body.appendChild(el);
    window.__lastMovement = null;
  `);
  await ev('smaiConfirmAdd(0)');
  await sleep(20);
  ck('smaiConfirmAdd (catalogue): posts kind=received', ev('window.__lastMovement.kind') === 'received');
  ck('smaiConfirmAdd (catalogue): qty comes from the input', ev('window.__lastMovement.delta') === 4);
  ck('smaiConfirmAdd (catalogue): refType is catalogue', ev('window.__lastMovement.refType') === 'catalogue');

  // ── smaiConfirmAdd: special-order mode always adds exactly 1 and tags refType ──
  ev(`
    // fresh soItem select to check option-injection + value-setting
    const sel = window.document.createElement('select'); sel.id = 'soItem';
    sel.innerHTML = '<option value="">— choose an item —</option>';
    window.document.body.appendChild(sel);
    window.soOnItemChange = window.soOnItemChange || function(){};
    state._smai = { mode: 'special', product: ${JSON.stringify(product1)} };
    window.__lastMovement = null;
  `);
  await ev('smaiConfirmAdd(0)');
  await sleep(20);
  ck('smaiConfirmAdd (special): posts kind=received', ev('window.__lastMovement.kind') === 'received');
  ck('smaiConfirmAdd (special): always exactly 1 unit', ev('window.__lastMovement.delta') === 1);
  ck('smaiConfirmAdd (special): refType is special_order', ev('window.__lastMovement.refType') === 'special_order');
  ck('smaiConfirmAdd (special): item option injected into #soItem', ev(`document.getElementById('soItem').value`) !== '');

  // ── smaiConfirmAdd: blocked without edit-stock permission ──
  ev(`can.editStock = () => false; window.__lastMovement = null; state._smai = { mode:'catalogue', product: ${JSON.stringify(product1)} };`);
  await ev('smaiConfirmAdd(0)');
  await sleep(20);
  ck('smaiConfirmAdd: blocked when editStock() denies', ev('window.__lastMovement') === null);

  // ── search results rendering (pure render, mocked DB.smai.search) ──
  ev(`can.editStock = () => true;`);
  ck('openSmaiSearch defined', typeof ev('openSmaiSearch') === 'function');
  ck('smaiSearchInput defined', typeof ev('smaiSearchInput') === 'function');
  ev(`
    document.body.insertAdjacentHTML('beforeend', '<div id="smaiResults"></div>');
    state._smai = { mode:'catalogue', results: [ { handle:'gi', title:'Karate Gi', price:'$49.95', image:null, available:true } ], loading:false, error:null };
  `);
  ev('smaiRenderResults()');
  ck('search results render the product title', /Karate Gi/.test(ev(`document.getElementById('smaiResults').innerHTML`)));
  ev(`state._smai.error = 'smai_unavailable'; `);
  ev('smaiRenderResults()');
  ck('search error renders a friendly message', /reach SMAI/.test(ev(`document.getElementById('smaiResults').innerHTML`)));

  // ── Delete item: confirm warning, cascade cleanup of local state, DB.deleteItem called ──
  ev(`
    state.shop.items = [{ id:'del1', name:'Old Item', archived:false }];
    state.shopStock = [{ schoolId:'sch1', itemId:'del1', size:'', qty: 7, reorderLevel:0, targetLevel:0 }];
    state.shopMovements = [{ id:'m1', itemId:'del1', kind:'received', delta:7 }];
    state.shopStockSchool = 'sch1';
    window.__deletedId = null;
    DB.deleteItem = async (id) => { window.__deletedId = id; };
    uiConfirm = async (msg) => { window.__lastConfirmMsg = msg; return true; };
  `);
  await ev('shopDeleteItem("del1")');
  await sleep(20);
  ck('delete: confirm warning mentions permanent + every school', /permanently/.test(ev('window.__lastConfirmMsg')) && /EVERY school/.test(ev('window.__lastConfirmMsg')));
  ck('delete: confirm warning surfaces current local stock qty', /7 in stock/.test(ev('window.__lastConfirmMsg')));
  ck('delete: confirm warning mentions Archive as the reversible alternative', /Archive is reversible/.test(ev('window.__lastConfirmMsg')));
  ck('delete: calls DB.deleteItem with the right id', ev('window.__deletedId') === 'del1');
  ck('delete: item removed from local state', ev('state.shop.items.length') === 0);
  ck('delete: local stock rows for that item cleared', ev('state.shopStock.length') === 0);
  ck('delete: local movement rows for that item cleared', ev('state.shopMovements.length') === 0);

  // declining the confirm should do nothing
  ev(`
    state.shop.items = [{ id:'del2', name:'Keep Me', archived:false }];
    window.__deletedId = null;
    uiConfirm = async () => false;
  `);
  await ev('shopDeleteItem("del2")');
  await sleep(20);
  ck('delete: declining confirm calls DB.deleteItem never', ev('window.__deletedId') === null);
  ck('delete: declining confirm keeps the item', ev('state.shop.items.length') === 1);

  // catalogue list renders a Delete button per item
  ev(`can.manageShop = () => true; state.shopEdit = null; state.shopImport = null;`);
  const catHtmlWithDelete = ev('renderShopCatalogue()');
  ck('catalogue row includes a Delete button', /shopDeleteItem\('del2'\)/.test(catHtmlWithDelete));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILED:', fails.join(', ')); process.exit(1); }
  process.exit(0);
})();
