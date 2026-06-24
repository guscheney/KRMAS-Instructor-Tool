// Exhaustive proof that the Aquila → KRMAS grade/programme translation matches
// the school's real Aquila programme "Grade" lists (Karate, Muay Thai, MMA Sanda,
// Junior Muay Thai, Little Ninjas, Mini Ninjas). Uses the exact Aquila display
// strings (with their hyphens/slashes/apostrophes) to prove normalisation + table
// handle the real values. Also checks the table for typo'd rank ids.
const fs = require('fs');
const { JSDOM } = require('jsdom');

function boot() {
  const generic = () => { const b = {}; ['select','eq','or','order','limit','in','is','insert','update','delete','upsert','maybeSingle','single','not','neq'].forEach((m) => { b[m] = () => b; }); b.single = () => Promise.resolve({ data: null, error: null }); b.maybeSingle = b.single; b.then = (r) => Promise.resolve({ data: [], error: null }).then(r); return b; };
  const client = { from: () => generic(), rpc: () => Promise.resolve({ data: null, error: null }),
    auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }), getUser: () => Promise.resolve({ data: { user: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: () => Promise.resolve({ error: null }) },
    functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => {} };
  let html = fs.readFileSync('index.html', 'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g, '').replace(/<script>[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/' });
  const { window } = dom;
  window.SUPABASE_URL = 'https://x.supabase.co'; window.SUPABASE_ANON = 'k'; window.KRMAS_APP_VERSION = '102';
  window.supabase = { createClient: () => client }; window.XLSX = {};
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  window.scrollTo = () => {}; window.alert = (m) => { window.__lastAlert = m; }; window.confirm = () => true;
  window.open = () => null;
  window.__errs = []; window.onerror = (m) => { window.__errs.push(m); return true; };
  try { window.crypto = require('crypto').webcrypto; } catch (e) {}
  ['data.js', 'db.js', 'app.js'].forEach((f) => { const s = window.document.createElement('script'); s.textContent = fs.readFileSync(f, 'utf8'); window.document.body.appendChild(s); });
  return { window };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('unhandledRejection', (e) => { console.log('UNHANDLED', (e && e.message) || e); process.exit(2); });

