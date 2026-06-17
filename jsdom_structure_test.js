// v61 — school structure moved OUT of the client bundle into per-school DB rows.
// Verifies the client boots with an EMPTY bundled seed and populates SCHOOL_DATA_SEED
// at runtime from ONLY the member schools' rows: a member resolves its structure, a
// non-member resolves nothing, the batch query is scoped to the member set, and saves
// write a per-school overlay row (never the old global blob).
const fs = require('fs');
const { JSDOM } = require('jsdom');

function makeClient(sessionUser) {
  const calls = { upserts: [], invokes: [], inFilters: [] };
  const profiles = [
    { id: 'sa',  role: 'superadmin', school_id: null,        schools: null,                        display_name: 'Sara', email: 'sa@krmas.app' },
    { id: 'meb', role: 'instructor', school_id: 'edgeworth', schools: ['edgeworth', 'beecroft'],   display_name: 'Mel',  email: 'meb@krmas.app' },
  ];
  // Per-school structure rows, exactly as the migration produces them.
  const kvRows = [
    { school_id: 'edgeworth', key: 'school-seed', value: { instructors: [{ id: 'gus', name: 'Sensei Gus', short: 'Gus', role: 'admin' }], schedule: [{ day: 1, start: '16:00', end: '16:30', type: 'karate' }], defaults: {}, contact: { locationLabel: 'Edgeworth' } } },
    { school_id: 'edgeworth', key: 'custom-schools', value: { instructors: [], schedule: [], defaults: {}, contact: {} } },
    { school_id: 'beecroft',  key: 'school-seed', value: { instructors: [], schedule: [{ day: 2, start: '17:00', end: '17:45', type: 'karate' }], defaults: {}, contact: { locationLabel: 'Beecroft' } } },
    // NOTE: deliberately NO rutherford row — a non-member must resolve nothing.
  ];
  const data = { profiles, kv_store: kvRows };
  let session = sessionUser ? { user: sessionUser } : null;
  function builder(table) {
    const b = { _table: table, _op: 'select', _in: {} };
    const ch = (fn) => (...a) => { fn(...a); return b; };
    b.select = ch(() => {});
    b.upsert = ch((row) => calls.upserts.push({ table, row }));
    b.insert = ch((row) => calls.upserts.push({ table, row, insert: true }));
    b.update = ch(() => {}); b.delete = ch(() => {});
    b.eq = ch((c, v) => { if (c === 'id') b._eqId = v; b._in[c] = [v]; });
    b.in = ch((col, vals) => { b._in[col] = vals; if (table === 'kv_store') calls.inFilters.push({ col, vals }); });
    ['order','or','is','neq','limit','gte','lte','contains','overlaps','range','filter','match'].forEach((m) => { b[m] = ch(() => {}); });
    function rows() {
      let r = data[table] || [];
      for (const [col, vals] of Object.entries(b._in)) r = r.filter((x) => vals.includes(x[col]));
      return r;
    }
    b.single = () => Promise.resolve({ data: rows()[0] || null, error: null });
    b.maybeSingle = b.single;
    b.then = (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej);
    return b;
  }
  return {
    _calls: calls,
    from: (t) => builder(t),
    rpc: (name, args) => { if (name === 'upsert_kv') calls.upserts.push({ rpc: true, args }); return Promise.resolve({ data: null, error: null }); },
    auth: {
      getSession: () => Promise.resolve({ data: { session }, error: null }),
      getUser: () => Promise.resolve({ data: { user: session ? session.user : null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: () => Promise.resolve({ data: { session }, error: null }),
      signOut: () => { session = null; return Promise.resolve({ error: null }); },
    },
    functions: { invoke: (name, opts) => { calls.invokes.push({ name, opts }); return Promise.resolve({ data: { ok: true }, error: null }); } },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  };
}

function boot(sessionUser) {
  const theClient = makeClient(sessionUser);
  let html = fs.readFileSync('index.html', 'utf8')
    .replace(/<script[^>]*src=[^>]*><\/script>/g, '')
    .replace(/<script>[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/' });
  const { window } = dom;
  window.SUPABASE_URL = 'https://x.supabase.co';
  window.SUPABASE_ANON = 'anon-key';
  window.KRMAS_APP_VERSION = '61';
  window.supabase = { createClient: () => theClient };
  window.XLSX = {};
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  window.scrollTo = () => {}; window.alert = () => {}; window.confirm = () => true;
  try { window.crypto = require('crypto').webcrypto; } catch (e) {}
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error ? e.error.message : e.message));
  window.onerror = (m) => errors.push(m);
  ['data.js', 'db.js', 'app.js'].forEach((f) => {
    const s = window.document.createElement('script');
    s.textContent = fs.readFileSync(f, 'utf8');
    window.document.body.appendChild(s);
  });
  return { window, theClient, errors };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('unhandledRejection', (e) => { console.log('UNHANDLED', (e && e.message) || e); process.exit(2); });

(async () => {
  let pass = 0, fail = 0; const fails = [];
  const ck = (label, cond) => { if (cond) pass++; else { fail++; fails.push(label); } };

  // The bundled seed must ship EMPTY (data is now server-side, RLS-isolated).
  {
    const { window, errors } = boot(null);
    await sleep(40);
    ck('bundled SCHOOL_DATA_SEED ships empty', window.eval('Object.keys(SCHOOL_DATA_SEED).length') === 0);
    ck('directory KRMAS_SCHOOLS still bundled', window.eval('typeof KRMAS_SCHOOLS!=="undefined" && KRMAS_SCHOOLS.length > 0'));
    ck('boots clean (logged out)', errors.length === 0);
  }

  // Logged in as a multi-school instructor (edgeworth + beecroft, NOT rutherford).
  {
    const { window, theClient, errors } = boot({ id: 'meb', email: 'meb@krmas.app' });
    await sleep(120);
    ck('boots clean (member)', errors.length === 0);

    // SCHOOL_DATA_SEED is populated AT RUNTIME from the member schools only.
    ck('seed populated for home school', window.eval('!!(SCHOOL_DATA_SEED["edgeworth"] && SCHOOL_DATA_SEED["edgeworth"].schedule.length)') === true);
    ck('seed populated for 2nd member school', window.eval('!!(SCHOOL_DATA_SEED["beecroft"] && SCHOOL_DATA_SEED["beecroft"].schedule.length)') === true);
    ck('seed has NO entry for non-member school', window.eval('SCHOOL_DATA_SEED["rutherford"] === undefined') === true);
    ck('only member schools loaded (exactly 2)', window.eval('Object.keys(SCHOOL_DATA_SEED).length') === 2);

    // getSchoolData resolves structure for members, nothing for a non-member.
    ck('getSchoolData(member) returns structure', window.eval('!!(getSchoolData("edgeworth") && getSchoolData("edgeworth").instructors.length)') === true);
    ck('getSchoolData(non-member) returns null', window.eval('getSchoolData("rutherford")') === null);

    // The batch read was SCOPED to the member set (proves we never fetch all schools).
    const inF = theClient._calls.inFilters.find((f) => f.col === 'school_id');
    ck('structure query scoped to member schools', !!inF && JSON.stringify(inF.vals.slice().sort()) === '["beecroft","edgeworth"]');
    const keyF = theClient._calls.inFilters.find((f) => f.col === 'key');
    ck('structure query asks for seed + overlay', !!keyF && keyF.vals.includes('school-seed') && keyF.vals.includes('custom-schools'));

    // A save writes a PER-SCHOOL overlay row (never the old global blob).
    window.eval('state.schoolId="edgeworth"; state.customSchools["edgeworth"]={instructors:[],schedule:[],defaults:{x:1},contact:{}};');
    await window.eval('saveCustomSchools()');
    await sleep(40);
    const saved = theClient._calls.upserts.find((u) => u.rpc && u.args && u.args.p_key === 'custom-schools');
    ck('save targets per-school custom-schools row', !!saved && saved.args.p_school_id === 'edgeworth');
    ck('save NEVER writes a global row', !theClient._calls.upserts.some((u) => u.rpc && u.args && u.args.p_school_id === 'global'));
  }

  console.log(`\nPASS=${pass} FAIL=${fail}`);
  if (fail) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('✓ STRUCTURE ISOLATION (CLIENT) GREEN');
  process.exit(0);
})();
