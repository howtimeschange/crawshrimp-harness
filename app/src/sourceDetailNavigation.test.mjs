import test from 'node:test'
import assert from 'node:assert/strict'
import { createSourceDetailNavigation } from './renderer/utils/sourceDetailNavigation.mjs'

function fixture() {
  const context = { alive: true, epoch: 1, ownerID: 'owner-a', roomID: 'room-a', policyID: 'policy-a' }
  const events = [], ticks = []
  const element = name => ({ isConnected: true, disabled: false, focus: options => events.push([name, 'focus', options]), scrollIntoView: options => events.push([name, 'scroll', options]) })
  const heading = element('detail'), trigger = element('trigger'), history = element('history')
  const navigation = createSourceDetailNavigation({ context: () => ({ ...context }), nextTick: () => new Promise(resolve => ticks.push(resolve)), heading: () => heading, fallback: () => history })
  return { context, events, heading, trigger, history, navigation, tick: () => ticks.splice(0).forEach(resolve => resolve()) }
}

test('detail reveal waits for DOM and immediately focuses/scrolls the current title', async () => {
  const f = fixture(), request = f.navigation.begin(f.trigger), ready = f.navigation.reveal(request)
  assert.deepEqual(f.events, [])
  f.tick(); await ready
  assert.deepEqual(f.events, [['detail', 'focus', { preventScroll: true }], ['detail', 'scroll', { behavior: 'instant', block: 'start', inline: 'nearest' }]])
})

for (const [name, change] of Object.entries({
  account: c => c.epoch++, owner: c => { c.ownerID = 'owner-b' }, room: c => { c.roomID = 'room-b' },
  policy: c => { c.policyID = 'policy-b' }, unmount: c => { c.alive = false },
})) test(`${name} change fences a response and queued title focus`, async () => {
  const f = fixture(), request = f.navigation.begin(f.trigger), ready = f.navigation.reveal(request)
  change(f.context); assert.equal(f.navigation.isCurrent(request), false)
  f.tick(); await ready; assert.deepEqual(f.events, [])
})

test('close fences late responses before waiting and returns to the exact trigger', async () => {
  const f = fixture(), request = f.navigation.begin(f.trigger), closing = f.navigation.restore()
  assert.equal(f.navigation.isCurrent(request), false)
  f.tick(); await closing
  assert.deepEqual(f.events.map(e => e.slice(0, 2)), [['trigger', 'focus'], ['trigger', 'scroll']])
  assert.equal(f.events[1][2].block, 'nearest')
})

test('new read/close while title reveal is queued never focuses the previous detail', async () => {
  const f = fixture(), previous = f.navigation.begin(f.trigger), ready = f.navigation.reveal(previous)
  f.navigation.begin(f.trigger)
  f.tick(); await ready; assert.deepEqual(f.events, [])
})

test('room/account invalidation while close is queued never steals focus back', async () => {
  const f = fixture(); f.navigation.begin(f.trigger)
  const closing = f.navigation.restore()
  f.context.epoch++; f.navigation.invalidate()
  f.tick(); await closing; assert.deepEqual(f.events, [])
})

test('a newer read supersedes queued close restoration', async () => {
  const f = fixture(); f.navigation.begin(f.trigger)
  const closing = f.navigation.restore()
  const current = f.navigation.begin(f.trigger)
  f.tick(); await closing
  assert.equal(f.navigation.isCurrent(current), true); assert.deepEqual(f.events, [])
})

for (const state of ['disabled', 'detached']) test(`${state} trigger falls back to a connected history title`, async () => {
  const f = fixture(); if (state === 'disabled') f.trigger.disabled = true; else f.trigger.isConnected = false
  f.navigation.begin(f.trigger); const closing = f.navigation.restore()
  f.tick(); await closing
  assert.deepEqual(f.events.map(e => e[0]), ['history', 'history'])
})

test('detached detail and history anchors receive no focus or scroll', async () => {
  const f = fixture(); f.heading.isConnected = false; f.trigger.isConnected = false; f.history.isConnected = false
  const ready = f.navigation.reveal(f.navigation.begin(f.trigger)); f.tick(); await ready
  const closing = f.navigation.restore(); f.tick(); await closing
  assert.deepEqual(f.events, [])
})
