import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('settings exposes optional personal account and no cloud machine controls', () => {
  const source = read('app/src/renderer/views/SettingsPage.vue')
  assert.match(source, /AccountPanel/)
  assert.match(source, /label: '个人账号'/)
  assert.doesNotMatch(source, /cloud_approval|loadCloudStatus|enrollCloudMachine|startCloudMachine/)
})

test('cloud approval is not exposed or probed by the app shell', () => {
  const appSource = read('app/src/renderer/App.vue')
  const frameSource = read('app/src/renderer/views/CloudApprovalFrame.vue')
  const slotsSource = read('integrations/deepseek-harness/crawshrimp-slots/lib/client.js')

  assert.doesNotMatch(appSource, /id: 'cloud_approval'/)
  assert.doesNotMatch(appSource, /CloudApprovalFrame/)
  assert.doesNotMatch(appSource, /getCloudApprovalStatus/)
  assert.match(appSource, /filteredNavItems/)
  assert.doesNotMatch(appSource, /cloudApprovalConfigured/)
  assert.doesNotMatch(appSource, /currentView(?:\.value)? === 'cloud_approval'/)
  assert.doesNotMatch(appSource, /currentView(?:\.value)? = 'cloud_approval'/)
  assert.doesNotMatch(slotsSource, /const BOTTOM_NAV_IDS = \['cloud_approval', 'settings'\]/)
  assert.doesNotMatch(slotsSource, /底部菜单:云端审批\/设置/)
  assert.doesNotMatch(appSource, /machine_token/)
  assert.doesNotMatch(frameSource, /machine_token|iframe|getCloudApprovalStatus/)
  assert.match(frameSource, /已弃用/)
})
