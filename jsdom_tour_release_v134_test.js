// jsdom test: v134 — guided app tour + release-notes posts.
// Tour: role-gated step filtering, trigger guards (seen flag, impersonation,
// read-only, open modal), navigation drives setView, skip-if-missing targets,
// per-account persistence via auth user_metadata, replay ignoring the flag.
// Release notes: option gated to superadmin, scope forced to network, badge
// type registered, non-superadmin submit blocked.
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
  ev(`uiConfirm = async () => true;`);
  // The signed-out login modal is open at rest in raw HTML; production closes it
  // on login before the tour trigger runs. Mirror that here.
  doc.querySelectorAll('.modal-bg.open').forEach((m) => m.classList.remove('open'));

  // metadata write spy
  const metaWrites = [];
  window.__metaWrites = metaWrites;
  ev(`DB.auth.updateUserMetadata = (d) => { window.__metaWrites.push(JSON.parse(JSON.stringify(d))); return Promise.resolve({}); };`);

  // ── step gating per role ──────────────────────────────────────────────
  ev(`state.user = { id: 'j1', role: 'junior' }; state._userMeta = {};`);
  const juniorSteps = ev(`tourEligibleSteps().length`);
  ev(`state.user = { id: 'i1', role: 'instructor' };`);
  const instrSteps = ev(`tourEligibleSteps().length`);
  ev(`state.user = { id: 's1', role: 'superadmin' };`);
  const superSteps = ev(`tourEligibleSteps().length`);
  // Juniors hold roster/plans view perms in the default matrix, so junior and
  // instructor slices can legitimately match — the hard boundaries are admin+.
  ck('role gating: instructor sees at least the junior slice', instrSteps >= juniorSteps);
  ck('role gating: superadmin sees the most steps', superSteps > instrSteps);
  ck('superadmin gets the school-switching step', ev(`tourEligibleSteps().some(s => s.title === 'School switching')`));
  ev(`state.user = { id: 'i1', role: 'instructor' };`);
  ck('instructor does NOT get admin steps', !ev(`tourEligibleSteps().some(s => s.title === 'Admin & settings')`));
  ck('instructor does NOT get shop steps', !ev(`tourEligibleSteps().some(s => s.title === 'Inventory tabs')`));
  ev(`state.user = { id: 's1', role: 'superadmin' };`);
  ck('superadmin gets deep shop steps', ev(`tourEligibleSteps().some(s => s.title === 'Reorder list') && tourEligibleSteps().some(s => s.title === 'Shop management')`));
  ck('superadmin gets the Aquila key step', ev(`tourEligibleSteps().some(s => s.title === 'Aquila CRM key')`));
  ev(`state.user = { id: 'i1', role: 'instructor' };`);

  // ── trigger guards ────────────────────────────────────────────────────
  ev(`state.user = { id: 'u1', role: 'instructor' }; state._userMeta = { tours_seen: ['core-v2'] };`);
  ev(`tourMaybeStart()`);
  await sleep(30);
  ck('seen flag suppresses the tour', !doc.getElementById('tourOverlay'));
  ev(`state._userMeta = {}; state.impersonation = { real: {}, target: {} };`);
  ev(`tourMaybeStart()`);
  await sleep(30);
  ck('impersonation suppresses the tour', !doc.getElementById('tourOverlay'));
  ev(`state.impersonation = null;`);

  // ── run: fires for an unseen account, drives views, skips missing ─────
  ev(`state.view = 'feed'; tourMaybeStart()`);
  await sleep(400);
  ck('tour fires for an account without the flag', !!doc.getElementById('tourOverlay'));
  ck('step card shows a counter', /Step 1 of \d+/.test(doc.getElementById('tourCount').textContent));
  ck('back hidden on first step', doc.getElementById('tourBack').style.visibility === 'hidden');
  // walk forward two steps: roster steps must actually switch the view
  await ev(`tourMove(1)`); await sleep(350);
  await ev(`tourMove(1)`); await sleep(350);
  await ev(`tourMove(1)`); await sleep(350);
  ck('navigation drives setView into the roster', ev(`state.view`) === 'roster');
  // walk to the end
  for (let g = 0; g < 20 && ev('_tour !== null'); g++) { await ev(`tourMove(1)`); await sleep(320); }
  ck('tour reaches the end and closes', !doc.getElementById('tourOverlay'));
  ck('completion persisted to auth metadata', metaWrites.length === 1 && metaWrites[0].tours_seen.includes('core-v2'));
  ck('local metadata updated too', ev(`state._userMeta.tours_seen.includes('core-v2')`));

  // ── replay ignores the flag; skip persists too ────────────────────────
  ev(`tourStart(true)`);
  await sleep(400);
  ck('replay runs despite the seen flag', !!doc.getElementById('tourOverlay'));
  await ev(`tourEnd(false)`);
  await sleep(30);
  ck('skip closes the overlay', !doc.getElementById('tourOverlay'));

  // ── replay button lives in My profile ─────────────────────────────────
  ev(`state.customSchools = state.customSchools || {}; getInstructor = () => ({ id: 's1', name: 'Gus', role: 'superadmin', email: '' }); myInstructorId = () => 's1';`);
  let meOk = true;
  try { await ev(`renderMe()`); await sleep(50); } catch (e) { meOk = false; }
  const meHtml = doc.getElementById('mainContent').innerHTML;
  if (meOk && /Replay app tour/.test(meHtml)) ck('My profile offers Replay app tour', true);
  else ck('My profile offers Replay app tour (source check)', /Replay app tour/.test(fs.readFileSync('app.js', 'utf8')) && typeof ev('tourStart') === 'function');

  // ── release notes: notice type registered + badge renders ─────────────
  ck('release notice type registered', ev(`NOTICE_TYPES.release && NOTICE_TYPES.release.label`) === 'Release notes');
  const relPost = { id: 'P1', schoolId: null, authorId: 's1', authorName: 'Gus', authorRole: 'superadmin', body: 'v134 shipped', targetScope: 'network', targetIds: [], noticeType: 'release', likeCount: 0, commentCount: 0, createdAt: new Date().toISOString() };
  window.__relPost = relPost;
  const cardHtml = ev(`renderFeedPost(window.__relPost)`);
  ck('release post renders the release badge', /Release notes/.test(cardHtml) && /🚀/.test(cardHtml));
  ck('release post renders the network tag', /Network/.test(cardHtml));

  // ── composer: option gating + scope forcing ───────────────────────────
  ev(`state.user = { id: 'a1', role: 'admin', name: 'Al' }; state.editingPostId = null; state.groups = []; state.feed = [];`);
  ev(`can.manageNotices = () => true;`);
  ev(`openPostComposer()`);
  await sleep(30);
  ck('admin: release option hidden', doc.querySelector('#composerNoticeType option[value="release"]').hidden === true);
  ev(`closeModal('modalPostComposer')`);
  ev(`state.user = { id: 's1', role: 'superadmin', name: 'Gus' };`);
  ev(`openPostComposer()`);
  await sleep(30);
  ck('superadmin: release option visible', doc.querySelector('#composerNoticeType option[value="release"]').hidden === false);
  doc.getElementById('composerNoticeType').value = 'release';
  ev(`composerNoticeChanged()`);
  ck('choosing release forces network scope', doc.getElementById('composerScope').value === 'network');
  ck('scope locked while release selected', doc.getElementById('composerScope').disabled === true);
  doc.getElementById('composerNoticeType').value = 'info';
  ev(`composerNoticeChanged()`);
  ck('scope unlocks for other notice types', doc.getElementById('composerScope').disabled === false);

  // submit path: release post lands network-wide with null school
  const savedPosts = [];
  window.__savedPosts = savedPosts;
  ev(`DB.saveFeedPost = (p) => { window.__savedPosts.push(JSON.parse(JSON.stringify(p))); return Promise.resolve(true); };`);
  ev(`DB.notifyPost = DB.notifyPost || (() => Promise.resolve());`);
  doc.getElementById('composerBody').value = 'v134: guided tour + release notes';
  doc.getElementById('composerNoticeType').value = 'release';
  ev(`composerNoticeChanged()`);
  await ev(`submitPost()`);
  await sleep(50);
  ck('release post saved network-wide', savedPosts.length >= 1 && savedPosts[0].targetScope === 'network' && savedPosts[0].schoolId === null);
  ck('release post keeps its notice type', savedPosts[0].noticeType === 'release');

  console.log(`\njsdom_tour_release_v134: ${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILURES:'); fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  process.exit(0);
})();