// [aquila grade display string, expected KRMAS rank id | null for white/no-badge]
const GRADES = {
  karate: [
    ['Ju Kyu - White Belt', null],
    ['Ku Kyu - Yellow Belt', 'k-y'], ['Hachi Kyu - Orange Belt', 'k-o'], ['Shichi Kyu - Blue Belt', 'k-b'],
    ['Roku Kyu - Purple Belt', 'k-p'], ['Go Kyu - Green Belt', 'k-g'], ['Yon Kyu - Brown/White Belt', 'k-bw'],
    ['San Kyu - Brown Belt', 'k-b3'], ['Ni Kyu - Brown/Black Belt', 'k-bb'], ['Ik Kyu - Black/White Belt', 'k-bw1'],
    ['Sho Dan - 1st Black Belt', 'k-1d'], ['Ni Dan - 2nd Black Belt', 'k-2d'], ['San Dan - 3rd Black Belt', 'k-3d'],
    ['Yon Dan - 4th Black Belt', 'k-4d'], ['Go Dan - 5th Black Belt', 'k-5d'], ['Roku Dan - 6th Black Belt', 'k-6d'],
    ['Shichi Dan - 7th Black Belt', 'k-7d'], ['Hachi Dan - 8th Black Belt', 'k-8d'], ['Ku Dan - 9th Black Belt', 'k-9d']
  ],
  muayThai: [
    ['No Badge', null],
    ['Yellow Level 1', 'mt-y1'], ['Yellow Level 2', 'mt-y2'], ['Blue Level 1', 'mt-b1'], ['Blue Level 2', 'mt-b2'],
    ['Purple Level 1', 'mt-p1'], ['Purple Level 2', 'mt-p2'], ['Green Level 1', 'mt-g1'], ['Green Level 2', 'mt-g2'],
    ['Red', 'mt-r'], ['Black Level 1', 'mt-bk1'], ['Black Level 2', 'mt-bk2'], ['Black Level 3', 'mt-bk3'], ['Black Level 4', 'mt-bk4']
  ],
  mmaSanda: [
    ['No Badge', null],
    ['Yellow Level 1', 'mma-y1'], ['Yellow Level 2', 'mma-y2'], ['Blue Level 1', 'mma-b1'], ['Blue Level 2', 'mma-b2'],
    ['Purple Level 1', 'mma-p1'], ['Purple Level 2', 'mma-p2'], ['Green Level 1', 'mma-g1'], ['Green Level 2', 'mma-g2'],
    ['Red', 'mma-r'], ['Black Level 1', 'mma-bk1'], ['Black Level 2', 'mma-bk2'], ['Black Level 3', 'mma-bk3'], ['Black Level 4', 'mma-bk4']
  ],
  juniorMuayThai: [
    ['Jnr - No Badge', null],
    ['Jnr - Yellow Level 1', 'jmt-y1'], ['Jnr - Yellow Level 2', 'jmt-y2'], ['Jnr - Yellow Level 3', 'jmt-y3'], ['Jnr - Yellow Level 4', 'jmt-y4'],
    ['Jnr - Blue Level 1', 'jmt-b1'], ['Jnr - Blue Level 2', 'jmt-b2'], ['Jnr - Blue Level 3', 'jmt-b3'], ['Jnr - Blue Level 4', 'jmt-b4'],
    ['Jnr - Purple Level 1', 'jmt-p1'], ['Jnr - Purple Level 2', 'jmt-p2'], ['Jnr - Purple Level 3', 'jmt-p3'], ['Jnr - Purple Level 4', 'jmt-p4'],
    ['Jnr - Green Level 1', 'jmt-g1'], ['Jnr - Green Level 2', 'jmt-g2'], ['Jnr - Green Level 3', 'jmt-g3']
  ],
  littleNinjas: [
    ['Ju Kyu - White Belt', null],
    ['Kari Ku Kyu - Yellow/White Belt', 'ln-yw'], ['Ku Kyu - Yellow Belt', 'ln-y'],
    ['Kari Hachi Kyu-Orange/White Belt', 'ln-ow'], ['Hachi Kyu - Orange Belt', 'ln-o'],
    ['Kari Shichi Kyu - Blue/White Belt', 'ln-bw'], ['Shichi Kyu - Blue Belt', 'ln-b'],
    ['Kari Roku Kyu - Purple/White Belt', 'ln-pw'], ['Roku Kyu - Purple Belt', 'ln-p'],
    ['Kari Go Kyu - Green/White Belt', 'ln-gw'], ['Go Kyu - Green Belt', 'ln-g'],
    ['Yon Kyu - Green/Black Belt', 'ln-gb'], ['San Kyu - Red/White Belt', 'ln-rw'], ['Ni Kyu - Red Belt', 'ln-r'],
    ['Kari Ik Kyu - Red/Black Belt', 'ln-rb'], ["Ik Kyu - Black/Red Grad'n Belt", 'ln-grad']
  ],
  miniLittleNinjas: [
    ['Level 0 - White Belt', null],
    ['Level 1 - White/Yellow Belt', 'mln-l1'], ['Level 2 - White/Orange Belt', 'mln-l2'], ['Level 3 - White/Blue Belt', 'mln-l3'],
    ['Level 4 - White/Purple Belt', 'mln-l4'], ['Level 5 - White/Green', 'mln-l5'], ['Level 6 - White/Brown Belt', 'mln-l6'],
    ['Level 7 - White/Red Belt', 'mln-l7']
  ]
};

// [aquila programme name, expected KRMAS program id]
const PROGRAMMES = [
  ['KR Karate', 'karate'], ['KR Muay Thai', 'muayThai'], ['KR MMA Sanda', 'mmaSanda'],
  ['KR Junior Muay Thai', 'juniorMuayThai'], ['KR Little Ninjas', 'littleNinjas'],
  ['KR Mini Ninjas', 'miniLittleNinjas'], ['KR Mini Little Ninjas', 'miniLittleNinjas']
];

