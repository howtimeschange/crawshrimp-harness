// Adapted from Phant0Meow/dsh-meow-memory src/bm25.ts,
// commit 033df8589467bbe17a2c40dc864283b960795ec5 (MIT).
// See ../MEOW-MEMORY-LICENSE. Retains tokenizer and BM25 only.
/**
 * meow-memory v2 — 检索层。
 *
 * 分词（类别路由 v0.20.0，语言无关）：CJK（汉字+假名）连续段相邻 bigram + Unicode
 * 字母/数字（\p{L}\p{N}）整词；NFKC 归一化；标点/符号/emoji 丢弃。
 * en 语言包贡献（PR #6）：en 模式下对产出 tokens 追加英语归一化（停用词过滤 +
 * Porter 词干还原，见下方 EN 段）；其他语言维持基线（stemming 扩展点见 prompts/README.md）。
 * 打分：标准 BM25 × 艾宾浩斯近期权重；importance≥3 或超级匹配（≥0.85×本轮
 *       最高原始分）时豁免衰减。
 * 偏离信号：turn 文本向量 vs 各 topic 质心（title+goal+content+keywords 词频
 *       向量）的余弦相似度；top1 相似度过低 → "疑似新话题"提示。topic 数 < 3
 *       （冷启动）不提示。信号只提醒不拍板，归属判定由模型用目标句测试完成。
 */



export interface Doc {
  id: string
  level: string
  title: string | null
  content: string
  keywords: string[]
  importance: number
  created_at: number
  /** 记忆时间戳 = 最后更新时间（艾宾浩斯按它算年龄）。 */
  updated_at: number
}

// CJK 类：汉字（\p{Script=Han} 覆盖基本区+Ext A~I）+ 假名 + 日文词内符号（々 叠字 / ー
// 长音符——script=Common，但必须随 CJK run，"人々/タワー"才能整体成词）
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3005\u30fc]/u
// 字母/数字类：é ü ñ、西里尔、希腊、谚文、全角英数（NFKC 后）……一切语言的字母数字
const WORD = /[\p{L}\p{N}]/u

type CharClass = 'cjk' | 'word' | 'skip'

/** 单字符分类：CJK → bigram 路径；字母/数字 → 整词路径；其余（标点/符号/emoji）→ 丢弃。 */
function classify(cp: string): CharClass {
  if (CJK.test(cp)) return 'cjk'
  if (WORD.test(cp)) return 'word'
  return 'skip'
}

/** 切词（类别路由，v0.20.0，语言无关——promptLang 不再影响分词；唯一例外：en 语言包
 *  贡献的英语归一化（停用词+Porter）在产出后追加，见 normalizeEn）：
 * - CJK 类（汉字+假名）：连续段相邻 bigram——中文稳定零依赖，日文 n-gram 基线；
 *   run<2 单字不成词丢弃防噪音；汉字-假名交界不断 run，"行く/食べる"自然成词；
 * - 字母/数字类（\p{L}\p{N}）：连续段整词 + 小写化（café/привет/한국어/全角英数…）；
 * - 其余（标点/空白/符号/emoji）：跳过——信息量为零，不污染 IDF。
 * 文本先 NFKC 归一化（全角ＢＭ２５→bm25、半角片假名→全角）；Array.from 按 code point
 * 迭代，emoji/Ext B 汉字等 surrogate pair 不切半。其他语言的词形归一化/stemming 仍是
 * 语言包贡献者的扩展点（见 prompts/README.md）；打分本体（BM25/艾宾浩斯/余弦）语言无关。 */
export function tokenize(text: string): string[] {
  // 主语言码（'en-US' → 'en'）：只用于 en 归一化钩子，分词主干仍语言无关
  const cps = Array.from(text.normalize('NFKC'))
  const out: string[] = []
  let i = 0
  while (i < cps.length) {
    const cls = classify(cps[i])
    if (cls === 'skip') {
      i++
      continue
    }
    let j = i + 1
    while (j < cps.length && classify(cps[j]) === cls) j++
    const run = cps.slice(i, j)
    if (cls === 'cjk') {
      // 连续 CJK → 相邻 bigram（单字不成词，避免噪音）
      if (run.length >= 2) {
        for (let k = 0; k + 1 < run.length; k++) out.push(run[k] + run[k + 1])
      }
    } else {
      out.push(run.join('').toLowerCase())
    }
    i = j
  }
  return out
}

function docText(d: Doc): string {
  return [d.title ?? '', d.content, ...d.keywords].join(' ')
}

/** 艾宾浩斯复习间隔分桶（年龄天数 → 权重）。 */
export function recencyWeight(ageMs: number): number {
  const days = ageMs / 86_400_000
  if (days < 1) return 1.0
  if (days < 2) return 0.9
  if (days < 4) return 0.8
  if (days < 7) return 0.65
  if (days < 15) return 0.5
  if (days < 30) return 0.35
  if (days < 60) return 0.25
  if (days < 180) return 0.15
  return 0.08
}

export interface RankedHit {
  id: string
  level: string
  title: string | null
  content: string
  importance: number
  updated_at: number
  score: number
}

export interface SearchOptions {
  k?: number
  /** 相对当前时间；null 表示不衰减（测试/手动检索可关）。 */
  now?: number | null
}

/**
 * BM25 × 近期权重检索。docs 中 importance≥3 或原始分 ≥0.85×本轮最高分的
 * 条目豁免衰减。返回按最终分降序。
 */
export function search(query: string, docs: Doc[], opts: SearchOptions = {}): RankedHit[] {
  const k = opts.k ?? 5
  const now = opts.now === undefined ? Date.now() : opts.now
  const q = tokenize(query)
  if (q.length === 0 || docs.length === 0) return []

  const n = docs.length
  const docToks = docs.map((d) => tokenize(docText(d)))
  const avgdl = docToks.reduce((s, t) => s + t.length, 0) / n || 1

  const df = new Map<string, number>()
  const tf: Array<Map<string, number>> = []
  for (const toks of docToks) {
    const m = new Map<string, number>()
    const seen = new Set<string>()
    for (const t of toks) {
      m.set(t, (m.get(t) ?? 0) + 1)
      if (!seen.has(t)) {
        seen.add(t)
        df.set(t, (df.get(t) ?? 0) + 1)
      }
    }
    tf.push(m)
  }

  const k1 = 1.5
  const b = 0.75
  const raw: number[] = docs.map((_, di) => {
    let s = 0
    const len = docToks[di].length
    for (const term of q) {
      const f = tf[di].get(term)
      if (!f) continue
      const idf = Math.log(1 + (n - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5))
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / avgdl)))
    }
    return s
  })

  const maxRaw = Math.max(...raw)
  const hits: RankedHit[] = []
  for (let di = 0; di < docs.length; di++) {
    if (raw[di] <= 0) continue
    let w = 1
    if (now !== null && docs[di].importance < 3 && !(raw[di] >= 0.85 * maxRaw)) {
      w = recencyWeight(now - docs[di].updated_at) // 艾宾浩斯按记忆时间戳（最后更新时间）
    }
    hits.push({
      id: docs[di].id,
      level: docs[di].level,
      title: docs[di].title,
      content: docs[di].content,
      importance: docs[di].importance,
      updated_at: docs[di].updated_at,
      score: raw[di] * w,
    })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, k)
}
