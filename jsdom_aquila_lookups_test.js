// Aquila live lookups (Phase E progression + F student lookup): gating, the
// loading→data→search render path, the progression detail + branded print
// builder, error handling, and the gated Students-view buttons.
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
  window.SUPABASE_URL = 'https://x.supabase.co'; window.SUPABASE_ANON = 'k'; window.KRMAS_APP_VERSION = '100';
  window.supabase = { createClient: () => client }; window.XLSX = {};
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  window.scrollTo = () => {}; window.alert = (m) => { window.__lastAlert = m; }; window.confirm = () => true;
  window.open = () => null; // print path: just ensure it doesn't throw
  window.__errs = []; window.onerror = (m) => { window.__errs.push(m); return true; };
  try { window.crypto = require('crypto').webcrypto; } catch (e) {}
  ['data.js', 'db.js', 'app.js'].forEach((f) => { const s = window.document.createElement('script'); s.textContent = fs.readFileSync(f, 'utf8'); window.document.body.appendChild(s); });
  return { window };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('unhandledRejection', (e) => { console.log('UNHANDLED', (e && e.message) || e); process.exit(2); });

(async () => {
  let pass = 0, fail = 0; const fails = [];
  const ck = (label, cond) => { if (cond) pass++; else { fail++; fails.push(label); } };
  const { window } = boot();
  await sleep(50);
  const W = (code) => window.eval(code);
  const body = (id) => W("document.getElementById('" + id + "').innerHTML");

  ck('boots clean', window.__errs.length === 0);

  for (const fn of ['openAquilaStudentLookup','renderAquilaLookup','_aquilaLookupResults','openAquilaProgPicker','renderAquilaProgPicker',
                    '_aquilaProgPickerResults','_aquilaProgPick','_aquilaCreateOrFindStudent','_aquilaErrText','_aquilaFullName']) {
    ck('defined: ' + fn, W('typeof ' + fn) === 'function');
  }
  ck('error text: invalid_api_key', /rotate/.test(W("_aquilaErrText('invalid_api_key')")));
  ck('error text: insufficient_permissions', /Development_Read/.test(W("_aquilaErrText('insufficient_permissions')")));
  ck('error text: unavailable fallback', /unavailable/i.test(W("_aquilaErrText('aquila_unavailable')")));
  ck('full name joins', W("_aquilaFullName({firstName:'A',lastName:'B'})") === 'A B');
  ck('full name dash when empty', W("_aquilaFullName({})") === '—');

  // Setup: Aquila school with Development_Read, stubbed members
  W("state.schoolId='edgeworth'; state.aquilaIntegration={ locationId:'L1', roles:['Members_Read','Development_Read'] };");
  W("window.__members=[" +
    "{firstName:'Gus',lastName:'Cheney',dob:'1985-05-05',age:41,reference:'AU-1',email:'gus@x.com',mobile:'+61400'," +
      "programmes:[{name:'KR Karate',gradeName:'Black Belt',progress:0.9,attended:120,promoted:'2024-01-01',readyToPromote:true}," +
                  "{name:'KR Muay Thai',gradeName:'Level 3',progress:0.4,attended:30,readyToPromote:false}]}," +
    "{firstName:'Chen',lastName:'Lee',programmes:[]}," +
    "{firstName:'Zoe',lastName:'Pryke',age:30,programmes:[{name:'KR Karate',gradeName:'Blue Belt',progress:0.5,attended:40,readyToPromote:false}]}" +
  "];");
  W("aquilaCacheClear(); DB.aquila.members=async()=>({ members:window.__members, programmes:[{id:'P1',name:'KR Karate'}], fetchedAt:'t' });");

  // ---------- F: student lookup ----------
  W("openAquilaStudentLookup();");
  ck('lookup opens in loading state', W("state._aqLookup.loading") === true);
  await sleep(10);
  ck('lookup loaded data', W("!state._aqLookup.loading && !!state._aqLookup.data") === true);
  ck('lookup lists all 3 (empty query)', /Gus Cheney/.test(body('aquilaLookupBody')) && /Chen Lee/.test(body('aquilaLookupBody')) && /Zoe Pryke/.test(body('aquilaLookupBody')));
  ck('lookup shows contact for Gus', /gus@x\.com/.test(body('aquilaLookupBody')));
  ck('lookup shows "No grades recorded" for Chen', /No grades recorded/.test(body('aquilaLookupBody')));
  W("state._aqLookup.query='zoe'; _aquilaLookupResults();");
  ck('lookup search filters to Zoe', /Zoe Pryke/.test(body('aqLookupResults')) && !/Gus Cheney/.test(body('aqLookupResults')));
  W("state._aqLookup.query='che'; _aquilaLookupResults();");
  ck('lookup "che" matches Cheney by surname', /Gus Cheney/.test(body('aqLookupResults')));

  // F error path
  W("aquilaCacheClear(); DB.aquila.members=async()=>({ error:'insufficient_permissions' });");
  W("openAquilaStudentLookup();"); await sleep(10);
  ck('lookup surfaces permission error', /Development_Read/.test(body('aquilaLookupBody')));

  // ---------- E: progression PICKER → planner pre-filled, PRINT-ONLY (no save) ----------
  W("aquilaCacheClear(); DB.aquila.members=async()=>({ members:window.__members, programmes:[{id:'P1',name:'KR Karate'}], fetchedAt:'t' });");
  W("state.students={}; state.progressions={}; state.user={id:'U1',name:'Tester',role:'admin'};");
  W("openAquilaProgPicker();");
  ck('prog picker opens in loading state', W("state._aqPick.loading") === true);
  await sleep(10);
  ck('prog picker lists Aquila students', /Gus Cheney/.test(body('aquilaProgBody')) && /Zoe Pryke/.test(body('aquilaProgBody')));
  ck('prog picker row shows DOB', /1985-05-05/.test(body('aquilaProgBody')));
  W("state._aqPick.query='zoe'; _aquilaProgPickerResults();");
  ck('prog picker search filters to Zoe', /Zoe Pryke/.test(body('aqPickResults')) && !/Gus Cheney/.test(body('aqPickResults')));
  W("state._aqPick.query=''; _aquilaProgPickerResults();");

  // pick Gus → planner opens pre-filled, and NOTHING is saved (print-only)
  await W("_aquilaProgPick(0)"); await sleep(10);
  ck('prog pick does NOT materialise a student', W("Object.keys(state.students).length") === 0);
  ck('prog pick fills planner name', W("document.getElementById('progStudentName').value") === 'Gus Cheney');
  ck('prog pick fills planner DOB', W("document.getElementById('progDob').value") === '1985-05-05');
  ck('prog pick saves nothing to state.progressions', W("Object.keys(state.progressions).length") === 0);

  // ---------- E: pathway PICKER → materialise student → saved pathway editor ----------
  W("can.managePathway=function(){return true;}; aquilaCacheClear(); state.students={}; state.pathways={};");
  W("DB.aquila.members=async()=>({ members:window.__members, programmes:[{id:'P1',name:'KR Karate'}], fetchedAt:'t' });");
  W("openAquilaPathwayPicker();");
  ck('pathway picker opens loading', W("state._aqPwPick.loading") === true);
  await sleep(10);
  ck('pathway picker lists Aquila members', /Gus Cheney/.test(body('aquilaPathwayBody')) && /Zoe Pryke/.test(body('aquilaPathwayBody')));
  W("state._aqPwPick.query='zoe'; _aquilaPathwayPickerResults();");
  ck('pathway picker search filters', /Zoe Pryke/.test(body('aqPwResults')) && !/Gus Cheney/.test(body('aqPwResults')));
  W("state._aqPwPick.query=''; _aquilaPathwayPickerResults();");

  // pick Gus → creates a local student + opens the pathway editor (saved)
  await W("_aquilaPathwayPick(0)"); await sleep(10);
  ck('pathway pick creates a local student', W("Object.values(state.students).some(s=>s.name==='Gus Cheney')") === true);
  ck('pathway student tagged source=aquila', W("Object.values(state.students).find(s=>s.name==='Gus Cheney').source") === 'aquila');
  ck('pathway student carries DOB', W("Object.values(state.students).find(s=>s.name==='Gus Cheney').dob") === '1985-05-05');
  ck('pathway student carries Aquila reference', W("Object.values(state.students).find(s=>s.name==='Gus Cheney').memberNum") === 'AU-1');
  ck('pathway editor opened pre-filled', W("document.getElementById('pwStudentName').value") === 'Gus Cheney');
  ck('pathway record created in state', W("Object.keys(state.pathways).length") === 1);

  // pick the SAME member again → folds to one student record (no duplicate)
  const beforeCount = W("Object.keys(state.students).length");
  W("openAquilaPathwayPicker();"); await sleep(10);
  await W("_aquilaPathwayPick(0)"); await sleep(10);
  ck('re-picking same member does not duplicate', W("Object.keys(state.students).length") === beforeCount);

  // _aquilaCreateOrFindStudent normalises an ISO-datetime DOB to YYYY-MM-DD
  W("state.students={};");
  const sid = await W("_aquilaCreateOrFindStudent({firstName:'Iso',lastName:'Date',dob:'2010-03-04T00:00:00',reference:'R2'})");
  ck('ISO dob normalised to YYYY-MM-DD', W("state.students['" + sid + "'].dob") === '2010-03-04');
  W("state.students={};");
  await W("_aquilaCreateOrFindStudent({firstName:'No',lastName:'Dob'})");
  ck('member with no dob → empty dob, still created', W("(Object.values(state.students).find(s=>s.name==='No Dob')||{}).dob") === '');

  // ---------- E carry-over: Aquila grade + last-grading date pre-fill the planner ----------
  ck('match program: KR Karate → karate', W("(_aquilaProgMatchProgram('KR Karate')||{}).id") === 'karate');
  ck('match program: Muay Thai (no KR) → muayThai', W("(_aquilaProgMatchProgram('Muay Thai')||{}).id") === 'muayThai');
  ck('match program: unknown → null', W("_aquilaProgMatchProgram('Fencing')") === null);
  ck('match rank: exact Yellow 9th Kyu → 0', W("_aquilaProgMatchRank(progressionProgramById('karate'),'Yellow 9th Kyu')") === 0);
  ck('match rank: exact Blue 7th Kyu → 2', W("_aquilaProgMatchRank(progressionProgramById('karate'),'Blue 7th Kyu')") === 2);
  ck('match rank: unknown grade → -1 (never guesses)', W("_aquilaProgMatchRank(progressionProgramById('karate'),'Totally Unknown Grade')") === -1);

  // full pick → existing planner pre-filled with rank + last-grading date
  W("aquilaCacheClear(); state.students={}; state.progressions={};");
  W("DB.aquila.members=async()=>({ members:[{firstName:'Carry',lastName:'Over',dob:'2005-05-05',reference:'C1',programmes:[" +
    "{name:'KR Karate',gradeName:'Blue 7th Kyu',promoted:'2024-03-01'}," +
    "{name:'KR Muay Thai',gradeName:'Yellow Level 2',promoted:'2024-06-15'}," +
    "{name:'Brazilian Jiu Jitsu',gradeName:'White',promoted:'2024-01-01'}" + // no KRMAS program → skipped
  "]}], programmes:[], fetchedAt:'t' });");
  W("openAquilaProgPicker();"); await sleep(10);
  await W("_aquilaProgPick(0)"); await sleep(10);
  ck('carry: karate chip auto-checked', W("(document.getElementById('pp-chip-karate')||{}).checked") === true);
  ck('carry: karate last-grading date in state', W("(_ppCardState['karate']||{}).startDate") === '2024-03-01');
  ck('carry: karate rank mapped (Blue 7th Kyu → idx 2)', W("(_ppCardState['karate']||{}).startIdx") === '2');
  ck('carry: karate date input shows the date', W("(document.getElementById('pp-date-karate')||{}).value") === '2024-03-01');
  ck('carry: karate rank select shows idx 2', W("(document.getElementById('pp-start-karate')||{}).value") === '2');
  ck('carry: muayThai date carried', W("(_ppCardState['muayThai']||{}).startDate") === '2024-06-15');
  ck('carry: muayThai rank mapped (Yellow Level 2 → idx 1)', W("(_ppCardState['muayThai']||{}).startIdx") === '1');
  ck('carry: unmatched programme (BJJ) added no card', W("Object.keys(_ppCardState).sort().join(',')") === 'karate,muayThai');
  ck('carry: projection auto-generated', W("!!(state.progResultsCache && state.progResultsCache.programs && state.progResultsCache.programs.karate)") === true);
  // print/download path works off the in-memory generated plan (no save needed)
  ck('print html includes the student name', /Carry Over/.test(W("formatProgressionHtml()")));
  ck('print html includes a program section', /KR Karate/.test(W("formatProgressionHtml()")));

  // graceful: programme matches but grade does not → date carries, rank stays blank
  W("aquilaCacheClear(); state.students={}; state.progressions={};");
  W("DB.aquila.members=async()=>({ members:[{firstName:'NoRank',lastName:'Match',dob:'2000-01-01',programmes:[{name:'KR Karate',gradeName:'Some Custom Belt',promoted:'2022-02-02'}]}], programmes:[], fetchedAt:'t' });");
  W("openAquilaProgPicker();"); await sleep(10);
  await W("_aquilaProgPick(0)"); await sleep(10);
  ck('graceful: unmatched grade → blank rank', W("(_ppCardState['karate']||{}).startIdx") === '');
  ck('graceful: date still carries', W("(_ppCardState['karate']||{}).startDate") === '2022-02-02');

  // ---------- gating ----------
  W("__lastAlert=''; state.aquilaIntegration={ locationId:'L1', roles:['Members_Read'] };"); // no Development_Read
  ck('prog gate blocked without Development_Read', W("aquilaCanProgression()") === false);
  W("openAquilaProgPicker();");
  ck('prog picker alerts when gated', /Development_Read/.test(W('__lastAlert') || ''));
  W("__lastAlert=''; state.aquilaIntegration=null;");
  W("openAquilaStudentLookup();");
  ck('student lookup alerts when no Aquila', /not connected/.test(W('__lastAlert') || ''));

  // ---------- Students-view entry point: single "Search in Aquila" menu ----------
  W("can.viewStudents=function(){return true;}; can.editPlans=function(){return true;}; can.managePathway=function(){return true;}; state.students={};");
  W("state.aquilaIntegration={ locationId:'L1', roles:['Development_Read'] }; renderStudents();");
  ck('Aquila school shows single Search-in-Aquila button', /Search in Aquila/.test(body('mainContent')));
  ck('individual Aquila buttons no longer on the main view', !/Aquila pathway|Aquila progression|Aquila lookup/.test(body('mainContent')));
  // the menu folds in every option
  W("openStudentAddMenu();");
  ck('menu offers instructor pathway', /Instructor pathway/.test(body('actionSheetBody')));
  ck('menu offers grading progression', /Grading progression/.test(body('actionSheetBody')));
  ck('menu offers look-up a member', /Look up a member/.test(body('actionSheetBody')));
  ck('menu folds in manual add', /Add manually/.test(body('actionSheetBody')));
  W("closeModal('modalActions');");
  // pathway option hides without instructor access; lookup stays
  W("can.managePathway=function(){return false;}; openStudentAddMenu();");
  ck('menu hides pathway without instructor access', !/Instructor pathway/.test(body('actionSheetBody')));
  ck('menu still offers lookup', /Look up a member/.test(body('actionSheetBody')));
  W("can.managePathway=function(){return true;}; closeModal('modalActions');");
  // non-Aquila school: plain manual add button, no Search-in-Aquila
  W("state.aquilaIntegration={ locationId:'L1', roles:['Members_Read'] }; renderStudents();");
  ck('no Search-in-Aquila without Development_Read', !/Search in Aquila/.test(body('mainContent')));
  ck('manual add button shown instead', /Add student/.test(body('mainContent')));
  W("state.aquilaIntegration=null; renderStudents();");
  ck('non-Aquila school still shows manual add', /Add student/.test(body('mainContent')) && !/Search in Aquila/.test(body('mainContent')));

  ck('no errors during lookups', window.__errs.length === 0);

  console.log(`\nAQUILA LOOKUPS (jsdom): PASS=${pass} FAIL=${fail}`);
  if (fail) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('✓ ALL GREEN');
  process.exit(0);
})();
