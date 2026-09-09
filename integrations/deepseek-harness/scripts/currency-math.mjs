import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export const CURRENCY_MATH_MARKER = 'crawshrimp-brl-math-v1'
export function patchCurrencyMathSource(source) {
  if (source.includes(CURRENCY_MATH_MARKER)) return source
  const anchor = /function ([\w$]+)\(e\)\{return e!==36\|\|this\.events\[this\.events\.length-1\]\[1\]\.type==="characterEscape"\}/g
  const matches = [...source.matchAll(anchor)]
  if (matches.length !== 1) throw new Error('Inline math previous-character anchor changed')
  return source.replace(anchor, (_, name) => `function ${name}(e){/* ${CURRENCY_MATH_MARKER} */return e!==82&&(e!==36||this.events[this.events.length-1][1].type==="characterEscape")}`)
}
export function patchCurrencyMath(root) {
  const assets = join(root, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
  const candidates = readdirSync(assets).filter(name => /^vendor-.*\.js$/.test(name))
    .filter(name => readFileSync(join(assets, name), 'utf8').includes('singleDollarTextMath'))
  if (candidates.length !== 1) throw new Error('Expected one DSH math vendor bundle')
  const entry = join(assets, candidates[0])
  const before = readFileSync(entry, 'utf8')
  const after = patchCurrencyMathSource(before)
  if (after !== before) writeFileSync(entry, after)
  return { entry, marker: CURRENCY_MATH_MARKER }
}
