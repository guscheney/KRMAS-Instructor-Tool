// Feed-post save path — the "publishing but not saving" bug.
// Proves: (1) a successful save keeps the post in the feed; (2) a FAILED save no
// longer silently drops the post — it's rolled back out of the feed AND the user's
// draft is restored to the composer (so nothing is lost), instead of appearing saved.
const fs = require('fs');
const { JSDOM } = require('jsdom');

function boot() {
  const client = {
    from: () => {
      const b = {};
      ['select','eq','or','order','limit','lt','gt','gte','lte','in','is','neq','upsert','insert','update','delete','match','filter','contains','overlaps','range','not'].forEach((m) => { b[m] = () => b; });
      b.single = () => Promise.resolve({ data: null, error: null });
      b.maybeSingle = () => Promise.resolve({ data: null, error: null });
      b.then = (r) => Promise.resolve({ data: [], error: null }).then(r);
      return b;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'uid-1', email: 'gus@krmas.app' } } }, error: null }), getUser: () => Promise.resolve({ data: { user: { id: 'uid-1' } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: () => Promise.resolve({ error: null }) },
    functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  };
  let html = fs.readFileSync('index.html', 'utf8')
    .replace(/<script[^>]*src=[^>]*><\/script>/g, '')
    .replace(/<script>[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/' });
  const { window } = dom;
  window.SUPABASE_URL = 'https://x.supabase.co'; window.SUPABASE_ANON = 'k'; window.KRMAS_APP_VERSION = '61';
  window.supabase = { createClient: () => client };
  window.XLSX = {};
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  window.scrollTo = () => {}; window.alert = (m) => { window.__lastAlert = m; }; window.confirm = () => true;
  try { window.crypto = require('crypto').webcrypto; } catch (e) {}
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error ? e.error.message : e.message));
  window.onerror = (m) => errors.push(m);
  ['data.js', 'db.js', 'app.js'].forEach((f) => { const s = window.document.createElement('script'); s.textContent = fs.readFileSync(f, 'utf8'); window.document.body.appendChild(s); });
  return { window, errors };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('unhandledRejection', (e) => { console.log('UNHANDLED', (e && e.message) || e); process.exit(2); });

(async () => {
  let pass = 0, fail = 0; const fails = [];
  const ck = (label, cond) => { if (cond) pass++; else { fail++; fails.push(label); } };

  const { window, errors } = boot();
  await sleep(120);
  ck('boots clean', errors.length === 0);

  // Minimal state so submitPost can run, with a composer present.
  window.eval(`
    state.user = { id: 'uid-1', name: 'Gus', role: 'admin' };
    state.schoolId = 'edgeworth';
    state.feed = [];
    if (typeof can !== 'undefined') { /* admin gate fields read from DOM */ }
  `);

  function setComposer(text) {
    window.eval(`
      (function(){
        var b=document.getElementById('composerBody'); if(b) b.value=${JSON.stringify(text)};
        var sc=document.getElementById('composerScope'); if(sc) sc.value='school';
        ['composerNoticeType','composerExpires'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
        ['composerRequired','composerPinned'].forEach(function(id){ var e=document.getElementById(id); if(e) e.checked=false; });
        window.__pendingReset && window.__pendingReset();
      })();
    `);
  }

  // ---- 1. SUCCESS: post stays in the feed ----
  window.eval("DB.saveFeedPost = async () => true;");
  setComposer('First post that saves fine');
  await window.eval('submitPost()');
  await sleep(40);
  ck('successful save keeps post in feed', window.eval('state.feed.length') === 1);
  ck('no error alert on success', window.eval('window.__lastAlert == null'));

  // ---- 2. FAILURE: post is rolled back (NOT left looking saved) ----
  window.eval("window.__lastAlert=null; DB.saveFeedPost = async () => ({ error: 'column \"notice_type\" does not exist' });");
  setComposer('Second post that fails to save');
  const beforeLen = window.eval('state.feed.length');
  await window.eval('submitPost()');
  await sleep(40);
  ck('failed save does NOT leave a phantom post', window.eval('state.feed.length') === beforeLen);
  ck('failed save alerts the user', window.eval('typeof window.__lastAlert === "string" && window.__lastAlert.indexOf("could not be saved") !== -1'));
  ck('failure alert surfaces the real reason', window.eval('window.__lastAlert.indexOf("notice_type") !== -1'));
  ck('draft restored to composer (nothing lost)', window.eval('(document.getElementById("composerBody")||{}).value === "Second post that fails to save"'));

  console.log(`\nPASS=${pass} FAIL=${fail}`);
  if (fail) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('✓ FEED-POST SAVE GREEN');
  process.exit(0);
})();
