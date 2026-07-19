// jsdom test: v142 — instructor uploads compliance documents against
// requirements. Covers: My compliance modal renders requirements + status;
// upload writes BOTH a document AND an instructor_compliance row with
// status='submitted' and documentId set; admin dashboard shows submitted
// count and doc indicator; admin editor loads the linked doc; verify (admin
// changes status to 'valid') preserves the documentId; documentId round-trips
// through the DB normaliser and saveDocument row shape.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const upserts = { documents: [], compliance: [] };
const chain = (kind) => ({
  from(t) { this._t = t; return this; },
  select() { return this; }, eq() { return this; }, order() { return this; }, in() { return this; }, is() { return this; }, or() { return this; }, limit() { return this; }, single() { return this; }, maybeSingle() { return this; },
  upsert(row) { upserts[this._t] = upserts[this._t] || []; upserts[this._t].push(JSON.parse(JSON.stringify(row))); return { then: (r) => r({ error: null }) }; },
  insert() { return { then: (r) => r({ error: null }) }; },
  delete() { return this; },
  auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }), updateUser: async () => ({ data: null, error: null }) },
  rpc: async () => ({ data: null, error: null }),
  functions: { invoke: async () => ({ data: null, error: null }) },
});
const theClient = chain('compliance');

let html = fs.readFileSync('index.html', 'utf8')
  .replace(/<script[^>]*src=[^>]*><\/script>/g, '')
  .replace(/<script>[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/' });
const { window } = dom;
window.SUPABASE_URL = 'https://x.supabase.co';
window.SUPABASE_ANON = 'anon-key';
window.KRMAS_APP_VERSION = '142';
window.supabase = { createClient: () => theClient };
window.XLSX = {};
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
window.alert = () => {};
window.confirm = () => true;
window.FileReader = class { readAsDataURL(f) { setTimeout(() => this.onload && this.onload({ target: { result: 'data:application/pdf;base64,AAAA' } }), 0); } };
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
  doc.querySelectorAll('.modal-bg.open').forEach((m) => m.classList.remove('open'));
  ev(`uiConfirm = async () => true;`);
  ev(`uiToast = () => {};`);

  const docs = [], recs = [];
  window.__docs = docs; window.__recs = recs;
  ev(`DB.saveDocument = (d) => { window.__docs.push(JSON.parse(JSON.stringify(d))); return Promise.resolve(true); };`);
  ev(`DB.saveInstructorCompliance = (r) => { window.__recs.push(JSON.parse(JSON.stringify(r))); return Promise.resolve(true); };`);
  ev(`DB.loadInstructorDocuments = () => Promise.resolve(window.__docs);`);

  // Fixture: instructor u1 with two requirements. Admin has not yet verified anything.
  ev(`state.user = { id: 'u1', role: 'instructor', name: 'Jen' };`);
  ev(`state.schoolId = 'edgeworth';`);
  ev(`state.customSchools = { edgeworth: { instructors: [ { id: 'u1', name: 'Jen', role: 'instructor' } ], schedule: [], contact: {} } };`);
  ev(`getInstructor = () => ({ id: 'u1', name: 'Jen' }); myInstructorId = () => 'u1';`);
  ev(`state.complianceReqs = [ { id: 'wwc', name: 'Working With Children Check', hasExpiry: true }, { id: 'fa', name: 'First Aid', hasExpiry: true } ];`);
  ev(`state.complianceRecords = [];`);
  ev(`state.myDocuments = [];`);

  // ── My compliance list ────────────────────────────────────────────────
  ev(`openMyCompliance()`);
  await sleep(20);
  let body = doc.getElementById('myComplianceBody').innerHTML;
  ck('list shows every requirement', /Working With Children Check/.test(body) && /First Aid/.test(body));
  ck('list offers Upload for unsubmitted requirements', /＋ Upload certificate/.test(body));

  // ── Upload against WWC ───────────────────────────────────────────────
  ev(`openComplianceUpload('wwc')`);
  await sleep(10);
  ck('upload modal preselects the requirement', /Working With Children Check/.test(doc.getElementById('compUpTitle').textContent));
  ck('upload modal shows expiry field for hasExpiry reqs', doc.getElementById('compUpExpiryRow').style.display !== 'none');

  // Stub a file selection.
  Object.defineProperty(doc.getElementById('compUpFile'), 'files', {
    value: [ { name: 'wwc-cert.pdf', size: 1024, type: 'application/pdf' } ],
    configurable: true,
  });
  doc.getElementById('compUpExpiry').value = '2027-06-30';
  doc.getElementById('compUpRef').value = 'WWC-9876';
  await ev(`submitComplianceUpload()`);
  await sleep(30);

  ck('upload persists a personal document', docs.length === 1 && docs[0].instructorId === 'u1' && docs[0].category === 'compliance');
  ck('document is tagged with requirementId', docs[0].requirementId === 'wwc');
  ck('document title includes the requirement name', /Working With Children Check/.test(docs[0].title));
  ck('upload persists a compliance record with status submitted', recs.length === 1 && recs[0].status === 'submitted');
  ck('record links back to the uploaded document', recs[0].documentId === docs[0].id);
  ck('record captures expiry and reference number', recs[0].expiryDate === '2027-06-30' && recs[0].referenceNumber === 'WWC-9876');
  ck('client state updated: my documents shows the new cert', ev(`state.myDocuments[0].requirementId`) === 'wwc');
  ck('client state updated: compliance record present', ev(`state.complianceRecords.length`) === 1 && ev(`state.complianceRecords[0].status`) === 'submitted');

  // ── My compliance re-render reflects submitted state ─────────────────
  ev(`renderMyComplianceList()`);
  body = doc.getElementById('myComplianceBody').innerHTML;
  ck('WWC row now reads as submitted', /Submitted — awaiting verification/.test(body));
  ck('submitted row offers Replace / update', /Replace \/ update/.test(body));
  ck('First Aid row still offers Upload', /＋ Upload certificate/.test(body));

  // ── Admin dashboard: renders submitted count and doc indicator ───────
  ev(`state.user = { id: 'a1', role: 'admin', name: 'Al' };`);
  ev(`allInstructors = () => [ { id: 'u1', name: 'Jen', role: 'instructor' } ];`);
  ev(`currentInstructors = () => allInstructors();`);
  ev(`can.switchAnySchool = () => false;`);
  // Compliance body element does not exist in raw HTML — inject one.
  if (!doc.getElementById('complianceBody')) {
    const el = doc.createElement('div'); el.id = 'complianceBody'; doc.body.appendChild(el);
  }
  ev(`renderComplianceDashboard()`);
  const dashHtml = doc.getElementById('complianceBody').innerHTML;
  ck('dashboard shows Awaiting verify count', /Awaiting verify/.test(dashHtml) && />1</.test(dashHtml));
  ck('dashboard marks the row with a doc indicator', /📄/.test(dashHtml));
  ck('dashboard labels the row awaiting verification', /Awaiting verification/.test(dashHtml));

  // ── Admin editor: loads the linked doc ────────────────────────────────
  ev(`openComplianceEditor('u1', 'wwc')`);
  await sleep(30);
  const docRow = doc.getElementById('compEdDocRow');
  ck('editor doc row is visible for a submitted record', docRow && docRow.style.display !== 'none');
  ck('editor doc row offers a View link', /viewDocument\(/.test(docRow.innerHTML));
  ck('editor status preselected to submitted', doc.getElementById('compEdStatus').value === 'submitted');

  // ── Verify: admin flips to valid — documentId must survive ───────────
  doc.getElementById('compEdStatus').value = 'valid';
  await ev(`saveComplianceRecord()`);
  await sleep(20);
  const verified = ev(`state.complianceRecords[0]`);
  ck('verify sets status to valid', verified.status === 'valid');
  ck('verify preserves the documentId link', verified.documentId === docs[0].id);
  ck('verify write went through the DB wrapper', recs[recs.length - 1].status === 'valid' && recs[recs.length - 1].documentId === docs[0].id);

  // ── DB shape: saveDocument row includes requirement_id ───────────────
  const dbSrc = fs.readFileSync('db.js', 'utf8');
  ck('db.js saveDocument row includes requirement_id column', /requirement_id:\s*doc\.requirementId/.test(dbSrc));
  ck('db.js loadInstructorCompliance surfaces documentId', /documentId:\s*r\.document_id/.test(dbSrc));
  ck('db.js normaliseDocument surfaces requirementId', /requirementId:\s*r\.requirement_id/.test(dbSrc));

  // ── Tour: My compliance step present ─────────────────────────────────
  ev(`state.user = { id: 'i1', role: 'instructor' };`);
  const titles = ev(`tourEligibleSteps().map(s => s.title)`);
  ck('tour includes My compliance step', titles.includes('My compliance'));

  // ── TOUR_ID bumped so everyone sees the new step ─────────────────────
  ck('TOUR_ID bumped to core-v3', ev(`TOUR_ID`) === 'core-v3');

  console.log(`\njsdom_compliance_v142: ${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILURES:'); fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  process.exit(0);
})();
