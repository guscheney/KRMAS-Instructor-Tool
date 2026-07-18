// jsdom test: v133 — editable topic charts + per-school rotation anchor.
// Covers: applyTopicChartOverrides (reset-then-apply, unknown charts ignored,
// wholesale topic replace), per-school anchor driving getWeekNumber and
// getTopicForClass, role gating of the library UI, the topic edit modal save
// path persisting via DB.saveTopicCharts, and the anchor save snapping to
// Monday via DB.saveRotationAnchor.
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
window.KRMAS_APP_VERSION = '133';
window.supabase = { createClient: () => theClient };
window.XLSX = {};
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
window.alert = () => {};
window.confirm = () => true;
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
  ev(`uiConfirm = async () => true;`); // styled confirm modal — auto-accept for the save paths

  // ── applyTopicChartOverrides ──────────────────────────────────────────
  const defTitle = ev(`TOPIC_CHART_DEFAULTS.karate.topics[8].title`);
  ev(`applyTopicChartOverrides({ charts: { karate: { topics: { 8: { title: 'Ground Escapes', grappling: 'Escapes only' } } } } })`);
  ck('override replaces topic title', ev(`TOPIC_CHARTS.karate.topics[8].title`) === 'Ground Escapes');
  ck('override replaces wholesale (default fitness gone)', ev(`TOPIC_CHARTS.karate.topics[8].fitness`) === undefined);
  ck('other topics untouched', ev(`TOPIC_CHARTS.karate.topics[7].title`) === ev(`TOPIC_CHART_DEFAULTS.karate.topics[7].title`));
  ev(`applyTopicChartOverrides(null)`);
  ck('clearing overrides restores defaults', ev(`TOPIC_CHARTS.karate.topics[8].title`) === defTitle);
  ev(`applyTopicChartOverrides({ charts: { 'no-such-chart': { name: 'X', topics: { 1: { title: 'X' } } }, karate: { name: 'Adults Karate', cycleLength: 13 } } })`);
  ck('unknown chart ignored', ev(`TOPIC_CHARTS['no-such-chart']`) === undefined);
  ck('chart name override applies', ev(`TOPIC_CHARTS.karate.name`) === 'Adults Karate');
  ck('cycle length override applies', ev(`TOPIC_CHARTS.karate.cycleLength`) === 13);
  ev(`applyTopicChartOverrides(null)`);

  // ── per-school rotation anchor → getWeekNumber / getTopicForClass ─────
  ev(`state.schoolId = 'edgeworth'; state.rotationAnchor = null;`);
  const defaultWeek = ev(`getWeekNumber(new Date('2026-07-14T00:00:00'))`); // Tue in week of Mon 13 Jul
  ck('no anchor → network default anchor used', defaultWeek === ((Math.floor((new Date('2026-07-13') - new Date('2026-03-30')) / 604800000) % 12) + 1));
  ev(`state.rotationAnchor = { weekStart: '2026-07-13' };`);
  ck('anchored Monday is week 1', ev(`getWeekNumber(new Date('2026-07-13T00:00:00'))`) === 1);
  ck('anchor + 7 days is week 2', ev(`getWeekNumber(new Date('2026-07-20T00:00:00'))`) === 2);
  ck('anchor + 12 weeks wraps to week 1', ev(`getWeekNumber(new Date('2026-10-05T00:00:00'))`) === 1);
  // Topic follows the reset: karate Tuesday (col idx 1) week 1 → topic 1, and the
  // same date under the default anchor resolves a different week (hence topic).
  const anchoredTopic = ev(`getTopicForClass('karate', new Date('2026-07-14T00:00:00'))`);
  ck('getTopicForClass follows the restarted cycle', anchoredTopic === 1);
  ev(`state.rotationAnchor = null;`);
  const defaultTopic = ev(`getTopicForClass('karate', new Date('2026-07-14T00:00:00'))`);
  ck('default anchor resolves a different topic for the same date', defaultTopic !== null && defaultTopic !== anchoredTopic);

  // ── library UI role gating ────────────────────────────────────────────
  ev(`state.user = { id: 'u1', role: 'instructor' }; state.rotationAnchor = null;`);
  ev(`renderTopicLibrary()`);
  let main = doc.getElementById('mainContent').innerHTML;
  ck('instructor sees the rotation week bar', /Rotation week \d+ of 12/.test(main));
  ck('instructor cannot restart the cycle', !main.includes('Restart at week 1'));
  ck('instructor sees no topic edit affordance', !main.includes('openTopicEdit('));
  ev(`state.user = { id: 'u2', role: 'admin' };`);
  ev(`renderTopicLibrary()`);
  main = doc.getElementById('mainContent').innerHTML;
  ck('admin can restart the cycle', main.includes('Restart at week 1'));
  ck('admin still cannot edit charts', !main.includes('openTopicEdit('));
  ev(`state.user = { id: 'u3', role: 'superadmin' };`);
  ev(`renderTopicLibrary()`);
  main = doc.getElementById('mainContent').innerHTML;
  ck('superadmin sees topic edit affordances', main.includes('openTopicEdit('));
  ck('superadmin sees chart meta editor', main.includes('saveChartMeta('));

  // ── topic edit modal save path ────────────────────────────────────────
  const chartSaves = [];
  ev(`DB.saveTopicCharts = (d) => { window.__chartSaves.push(JSON.parse(JSON.stringify(d))); return Promise.resolve(true); };`);
  window.__chartSaves = chartSaves;
  ev(`openTopicEdit('karate', 8)`);
  ck('modal populated with chart + number', doc.getElementById('topicEditSub').textContent.includes('#8'));
  ck('existing sections rendered', !!doc.querySelector('#topicEditSections textarea[data-seckey="grappling"]'));
  doc.getElementById('topicEditTitle').value = 'Ground Escapes';
  doc.querySelector('#topicEditSections textarea[data-seckey="grappling"]').value = 'Escapes from mount & side control';
  await ev(`saveTopicEdit()`);
  await sleep(20);
  ck('save persisted via DB.saveTopicCharts', chartSaves.length === 1 && chartSaves[0].charts.karate.topics[8].title === 'Ground Escapes');
  ck('live chart updated after save', ev(`TOPIC_CHARTS.karate.topics[8].title`) === 'Ground Escapes');
  // Reset that topic back to default via the modal path.
  ev(`openTopicEdit('karate', 8)`);
  await ev(`resetTopicToDefault()`);
  await sleep(20);
  ck('reset restores the built-in topic', ev(`TOPIC_CHARTS.karate.topics[8].title`) === defTitle);

  // ── anchor save snaps to Monday ───────────────────────────────────────
  const anchorSaves = [];
  ev(`DB.saveRotationAnchor = (sid, d) => { window.__anchorSaves.push({ sid, d: JSON.parse(JSON.stringify(d)) }); return Promise.resolve(true); };`);
  window.__anchorSaves = anchorSaves;
  ev(`state.user = { id: 'u2', role: 'admin' }; state.currentDate = startOfWeek(new Date());`);
  ev(`renderTopicLibrary()`);
  doc.getElementById('rotAnchorDate').value = '2026-07-15'; // a Wednesday
  await ev(`saveRotationAnchorUI()`);
  await sleep(20);
  ck('anchor saved for the active school', anchorSaves.length === 1 && anchorSaves[0].sid === 'edgeworth');
  ck('anchor snapped to that week\'s Monday', anchorSaves[0].d.weekStart === '2026-07-13');
  ck('state anchor applied → current week recomputes from it', ev(`state.rotationAnchor.weekStart`) === '2026-07-13');
  await ev(`clearRotationAnchorUI()`);
  await sleep(20);
  ck('clearing reverts to network default', ev(`state.rotationAnchor`) === null && anchorSaves.length === 2);

  console.log(`\njsdom_topics_v133: ${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILURES:'); fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  process.exit(0);
})();
