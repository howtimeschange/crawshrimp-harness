import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const rendererRoot = resolve(here, '..')
const appSource = readFileSync(resolve(rendererRoot, 'App.vue'), 'utf8')
const agentHomeSource = readFileSync(resolve(rendererRoot, 'views/AgentHome.vue'), 'utf8')

test('script installation has no Script Review navigation or view', () => {
  assert.doesNotMatch(appSource, /agent_script_review/)
  assert.doesNotMatch(appSource, /AgentScriptReview/)
})

test('script installation is confirmed in the agent conversation and names My Scripts', () => {
  assert.match(agentHomeSource, /确认安装/)
  assert.match(agentHomeSource, /直接安装到「我的脚本」/)
  assert.match(agentHomeSource, /approvalApproveLabel/)
})
