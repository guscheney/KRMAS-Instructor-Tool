/* ====================================================================
   KRMAS — plangen.js (v130)
   Archive-grounded lesson-plan generation. A faithful JS port of
   krmas_generate.py — a RECOMBINATION ENGINE, NOT A CREATIVE WRITER.

   NON-NEGOTIABLE RULES (from the reference bundle["rules"]):
   1. STRICT GROUNDING — every output line is copied verbatim from the
      owner's corpus. Never invent, paraphrase, or extrapolate.
   2. Unsatisfiable requests return an explicit gap report, never filler.
   3. Every line carries a source ref (catalogue id + source plan).
   4. No belt/rank targeting — class type + topic only.
   5. "Usual warmup" is emitted literally; intentionally undefined.
   6. (v130) A requested TOPIC is a hard filter: source plans must carry
      that topic. Class/topic for seed-archive plans are derived from the
      plan TITLE (source filename) — the title is the authority.

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
  // Canonical key for CLASS-TYPE comparison: order-free token set, with
  // separators (-, _, /) treated as spaces. Makes the app's stored keys
  // ('little-ninjas'), display names ('Little Ninjas') and the archive's
  // spellings ('Little Ninjas') all compare equal.
  function classkey(s) { return [...tokens(String(s || '').replace(/[-_/]/g, ' '))].sort().join(' '); }

  // ── title-derived attribution (v130) ──
  // The founder archive was bulk-imported with class/topic inferred from
  // document CONTENT, which misfiled plans (a 'kids variety' doc landed as
  // Little Ninjas topic 8). The plan's TITLE (source filename) is the
  // authority: topic and class are re-derived from it at load; the stored
  // value survives only where the title says nothing. Applied to seed
  // plans only — app-completed plans carry the instructor's explicit
  // form values, which are authoritative.
  const TITLE_CLASS_ALIASES = { lmt: 'ladies mt', ufc: 'Sanda/MMA', 'jiu jitsu': 'BJJ', njj: 'BJJ' };
  function titleTopic(f) {
    const m = /topic\s*[-_]?\s*(\d+)/i.exec(String(f || '').split('/').pop() || '');
    return m ? parseInt(m[1], 10) : null;
  }
  function titleClass(f, plans, style) {
    const base = normkey(String(f || '').split('/').pop().replace(/\.[a-z0-9]+$/i, ''));
    if (!base) return null;
    const cands = new Map();   // token -> canonical class
    for (const p of plans) { const n = normkey(p.c); if (n && !cands.has(n)) cands.set(n, p.c); }
    for (const k in (style && style.class_aliases) || {}) if (!cands.has(k)) cands.set(k, style.class_aliases[k]);
    for (const k in TITLE_CLASS_ALIASES) if (!cands.has(k)) cands.set(k, TITLE_CLASS_ALIASES[k]);
    let hit = null;
    for (const [tok, canon] of cands) {
      if (tok === 'unknown') continue;
      const re = new RegExp('(^|[^a-z])(' + tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')($|[^a-z])', 'i');
      const m = re.exec(base);
      if (!m) continue;
      const at = m.index + m[1].length;
      // The class is named FIRST in a title; later tokens are theme
      // ('karate topic 4 - sparring' is a Karate class). Leftmost wins,
      // longest breaks ties ('mini little ninjas' over 'little ninjas').
      if (!hit || at < hit.at || (at === hit.at && tok.length > hit.tok.length)) hit = { tok, canon, at };
    }
    return hit ? hit.canon : null;
  }
  function normalizeSeedPlans(plans, style) {
    return plans.map(p => {
      const t = titleTopic(p.f), c = titleClass(p.f, plans, style);
      if (t == null && c == null) return p;
      return Object.assign({}, p, { t: t != null ? t : p.t, c: c != null ? c : p.c });
    });
  }

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
    // classkey pass: order/separator-free ('little-ninjas' == 'Little Ninjas')
    const ck = classkey(raw);
    if (ck) for (const k of known) if (classkey(k) === ck) return k;
    // last resort: a UNIQUE known class whose tokens contain the query's
    // ('Mini Ninjas' -> 'Mini Little Ninjas'). Ambiguity stays unresolved.
    const qt = tokens(String(raw || '').replace(/[-_/]/g, ' '));
    if (qt.size) {
      const supers = known.filter(k => { const kt = tokens(String(k).replace(/[-_/]/g, ' ')); return [...qt].every(t => kt.has(t)); });
      if (supers.length === 1) return supers[0];
    }
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
    const byType = {}; const canon = {};   // classkey -> first-seen spelling
    for (const p of plans) {
      if (!p.w.length && !p.d.length) continue;
      const ck = classkey(p.c);
      const label = canon[ck] || (canon[ck] = p.c);
      const t = byType[label] || (byType[label] = { plans: 0, topics: new Set(), themes: [] });
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
    const ctKey = classkey(ct);
    let cand = plans.filter(p => classkey(p.c) === ctKey && ((p.w && p.w.length) || (p.d && p.d.length)));
    if (!cand.length) return { ok: false, gaps: [`no usable plans of class type '${ct}' in this library`], available: { classTypes: [...new Set(plans.map(p => p.c))].sort() } };

    const gaps = [];
    // A requested topic is a HARD FILTER, not a preference: a 'topic 8'
    // plan must be assembled only from topic-8 source plans — never padded
    // out with material from whatever other topics the class happens to
    // have (rule 2: honest gaps, never filler).
    if (want.topic != null) {
      const byTopic = cand.filter(p => p.t === want.topic);
      if (!byTopic.length) gaps.push(`no '${ct}' plan for topic ${want.topic}`);
      else cand = byTopic;
    }
    cand.sort((a, b) => (score(b, want) - score(a, want)) || (a.f < b.f ? -1 : a.f > b.f ? 1 : 0));
    if (!gaps.length && want.ttok.size && score(cand[0], { topic: null, ttok: want.ttok, term: null, week: null }) === 0) gaps.push(`no '${ct}' material matching theme '${req.theme}'`);
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
      // via the exported object so tests (or callers) can substitute the fetcher
      const bundle = await PlanGen.fetchSeedBundle(opts && opts.seedUrl);
      // Title-wins attribution: the archive's stored class/topic were
      // inferred from document content and misfiled ~10% of plans.
      const seedPlans = normalizeSeedPlans(bundle.plans, { class_aliases: (bundle.style_dna && bundle.style_dna.class_aliases) || {} });
      plans = seedPlans.concat(plans);
      seedStyle = bundle.style_dna || null;
    }
    return { plans, style: deriveStyle(plans, seedStyle) };
  }

  const PlanGen = { normkey, mergekey, tokens, classkey, titleTopic, titleClass, normalizeSeedPlans, buildCatalogue, allowedIndex, deriveStyle, resolveClass, score, blocksOf, coverage, generate, rowToPlan, assembleCorpus, fetchSeedBundle, MIN_PLANS_FOR_GEN, BASE_FORMAT_HEADERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = PlanGen;
  root.PlanGen = PlanGen;
})(typeof window !== 'undefined' ? window : globalThis);
