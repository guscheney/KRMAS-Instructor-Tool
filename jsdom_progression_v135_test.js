// jsdom test: v135 — superadmin-editable progression frameworks.
// Covers: applyProgressionProgramOverrides (wholesale replace, malformed
// rejection, revert), applyPathwayTemplateOverrides (per-field replace,
// meeting-points rebind, revert), retroactive point re-scoring of existing
// pathway records, record survival when template items are removed, admin
// menu gating (sup-only entries), and both editors' save paths persisting
// via the DB wrappers with the points-change confirmation firing.
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
window.KRMAS_APP_VERSION = '135';
window.supabase = { createClient: () => theClient };
window.XLSX = {};
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
window.alert = () => {};
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

  // ── progression program overrides ─────────────────────────────────────
  const defCount = ev(`PROGRESSION_PROGRAM_DEFAULTS.length`);
  const defFirstName = ev(`PROGRESSION_PROGRAM_DEFAULTS[0].name`);
  ev(`applyProgressionProgramOverrides({ programs: [ { id: 'karate-adults', name: 'Adults Karate Pathway', type: 'Traditional', colour: '#123456', ranks: [ { id: 'ka-1', label: 'White', minAgeYears: 5, minDays: 0 }, { id: 'ka-2', label: 'Yellow', minAgeYears: 6, minDays: 120 } ] } ] })`);
  ck('override replaces the program list wholesale', ev(`PROGRESSION_PROGRAMS.length`) === 1 && ev(`PROGRESSION_PROGRAMS[0].name`) === 'Adults Karate Pathway');
  ck('rank requirements come from the override', ev(`PROGRESSION_PROGRAMS[0].ranks[1].minDays`) === 120);
  ck('progressionProgramById resolves overridden programs', ev(`progressionProgramById('karate-adults').ranks.length`) === 2);
  ev(`applyProgressionProgramOverrides({ programs: [ { id: 'bad' } ] })`);
  ck('malformed blob rejected — defaults stand', ev(`PROGRESSION_PROGRAMS.length`) === defCount && ev(`PROGRESSION_PROGRAMS[0].name`) === defFirstName);
  ev(`applyProgressionProgramOverrides(null)`);
  ck('clearing reverts to built-ins', ev(`PROGRESSION_PROGRAMS.length`) === defCount);

  // ── pathway template overrides + retroactive re-scoring ───────────────
  // A candidate record scored under the defaults…
  ev(`window.__pw = { goals: { assistant: { date: '2026-01-10' } }, milestones: { 'ran-whole-class': { date: '2026-02-01' } }, meetings: { '2026': { January: { date: '2026-01-05' }, February: { date: '2026-02-02' } } } };`);
  const defaultScore = ev(`instructorPathwayPoints(window.__pw)`); // 20 + 15 + 3 + 3 = 41
  ck('baseline score computed under defaults', defaultScore === 41);
  // …re-scores immediately when the template's points change.
  ev(`applyPathwayTemplateOverrides({ goals: [ { id: 'assistant', label: 'Assistant', points: 50 } ], milestones: [ { id: 'ran-whole-class', label: 'Ran whole class', points: 30 } ], meetingPoints: 5, recommenders: ['Gus'] })`);
  ck('meeting points rebinds (let, not const)', ev(`INSTRUCTOR_MEETING_POINTS`) === 5);
  ck('points recompute retroactively for existing records', ev(`instructorPathwayPoints(window.__pw)`) === 50 + 30 + 5 + 5);
  ck('recommenders replaced', ev(`INSTRUCTOR_PATHWAY_RECOMMENDERS.length`) === 1 && ev(`INSTRUCTOR_PATHWAY_RECOMMENDERS[0]`) === 'Gus');
  // Removed template items hide from the score but the record keeps its data.
  ck('record survives item removal (data intact)', ev(`window.__pw.milestones['ran-whole-class'].date`) === '2026-02-01');
  ev(`applyPathwayTemplateOverrides({ milestones: [ { id: 'new-thing', label: 'New thing', points: 7 } ] })`);
  ck('removed milestone no longer scores, record untouched', ev(`instructorPathwayPoints(window.__pw)`) === 20 + 0 + 3 + 3 && ev(`window.__pw.milestones['ran-whole-class'].date`) === '2026-02-01');
  ev(`applyPathwayTemplateOverrides(null)`);
  ck('clearing reverts template and score', ev(`INSTRUCTOR_MEETING_POINTS`) === 3 && ev(`instructorPathwayPoints(window.__pw)`) === 41);

  // ── admin menu gating ─────────────────────────────────────────────────
  // The sup gate is applied at render time (renderAdmin filters `it.sup`), so
  // mirror that filter here rather than reading the raw model.
  const menuFor = (isSuper) => JSON.stringify(ev(`adminMenuSections(${isSuper}).map(sec => sec.items.filter(it => !it.sup || ${isSuper}))`));
  const supMenu = menuFor(true);
  const admMenu = menuFor(false);
  ck('superadmin menu offers both editors', /Progression programs/.test(supMenu) && /Pathway template/.test(supMenu));
  ck('plain admin menu offers neither', !/Progression programs/.test(admMenu) && !/Pathway template/.test(admMenu));

  // ── editor save paths ─────────────────────────────────────────────────
  const progSaves = [], pwSaves = [];
  window.__progSaves = progSaves; window.__pwSaves = pwSaves;
  ev(`DB.saveProgressionPrograms = (d) => { window.__progSaves.push(JSON.parse(JSON.stringify(d))); return Promise.resolve(true); };`);
  ev(`DB.savePathwayTemplate = (d) => { window.__pwSaves.push(JSON.parse(JSON.stringify(d))); return Promise.resolve(true); };`);
  const confirms = [];
  window.__confirms = confirms;
  ev(`uiConfirm = async (msg) => { window.__confirms.push(String(msg)); return true; };`);
  ev(`state.user = { id: 's1', role: 'superadmin' };`);

  ev(`openProgressionProgramsEditor()`);
  ck('programs editor renders every default program', doc.querySelectorAll('#progProgramsBody > div[style*="border"]').length === defCount);
  ev(`state._progEdit[0].ranks[0].minDays = 999; state._progEdit[0].name = 'Edited Program';`);
  await ev(`saveProgressionPrograms()`);
  await sleep(20);
  ck('save persists wholesale via DB wrapper', progSaves.length === 1 && progSaves[0].programs[0].name === 'Edited Program' && progSaves[0].programs[0].ranks[0].minDays === 999);
  ck('save applies live', ev(`PROGRESSION_PROGRAMS[0].ranks[0].minDays`) === 999);
  await ev(`resetProgressionPrograms()`);
  await sleep(20);
  ck('reset reverts live and persists a clear', ev(`PROGRESSION_PROGRAMS[0].ranks[0].minDays`) !== 999 && progSaves.length === 2);

  ev(`openPathwayTemplateEditor()`);
  ck('template editor renders goals and milestones', !!doc.querySelector('#pathwayTemplateBody') && /Milestones/.test(doc.getElementById('pathwayTemplateBody').innerHTML));
  ev(`state._pwEdit.goals[0].points = 99;`);
  confirms.length = 0;
  await ev(`savePathwayTemplate()`);
  await sleep(20);
  ck('points change triggers the retroactive warning', confirms.some(m => /recompute/.test(m)));
  ck('template save persists via DB wrapper', pwSaves.length === 1 && pwSaves[0].goals[0].points === 99);
  ck('template save applies live', ev(`INSTRUCTOR_GOALS[0].points`) === 99);
  // Label-only edit must NOT warn.
  ev(`openPathwayTemplateEditor()`);
  ev(`state._pwEdit.goals[0].label = 'Assistant (renamed)';`);
  confirms.length = 0;
  await ev(`savePathwayTemplate()`);
  await sleep(20);
  ck('label-only edit saves without the points warning', pwSaves.length === 2 && !confirms.some(m => /recompute/.test(m)));
  await ev(`resetPathwayTemplate()`);
  await sleep(20);
  ck('template reset reverts points live', ev(`INSTRUCTOR_GOALS[0].points`) === 20 && pwSaves.length === 3);

  // ── non-superadmin lockout ────────────────────────────────────────────
  ev(`state.user = { id: 'a1', role: 'admin' };`);
  ev(`openProgressionProgramsEditor()`);
  ck('admin cannot open the programs editor', !doc.getElementById('modalProgPrograms').classList.contains('open'));
  await ev(`savePathwayTemplate()`);
  await sleep(10);
  ck('admin save call is a no-op', pwSaves.length === 3);

  console.log(`\njsdom_progression_v135: ${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILURES:'); fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  process.exit(0);
})();
