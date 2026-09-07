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
  assert.match(source, /program_test_proof/)
  assert.match(source, /测试没有返回可用证明/)
  assert.match(source, /运行一次/)
  assert.match(source, /needs_review/)
  assert.doesNotMatch(source, /script_publish|自动发布脚本/)
})

test('automation center prefers the live scheduler next_run projection', () => {
  const source = readFileSync(path.join(srcRoot, 'renderer', 'views', 'AutomationCenter.vue'), 'utf8')
  assert.match(source, /automation\?\.next_run \|\| automation\?\.next_run_at/)
})

test('automation center clears only the untouched loop example for a simple schedule and sends explicit Program removal', () => {
  const source = readFileSync(path.join(srcRoot, 'renderer', 'views', 'AutomationCenter.vue'), 'utf8')
  assert.match(source, /initialExampleProgramText/)
  assert.match(source, /!editingUid\.value && form\.value\.program_text === initialExampleProgramText/)
  assert.match(source, /else if \(editingUid\.value\) payload\.program = null/)
})

test('automation center explains and persists the bounded wait for inherited sessions', () => {
  const source = readFileSync(path.join(srcRoot, 'renderer', 'views', 'AutomationCenter.vue'), 'utf8')
  assert.match(source, /继承会话最长等待（秒）/)
  assert.match(source, /inherited_wait_seconds/)
  assert.match(source, /超时会记录为“因并发跳过”/)
})

test('automation center sends a source session only while creating an inherited automation', () => {
  const source = readFileSync(path.join(srcRoot, 'renderer', 'views', 'AutomationCenter.vue'), 'utf8')
  assert.match(source, /if \(!editingUid\.value && form\.value\.context_mode === 'inherited'\) \{\s*payload\.source_session_id = form\.value\.source_session_id\.trim\(\)/)
  assert.doesNotMatch(source, /source_session_id:\s*form\.value\.context_mode/)
})

test('automation center requires a source session before creating an inherited automation', () => {
  const source = readFileSync(path.join(srcRoot, 'renderer', 'views', 'AutomationCenter.vue'), 'utf8')
  assert.match(source, /v-model\.trim="form\.source_session_id"[^>]*\srequired/)
})

test('automation center exposes explicit unattended risk approval alongside its MCP tool allowlist', () => {
  const source = readFileSync(path.join(srcRoot, 'renderer', 'views', 'AutomationCenter.vue'), 'utf8')
  const state = readFileSync(path.join(srcRoot, 'renderer', 'utils', 'automationCenterState.mjs'), 'utf8')
  assert.match(source, /allowed_risks_text/)
  assert.match(state, /allowed_risks:\s*splitToolset\(form\.allowed_risks_text\)/)
  assert.match(source, /无人值守允许风险/)
})

test('task center mounts AutomationCenter as its 自动化 tab', () => {
  const source = readFileSync(path.join(srcRoot, 'renderer', 'views', 'TaskCenter.vue'), 'utf8')
  assert.match(source, /AutomationCenter/)
  assert.match(source, /id: 'automations', label: '自动化'/)
})

test('Automation Center sends ordinary creation to the Agent conversation', () => {
  const automationCenter = readFileSync(path.join(srcRoot, 'renderer', 'views', 'AutomationCenter.vue'), 'utf8')
  const taskCenter = readFileSync(path.join(srcRoot, 'renderer', 'views', 'TaskCenter.vue'), 'utf8')
  const app = readFileSync(path.join(srcRoot, 'renderer', 'App.vue'), 'utf8')

  assert.match(automationCenter, /从智能体对话创建/)
  assert.match(automationCenter, /emit\('open-agent'\)/)
  assert.match(taskCenter, /@open-agent="emit\('open-agent'\)"/)
  assert.match(app, /@open-agent="openAgentFromAutomation"/)
  assert.match(app, /function openAgentFromAutomation\(\)/)
})
