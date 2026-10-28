import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { patchRuntimeDependencies } from '../../integrations/deepseek-harness/scripts/patch-runtime-dependencies.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const patchFile = path.join(repo, 'integrations/deepseek-harness/scripts/patch-runtime-dependencies.mjs')
const patchSource = fs.readFileSync(patchFile, 'utf8')
// Exercise the exact private lexer without exporting a product-only test API.
const constants = ['UPSTREAM_HARNESS_BRAND', 'CRAWSHRIMP_HARNESS_BRAND', 'GENERIC_HARNESS_LABEL']
  .map(name => patchSource.match(new RegExp(`^const ${name} = .*$`, 'm'))?.[0])
assert.ok(constants.every(Boolean))
const lexer = patchSource.slice(patchSource.indexOf('function replaceImUserVisibleText('), patchSource.indexOf('function patchDshImUserVisibleBrand('))
const scope = vm.createContext({})
vm.runInContext([...constants, lexer, 'globalThis.brand = replaceImUserVisibleCopy'].join('\n'), scope)
const brand = text => scope.brand(text)
const digest = text => crypto.createHash('sha256').update(text).digest('hex')
const runtime = process.env.HARNESS_BRAND_RUNTIME ?? path.join(repo, 'build-staging/deepseek-harness/darwin-arm64')
const imRelative = 'node_modules/@xmanrui/dsh-im/lib/index.js'
const realIM = path.join(runtime, imRelative)
const baselineIM = process.env.HARNESS_BRAND_BASELINE_IM
const mutable = process.env.HARNESS_BRAND_MUTABLE_RUNTIME
const evidence = process.env.HARNESS_BRAND_EVIDENCE

function inventory(root) {
  const rows = {}
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name), relative = path.relative(root, file), stat = fs.lstatSync(file)
      if (entry.isSymbolicLink()) rows[relative] = { type: 'link', target: fs.readlinkSync(file), mode: stat.mode & 0o777 }
      else if (entry.isDirectory()) { rows[relative] = { type: 'directory', mode: stat.mode & 0o777 }; walk(file) }
      else rows[relative] = { type: 'file', sha256: digest(fs.readFileSync(file)), bytes: stat.size, mode: stat.mode & 0o777 }
    }
  }
  walk(root)
  return rows
}
function changed(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(name => JSON.stringify(before[name]) !== JSON.stringify(after[name])).sort()
}

test('literal and escaped product prefixes remain branded exactly once, including hex case and mixed forms', () => {
  for (const source of [
    '"抓虾 Harness ready"', String.raw`"\u6293\u867E Harness ready"`,
    String.raw`"\u6293\u867e Harness ready"`, String.raw`"抓\u867E Harness ready"`,
    String.raw`"\u6293虾 Harness ready"`,
  ]) assert.equal(brand(source), source)
  for (const [source, expected] of [
    ['"Harness ready"', '"抓虾 Harness ready"'],
    ['"DeepSeek Harness ready"', '"抓虾 Harness ready"'],
    ['"DSH-IM / DSH Session / DSH 会话"', '"抓虾 Harness IM / 抓虾 Harness Session / 抓虾 Harness 会话"'],
  ]) { assert.equal(brand(source), expected); assert.equal(brand(expected), expected) }
})

