import test from 'node:test'
import assert from 'node:assert/strict'
import { setBrowserPreviewVisible, subscribeBrowserPreview } from './browserPreviewStreams.js'
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

test('static handoff replays the same target frame and current metadata without restarting', async () => {
  const calls = [], listeners = { frame: new Set(), status: new Set() }
  const bridge = {
    startAgentBrowserStream: async id => { calls.push(['start', id]); return { ok: true } },
    stopAgentBrowserStream: async id => calls.push(['stop', id]),
    onAgentBrowserFrame: fn => { listeners.frame.add(fn); return () => listeners.frame.delete(fn) },
    onAgentBrowserStatus: fn => { listeners.status.add(fn); return () => listeners.status.delete(fn) },
  }
  const publish = (kind, payload) => { for (const fn of listeners[kind]) fn(payload) }
  const mini = Symbol(), full = Symbol(), seen = []
  const offMini = subscribeBrowserPreview('static', mini, {}, bridge)
  await setBrowserPreviewVisible('static', mini, true, false, bridge)
  publish('status', { targetId: 'static', state: 'connected', url: 'about:blank' })
  publish('frame', { targetId: 'static', dataUrl: 'jpeg', width: 800, height: 600, url: 'about:blank' })
  publish('status', { targetId: 'static', url: 'about:blank#route', metadataOnly: true })
  publish('frame', { targetId: 'other', dataUrl: 'wrong-target' })
  const offFull = subscribeBrowserPreview('static', full, { onFrame: frame => seen.push(frame), onStatus: status => seen.push(status) }, bridge)
  const show = setBrowserPreviewVisible('static', full, true, false, bridge)
  offMini(); await setBrowserPreviewVisible('static', mini, false, false, bridge); await show
  assert.deepEqual(calls, [['start', 'static']])
  assert.equal(seen[0].dataUrl, 'jpeg'); assert.equal(seen[0].url, 'about:blank#route')
  assert.equal(seen[1].state, 'connected'); assert.equal(seen[1].url, 'about:blank#route')
  offFull(); await setBrowserPreviewVisible('static', full, false, false, bridge)
  assert.equal(listeners.frame.size, 0); assert.equal(listeners.status.size, 0)
  const fresh = []
  const offFresh = subscribeBrowserPreview('static', full, { onFrame: frame => fresh.push(frame) }, bridge)
  assert.equal(fresh.length, 0, 'stopped streams cannot bootstrap with a stale frame')
  offFresh()
})

test('metadata keeps errors intact and a live frame clears the cached error for new consumers', async () => {
  let frameListener, statusListener
  const bridge = { startAgentBrowserStream: async () => ({ ok: true }), stopAgentBrowserStream: async () => {},
    onAgentBrowserFrame: fn => { frameListener = fn }, onAgentBrowserStatus: fn => { statusListener = fn } }
  const owner = Symbol(), next = Symbol(), seen = []
  const off = subscribeBrowserPreview('recovery', owner, {}, bridge)
  await setBrowserPreviewVisible('recovery', owner, true, false, bridge)
  statusListener({ targetId: 'recovery', state: 'error', message: 'temporary' })
  statusListener({ targetId: 'recovery', url: '#new', metadataOnly: true })
  const offNext = subscribeBrowserPreview('recovery', next, { onStatus: s => seen.push(s) }, bridge)
  assert.equal(seen.at(-1).state, 'error'); assert.equal(seen.at(-1).message, 'temporary')
  frameListener({ targetId: 'recovery', dataUrl: 'fresh', url: '#new' })
  await setBrowserPreviewVisible('recovery', next, true, false, bridge)
  assert.equal(seen.at(-1).state, 'connected'); assert.equal(seen.at(-1).message, undefined)
  off(); offNext()
  await setBrowserPreviewVisible('recovery', owner, false, false, bridge)
  await setBrowserPreviewVisible('recovery', next, false, false, bridge)
})

test('replacement consumers retain the same queue during an unconfirmed stream start', async () => {
  const old = Symbol(), replacement = Symbol(), calls = []
  let finish
  const bridge = { startAgentBrowserStream: id => { calls.push(['start', id]); return new Promise(resolve => { finish = resolve }) }, stopAgentBrowserStream: async id => calls.push(['stop', id]) }
  const offOld = subscribeBrowserPreview('pending', old, {}, bridge)
  const start = setBrowserPreviewVisible('pending', old, true, false, bridge)
  await new Promise(resolve => setImmediate(resolve))
  const hide = setBrowserPreviewVisible('pending', old, false, false, bridge); offOld()
  const offNew = subscribeBrowserPreview('pending', replacement, {}, bridge)
  const show = setBrowserPreviewVisible('pending', replacement, true, false, bridge)
  finish({ ok: true }); await Promise.all([start, hide, show])
  assert.deepEqual(calls, [['start', 'pending']])
  offNew(); await setBrowserPreviewVisible('pending', replacement, false, false, bridge)
})

test('a disconnected stream restarts when its mini preview hands off to a full panel', async () => {
  const calls = [], seen = []
  let status
  const bridge = {
    startAgentBrowserStream: async id => { calls.push(['start', id]); return { ok: true } },
    stopAgentBrowserStream: async id => calls.push(['stop', id]),
    onAgentBrowserStatus: fn => { status = fn },
  }
  const mini = Symbol(), full = Symbol()
  const offMini = subscribeBrowserPreview('disconnected', mini, {}, bridge)
  await setBrowserPreviewVisible('disconnected', mini, true, false, bridge)
  status({ targetId: 'other', state: 'disconnected' })
  await setBrowserPreviewVisible('disconnected', mini, true, false, bridge)
  assert.equal(calls.length, 1)
  status({ targetId: 'disconnected', state: 'disconnected' })
  const offFull = subscribeBrowserPreview('disconnected', full, { onStatus: value => seen.push(value) }, bridge)
  const show = setBrowserPreviewVisible('disconnected', full, true, false, bridge)
  const hide = setBrowserPreviewVisible('disconnected', mini, false, false, bridge)
  await Promise.all([show, hide])
  assert.deepEqual(calls, [['start', 'disconnected'], ['start', 'disconnected']])
  assert.equal(seen[0].state, 'disconnected')
  offMini(); offFull(); await setBrowserPreviewVisible('disconnected', full, false, false, bridge)
})

test('a late start reply cannot revive a connection that already disconnected', async () => {
  const calls = []
  let status, finish
  const bridge = {
    startAgentBrowserStream: id => { calls.push(['start', id]); return calls.length === 1 ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ ok: true }) },
    stopAgentBrowserStream: async id => calls.push(['stop', id]),
    onAgentBrowserStatus: fn => { status = fn },
  }
  const old = Symbol(), next = Symbol()
  const offOld = subscribeBrowserPreview('start-disconnect', old, {}, bridge)
  const start = setBrowserPreviewVisible('start-disconnect', old, true, false, bridge)
  await new Promise(resolve => setImmediate(resolve))
  status({ targetId: 'start-disconnect', state: 'disconnected' })
  const offNext = subscribeBrowserPreview('start-disconnect', next, {}, bridge)
  const show = setBrowserPreviewVisible('start-disconnect', next, true, false, bridge)
  finish({ ok: true }); const [initial] = await Promise.all([start, show])
  assert.equal(initial.ok, false, 'the disconnected start cannot claim a live connection')
  assert.equal(calls.length, 2)
  offOld(); offNext()
  await setBrowserPreviewVisible('start-disconnect', old, false, false, bridge)
  await setBrowserPreviewVisible('start-disconnect', next, false, false, bridge)
})
