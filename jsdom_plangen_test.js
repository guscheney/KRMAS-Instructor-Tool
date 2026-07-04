// jsdom test — plan generation from library (v126)
// Engine behaviour on small corpora, the ingest pipeline, unlock gating,
// modal wiring, the sharing picker, and seed-attach gating.
// Run from frontend/: npm install --no-save jsdom && node jsdom_plangen_test.js
const fs = require('fs');
const { JSDOM } = require('jsdom');

const theClient = { auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) }, from() { return this; }, select() { return this; }, eq() { return this; }, order() { return this; }, in() { return this; }, limit() { return this; }, single() { return this; }, maybeSingle() { return this; }, upsert: async () => ({ data: null, error: null }), rpc: async () => ({ data: null, error: null }), functions: { invoke: async () => ({ data: null, error: null }) } };

let html = fs.readFileSync('index.html', 'utf8')
  .replace(/<script[^>]*src=[^>]*><\/script>/g, '')
  .replace(/<script>[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/' });
const { window } = dom;
window.SUPABASE_URL = 'https://x.supabase.co';
window.SUPABASE_ANON = 'anon-key';
window.supabase = { createClient: () => theClient };
window.XLSX = {};
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
window.alert = () => {};
try { window.crypto = require('crypto').webcrypto; } catch (e) {}

const errors = [];
window.addEventListener('error', (e) => errors.push(e.error ? e.error.message : e.message));

['data.js', 'db.js', 'plangen.js', 'app.js'].forEach((f) => {
  const s = window.document.createElement('script');
  s.textContent = fs.readFileSync(f, 'utf8');
  window.document.body.appendChild(s);
});
(() => { const s = window.document.createElement('script'); s.textContent = "uiConfirm = async () => true; (function(){ const _o = uiToast; uiToast = function(m,k,d){ window.__lastToast = String(m); try { _o(m,k,d); } catch(e){} }; })();"; window.document.body.appendChild(s); })();

const ev = (code) => window.eval(code);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  await sleep(80);
  let pass = 0, fail = 0; const fails = [];
  const ck = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log('  ✗', n); } };

  ck('app booted with plangen.js without errors', errors.length === 0);
  ck('PlanGen exposed on window', typeof ev('PlanGen') === 'object' && typeof ev('PlanGen.generate') === 'function');

  // ── engine on a tiny corpus (mirrors a real instructor's early library) ──
  const mkPlan = (i, c, t, th, w, d, cd, tw) => ({ i, f: i, y: 2026, c, t, th, o: '', tw: tw || null, w, d, cd });
  ev(`window.__tiny = {
    plans: [
      ${[1,2,3,4,5,6].map(n => `{ i:'p${n}', f:'p${n}', y:2026, c:'Karate', t:${n <= 3 ? 1 : 2}, th:'${n <= 3 ? 'Hands' : 'Kicks'}', o:'', tw:'T1W${n}', w:['Usual warmup'], d:['Lines','Jab cross drill ${n}','Partners','Pad work ${n}'], cd:['5 min stretch'] }`).join(',')}
    ],
  };
  window.__tiny.style = PlanGen.deriveStyle(window.__tiny.plans, null);`);
  ck('coverage: 6 Karate plans unlock generation', ev(`PlanGen.coverage(window.__tiny.plans)['Karate'].unlocked`) === true);
  ck('coverage: topics tracked', ev(`PlanGen.coverage(window.__tiny.plans)['Karate'].topics.join(',')`) === '1,2');
  const gen = ev(`PlanGen.generate(window.__tiny, { classType: 'karate', topic: 1, duration: 60 })`);
  ck('generate: succeeds on tiny corpus', gen.ok === true);
  ck('generate: every line is verbatim from the corpus', gen.plan.tech.every(l => /^(Lines|Partners|Jab cross drill \d|Pad work \d)$/.test(l.t)));
  ck('generate: every line carries a source ref', [...gen.plan.warmup, ...gen.plan.tech, ...gen.plan.cool].every(l => l.id && l.src));
  ck('generate: topic-1 exemplar preferred', gen.plan.theme === 'Hands');
  ck('generate: usual warmup emitted literally', gen.plan.warmup.length === 1 && gen.plan.warmup[0].t === 'Usual warmup');
  const gap = ev(`PlanGen.generate(window.__tiny, { classType: 'karate', topic: 9, duration: 60 })`);
  ck('generate: honest gap for missing topic', gap.ok === false && /topic 9/.test(gap.gaps[0]));
  ck('generate: gap report lists what IS available', gap.available.topics.join(',') === '1,2');
  const unknown = ev(`PlanGen.generate(window.__tiny, { classType: 'capoeira' })`);
  ck('generate: unknown class type is a gap, never filler', unknown.ok === false && unknown.available.classTypes.includes('Karate'));

  // one plan short of the threshold stays locked
  ev(`window.__five = { plans: window.__tiny.plans.slice(0,5), style: window.__tiny.style };`);
  ck('coverage: 5 plans stay locked', ev(`PlanGen.coverage(window.__five.plans)['Karate'].unlocked`) === false);

  // ── ingest pipeline: completed plan -> corpus row + stats refresh ──
  ev(`
    state.user = { id: 'uid-1', name: 'Test Instructor' };
    window.__upserted = null; window.__styleSaved = null;
    DB.corpus.upsertPlan = async (row) => { window.__upserted = row; };
    DB.corpus.loadPlans = async () => window.__upserted ? [ { id:'r1', ownerId:'uid-1', sourceKey: window.__upserted.sourceKey, classType: window.__upserted.classType, topic: window.__upserted.topic, theme: window.__upserted.theme, objective:'', termWeek: window.__upserted.termWeek, warmup: window.__upserted.warmup, drills: window.__upserted.drills, cooldown: window.__upserted.cooldown } ] : [];
    DB.corpus.loadStyle = async () => null;
    DB.corpus.saveStyle = async (row) => { window.__styleSaved = row; };
  `);
  await ev(`planCorpusIngest({ key: '2026-07-02|0600', classType: 'Muay Thai', topic: '4', theme: 'Topic 4 — Clinch', objective: 'x', term: '2', week: '3', date: '2026-07-02', warmup: 'Skipping 3 rounds\\nShadow boxing', techniques: 'Thai pads\\nJab cross hook\\nClinch knees', cooldown: '5 min stretch' })`);
  await sleep(20);
  ck('ingest: corpus row upserted with split lines', ev('window.__upserted.warmup.length') === 2 && ev('window.__upserted.drills.length') === 3);
  ck('ingest: topic parsed from the field', ev('window.__upserted.topic') === 4);
  ck('ingest: term/week encoded as TxWy', ev('window.__upserted.termWeek') === 'T2W3');
  ck('ingest: keyed by the plan dateKey (re-save updates, never duplicates)', ev('window.__upserted.sourceKey') === '2026-07-02|0600');
  ck('ingest: stats refreshed to corpus_style', ev('window.__styleSaved') !== null && ev(`window.__styleSaved.stats['Muay Thai'].plans`) === 1);

  // topic falls back to parsing the theme when the field is empty
  await ev(`planCorpusIngest({ key: 'k2', classType: 'Karate', topic: '', theme: 'Topic 7 — Throws', term:'', week:'', warmup: 'w', techniques: 'd', cooldown: '' })`);
  await sleep(20);
  ck('ingest: topic parsed from theme text as fallback', ev('window.__upserted.topic') === 7);

  // an empty plan (no warmup, no drills) is not ingested
  ev(`window.__upserted = null;`);
  await ev(`planCorpusIngest({ key: 'k3', classType: 'Karate', topic:'', theme:'', warmup: '', techniques: '', cooldown: 'stretch' })`);
  await sleep(20);
  ck('ingest: empty plans are skipped', ev('window.__upserted') === null);

  // ── savePlan hook: drafts do NOT ingest, completed plans DO ──
  ck('savePlan hooks corpus ingest on non-draft only', /status !== 'draft'.*planCorpusIngest|planCorpusIngest.*status !== 'draft'/s.test(ev('savePlan.toString()')));

  // ── modal wiring ──
  ev(`
    state.user = { id: 'uid-1', name: 'Test Instructor' };
    can.switchAnySchool = () => true;
    DB.corpus.listReadable = async () => ([
      { ownerId: 'uid-1', ownerName: 'Test Instructor', seed: null, stats: { 'Karate': { plans: 2, topics: [1], unlocked: false } } },
      { ownerId: 'uid-2', ownerName: 'Jen Alderson', seed: null, stats: { 'Muay Thai': { plans: 9, topics: [1,2,4], unlocked: true } } },
    ]);
    document.getElementById('planType') || document.body.insertAdjacentHTML('beforeend', '<input id="planType" value="Muay Thai">');
  `);
  await ev('openPlanGen()');
  await sleep(40);
  ck('picker: my library listed first', /^My library/.test(ev(`document.getElementById('pgOwner').options[0].textContent`)));
  ck('picker: schoolmate library listed in their name', /Jen Alderson's library/.test(ev(`document.getElementById('pgOwner').innerHTML`)));
  ck('seed attach shown for superadmin on own unseeded library', ev(`document.getElementById('pgSeedRow').style.display`) === '');
  ck('coverage panel renders locked state with progress', /Karate/.test(ev(`document.getElementById('pgResult').innerHTML`)) && /2/.test(ev(`document.getElementById('pgResult').innerHTML`)));

  // switching to the schoolmate's library hides the seed-attach affordance
  ev(`document.getElementById('pgOwner').value = 'uid-2'; planGenOwnerChanged();`);
  ck('seed attach hidden on another instructor library', ev(`document.getElementById('pgSeedRow').style.display`) === 'none');
  ck('coverage shows their unlocked class type', /Muay Thai/.test(ev(`document.getElementById('pgResult').innerHTML`)));

  // non-superadmin never sees the attach affordance
  ev(`can.switchAnySchool = () => false; document.getElementById('pgOwner').value = 'uid-1'; planGenOwnerChanged();`);
  ck('seed attach hidden for non-superadmin', ev(`document.getElementById('pgSeedRow').style.display`) === 'none');
  ev(`window.__lastToast = null;`);
  await ev('attachSeedBundle()');
  ck('attachSeedBundle refuses non-superadmin', /superadmin/.test(ev('window.__lastToast') || ''));

  // ── generation through the modal against a mocked unlocked corpus ──
  ev(`
    can.switchAnySchool = () => true;
    _corpusCache.clear();
    DB.corpus.loadPlans = async (oid) => oid === 'uid-2' ? [
      ${[1,2,3,4,5,6].map(n => `{ id:'m${n}', ownerId:'uid-2', sourceKey:'m${n}', classType:'Muay Thai', topic:${n <= 3 ? 4 : 2}, theme:'${n <= 3 ? 'Clinch' : 'Kicks'}', objective:'', termWeek:'T1W${n}', warmup:['Skipping'], drills:['Thai pads','Combo ${n}'], cooldown:['5 min stretch'] }`).join(',')}
    ] : [];
    DB.corpus.loadStyle = async () => null;
    document.getElementById('pgOwner').value = 'uid-2';
    document.getElementById('pgTopic').value = '4';
    document.getElementById('pgTheme').value = '';
    document.getElementById('planType').value = 'Muay Thai';
  `);
  await ev('runPlanGen()');
  await sleep(40);
  ck('modal generation renders a grounded preview with sources', /Sources:/.test(ev(`document.getElementById('pgResult').innerHTML`)) && /Thai pads/.test(ev(`document.getElementById('pgResult').innerHTML`)));
  ck('Use button appears on success', ev(`document.getElementById('pgUseBtn').style.display`) === '');

  // applying the result fills the plan form textareas
  ev(`
    ['planTheme','planObjective'].forEach(id => { if (!document.getElementById(id)) document.body.insertAdjacentHTML('beforeend', '<input id="'+id+'">'); });
    ['planWarmup','planTechniques','planCooldown'].forEach(id => { if (!document.getElementById(id)) document.body.insertAdjacentHTML('beforeend', '<textarea id="'+id+'"></textarea>'); });
  `);
  ev('usePlanGenResult()');
  ck('use: warmup textarea filled', ev(`document.getElementById('planWarmup').value`) === 'Skipping');
  ck('use: techniques textarea filled with corpus lines only', ev(`document.getElementById('planTechniques').value`).split('\n')[0] === 'Thai pads');
  ck('use: theme carried from primary exemplar', ev(`document.getElementById('planTheme').value`) === 'Clinch');

  // locked class type through the modal
  ev(`
    _corpusCache.clear();
    DB.corpus.loadPlans = async () => [ { id:'x1', ownerId:'uid-2', sourceKey:'x1', classType:'BJJ', topic:null, theme:'Guard', objective:'', termWeek:null, warmup:['w'], drills:['d'], cooldown:[] } ];
    document.getElementById('planType').value = 'BJJ';
  `);
  await ev('runPlanGen()');
  await sleep(30);
  ck('locked class type renders 🔒 progress, no generation', /🔒/.test(ev(`document.getElementById('pgResult').innerHTML`)));

  // ── library sharing setting (v127) ──
  ev(`
    state.user = { id: 'uid-1', name: 'Test Instructor' };
    state.userSchools = ['edgeworth'];
    can.switchAnySchool = () => false;
    window.__styleSaved = null;
    DB.corpus.loadStyle = async () => ({ ownerId: 'uid-1', ownerName: 'Test Instructor', seed: null, stats: { K: { plans: 3 } }, shareSchools: [] });
    DB.corpus.saveStyle = async (row) => { window.__styleSaved = row; };
  `);
  await ev('openLibrarySharing()');
  await sleep(30);
  ck('sharing modal: non-superadmin sees only their own school(s)', ev(`document.querySelectorAll('.libShareCb').length`) === 1 && ev(`document.querySelector('.libShareCb').value`) === 'edgeworth');
  ck('sharing modal: private-by-default note shown', /Currently private/.test(ev(`document.getElementById('libShareState').textContent`)));
  ev(`document.querySelector('.libShareCb').checked = true;`);
  await ev('saveLibrarySharing()');
  await sleep(20);
  ck('sharing save: picked school persisted', ev('window.__styleSaved.shareSchools.join(",")') === 'edgeworth');
  ck('sharing save: seed and stats preserved through the rewrite', ev('window.__styleSaved.stats.K.plans') === 3);

  // superadmin sees all schools in the picker
  ev(`can.switchAnySchool = () => true;`);
  await ev('openLibrarySharing()');
  await sleep(30);
  ck('sharing modal: superadmin sees every school', ev(`document.querySelectorAll('.libShareCb').length`) > 5);

  // stats refresh must NOT wipe the sharing choice
  ev(`
    window.__styleSaved = null;
    DB.corpus.loadStyle = async () => ({ ownerId: 'uid-1', ownerName: 'Test Instructor', seed: 'krmas-bundle', stats: {}, shareSchools: ['edgeworth'] });
    DB.corpus.loadPlans = async () => [];
    _corpusCache.clear();
    PlanGen.fetchSeedBundle = async () => ({ plans: [], style_dna: null });
  `);
  await ev('planCorpusRefreshStats()');
  await sleep(20);
  ck('stats refresh preserves shareSchools', ev('window.__styleSaved.shareSchools.join(",")') === 'edgeworth');
  ck('stats refresh preserves seed flag', ev('window.__styleSaved.seed') === 'krmas-bundle');

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILED:', fails.join(', ')); process.exit(1); }
  process.exit(0);
})();
