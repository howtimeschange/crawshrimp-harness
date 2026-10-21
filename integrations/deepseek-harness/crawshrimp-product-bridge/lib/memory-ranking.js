// Adapted from Phant0Meow/dsh-meow-memory@033df8589467bbe17a2c40dc864283b960795ec5; MIT, see ../MEOW-MEMORY-LICENSE. Generated from memory-ranking.ts.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3005\u30fc]/u;
const WORD = /[\p{L}\p{N}]/u;
function classify(cp) {
  if (CJK.test(cp)) return "cjk";
  if (WORD.test(cp)) return "word";
  return "skip";
}
function tokenize(text) {
  const cps = Array.from(text.normalize("NFKC"));
  const out = [];
  let i = 0;
  while (i < cps.length) {
    const cls = classify(cps[i]);
    if (cls === "skip") {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < cps.length && classify(cps[j]) === cls) j++;
    const run = cps.slice(i, j);
    if (cls === "cjk") {
      if (run.length >= 2) {
        for (let k = 0; k + 1 < run.length; k++) out.push(run[k] + run[k + 1]);
      }
    } else {
      out.push(run.join("").toLowerCase());
    }
    i = j;
  }
  return out;
}
function docText(d) {
  return [d.title ?? "", d.content, ...d.keywords].join(" ");
}
function recencyWeight(ageMs) {
  const days = ageMs / 864e5;
  if (days < 1) return 1;
  if (days < 2) return 0.9;
  if (days < 4) return 0.8;
  if (days < 7) return 0.65;
  if (days < 15) return 0.5;
  if (days < 30) return 0.35;
  if (days < 60) return 0.25;
  if (days < 180) return 0.15;
  return 0.08;
}
function search(query, docs, opts = {}) {
  const k = opts.k ?? 5;
  const now = opts.now === void 0 ? Date.now() : opts.now;
  const q = tokenize(query);
  if (q.length === 0 || docs.length === 0) return [];
  const n = docs.length;
  const docToks = docs.map((d) => tokenize(docText(d)));
  const avgdl = docToks.reduce((s, t) => s + t.length, 0) / n || 1;
  const df = /* @__PURE__ */ new Map();
  const tf = [];
  for (const toks of docToks) {
    const m = /* @__PURE__ */ new Map();
    const seen = /* @__PURE__ */ new Set();
    for (const t of toks) {
      m.set(t, (m.get(t) ?? 0) + 1);
      if (!seen.has(t)) {
        seen.add(t);
        df.set(t, (df.get(t) ?? 0) + 1);
      }
    }
    tf.push(m);
  }
  const k1 = 1.5;
  const b = 0.75;
  const raw = docs.map((_, di) => {
    let s = 0;
    const len = docToks[di].length;
    for (const term of q) {
      const f = tf[di].get(term);
      if (!f) continue;
      const idf = Math.log(1 + (n - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      s += idf * (f * (k1 + 1) / (f + k1 * (1 - b + b * len / avgdl)));
    }
    return s;
  });
  const maxRaw = Math.max(...raw);
  const hits = [];
  for (let di = 0; di < docs.length; di++) {
    if (raw[di] <= 0) continue;
    let w = 1;
    if (now !== null && docs[di].importance < 3 && !(raw[di] >= 0.85 * maxRaw)) {
      w = recencyWeight(now - docs[di].updated_at);
    }
    hits.push({
      id: docs[di].id,
      level: docs[di].level,
      title: docs[di].title,
      content: docs[di].content,
      importance: docs[di].importance,
      updated_at: docs[di].updated_at,
      score: raw[di] * w
    });
  }
  hits.sort((a, b2) => b2.score - a.score);
  return hits.slice(0, k);
}
export {
  recencyWeight,
  search,
  tokenize
};