(async () => {
  let pass = 0, fail = 0; const fails = [];
  const ck = (label, cond) => { if (cond) pass++; else { fail++; fails.push(label); } };
  const { window } = boot();
  await sleep(50);
  const W = (code) => window.eval(code);

  ck('boots clean', window.__errs.length === 0);
  ck('AQUILA_GRADE_MAP defined', W('typeof AQUILA_GRADE_MAP') === 'object');

  // 1) Table integrity — every non-null rank id in the table exists in its program.
  const badIds = W('(function(){ const out=[]; for (const pid of Object.keys(AQUILA_GRADE_MAP)){ const pr=progressionProgramById(pid); if(!pr){out.push("no prog "+pid);continue;} const g=AQUILA_GRADE_MAP[pid].grades; for (const k of Object.keys(g)){ const id=g[k]; if(id!==null && !pr.ranks.some(r=>r.id===id)) out.push(pid+":"+k+"->"+id);} } return out.join("|"); })()');
  ck('table integrity: every mapped rank id is real' + (badIds ? ' — ' + badIds : ''), badIds === '');

  // 2) Programme-name matching (incl. the "KR Mini Ninjas" alias).
  for (const [aqName, progId] of PROGRAMMES) {
    const got = W('(_aquilaProgMatchProgram(' + JSON.stringify(aqName) + ')||{}).id');
    ck('programme "' + aqName + '" -> ' + progId, got === progId);
  }
  ck('unknown programme -> null', W("_aquilaProgMatchProgram('Brazilian Jiu Jitsu')") === null);
  ck('blank programme -> null', W("_aquilaProgMatchProgram('')") === null);

  // 3) Every grade in every programme maps to the right rank (or to "not started").
  for (const progId of Object.keys(GRADES)) {
    for (const [grade, rankId] of GRADES[progId]) {
      const got = W('_aquilaProgMatchRank(progressionProgramById(' + JSON.stringify(progId) + '), ' + JSON.stringify(grade) + ')');
      if (rankId === null) {
        ck(progId + ': "' + grade + '" -> not started', got === -1);
      } else {
        const expIdx = W('progressionProgramById(' + JSON.stringify(progId) + ').ranks.findIndex(r=>r.id===' + JSON.stringify(rankId) + ')');
        ck(progId + ': "' + grade + '" -> ' + rankId + ' (idx ' + expIdx + ')', expIdx >= 0 && got === expIdx);
      }
    }
  }

  // 4) Unknown grade in a known programme -> not started (never a wrong guess).
  ck('unknown grade -> -1', W("_aquilaProgMatchRank(progressionProgramById('karate'),'Totally Made Up Belt')") === -1);

  // 5) Full pipeline: pick a member with a real kyu grade -> planner card pre-filled.
  W("state.schoolId='edgeworth'; state.aquilaIntegration={ locationId:'L1', roles:['Development_Read'] };");
  W("state.students={}; state.progressions={}; state.user={id:'U1',name:'Tester',role:'admin'}; aquilaCacheClear();");
  W("DB.aquila=DB.aquila||{}; DB.aquila.members=async()=>({ members:[{firstName:'Kyu',lastName:'Test',dob:'2008-04-04',reference:'K1',programmes:[" +
    "{name:'KR Karate',gradeName:'Shichi Kyu - Blue Belt',promoted:'2024-05-01'}," +
    "{name:'KR Mini Ninjas',gradeName:'Level 3 - White/Blue Belt',promoted:'2023-09-09'}" + // alias programme + level grade
  "]}], programmes:[], fetchedAt:'t' });");
  W("openAquilaProgPicker();"); await sleep(10);
  await W("_aquilaProgPick(0)"); await sleep(10);
  const kIdx = W("progressionProgramById('karate').ranks.findIndex(r=>r.id==='k-b')");
  ck('pipeline: karate chip checked', W("(document.getElementById('pp-chip-karate')||{}).checked") === true);
  ck('pipeline: karate rank = Blue 7th Kyu (from Shichi Kyu)', W("(_ppCardState['karate']||{}).startIdx") === String(kIdx));
  ck('pipeline: karate date carried', W("(_ppCardState['karate']||{}).startDate") === '2024-05-01');
  const mIdx = W("progressionProgramById('miniLittleNinjas').ranks.findIndex(r=>r.id==='mln-l3')");
  ck('pipeline: mini-ninjas mapped via alias', W("(document.getElementById('pp-chip-miniLittleNinjas')||{}).checked") === true);
  ck('pipeline: mini-ninjas rank = Level 3 Blue', W("(_ppCardState['miniLittleNinjas']||{}).startIdx") === String(mIdx));
  ck('pipeline: mini-ninjas date carried', W("(_ppCardState['miniLittleNinjas']||{}).startDate") === '2023-09-09');

  console.log('\nAQUILA GRADE-MAP (jsdom): PASS=' + pass + ' FAIL=' + fail);
  if (fail) { console.log('FAILURES:'); fails.forEach((f) => console.log('  ✗ ' + f)); }
  else console.log('✓ ALL GREEN');
  process.exit(fail ? 1 : 0);
})();
