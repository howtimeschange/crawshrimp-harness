'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createDesktopOnboarding } = require('./desktopOnboarding')

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-onboarding-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return path.join(directory, 'onboarding-v1.json')
}
test('upgraded signed-out installs migrate directly to completed, including after restart', t => {
  const file = fixture(t)
  assert.equal(createDesktopOnboarding({ file, existingInstallation: true }).required(), false)
  assert.equal(createDesktopOnboarding({ file }).required(), false)
})
test('a fresh install remains pending across restart even after startup creates legacy markers', t => {
  const file = fixture(t)
  assert.equal(createDesktopOnboarding({ file }).required(), true)
  const restarted = createDesktopOnboarding({ file, existingInstallation: true })
  assert.equal(restarted.required(), true)
  restarted.complete()
  assert.equal(createDesktopOnboarding({ file }).required(), false)
})
test('completion is durable for the desktop rather than tied to an account or renderer origin', t => {
  const file = fixture(t), state = createDesktopOnboarding({ file })
  state.complete(); state.complete()
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { version: 1, completed: true })
  assert.equal(createDesktopOnboarding({ file }).required(), false)
})
test('corrupt legacy state is migrated using actual installation evidence', t => {
  const file = fixture(t)
  fs.writeFileSync(file, 'corrupt')
  assert.equal(createDesktopOnboarding({ file, existingInstallation: true }).required(), false)
})
test('failed persistence does not claim completion and can be retried', t => {
  const file = fixture(t)
  let fail = false
  const state = createDesktopOnboarding({ file, write(target, value) {
    if (fail) throw new Error('disk full')
    fs.writeFileSync(target, JSON.stringify(value))
  } })
  fail = true
  assert.throws(() => state.complete(), /disk full/)
  assert.equal(state.required(), true)
  fail = false; state.complete()
  assert.equal(createDesktopOnboarding({ file }).required(), false)
})
