import test from 'node:test'
import assert from 'node:assert/strict'
import { setBrowserPreviewVisible } from './browserPreviewStreams.js'
test('hidden retained panel cannot stop the compact or replacement consumer; recovery only changes stream', async () => {
  const calls = [], bridge = { startAgentBrowserStream: async id => { calls.push(['start',id]); return {ok:true} }, stopAgentBrowserStream: async id => calls.push(['stop',id]) }
  const old = Symbol(), mini = Symbol()
  await setBrowserPreviewVisible('owned', old, true, false, bridge)
  const hide = setBrowserPreviewVisible('owned', old, false, false, bridge)
  const show = setBrowserPreviewVisible('owned', mini, true, false, bridge)
  await Promise.all([hide, show]); assert.deepEqual(calls, [['start','owned']])
  await setBrowserPreviewVisible('owned', old, false, false, bridge); assert.equal(calls.length, 1)
  await setBrowserPreviewVisible('owned', mini, true, true, bridge); assert.deepEqual(calls.slice(-2), [['stop','owned'],['start','owned']])
  await setBrowserPreviewVisible('owned', mini, false, false, bridge); assert.deepEqual(calls.at(-1), ['stop','owned'])
})
