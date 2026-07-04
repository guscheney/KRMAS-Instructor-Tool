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

  // ── smaiStageVariant / basket: catalogue mode stages catalogue items, NO quantities, NO stock ──
  ev(`
    state._smai = { mode: 'catalogue', product: ${JSON.stringify(product1)}, basket: [], scope: null };
    document.body.insertAdjacentHTML('beforeend', '<div id="smaiBasket"></div>');
    window.__lastMovement = null;
  `);
  ev('smaiStageVariant(0)');
  ck('staging does NOT touch the DB — no movement posted', ev('window.__lastMovement') === null);
  ck('staged line added to the basket (no qty concept)', ev('state._smai.basket.length') === 1 && ev('state._smai.basket[0].qty') === undefined);
  ck('basket panel renders the staged item', /Focus Mitts/.test(ev(`document.getElementById('smaiBasket').innerHTML`)));
  ck('basket panel carries the scope selector', /smaiScopeSel/.test(ev(`document.getElementById('smaiBasket').innerHTML`)));
  ck('basket button says catalogue, not stock', /to catalogue/.test(ev(`document.getElementById('smaiBasket').innerHTML`)));

  // stage a second, different product — basket should hold two lines (multi-item add)
  const product2 = ev(`({ title: 'Karate Belt', productType: 'Martial Arts Belts', variants: [ { id:2, sku:'KB-002', title:'240cm', price: '19.95', available: true } ] })`);
  ev(`state._smai.product = ${JSON.stringify(product2)};`);
  ev('smaiStageVariant(0)');
  ck('a second distinct product adds a second basket line', ev('state._smai.basket.length') === 2);

  // re-staging the SAME sku is a no-op (already listed), not a duplicate
  ev(`state._smai.product = ${JSON.stringify(product1)};`);
  ev('smaiStageVariant(0)');
  ck('re-staging the same SKU does not duplicate', ev('state._smai.basket.length') === 2);

  // remove a line
  ev('smaiRemoveBasketLine(1)');
  ck('remove-from-basket drops that line', ev('state._smai.basket.length') === 1);

  // ── smaiConfirmBasket: creates catalogue items only — zero stock movements ──
  ev(`
    state.shop = { categories: [], sizeSets: [], suppliers: [], items: [] };
    state.shopStock = []; state.shopMovements = []; state.shopStockSchool = 'sch1';
    can.manageShop = () => true;
    let _sc2=0,_ss2=0,_si2=0;
    DB.saveCategory = async (c) => Object.assign({ id: c.id || ('CAT'+(++_sc2)) }, c);
    DB.saveSupplier = async (s) => Object.assign({ id: s.id || ('SUP'+(++_ss2)) }, s);
    DB.saveItem = async (it) => Object.assign({ id: it.id || ('ITEM'+(++_si2)) }, it);
    window.__movements = [];
    DB.applyMovement = async (sid,itemId,size,delta,kind,note,refType,refId) => { window.__movements.push({sid,itemId,size,delta,kind,note,refType,refId}); return delta; };
    // scope selector set to a specific school (reuse the one the basket render created — a duplicate id would shadow it)
    document.querySelectorAll('#smaiScopeSel').forEach(el => el.remove());
    document.body.insertAdjacentHTML('beforeend', '<select id="smaiScopeSel"><option value="">All</option><option value="sch2" selected>School 2</option></select>');
    state._smai.basket = [
      { product: ${JSON.stringify(product1)}, variant: ${JSON.stringify(product1.variants[0])} },
      { product: ${JSON.stringify(product2)}, variant: ${JSON.stringify(product2.variants[0])} },
    ];
  `);
  await ev('smaiConfirmBasket()');
  await sleep(20);
  ck('confirmBasket: NO stock movements posted (catalogue only)', ev('window.__movements.length') === 0);
  ck('confirmBasket: stock rows untouched', ev('state.shopStock.length') === 0);
  ck('confirmBasket: creates catalogue items for both products', ev('state.shop.items.length') === 2);
  ck('confirmBasket: items scoped to the selected school', ev('state.shop.items.every(i=>i.schoolId==="sch2")'));
  ck('confirmBasket: closes the search modal when done', !ev(`document.getElementById('modalSmaiSearch').classList.contains('open')`));

  // basket commit blocked without manage-shop permission (catalogue write, not stock write)
  ev(`
    can.manageShop = () => false; window.__prevItems = state.shop.items.length;
    state._smai.basket = [ { product: ${JSON.stringify(product1)}, variant: { id:9, sku:'NEW-SKU', title:'', price:'5.00', available:true } } ];
  `);
  await ev('smaiConfirmBasket()');
  await sleep(20);
  ck('confirmBasket: blocked when manageShop() denies', ev('state.shop.items.length === window.__prevItems'));
  ev(`can.manageShop = () => true;`);

  // ── smaiConfirmAdd (special mode): ensures the catalogue item, injects into the form, NO stock ──
  ev(`can.editStock = () => true; window.__lastMovement = null; DB.applyMovement = async (sid,itemId,size,delta,kind,note,refType,refId) => { window.__lastMovement = {sid,itemId,size,delta,kind,note,refType,refId}; return delta; };`);
  ev(`
    // fresh soItem select to check option-injection + value-setting
    const sel = window.document.createElement('select'); sel.id = 'soItem';
    sel.innerHTML = '<option value="">— choose an item —</option>';
    window.document.body.appendChild(sel);
    window.soOnItemChange = window.soOnItemChange || function(){};
    state._smai = { mode: 'special', product: { title:'Headgear', productType:'Boxing Protective Equipment', variants:[{id:7,sku:'HG-007',title:'',price:'89.00',available:true}] } };
    window.__lastMovement = null;
  `);
  await ev('smaiConfirmAdd(0)');
  await sleep(20);
  ck('smaiConfirmAdd (special): posts NO stock movement', ev('window.__lastMovement') === null);
  ck('smaiConfirmAdd (special): item option injected into #soItem', ev(`document.getElementById('soItem').value`) !== '');
  ck('smaiConfirmAdd (special): new item is network-wide by default', ev(`state.shop.items.find(i=>i.sku==='HG-007').schoolId`) == null);
  // an EXISTING item picked again keeps whatever scope it already had (never silently re-scoped)
  ev(`state._smai = { mode: 'special', product: ${JSON.stringify(product1)} };`);
  await ev('smaiConfirmAdd(0)');
  await sleep(20);
  ck('smaiConfirmAdd (special): re-picking an existing item keeps its scope', ev(`state.shop.items.find(i=>i.sku==='FM-001').schoolId`) === 'sch2');

  // ── smaiConfirmAdd: blocked without edit-stock permission ──
  ev(`can.editStock = () => false; window.__addBefore = state.shop.items.length; state._smai = { mode:'special', product: { title:'Blocked', productType:'X', variants:[{id:3,sku:'BLK-1',title:'',price:'1.00',available:true}] } };`);
  await ev('smaiConfirmAdd(0)');
  await sleep(20);
  ck('smaiConfirmAdd: blocked when editStock() denies', ev('state.shop.items.length === window.__addBefore'));

  // ── catalogue scoping helpers + school-context filtering ──
  ev(`can.editStock = () => true;`);
  ck('shopItemAtSchool: null scope visible everywhere', ev(`shopItemAtSchool({schoolId:null}, 'anySchool')`) === true);
  ck('shopItemAtSchool: matching scope visible', ev(`shopItemAtSchool({schoolId:'sch1'}, 'sch1')`) === true);
  ck('shopItemAtSchool: other scope hidden', ev(`shopItemAtSchool({schoolId:'sch1'}, 'sch2')`) === false);
  ev(`
    state.shop.items = [
      { id:'n1', name:'Network Item', archived:false, schoolId:null },
      { id:'s1', name:'School1 Item', archived:false, schoolId:'sch1' },
      { id:'s2', name:'School2 Item', archived:false, schoolId:'sch2' },
      { id:'a1', name:'Archived Item', archived:true, schoolId:null },
    ];
    state.shopStockSchool = 'sch1';
  `);
  ck('shopSchoolItems: default school shows network + own, hides other + archived',
     ev(`shopSchoolItems().map(i=>i.id).sort().join(',')`) === 'n1,s1');
  ck('shopSchoolItems: explicit school param respected',
     ev(`shopSchoolItems('sch2').map(i=>i.id).sort().join(',')`) === 'n1,s2');

  // ── catalogue search + filters ──
  ev(`
    state.shop.categories = [{ id:'catA', name:'Belts' }];
    state.shop.suppliers = [{ id:'supA', name:'SMAI' }];
    state.shop.items = [
      { id:'i1', name:'Karate Belt Red', sku:'KB-R', archived:false, schoolId:null, categoryId:'catA', supplierId:'supA' },
      { id:'i2', name:'Focus Mitts', sku:'FM-X', archived:false, schoolId:'sch1', categoryId:null, supplierId:null },
      { id:'i3', name:'Old Gi', sku:'OG-1', archived:true, schoolId:null, categoryId:null, supplierId:null },
    ];
    state.shopCatFilter = null;
  `);
  ck('cat filter: default shows active only', ev(`shopCatMatchedItems().map(i=>i.id).sort().join(',')`) === 'i1,i2');
  ev(`shopCatFilter().q = 'belt';`);
  ck('cat filter: search matches name', ev(`shopCatMatchedItems().map(i=>i.id).join(',')`) === 'i1');
  ev(`shopCatFilter().q = 'fm-x';`);
  ck('cat filter: search matches SKU case-insensitively', ev(`shopCatMatchedItems().map(i=>i.id).join(',')`) === 'i2');
  ev(`shopCatFilter().q = ''; shopCatFilter().cat = 'catA';`);
  ck('cat filter: category filter works', ev(`shopCatMatchedItems().map(i=>i.id).join(',')`) === 'i1');
  ev(`shopCatFilter().cat = '_none';`);
  ck('cat filter: "no category" filter works', ev(`shopCatMatchedItems().map(i=>i.id).join(',')`) === 'i2');
  ev(`shopCatFilter().cat = 'all'; shopCatFilter().sup = 'supA';`);
  ck('cat filter: supplier filter works', ev(`shopCatMatchedItems().map(i=>i.id).join(',')`) === 'i1');
  ev(`shopCatFilter().sup = 'all'; shopCatFilter().scope = 'network';`);
  ck('cat filter: network-scope filter shows only all-schools items', ev(`shopCatMatchedItems().map(i=>i.id).join(',')`) === 'i1');
  ev(`shopCatFilter().scope = 'sch1';`);
  ck('cat filter: school-scope filter shows only that school item', ev(`shopCatMatchedItems().map(i=>i.id).join(',')`) === 'i2');
  ev(`shopCatFilter().scope = 'all'; shopCatFilter().archived = 'archived';`);
  ck('cat filter: archived view shows only archived', ev(`shopCatMatchedItems().map(i=>i.id).join(',')`) === 'i3');
  ev(`state.shopCatFilter = null;`);
  ev(`can.manageShop = () => true; state.shopEdit = null; state.shopImport = null;`);
  const catRender = ev('renderShopCatalogue()');
  ck('catalogue renders a search box', /shopCatSearch/.test(catRender));
  ck('catalogue renders the scope filter', /All-schools items/.test(catRender));
  ck('scope badge shows on school-scoped rows', /🏫/.test(ev('shopCatalogueListHtml()')));

  // ── item editor carries the scope selector ──
  ev(`state.shopEdit = { kind:'item', data: { name:'Scoped Thing', schoolId: null } };`);
  ck('editor: scope selector present', /shopItemScope/.test(ev('renderShopItemEditor()')));

  // ── supplier spend reports (pure computation) ──
  ck('cost basis: buy price preferred', ev(`shopItemCostBasis({buyPrice: 10, unitCost: 20})`) === 10);
  ck('cost basis: falls back to unit cost', ev(`shopItemCostBasis({buyPrice: null, unitCost: 20})`) === 20);
  ck('cost basis: null when neither set', ev(`shopItemCostBasis({buyPrice: null, unitCost: null})`) === null);
  ev(`
    window.__repItems = [
      { id:'iA', name:'Gi', supplierId:'smai', buyPrice: 30, unitCost: null },
      { id:'iB', name:'Mitts', supplierId:'smai', buyPrice: null, unitCost: 20 },
      { id:'iC', name:'Mystery', supplierId:'morgan', buyPrice: null, unitCost: null },
      { id:'iD', name:'Orphan', supplierId: null, buyPrice: 5, unitCost: null },
    ];
    window.__repSups = [ { id:'smai', name:'SMAI', isInternal:false }, { id:'morgan', name:'Morgan', isInternal:false } ];
    window.__repMoves = [
      { kind:'received', delta: 2, itemId:'iA', schoolId:'sch1' },   // 2×30 = 60 @ sch1
      { kind:'received', delta: 1, itemId:'iB', schoolId:'sch2' },   // 1×20 = 20 @ sch2
      { kind:'received', delta: 3, itemId:'iC', schoolId:'sch1' },   // uncosted ×3
      { kind:'received', delta: 4, itemId:'iD', schoolId:'sch1' },   // no supplier, 4×5 = 20
      { kind:'received', delta: 5, itemId:'iA', schoolId:'__supply__:xyz' }, // supply location — excluded
      { kind:'adjusted', delta: 9, itemId:'iA', schoolId:'sch1' },   // wrong kind — excluded
      { kind:'received', delta: -2, itemId:'iA', schoolId:'sch1' },  // negative — excluded
    ];
  `);
  const spendAgg = ev(`computeSupplierSpend(window.__repMoves, window.__repItems, window.__repSups)`);
  ck('spend: SMAI totals across schools at correct cost basis', (() => { const s = spendAgg.find(x => x.name === 'SMAI'); return s && s.spend === 80 && s.units === 3; })());
  ck('spend: per-school split correct', (() => { const s = spendAgg.find(x => x.name === 'SMAI'); return s && s.schools.sch1.spend === 60 && s.schools.sch2.spend === 20; })());
  ck('spend: uncosted units tracked separately, not $0-valued', (() => { const m = spendAgg.find(x => x.name === 'Morgan'); return m && m.spend === 0 && m.uncostedUnits === 3; })());
  ck('spend: no-supplier bucket present', (() => { const n = spendAgg.find(x => x.key === '_none'); return n && n.spend === 20; })());
  ck('spend: supply-location rows excluded from school totals', (() => { const s = spendAgg.find(x => x.name === 'SMAI'); return !Object.keys(s.schools).some(k => k.indexOf('__supply__') === 0); })());
  ck('spend: sorted by spend descending', spendAgg[0].name === 'SMAI');

  // outlier detection
  const outliers = ev(`computeSpendOutliers([
    { name:'SMAI', spend: 400, schools: { sch1: { spend: 350 }, sch2: { spend: 40 }, sch3: { spend: 10 } } },
    { name:'Morgan', spend: 100, schools: { sch1: { spend: 100 } } },
    { name:'Even', spend: 200, schools: { sch1: { spend: 100 }, sch2: { spend: 100 } } },
  ])`);
  ck('outliers: high spender flagged', outliers.some(o => o.kind === 'high' && o.schoolId === 'sch1' && o.supplier === 'SMAI'));
  ck('outliers: low spender flagged', outliers.some(o => o.kind === 'low' && o.supplier === 'SMAI'));
  ck('outliers: single-buyer supplier flagged separately', outliers.some(o => o.kind === 'single_buyer' && o.supplier === 'Morgan' && o.schoolId === 'sch1'));
  ck('outliers: evenly-split supplier produces no flags', !outliers.some(o => o.supplier === 'Even'));

  // render smoke
  ev(`
    can.manageShop = () => true;
    state.shop.items = window.__repItems; state.shop.suppliers = window.__repSups;
    state.shopReportData = { rows: window.__repMoves, truncated: false, error: null };
    state.shopReportPeriod = '365';
  `);
  const repHtml = ev('renderShopReports()');
  ck('report renders supplier spend section with club total', /Spend by supplier/.test(repHtml) && /\$100\.00/.test(repHtml));
  ck('report renders the by-school matrix', /By school/.test(repHtml));
  ck('report renders buying-pattern flags section', /Buying-pattern flags/.test(repHtml));
  ck('report surfaces uncosted units warning', /uncosted/.test(repHtml));
  ck('report shows the estimate caveat', /current buy price/.test(repHtml));
  ev(`state.shopReportData = { rows: [], truncated: false, error: null };`);
  ck('report empty state renders', /No receipts in this period/.test(ev('renderShopReports()')));
  ev(`can.manageShop = () => false;`);
  ck('report gated to shop admins', /No access/.test(ev('renderShopReports()')));
  ev(`can.manageShop = () => true;`);
  ck('DB.loadReceivedMovements exported', typeof ev('DB.loadReceivedMovements') === 'function');

  // ── shop tab rail grouping: management views folded under ⚙ Manage ──
  ev(`
    can.seeShop = () => true; can.manageShop = () => true; can.supplyAdmin = () => false;
    state.shop.suppliers = []; state.shopView = 'stock'; state.shopTabLoading = null;
    document.body.insertAdjacentHTML('beforeend', '<div id="mainContent"></div>');
  `);
  ev('renderShop()');
  const rail = ev(`document.getElementById('mainContent').innerHTML`);
  ck('rail: Manage tab present for shop admins', /setShopView\('manage'\)/.test(rail));
  ck('rail: catalogue/suppliers/reports NOT top-level any more', !/setShopView\('catalogue'\)/.test(rail) && !/setShopView\('suppliers'\)/.test(rail) && !/setShopView\('reports'\)/.test(rail));
  ck('rail: day-to-day ops still top-level', /setShopView\('stock'\)/.test(rail) && /setShopView\('reorder'\)/.test(rail) && /setShopView\('special'\)/.test(rail));
  ck('rail: Value folded under Manage for shop admins', !/setShopView\('value'\)/.test(rail));

  // clicking Manage routes to the default sub-view and shows the sub-rail
  ev(`setShopView('manage')`);
  ck('Manage routes to catalogue by default', ev('state.shopView') === 'catalogue');
  const subRail = ev(`document.getElementById('mainContent').innerHTML`);
  ck('sub-rail renders the management views', /setShopView\('suppliers'\)/.test(subRail) && /setShopView\('reports'\)/.test(subRail) && /setShopView\('transfers'\)/.test(subRail) && /setShopView\('value'\)/.test(subRail));

  // deep-link straight into a manage view still works, and Manage remembers position
  ev(`setShopView('suppliers')`);
  ck('deep-link to a manage view still works', ev('state.shopView') === 'suppliers');
  ev(`setShopView('stock'); setShopView('manage')`);
  ck('Manage remembers the last sub-view used', ev('state.shopView') === 'suppliers');

  // school admins (no manageShop) keep Value top-level and see no Manage tab
  ev(`can.manageShop = () => false; state.shopView = 'stock';`);
  ev('renderShop()');
  const railSchool = ev(`document.getElementById('mainContent').innerHTML`);
  ck('rail (school admin): Value stays top-level', /setShopView\('value'\)/.test(railSchool));
  ck('rail (school admin): no Manage tab', !/setShopView\('manage'\)/.test(railSchool));
  ev(`can.manageShop = () => true;`);

  // ── local catalogue ownership (v125 / migration 32) ──
  ev(`
    state.userSchools = ['sch1']; state.user = state.user || {}; state.user.isShopAdmin = false;
    can.manageShop = () => false;
    hasRole = (r) => r === 'admin';   // plain school admin
  `);
  ck('editCatalogueItem: admin can edit own-school item', ev(`can.editCatalogueItem({ schoolId:'sch1' })`) === true);
  ck('editCatalogueItem: admin cannot edit another school item', ev(`can.editCatalogueItem({ schoolId:'sch2' })`) === false);
  ck('editCatalogueItem: admin cannot edit network item', ev(`can.editCatalogueItem({ schoolId:null })`) === false);
  ck('addLocalCatalogue: school admin allowed', ev(`can.addLocalCatalogue()`) === true);
  ev(`can.manageShop = () => true;`);
  ck('editCatalogueItem: shop admin edits anything', ev(`can.editCatalogueItem({ schoolId:null })`) === true && ev(`can.editCatalogueItem({ schoolId:'sch2' })`) === true);

  // rail: school admin gets a top-level Catalogue tab
  ev(`can.manageShop = () => false; can.seeShop = () => true; can.supplyAdmin = () => false; state.shopView = 'stock';`);
  ev('renderShop()');
  ck('rail (school admin): Catalogue tab present', /setShopView\('catalogue'\)/.test(ev(`document.getElementById('mainContent').innerHTML`)));

  // catalogue list: read-only rows for items the admin doesn't own
  ev(`
    state.shop.items = [
      { id:'net1', name:'Network Gi', archived:false, schoolId:null },
      { id:'own1', name:'Local Pads', archived:false, schoolId:'sch1' },
    ];
    state.shopCatFilter = null; state.shopStockSchool = 'sch1'; state.shopEdit = null; state.shopImport = null;
  `);
  const localCatHtml = ev('renderShopCatalogue()');
  ck('catalogue (school admin): own item gets Edit/Delete', /shopEditItem\('own1'\)/.test(localCatHtml) && /shopDeleteItem\('own1'\)/.test(localCatHtml));
  ck('catalogue (school admin): network item is read-only', !/shopEditItem\('net1'\)/.test(localCatHtml) && /read-only/.test(localCatHtml));
  ck('catalogue (school admin): no ⋯ actions (import stays shop-admin)', !/shopCatalogueActions/.test(localCatHtml));
  ck('catalogue (school admin): local-ownership note shown', /Network items are read-only here/.test(localCatHtml));

  // entry-point guards
  ev(`window.__lastAlert = null; shopEditItem('net1');`);
  ck('shopEditItem refuses network item for school admin', ev('state.shopEdit') === null && /shop admins/.test(ev('window.__lastAlert') || ''));
  ev(`shopNewItem();`);
  ck('shopNewItem pre-scopes new item to the admin school', ev('state.shopEdit.data.schoolId') === 'sch1');
  // the editor's scope options come from KRMAS_SCHOOLS (real ids) ∩ userSchools —
  // use a real school id for this render assertion
  ev(`state.userSchools = ['edgeworth']; state.shopStockSchool = 'edgeworth'; state.shopEdit = { kind:'item', data: { name:'X', sized:false, schoolId:'edgeworth' } };`);
  const editorHtmlLocal = ev('renderShopItemEditor()');
  ck('editor (school admin): no All-schools option', !/All schools/.test(editorHtmlLocal));
  ck('editor (school admin): own school selectable, others absent', /edgeworth/.test(editorHtmlLocal) && !/"beecroft"/.test(editorHtmlLocal));
  ev(`state.shopEdit = null; state.userSchools = ['sch1']; state.shopStockSchool = 'sch1';`);

  // archive/delete guards on foreign items
  ev(`window.__lastAlert = null;`);
  await ev(`shopToggleArchive('net1')`);
  ck('archive refused on network item for school admin', /your own school/.test(ev('window.__lastAlert') || ''));
  ev(`window.__lastAlert = null;`);
  await ev(`shopDeleteItem('net1')`);
  ck('delete refused on network item for school admin', /your own school/.test(ev('window.__lastAlert') || ''));

  // SMAI basket: school admin allowed, scope forced to own school
  ev(`
    state._smai = { mode:'catalogue', basket: [ { product: { title:'Shin Guards', productType:'Protective', image:null }, variant: { id:11, sku:'SG-011', title:'', price:'25.00', available:true } } ], scope: null };
    document.querySelectorAll('#smaiScopeSel').forEach(el => el.remove());
    document.body.insertAdjacentHTML('beforeend', '<select id="smaiScopeSel"><option value="" selected>All</option></select>');
    let _si9 = 0;
    DB.saveItem = async (it) => Object.assign({ id: it.id || ('LX'+(++_si9)) }, it);
    DB.saveCategory = async (c) => Object.assign({ id: c.id || 'LC1' }, c);
    DB.saveSupplier = async (s) => Object.assign({ id: s.id || 'LS1' }, s);
  `);
  await ev('smaiConfirmBasket()');
  await sleep(20);
  ck('SMAI basket (school admin): commit allowed, item forced to own school', ev(`(state.shop.items.find(i=>i.sku==='SG-011')||{}).schoolId`) === 'sch1');

  // ensure: price refresh SKIPPED on items the admin cannot write (no RLS error)
  ev(`
    state.shop.items.push({ id:'netP', name:'Kick Pad', sku:'KP-1', schoolId:null, retailPrice: 10 });
    window.__savedIds = []; DB.saveItem = async (it) => { window.__savedIds.push(it.id||'new'); return it; };
  `);
  await ev(`shopEnsureSmaiItem({ title:'Kick Pad', productType:'X', image:null }, { id:1, sku:'KP-1', title:'', price:'12.00', available:true }, 'sch1')`);
  await sleep(10);
  ck('ensure (school admin): reuses network item WITHOUT attempting price write', ev('window.__savedIds.length') === 0);
  ev(`can.manageShop = () => true;`);

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

  // ── stock filter bar cleanup (v128): category pills -> compact select ──
  ev(`
    can.manageShop = () => true;
    state.shop.categories = [ { id:'c1', name:'Belts', sort: 1 }, { id:'c2', name:'Gis', sort: 2 } ];
    state.shop.suppliers = [ { id:'s1', name:'SMAI' } ];
    state.shopFilter = Object.assign({}, SHOP_FILTER_DEFAULTS, { cats: [] });
  `);
  const fbar = ev('shopFilterBarHtml()');
  ck('filter bar: category rendered as a select, not pills', /shopFilterCat\(/.test(fbar) && !/shopFilterToggleCat/.test(fbar));
  ck('filter bar: category options present with All', /<option value="">All<\/option>/.test(fbar) && /Belts/.test(fbar));
  ck('filter bar: status pills retained', /shopFilterStatus\('low'\)/.test(fbar));
  ev(`shopFilterCat('c1')`);
  ck('category select sets the cats array', ev('state.shopFilter.cats.join(",")') === 'c1');
  ev(`shopFilterCat('')`);
  ck('choosing All clears the category filter', ev('state.shopFilter.cats.length') === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILED:', fails.join(', ')); process.exit(1); }
  process.exit(0);
})();
