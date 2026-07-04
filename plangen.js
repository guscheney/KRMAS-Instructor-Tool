/* ====================================================================
   KRMAS — plangen.js (v126)
   Archive-grounded lesson-plan generation. A faithful JS port of
   krmas_generate.py — a RECOMBINATION ENGINE, NOT A CREATIVE WRITER.

   NON-NEGOTIABLE RULES (from the reference bundle["rules"]):
   1. STRICT GROUNDING — every output line is copied verbatim from the
      owner's corpus. Never invent, paraphrase, or extrapolate.
   2. Unsatisfiable requests return an explicit gap report, never filler.
   3. Every line carries a source ref (catalogue id + source plan).
   4. No belt/rank targeting — class type + topic only.
   5. "Usual warmup" is emitted literally; intentionally undefined.

   DIFFERENCES FROM THE PYTHON REFERENCE (deliberate):
   • The catalogue is DERIVED IN MEMORY from the owner's plans
     (buildCatalogue) instead of precomputed — app corpora grow one plan
     at a time and re-deriving a few thousand lines takes milliseconds.
     The founder seed asset's own precomputed catalogue is ignored for
     the same reason: one code path, always freshly consistent.
   • Style DNA is computed empirically per owner (deriveStyle): format
     headers = a known base set ∪ short lines that repeatedly open
     blocks in the owner's own plans; aliases map normalised class-type
     names onto the owner's canonical spellings.
   Everything else — normalisation, scoring weights, exemplar count,
   block assembly, volume targeting, ground-checking — matches the
   reference so the two implementations stay comparable (see the parity
   test in tests/plangen_parity_test.js).
   ==================================================================== */