test('comments, regexes, identifiers and template expressions remain intact while literal copy is branded', () => {
  const untouched = 'class HarnessClient {}; const Harness = 1; const x = obj.Harness; const r = /DeepSeek Harness|Harness\\b/gu; // DeepSeek Harness and Harness\n/* Harness; DeepSeek Harness */'
  assert.equal(brand(untouched), untouched)
  const source = 'const label = `Harness ${model.Harness} ${"DeepSeek Harness"} ${`Harness ${HarnessClient.name}`} tail DeepSeek Harness`; const q = "HarnessClient";'
  const expected = 'const label = `抓虾 Harness ${model.Harness} ${"DeepSeek Harness"} ${`Harness ${HarnessClient.name}`} tail 抓虾 Harness`; const q = "HarnessClient";'
  assert.equal(brand(source), expected)
  assert.equal(brand(expected), expected)
  const division = 'const n=8/2; const r=/["DeepSeek Harness]/; const s="DeepSeek Harness";'
  const divisionExpected = 'const n=8/2; const r=/["DeepSeek Harness]/; const s="抓虾 Harness";'
  assert.equal(brand(division), divisionExpected)
  assert.doesNotThrow(() => new vm.Script(brand(division)))
  assert.equal(brand('if (ok) /["Harness]/.test(value); const s="Harness";'), 'if (ok) /["Harness]/.test(value); const s="抓虾 Harness";')
  assert.equal(brand('const label=`Harness ${8/2} tail Harness`; const n=4/2;'), 'const label=`抓虾 Harness ${8/2} tail 抓虾 Harness`; const n=4/2;')
  for (const operand of ['8', '"x"', '/x/', '({x:1})', 'function(){}', 'class {}', 'i++', '(x=>x)', '(()=>{})']) {
    const program = 'let i=1; const n='+operand+'/2; const r=/["Harness]/; const s="Harness";'
    assert.equal(brand(program), program.replace('const s="Harness"', 'const s="抓虾 Harness"'))
    assert.doesNotThrow(() => new vm.Script(brand(program)))
  }
  for (const key of ['Harness', 'DeepSeek Harness']) {
    const lookup = 'const tr={"'+key+'":"ok"}; const result=`${tr["'+key+'"]}`;'
    assert.equal(vm.runInNewContext(brand(lookup)+';result'), 'ok')
    assert.equal(brand(brand(lookup)), brand(lookup))
    const templateLookup = 'const tr={"'+key+'":"ok"}; const result=`${tr[`'+key+'`]}`;'
    assert.equal(vm.runInNewContext(brand(templateLookup)+';result'), 'ok')
    assert.equal(brand(brand(templateLookup)), brand(templateLookup))
  }
})

test('the complete original 8 MB standard bundle converges without any duplicate escaped brand', { skip: !baselineIM }, () => {
  const original = fs.readFileSync(baselineIM, 'utf8')
  assert.ok(Buffer.byteLength(original) > 8_000_000)
  assert.equal(digest(original), 'fc469072707ab36947c871ea6cc26b757f9d7f411ebe9620f742d234164677c0')
  // The builder embedded two upstream labels after its former source pass.
  // Every other byte, including all 386 escaped-prefix occurrences, stays intact.
  const once = brand(original)
  assert.equal(once, original.replaceAll('DeepSeek Harness', '抓虾 Harness'))
  assert.equal(brand(once), once)
  assert.equal(once.includes(String.raw`\u6293\u867E 抓虾 Harness`), false)
})

test('the fresh repaired complete bundle is already byte-idempotent before any diagnostic reentry', { skip: !fs.existsSync(realIM) }, () => {
  const complete = fs.readFileSync(realIM)
  assert.ok(complete.length > 8_000_000)
  assert.deepEqual(Buffer.from(brand(complete.toString('utf8'))), complete)
  assert.equal(complete.includes(Buffer.from(String.raw`\u6293\u867E 抓虾 Harness`)), false)
})

test('two complete patch reentries preserve every runtime artifact; diagnostic report converges separately', { skip: !mutable }, () => {
  // The caller must explicitly authorize a disposable clone; never mutate the
  // standard runtime used by the byte-idempotence and SDK probes.
  assert.equal(process.env.HARNESS_BRAND_ALLOW_MUTATION, '1')
  assert.notEqual(fs.realpathSync(mutable), fs.realpathSync(runtime))
  assert.ok(evidence)
  fs.mkdirSync(evidence, { recursive: true })
  const snapshots = [inventory(mutable)]
  for (let pass = 1; pass <= 2; pass++) {
    const result = patchRuntimeDependencies(mutable)
    snapshots.push(inventory(mutable))
    fs.writeFileSync(path.join(evidence, `patch-${pass}-readback.json`), JSON.stringify(result, null, 2) + '\n')
  }
  const firstDiff = changed(snapshots[0], snapshots[1]), secondDiff = changed(snapshots[1], snapshots[2])
  fs.writeFileSync(path.join(evidence, 'reentry-diff.json'), JSON.stringify({ firstDiff, secondDiff, entries: snapshots.map(s => Object.keys(s).length) }, null, 2) + '\n')
  for (let i = 0; i < snapshots.length; i++) fs.writeFileSync(path.join(evidence, `inventory-${i}.json`), JSON.stringify(snapshots[i], null, 2) + '\n')
  assert.deepEqual(firstDiff, ['compat-report.json'])
  assert.deepEqual(secondDiff, [])
  for (const name of [imRelative, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js', 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/crawshrimp-managed-caller-trace.mjs', 'node_modules/@deepseek-ai/dsh-session-title-llm/lib/index.js']) {
    assert.deepEqual(snapshots[0][name], snapshots[1][name], name)
    assert.deepEqual(snapshots[1][name], snapshots[2][name], name)
  }
})
