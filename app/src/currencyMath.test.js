import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { patchCurrencyMathSource } from '../../integrations/deepseek-harness/scripts/currency-math.mjs'
test('BRL currency dollar never opens inline math; standard math and escapes remain supported', () => {
  const source = 'function fixture(e){return e!==36||this.events[this.events.length-1][1].type==="characterEscape"}'
  const patched = patchCurrencyMathSource(source)
  const previous = vm.runInNewContext(patched + ';fixture')
  const context = { events: [['exit', { type: 'data' }]] }
  assert.equal(previous.call(context, 82), false) // R$ 19,90 - R$ 199,90
  assert.equal(previous.call(context, 32), true) // $x^2$
  assert.equal(previous.call(context, null), true) // start of paragraph
  assert.equal(previous.call(context, 36), false)
  context.events[0][1].type = 'characterEscape'
  assert.equal(previous.call(context, 36), true)
  assert.equal(patchCurrencyMathSource(patched), patched)
  assert.throws(() => patchCurrencyMathSource('upstream changed'), /anchor changed/)
})