(function (root) {
  'use strict';

  const TYPO = { 'kics': 'kicks', 'break falls': 'breakfalls', 'warm up': 'warmup', 'bsics': 'basics' };
  const BASE_FORMAT_HEADERS = ['lines', 'partners', 'pads', 'thai pads', 'bags', 'round bags', 'heavy bags', 'hanging bags', 'round pads', 'freestyle'];
  const EXEMPLARS = 4;
  // A class type unlocks generation once the corpus holds this many usable
  // plans of it — below that the exemplar pool is too thin to assemble
  // honestly (the reference draws on 4 exemplars; 6 gives real choice).
  const MIN_PLANS_FOR_GEN = 6;

  function normkey(s) {
    s = String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/^[\s.\-–—:*]+|[\s.\-–—:*]+$/g, '');
    for (const k in TYPO) s = s.split(k).join(TYPO[k]);
    return s.replace(/&/g, 'and').replace(/\+/g, 'and').replace(/\s+/g, ' ').trim();
  }
  function mergekey(s) { return normkey(s).replace(/[\s,\-–/]/g, ''); }
  function tokens(s) { return new Set((normkey(s || '').match(/[a-z]+/g) || [])); }

  // ── catalogue derivation (replaces the bundle's precomputed catalogue) ──
  // Groups every line of every plan by (section, mergekey). Canonical text =
  // the most frequent original spelling; the rest become variants. Ids are
  // stable-ish (section prefix + short hash of the merge key) so source refs
  // survive re-derivation.
  function _hash(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; } return (h >>> 0).toString(16).padStart(8, '0'); }
  function buildCatalogue(plans) {
    const map = new Map();   // section|mergekey -> item
    const add = (sec, line, plan) => {
      const mk = mergekey(line);
      if (!mk) return;
      const key = sec + '|' + mk;
      let it = map.get(key);
      if (!it) { it = { i: sec + '-' + _hash(mk), s: sec, forms: new Map(), n: 0, ct: {}, src: [] }; map.set(key, it); }
      it.n++;
      it.forms.set(line, (it.forms.get(line) || 0) + 1);
      it.ct[plan.c] = (it.ct[plan.c] || 0) + 1;
      if (!it.src.includes(plan.i)) it.src.push(plan.i);
    };
    for (const p of plans) {
      for (const l of (p.w || [])) add('warm', l, p);
      for (const l of (p.d || [])) add('tech', l, p);
      for (const l of (p.cd || [])) add('cool', l, p);
    }
    const catalogue = [];
    for (const it of map.values()) {
      let canonical = '', best = -1;
      for (const [form, n] of it.forms) if (n > best) { best = n; canonical = form; }
      const variants = [...it.forms.keys()].filter(f => f !== canonical);
      catalogue.push({ i: it.i, s: it.s, c: canonical, n: it.n, ct: it.ct, v: variants, src: it.src });
    }
    return catalogue;
  }
  function allowedIndex(catalogue) {
    const allowed = new Map();
    for (const it of catalogue) {
      allowed.set(it.s + '|' + mergekey(it.c), it);
      for (const v of (it.v || [])) allowed.set(it.s + '|' + mergekey(v), it);
    }
    return allowed;
  }

  // ── style DNA, computed per owner from their own plans ──
  function deriveStyle(plans, seedStyle) {
    const headerCounts = new Map();
    for (const p of plans) {
      for (const l of (p.d || [])) {
        const n = normkey(l);
        if (n && n.split(' ').length <= 2) headerCounts.set(n, (headerCounts.get(n) || 0) + 1);
      }
    }
    const headers = new Set(BASE_FORMAT_HEADERS);
    for (const [h, n] of headerCounts) if (n >= 5 && BASE_FORMAT_HEADERS.some(b => h.startsWith(b.split(' ')[0]))) headers.add(h);
    if (seedStyle && Array.isArray(seedStyle.format_headers)) for (const h of seedStyle.format_headers) headers.add(normkey(h));
    const aliases = {};
    for (const p of plans) { const n = normkey(p.c); if (n && !aliases[n]) aliases[n] = p.c; }
    if (seedStyle && seedStyle.class_aliases) for (const k in seedStyle.class_aliases) if (!aliases[k]) aliases[k] = seedStyle.class_aliases[k];
    return { format_headers: [...headers], class_aliases: aliases, topics: (seedStyle && seedStyle.curricula) || (seedStyle && seedStyle.topics) || {} };
  }

  function resolveClass(plans, style, raw) {
    const n = normkey(raw);
    if (style.class_aliases[n]) return style.class_aliases[n];
    const known = [...new Set(plans.map(p => p.c))];
    for (const k of known) if (normkey(k) === n) return k;
    return null;
  }

  // ── scoring: identical weights to the reference ──
  function score(p, want) {
    let s = 0;
    if (want.topic != null && p.t === want.topic) s += 50;
    if (want.ttok && want.ttok.size) {
      const hay = new Set([...tokens(p.th), ...tokens(p.o)]);
      for (const l of [...(p.w || []), ...(p.d || []), ...(p.cd || [])]) for (const t of tokens(l)) hay.add(t);
      let hits = 0; for (const t of want.ttok) if (hay.has(t)) hits++;
      s += 10 * hits;
    }
    if (want.week != null && p.tw) {
      const m = /^T(\d+)W(\d+)/.exec(p.tw);
      if (m) {
        s += Math.max(0, 5 - Math.abs(parseInt(m[2], 10) - want.week));
        if (want.term != null && parseInt(m[1], 10) === want.term) s += 3;
      }
    }
    return s;
  }

  function blocksOf(lines, headerSet) {
    const blocks = []; let cur = [];
    for (const l of lines) {
      if (headerSet.has(normkey(l))) { if (cur.length) blocks.push(cur); cur = [l]; }
      else cur.push(l);
    }
    if (cur.length) blocks.push(cur);
    return blocks;
  }

  // ── corpus coverage (cold-start UX + the sharing picker's stats) ──
  function coverage(plans) {
    const byType = {};
    for (const p of plans) {
      if (!p.w.length && !p.d.length) continue;
      const t = byType[p.c] || (byType[p.c] = { plans: 0, topics: new Set(), themes: [] });
      t.plans++;
      if (p.t != null) t.topics.add(p.t);
      if (p.th && t.themes.length < 8 && !t.themes.includes(p.th)) t.themes.push(p.th);
    }
    const out = {};
    for (const c in byType) out[c] = { plans: byType[c].plans, topics: [...byType[c].topics].sort((a, b) => a - b), themes: byType[c].themes, unlocked: byType[c].plans >= MIN_PLANS_FOR_GEN };
    return out;
  }

  // ── the generator: mirrors main() in the reference ──
  // corpus = { plans:[], style:{}, catalogue?:[] }  req = { classType, topic?, theme?, duration?, term?, week? }
  // Returns { ok, gaps:[], plan?, available? } — plan lines are {t, id, src}.
  function generate(corpus, req) {
    const plans = corpus.plans || [];
    const style = corpus.style || deriveStyle(plans, null);
    const headerSet = new Set((style.format_headers || []).map(normkey));
    const catalogue = corpus.catalogue || buildCatalogue(plans);
    const allowed = allowedIndex(catalogue);

    const ct = resolveClass(plans, style, req.classType);
    if (!ct) {
      return { ok: false, gaps: [`unknown class type '${req.classType}'`], available: { classTypes: [...new Set(plans.map(p => p.c))].sort() } };
    }
    const want = { topic: req.topic != null ? req.topic : null, ttok: tokens(req.theme), term: req.term != null ? req.term : null, week: req.week != null ? req.week : null };
    const cand = plans.filter(p => p.c === ct && ((p.w && p.w.length) || (p.d && p.d.length)));
    if (!cand.length) return { ok: false, gaps: [`no usable plans of class type '${ct}' in this library`], available: { classTypes: [...new Set(plans.map(p => p.c))].sort() } };
    cand.sort((a, b) => (score(b, want) - score(a, want)) || (a.f < b.f ? -1 : a.f > b.f ? 1 : 0));

    const gaps = [];
    if (want.topic != null && cand.every(p => p.t !== want.topic)) gaps.push(`no '${ct}' plan for topic ${want.topic}`);
    if (want.ttok.size && score(cand[0], { topic: null, ttok: want.ttok, term: null, week: null }) === 0) gaps.push(`no '${ct}' material matching theme '${req.theme}'`);
    if (gaps.length) {
      const ts = [...new Set(cand.filter(p => p.t != null).map(p => String(p.t)))].sort((a, b) => a - b);
      const themes = cand.filter(p => p.th).map(p => p.th).slice(0, 8);
      return { ok: false, gaps, available: { classType: ct, topics: ts, themes } };
    }

    const top = cand.slice(0, EXEMPLARS);
    const tag = (lines, p, sec) => {
      const out = [];
      for (const l of (lines || [])) {
        const it = allowed.get(sec + '|' + mergekey(l));
        if (it) out.push({ t: l, id: it.i, src: p.f || p.i });
      }
      return out;
    };
    let warmup = [], cool = [];
    for (const p of top) { const w = tag(p.w, p, 'warm'); if (w.length) { warmup = w; break; } }
    for (const p of top) { const c = tag(p.cd, p, 'cool'); if (c.length) { cool = c; break; } }
    const counts = top.filter(p => p.d && p.d.length).map(p => p.d.length);
    const median = counts.length ? counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)] : 8;
    const target = Math.max(3, Math.round(median * ((req.duration || 60) / 60)));
    const tech = []; const seen = new Set();
    outer:
    for (const p of top) {
      for (const blk of blocksOf(p.d || [], headerSet)) {
        const k = mergekey(blk.join(' '));
        if (seen.has(k)) continue;
        seen.add(k);
        tech.push(...tag(blk, p, 'tech'));
        if (tech.length >= target) break outer;
      }
    }

    const prim = top[0];
    const tw = (req.term && req.week) ? `Term ${req.term} Week ${req.week}` : (req.week ? `Week ${req.week}` : (prim.tw || ''));
    const sources = [];
    for (const line of [...warmup, ...tech, ...cool]) if (!sources.includes(line.src)) sources.push(line.src);
    return {
      ok: true, gaps: [],
      plan: {
        classType: ct, theme: prim.th || '', objective: prim.o || '', termWeek: tw,
        warmup, tech, cool, sources,
        headerSet: [...headerSet],
      },
    };
  }

  // ── corpus loading: table rows + optional founder seed asset, merged ──
  // rowToPlan maps a corpus_plans DB row onto the bundle plan shape.
  function rowToPlan(r) {
    return { i: r.id, f: r.sourceKey || r.source_key || r.id, y: r.year || null, c: r.classType || r.class_type, t: (r.topic == null ? null : r.topic), th: r.theme || '', o: r.objective || '', tw: r.termWeek || r.term_week || null, w: r.warmup || [], d: r.drills || [], cd: r.cooldown || [] };
  }
  let _seedCache = null;
  async function fetchSeedBundle(url) {
    if (_seedCache) return _seedCache;
    const res = await fetch(url || 'krmas-bundle.json');
    if (!res.ok) throw new Error('Seed bundle unavailable (' + res.status + ')');
    _seedCache = await res.json();
    return _seedCache;
  }
  // ownerRows: corpus_plans rows for the owner; style row from corpus_style.
  async function assembleCorpus(ownerRows, styleRow, opts) {
    let plans = (ownerRows || []).map(rowToPlan);
    let seedStyle = null;
    if (styleRow && styleRow.seed === 'krmas-bundle') {
      const bundle = await fetchSeedBundle(opts && opts.seedUrl);
      plans = bundle.plans.concat(plans);
      seedStyle = bundle.style_dna || null;
    }
    return { plans, style: deriveStyle(plans, seedStyle) };
  }

  const PlanGen = { normkey, mergekey, tokens, buildCatalogue, allowedIndex, deriveStyle, resolveClass, score, blocksOf, coverage, generate, rowToPlan, assembleCorpus, fetchSeedBundle, MIN_PLANS_FOR_GEN, BASE_FORMAT_HEADERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = PlanGen;
  root.PlanGen = PlanGen;
})(typeof window !== 'undefined' ? window : globalThis);
