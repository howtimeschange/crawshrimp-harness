const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const srcRoot = path.join(__dirname, '..', '..')

test('preload and Electron main expose the full automation management bridge', () => {
  const preload = readFileSync(path.join(srcRoot, 'preload.js'), 'utf8')
  const main = readFileSync(path.join(srcRoot, 'main.js'), 'utf8')
  for (const name of [
    'listAutomations', 'createAutomation', 'getAutomation', 'updateAutomation',
    'archiveAutomation', 'pauseAutomation', 'resumeAutomation', 'runAutomationNow',
    'listAutomationRuns', 'testAutomationProgram',
  ]) {
    assert.match(preload, new RegExp(`${name}:`))
  }
  for (const channel of [
    'list-automations', 'create-automation', 'get-automation', 'update-automation',
    'archive-automation', 'pause-automation', 'resume-automation', 'run-automation-now',
    'list-automation-runs', 'automation-program-test',
  ]) {
    assert.match(main, new RegExp(`'${channel}'`))
  }
})

test('automation center tests a Program before allowing an enabled save', () => {
  const source = readFileSync(path.join(srcRoot, 'renderer', 'views', 'AutomationCenter.vue'), 'utf8')
  assert.match(source, /await window\.cs\.testAutomationProgram/)
  assert.match(source, /programTest\.value\.matched_branch/)
  assert.match(source, /请先测试 Program/)
  assert.match(source, /运行一次/)
  assert.match(source, /needs_review/)
  assert.doesNotMatch(source, /script_publish|自动发布脚本/)
})

test('task center mounts AutomationCenter as its 自动化 tab', () => {
  const source = readFileSync(path.join(srcRoot, 'renderer', 'views', 'TaskCenter.vue'), 'utf8')
  assert.match(source, /AutomationCenter/)
  assert.match(source, /id: 'automations', label: '自动化'/)
})
