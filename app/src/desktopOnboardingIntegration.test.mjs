import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createDesktopOnboarding } = require('./desktopOnboarding')
const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8')
function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-main-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
function handler(onboarding, state) {
  const context = { desktopOnboarding: onboarding, desktopAccountAuth: () => ({ run: async () => state }), secureHandle: (_, callback) => { context.run = callback } }
  const start = source.indexOf("secureHandle('account:action'")
  vm.runInNewContext(source.slice(start, source.indexOf('\nconst marketplace', start)), context)
  return context.run
}
test('main captures upgrade evidence before startup writes its first config, and preserves a pending restart', async t => {
  for (const legacy of [true, false]) {
    const root = directory(t), config = path.join(root, 'desktop-config.json')
    if (legacy) fs.writeFileSync(config, '{}')
    const context = {
      fs, path, require, app: { getPath: () => root }, process: { env: {}, platform: process.platform },
      resolvedCrawshrimpDataDir: '', dataDirectoryReady: null, desktopOnboarding: null,
      getDesktopConfigPath: () => config, resolveCrawshrimpDataDir: () => root,
      hasLegacyRuntimeData: () => false, collectCrawshrimpDataDirCandidates: () => [root],
      getWindowsLocalCrawshrimpDataDir: () => root, getMacLocalCrawshrimpDataDir: () => root,
      prepareDesktopDataDirectoryAsync: async () => {
        assert.equal(context.desktopOnboarding.required(), !legacy)
        return { root, token: 'test-only', errors: [] }
      },
      writeDesktopConfig: () => fs.writeFileSync(config, '{}'), sameRuntimePath: () => true,
      dataDirRecoveryInfo: {},
    }
    const start = source.indexOf('function initializeDataDirectory(')
    vm.runInNewContext(source.slice(start, source.indexOf('\nfunction getCrawshrimpDataDir', start)), context)
    await context.initializeDataDirectory()
    assert.equal(createDesktopOnboarding({ file: path.join(root, 'onboarding-v1.json'), existingInstallation: true }).required(), !legacy)
  }
})
test('account IPC returns installation eligibility and persists a completed first run', async t => {
  const file = path.join(directory(t), 'onboarding-v1.json'), onboarding = createDesktopOnboarding({ file })
  const run = handler(onboarding, { user: { id: 'first-owner' }, models: [{ kind: 'text' }] })
  assert.equal((await run({}, 'status')).onboardingRequired, true)
  assert.equal((await run({}, 'finish-onboarding')).onboardingRequired, false)
  assert.equal(createDesktopOnboarding({ file }).required(), false)
  assert.equal((await handler(onboarding, { user: { id: 'another-owner' }, models: [] })({}, 'status')).onboardingRequired, false)
})
test('account IPC rejects completion before a usable account is connected', async t => {
  const onboarding = createDesktopOnboarding({ file: path.join(directory(t), 'onboarding-v1.json') })
  for (const state of [{ user: null, models: [] }, { user: { id: 'a' }, models: [{ kind: 'image' }] }]) {
    await assert.rejects(handler(onboarding, state)({}, 'finish-onboarding'), /请先完成账号连接/)
    assert.equal(onboarding.required(), true)
  }
})
