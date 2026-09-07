<template>
  <div class="automation-center">
    <header class="ac-head">
      <div>
        <h2>智能体自动化</h2>
        <p>让智能体按时间或闭环条件执行；条件只选择分支，权限仍受此自动化的策略约束。</p>
      </div>
      <div class="ac-head-actions">
        <button v-if="editing" type="button" class="ac-secondary" @click="closeEditor">返回列表</button>
        <button v-else type="button" class="ac-primary" @click="startCreate">新建自动化</button>
        <button type="button" class="ac-secondary" :disabled="loading" @click="refresh">
          {{ loading ? '刷新中...' : '刷新' }}
        </button>
      </div>
    </header>

    <p v-if="notice" class="ac-notice">{{ notice }}</p>
    <p v-if="error" class="ac-notice error">{{ error }}</p>

    <section v-if="editing" class="ac-editor">
      <div class="ac-editor-title">
        <div>
          <h3>{{ editingUid ? '编辑自动化' : '新建自动化' }}</h3>
              <p>可先编辑草稿；含 Program 的自动化必须用代表性事实测试通过后才能保存或启用。</p>
        </div>
        <span :class="['ac-status', form.enabled ? 'active' : 'neutral']">{{ form.enabled ? '准备启用' : '草稿' }}</span>
      </div>

      <form class="ac-form" @submit.prevent="saveAutomation">
        <section class="ac-card ac-basics">
          <h4>目标与上下文</h4>
          <div class="ac-grid two">
            <label>
              <span>自动化名称</span>
              <input v-model.trim="form.title" required maxlength="120" placeholder="例如：库存风险闭环" />
            </label>
            <label>
              <span>运行方式</span>
              <select v-model="form.automation_kind" @change="onKindChange">
                <option value="loop">周期性闭环</option>
                <option value="scheduled">定时运行</option>
              </select>
            </label>
            <label class="wide">
              <span>智能体目标</span>
              <textarea v-model.trim="form.objective_prompt" rows="3" required placeholder="说明要观察什么、何时行动，以及如何验证结果" />
            </label>
            <label>
              <span>会话上下文</span>
              <select v-model="form.context_mode" :disabled="Boolean(editingUid)">
                <option value="isolated">隔离会话（推荐）</option>
                <option value="inherited">继承已有会话</option>
              </select>
            </label>
            <label v-if="form.context_mode === 'inherited'">
              <span>来源会话 ID</span>
              <input v-model.trim="form.source_session_id" required :readonly="Boolean(editingUid)" placeholder="已有智能体会话 ID" />
            </label>
          </div>
        </section>

        <section v-if="form.automation_kind === 'scheduled'" class="ac-card">
          <h4>时间触发</h4>
          <div class="ac-grid three">
            <label>
              <span>触发类型</span>
              <select v-model="form.schedule_kind">
                <option value="at">一次</option>
                <option value="every">固定间隔</option>
                <option value="cron">Cron</option>
              </select>
            </label>
            <label>
              <span>IANA 时区</span>
              <input v-model.trim="form.timezone" required placeholder="Asia/Shanghai" />
            </label>
            <label v-if="form.schedule_kind === 'at'">
              <span>执行时间</span>
              <input v-model="form.schedule_value" type="datetime-local" step="1" required />
            </label>
            <label v-else-if="form.schedule_kind === 'every'">
              <span>间隔（秒）</span>
              <input v-model.number="form.schedule_interval_seconds" type="number" min="1" required />
            </label>
            <label v-else>
              <span>五字段 Cron</span>
              <input v-model.trim="form.schedule_value" required placeholder="0 9 * * 1-5" />
            </label>
          </div>
          <p class="ac-help">后端离线期间错过的定时触发会记录为 missed，不会静默补跑。</p>
        </section>

        <section v-else class="ac-card">
          <h4>闭环节奏</h4>
          <div class="ac-grid three">
            <label>
              <span>循环间隔（秒）</span>
              <input v-model.number="form.cycle_interval_seconds" type="number" min="1" required />
            </label>
            <label>
              <span>最大循环次数（0 为不限）</span>
              <input v-model.number="form.max_cycles" type="number" min="0" required />
            </label>
            <label>
              <span>失败熔断阈值</span>
              <input v-model.number="form.failure_threshold" type="number" min="1" required />
            </label>
          </div>
          <p class="ac-help">每轮先观察，再由 Program 选择分支；没有匹配分支也会保存 checkpoint 并等待下一轮。</p>
        </section>

        <section class="ac-card">
          <div class="ac-section-head">
            <div>
              <h4>条件 Program</h4>
              <p>这是受限 JSON AST，不执行脚本、网络或浏览器操作；它只能依据 config、facts、checkpoint 选择分支。</p>
            </div>
            <button type="button" class="ac-secondary" @click="restoreProgramExample">还原示例</button>
          </div>
          <div class="ac-program-grid">
            <label>
              <span>Program JSON</span>
              <textarea v-model="form.program_text" rows="16" spellcheck="false" @input="invalidateProgramTest" />
            </label>
            <div class="ac-program-test">
              <label>
                <span>测试 facts JSON</span>
                <textarea v-model="form.facts_text" rows="6" spellcheck="false" @input="invalidateProgramTest" />
              </label>
              <label>
                <span>测试 checkpoint JSON</span>
                <textarea v-model="form.checkpoint_text" rows="6" spellcheck="false" @input="invalidateProgramTest" />
              </label>
              <button type="button" class="ac-primary" :disabled="testingProgram || !form.program_text.trim()" @click="testProgram">
                {{ testingProgram ? '测试中...' : '测试 Program' }}
              </button>
              <div v-if="programTest" class="ac-test-result success">
                <strong>Program 校验成功</strong>
                <span>匹配分支：{{ programTest.matched_branch || '无匹配分支' }}</span>
                <span>理由：{{ programTest.reason || '-' }}</span>
                <span>checkpoint patch：{{ compactJson(programTest.checkpoint_patch) }}</span>
              </div>
              <div v-else-if="programTestError" class="ac-test-result error">{{ programTestError }}</div>
              <div v-else class="ac-test-result">测试会显示真实的匹配分支和 checkpoint patch。</div>
            </div>
          </div>
        </section>

        <section class="ac-card">
          <h4>执行权限与限制</h4>
          <div class="ac-grid three">
            <label class="wide">
              <span>允许 MCP 工具（逗号分隔）</span>
              <input v-model="form.toolset_text" placeholder="automation_record_observation, automation_record_verification" />
            </label>
            <label class="wide">
              <span>无人值守允许风险（逗号分隔）</span>
              <input v-model="form.allowed_risks_text" placeholder="local_write, external_write（留空则需要人工复核）" />
            </label>
            <label>
              <span>超时（秒）</span>
              <input v-model.number="form.timeout_seconds" type="number" min="1" required />
            </label>
            <label>
              <span>最大重试</span>
              <input v-model.number="form.max_retries" type="number" min="0" required />
            </label>
            <label v-if="form.context_mode === 'inherited'">
              <span>继承会话最长等待（秒）</span>
              <input v-model.number="form.inherited_wait_seconds" type="number" min="1" required />
            </label>
          </div>
          <label class="ac-check">
            <input v-model="form.enabled" type="checkbox" />
            <span>启用此自动化</span>
          </label>
          <p v-if="hasProgram && !hasSuccessfulProgramTest" class="ac-policy-warning">请先测试 Program；已编辑的 Program 或测试输入会使原测试结果失效。</p>
          <p class="ac-help">填写实际 MCP 工具名，而不是“观察、验证”等抽象能力。例如闭环观察用 automation_record_observation，完成回执用 automation_record_verification。需要原本审批的操作，还必须填写具体风险类别：read_only、local_write、external_write 或 destructive；工具和风险必须同时匹配才会无人值守执行。策略与 Program 分支允许工具的交集之外，一律拒绝并转人工复核。继承会话会等待原会话空闲；超时会记录为“因并发跳过”，不会抢占用户对话。</p>
          <p v-if="editingUid" class="ac-policy-warning">会话上下文和来源会话在创建后不可修改；如需更换，请使用“复制为新 Automation”。</p>
        </section>

        <div class="ac-form-actions">
          <button type="button" class="ac-secondary" @click="closeEditor">取消</button>
          <button type="submit" class="ac-primary" :disabled="!canSave">
            {{ saving ? '保存中...' : (editingUid ? '保存自动化' : '创建自动化') }}
          </button>
        </div>
      </form>
    </section>

    <section v-else class="ac-list-shell">
      <div v-if="loading" class="ac-state">加载中...</div>
      <div v-else-if="!automations.length" class="ac-state empty">
        <strong>还没有智能体自动化</strong>
        <span>可以创建一次性的定时运行，也可以创建带条件 Program 的周期闭环。</span>
        <button type="button" class="ac-primary" @click="startCreate">新建自动化</button>
      </div>
      <template v-else>
        <div class="ac-table" role="table">
          <div class="ac-table-head" role="row">
            <span>自动化</span><span>触发</span><span>上下文 / 状态</span><span>Program / checkpoint</span><span>操作</span>
          </div>
          <article
            v-for="automation in automations"
            :key="automation.automation_uid"
            :class="['ac-row', { selected: selectedUid === automation.automation_uid }]"
            role="row"
            @click="selectAutomation(automation.automation_uid)"
          >
            <div class="ac-name">
              <strong>{{ automation.title || '未命名自动化' }}</strong>
              <span>{{ automation.objective_prompt || '未设置目标' }}</span>
            </div>
            <div>
              <b>{{ kindLabel(automation) }}</b>
              <span>{{ nextRunLabel(automation) }}</span>
            </div>
            <div>
              <span>{{ contextLabel(automation.context_mode) }}</span>
              <span :class="['ac-status', statusTone(automation.last_status)]">{{ statusLabel(automation.last_status, automation.enabled) }}</span>
            </div>
            <div>
              <span>v{{ shortId(automation.active_program_version_uid) || '-' }}</span>
              <span class="ac-clamp">{{ compactJson(automation.checkpoint) }}</span>
              <span v-if="automation.last_run_uid">最近 Run：{{ shortId(automation.last_run_uid) }}</span>
            </div>
            <div class="ac-actions" @click.stop>
              <button type="button" @click="runNow(automation)">运行一次</button>
              <button type="button" @click.stop="copyAutomation(automation)">复制为新 Automation</button>
              <button v-if="automation.enabled" type="button" @click="pause(automation)">暂停</button>
              <button v-else type="button" @click="resume(automation)">恢复</button>
              <button type="button" @click="editAutomation(automation)">编辑</button>
              <button type="button" class="danger" @click="archive(automation)">归档</button>
            </div>
          </article>
        </div>

        <section v-if="selectedAutomation" class="ac-run-panel">
          <div class="ac-section-head">
            <div>
              <h3>{{ selectedAutomation.title }} · 最近运行证据</h3>
              <p>只展示已持久化的事实、分支、验证和需要人工复核的原因。</p>
            </div>
            <button type="button" class="ac-secondary" :disabled="runsLoading" @click="loadRuns(selectedAutomation.automation_uid)">
              {{ runsLoading ? '读取中...' : '刷新运行记录' }}
            </button>
          </div>
          <div v-if="runsLoading" class="ac-inline-state">读取运行记录...</div>
          <div v-else-if="!runs.length" class="ac-inline-state">暂无运行记录</div>
          <article v-for="run in runs" :key="run.run_uid" class="ac-run-row">
            <div>
              <strong>{{ statusLabel(run.status) }}</strong>
              <span>{{ formatDateTime(run.started_at || run.trigger_at || run.created_at) }}</span>
            </div>
            <div>
              <span>分支：{{ run.matched_branch || '无匹配' }}</span>
              <span>Agent Run：{{ shortId(run.agent_run_id) || '-' }}</span>
            </div>
            <div class="ac-evidence">
              <span>facts：{{ compactJson(run.facts_summary) }}</span>
              <span>result：{{ compactJson(run.result_summary) }}</span>
              <span v-if="run.links?.length">资源：{{ run.links.map(link => `${link.link_kind}:${shortId(link.link_uid)}`).join(' · ') }}</span>
              <span v-if="run.status === 'needs_review'">needs_review：{{ run.error_code || 'REVIEW_REQUIRED' }} {{ run.error_message || '' }}</span>
              <span v-else-if="run.error_message">{{ run.error_code || 'ERROR' }} {{ run.error_message }}</span>
            </div>
          </article>
        </section>
      </template>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  createAutomationViewState,
  formFromAutomation,
  payloadFromAutomationForm,
} from '../utils/automationCenterState.mjs'

const automations = ref([])
const selectedAutomation = ref(null)
const selectedUid = ref('')
const runs = ref([])
const loading = ref(false)
const runsLoading = ref(false)
const saving = ref(false)
const testingProgram = ref(false)
const editing = ref(false)
const editingUid = ref('')
const notice = ref('')
const error = ref('')
const programTest = ref(null)
const programTestError = ref('')
const testedProgramFingerprint = ref('')
const programTestProof = ref('')
const initialExampleProgramText = JSON.stringify(exampleProgram(), null, 2)
let refreshTimer = null
const automationViewState = createAutomationViewState({
  getAutomation: (...args) => window.cs.getAutomation(...args),
  listAutomationRuns: (...args) => window.cs.listAutomationRuns(...args),
  listAutomations: (...args) => window.cs.listAutomations(...args),
  runAutomationNow: (...args) => window.cs.runAutomationNow(...args),
})

function syncAutomationViewState() {
  selectedUid.value = automationViewState.selectedUid
  selectedAutomation.value = automationViewState.selectedAutomation
  runs.value = automationViewState.runsForSelected
}

function exampleProgram() {
  return {
    config: { reorder_point: 20 },
    branches: [{
      id: 'inventory_below_reorder_point',
      priority: 10,
      when: { lt: [{ path: 'facts.inventory.available' }, { path: 'config.reorder_point' }] },
      allowed_tools: ['automation_record_verification'],
      objective: '读取库存风险并收集可验证的处理建议；若需要写入，先记录 needs_review。',
    }],
    checkpoint: { last_available: { path: 'facts.inventory.available' } },
  }
}

function defaultForm() {
  return {
    title: '',
    objective_prompt: '',
    automation_kind: 'loop',
    context_mode: 'isolated',
    source_session_id: '',
    timezone: 'Asia/Shanghai',
    schedule_kind: 'every',
    schedule_value: '',
    schedule_interval_seconds: 3600,
    cycle_interval_seconds: 1800,
    max_cycles: 0,
    failure_threshold: 3,
    toolset_text: 'automation_record_observation, automation_record_verification',
    allowed_risks_text: '',
    timeout_seconds: 300,
    max_retries: 1,
    inherited_wait_seconds: 300,
    enabled: false,
    program_text: JSON.stringify(exampleProgram(), null, 2),
    facts_text: JSON.stringify({ inventory: { available: 5 } }, null, 2),
    checkpoint_text: '{}',
  }
}

const form = ref(defaultForm())
const hasProgram = computed(() => Boolean(form.value.program_text.trim()))
const programFingerprint = computed(() => JSON.stringify({
  program: form.value.program_text,
  facts: form.value.facts_text,
  checkpoint: form.value.checkpoint_text,
}))
const hasSuccessfulProgramTest = computed(() => Boolean(
  programTest.value && testedProgramFingerprint.value === programFingerprint.value,
))
const canSave = computed(() => {
  if (saving.value || !form.value.title.trim() || !form.value.objective_prompt.trim()) return false
  if (form.value.automation_kind === 'loop' && !hasProgram.value) return false
  return !(hasProgram.value && !hasSuccessfulProgramTest.value)
})

function compactJson(value) {
  const source = value && typeof value === 'object' ? value : {}
  const text = JSON.stringify(source)
  return text === '{}' ? '-' : (text.length > 180 ? `${text.slice(0, 177)}…` : text)
}

function shortId(value) {
  const text = String(value || '').trim()
  return text ? text.slice(0, 10) : ''
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}

function kindLabel(automation) {
  if (automation?.automation_kind === 'loop') return '周期闭环'
  const kind = String(automation?.schedule?.kind || '')
  return { at: '一次定时', every: '固定间隔', cron: 'Cron' }[kind] || '定时运行'
}

function nextRunLabel(automation) {
  // Scheduled Automations expose the live APScheduler projection as next_run;
  // loops also persist their next-cycle cursor as next_run_at.  Prefer the
  // live projection so a resumed cron/at/every definition never renders a
  // misleading dash in the Automation Center.
  return `下一次：${formatDateTime(automation?.next_run || automation?.next_run_at)}`
}

function contextLabel(value) {
  return value === 'inherited' ? '继承会话' : '隔离会话'
}

function statusLabel(value, enabled) {
  const status = String(value || '').trim()
  const labels = {
    claimed: '已领取', queued: '排队中', running: '运行中', retry_scheduled: '等待重试',
    completed: '已完成', failed: '失败', skipped_overlap: '因并发跳过', canceled: '已取消',
    missed: '离线错过', needs_review: '需人工复核', paused_circuit_breaker: '熔断暂停',
  }
  if (!status) return enabled === false ? '已暂停' : '未运行'
  return labels[status] || status
}

function statusTone(status) {
  const value = String(status || '').trim()
  if (value === 'needs_review') return 'review'
  if (['failed', 'missed'].includes(value)) return 'error'
  if (['completed'].includes(value)) return 'done'
  if (['claimed', 'queued', 'running', 'retry_scheduled'].includes(value)) return 'active'
  return 'neutral'
}

function parseObject(text, label) {
  let parsed
  try {
    parsed = JSON.parse(String(text || '').trim() || '{}')
  } catch (err) {
    throw new Error(`${label} 不是有效 JSON：${err.message || err}`)
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(`${label} 必须是 JSON 对象`)
  return parsed
}

function splitToolset(text) {
  return [...new Set(String(text || '').split(',').map(item => item.trim()).filter(Boolean))]
}

function invalidateProgramTest() {
  programTest.value = null
  programTestError.value = ''
  testedProgramFingerprint.value = ''
  programTestProof.value = ''
}

function restoreProgramExample() {
  form.value.program_text = JSON.stringify(exampleProgram(), null, 2)
  form.value.facts_text = JSON.stringify({ inventory: { available: 5 } }, null, 2)
  form.value.checkpoint_text = '{}'
  invalidateProgramTest()
}

async function testProgram() {
  testingProgram.value = true
  programTest.value = null
  programTestError.value = ''
  try {
    const response = await window.cs.testAutomationProgram({
      program: parseObject(form.value.program_text, 'Program'),
      facts: parseObject(form.value.facts_text, 'facts'),
      checkpoint: parseObject(form.value.checkpoint_text, 'checkpoint'),
    })
    const result = response?.result || response?.data || response
    if (!result || typeof result !== 'object') throw new Error('Program 测试没有返回结果')
    if (!String(result.program_test_proof || '').trim()) throw new Error('Program 测试没有返回可用证明，请重新测试')
    programTest.value = result
    // Keep this explicit ref read so Program branch output stays visible in the
    // source and is never mistaken for permission to execute that branch.
    const matchedBranch = String(programTest.value.matched_branch || '')
    notice.value = matchedBranch ? `Program 测试成功，匹配分支：${matchedBranch}` : 'Program 测试成功，本次 facts 没有匹配分支'
    testedProgramFingerprint.value = programFingerprint.value
    programTestProof.value = String(result.program_test_proof)
  } catch (err) {
    programTestError.value = err?.message || String(err)
    testedProgramFingerprint.value = ''
  } finally {
    testingProgram.value = false
  }
}

function payloadFromForm() {
  const payload = payloadFromAutomationForm(form.value, { editing: Boolean(editingUid.value) })
  // Origin session bindings are assigned when an Automation is created and
  // remain immutable thereafter.  In particular, MCP-created isolated tasks
  // retain an origin session solely for their final receipt; serializing an
  // empty field on edit would accidentally request its removal.
  if (!editingUid.value && form.value.context_mode === 'inherited') {
    payload.source_session_id = form.value.source_session_id.trim()
  }
  if (hasProgram.value) {
    payload.program = parseObject(form.value.program_text, 'Program')
    payload.program_test_proof = programTestProof.value
  }
  else if (editingUid.value) payload.program = null
  return payload
}

async function saveAutomation() {
  error.value = ''
  notice.value = ''
  if (hasProgram.value && !hasSuccessfulProgramTest.value) {
    error.value = '请先测试 Program，再保存自动化。'
    return
  }
  saving.value = true
  try {
    const payload = payloadFromForm()
    const response = editingUid.value
      ? await window.cs.updateAutomation(editingUid.value, payload)
      : await window.cs.createAutomation(payload)
    const saved = response?.automation || response
    await loadAutomations()
    closeEditor()
    if (saved?.automation_uid) await selectAutomation(saved.automation_uid)
    notice.value = '自动化已保存。'
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    saving.value = false
  }
}

function startCreate() {
  form.value = defaultForm()
  editingUid.value = ''
  editing.value = true
  error.value = ''
  notice.value = ''
  invalidateProgramTest()
}

function closeEditor() {
  editing.value = false
  editingUid.value = ''
  error.value = ''
  invalidateProgramTest()
}

function onKindChange() {
  if (form.value.automation_kind === 'loop') {
    form.value.schedule_kind = 'every'
    if (!form.value.program_text.trim()) restoreProgramExample()
    return
  }
  // A freshly opened editor starts with the loop example so that the loop
  // path is immediately explorable. Switching it to a simple scheduled task
  // must not require users to discover and delete that untouched example.
  // Deliberately edited Program text remains available for scheduled Program
  // automations, which are still a supported use case.
  if (!editingUid.value && form.value.program_text === initialExampleProgramText) {
    form.value.program_text = ''
    invalidateProgramTest()
  }
}

async function editAutomation(automation) {
  error.value = ''
  notice.value = ''
  try {
    const response = await window.cs.getAutomation(automation.automation_uid)
    const item = response?.automation || response
    form.value = formFromAutomation(item, defaultForm())
    editingUid.value = item.automation_uid
    editing.value = true
    invalidateProgramTest()
  } catch (err) {
    error.value = err?.message || String(err)
  }
}

async function copyAutomation(automation) {
  error.value = ''
  notice.value = ''
  try {
    const response = await window.cs.getAutomation(automation.automation_uid)
    const item = response?.automation || response
    form.value = formFromAutomation(item, defaultForm(), { copy: true })
    form.value.title = `${form.value.title || '自动化'} 副本`
    editingUid.value = ''
    editing.value = true
    invalidateProgramTest()
  } catch (err) {
    error.value = err?.message || String(err)
  }
}

async function loadAutomations() {
  loading.value = true
  try {
    const response = await window.cs.listAutomations()
    automations.value = Array.isArray(response?.items) ? response.items : []
    if (selectedUid.value && !automations.value.some(item => item.automation_uid === selectedUid.value)) {
      automationViewState.clear()
      syncAutomationViewState()
    }
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

async function loadRuns(automationUid) {
  if (!automationUid) return
  const uid = String(automationUid)
  const selectedAtRequest = automationViewState.selectedUid === uid
  if (selectedAtRequest) runsLoading.value = true
  try {
    await automationViewState.loadRuns(uid)
    syncAutomationViewState()
  } catch (err) {
    if (automationViewState.selectedUid === uid) {
      error.value = err?.message || String(err)
    }
  } finally {
    if (automationViewState.selectedUid === uid) {
      runsLoading.value = false
    }
  }
}

async function selectAutomation(automationUid) {
  if (!automationUid) return
  const uid = String(automationUid)
  runsLoading.value = true
  const selecting = automationViewState.select(uid)
  syncAutomationViewState()
  try {
    await selecting
    syncAutomationViewState()
  } catch (err) {
    if (automationViewState.selectedUid === uid) {
      error.value = err?.message || String(err)
    }
  } finally {
    if (automationViewState.selectedUid === uid) runsLoading.value = false
  }
}

async function runNow(automation) {
  error.value = ''
  try {
    const requestUid = `desktop:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
    const response = await automationViewState.runNow(automation, requestUid)
    automations.value = Array.isArray(response?.items) ? response.items : []
    syncAutomationViewState()
    notice.value = '已请求运行一次；运行结果会在下方证据中更新。'
  } catch (err) {
    error.value = err?.message || String(err)
  }
}

async function pause(automation) {
  try {
    await window.cs.pauseAutomation(automation.automation_uid)
    await loadAutomations()
    notice.value = '自动化已暂停。'
  } catch (err) {
    error.value = err?.message || String(err)
  }
}

async function resume(automation) {
  try {
    await window.cs.resumeAutomation(automation.automation_uid)
    await loadAutomations()
    notice.value = '自动化已恢复。'
  } catch (err) {
    error.value = err?.message || String(err)
  }
}

async function archive(automation) {
  try {
    await window.cs.archiveAutomation(automation.automation_uid)
    await loadAutomations()
    if (selectedUid.value === automation.automation_uid) {
      automationViewState.clear()
      syncAutomationViewState()
    }
    notice.value = '自动化已归档；历史运行记录会保留。'
  } catch (err) {
    error.value = err?.message || String(err)
  }
}

async function refresh() {
  error.value = ''
  await loadAutomations()
  if (selectedUid.value) await selectAutomation(selectedUid.value)
}

onMounted(() => {
  void loadAutomations()
  refreshTimer = window.setInterval(() => {
    if (!editing.value && !loading.value) void refresh()
  }, 10000)
})

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
  refreshTimer = null
})
</script>

<style scoped>
.automation-center { min-height: 100%; color: var(--text); background: var(--bg); }
.ac-head, .ac-editor-title, .ac-section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.ac-head { padding: 20px 24px 16px; border-bottom: 1px solid var(--border); }
.ac-head h2, .ac-editor-title h3, .ac-section-head h3, .ac-card h4 { margin: 0; color: var(--text); }
.ac-head h2 { font-size: 18px; font-weight: 800; }
.ac-head p, .ac-editor-title p, .ac-section-head p, .ac-help { margin: 5px 0 0; color: var(--text3); font-size: 12px; line-height: 1.55; }
.ac-head-actions, .ac-actions, .ac-form-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.ac-primary, .ac-secondary, .ac-actions button { border: 1px solid var(--border); border-radius: 8px; background: var(--bg3); color: var(--text2); padding: 8px 12px; font-size: 12px; }
.ac-primary { border-color: rgba(var(--orange-rgb), .48); background: var(--orange); color: #fff; font-weight: 700; }
.ac-primary:disabled, .ac-secondary:disabled { cursor: not-allowed; opacity: .6; }
.ac-notice { margin: 0; padding: 9px 24px; border-bottom: 1px solid var(--border); background: var(--orange-bg); color: var(--orange-text); font-size: 12px; }
.ac-notice.error, .ac-test-result.error, .ac-policy-warning { color: var(--red); }
.ac-list-shell, .ac-editor { padding: 16px 24px 28px; }
.ac-state { min-height: 220px; display: grid; place-items: center; color: var(--text3); font-size: 13px; }
.ac-state.empty { align-content: center; gap: 10px; text-align: center; }
.ac-state.empty strong { color: var(--text); font-size: 15px; }
.ac-table { overflow: hidden; border: 1px solid var(--border); border-radius: 10px; background: var(--bg2); }
.ac-table-head, .ac-row { display: grid; grid-template-columns: minmax(190px, 1.35fr) minmax(135px, .78fr) minmax(135px, .78fr) minmax(180px, 1fr) auto; gap: 14px; align-items: center; }
.ac-table-head { padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--bg3); color: var(--text3); font-size: 11px; }
.ac-row { padding: 13px 14px; border-bottom: 1px solid var(--border); cursor: pointer; }
.ac-row:last-child { border-bottom: 0; }
.ac-row:hover, .ac-row.selected { background: color-mix(in srgb, var(--bg2) 90%, var(--orange) 10%); }
.ac-row > div:not(.ac-name), .ac-name { min-width: 0; display: flex; flex-direction: column; gap: 5px; color: var(--text3); font-size: 12px; }
.ac-name strong { color: var(--text); font-size: 13px; }
.ac-name span, .ac-clamp { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ac-row b { color: var(--text2); font-size: 12px; }
.ac-actions { justify-content: flex-end; }
.ac-actions button { padding: 6px 8px; }
.ac-actions .danger { color: var(--red); }
.ac-status { width: fit-content; border: 1px solid var(--border); border-radius: 999px; padding: 3px 8px; color: var(--text3); font-size: 11px; }
.ac-status.active { border-color: rgba(96, 165, 250, .35); color: var(--blue); }
.ac-status.done { border-color: rgba(74, 222, 128, .32); color: var(--green); }
.ac-status.review { border-color: rgba(251, 191, 36, .35); color: var(--yellow); }
.ac-status.error { border-color: rgba(248, 113, 113, .34); color: var(--red); }
.ac-run-panel { margin-top: 16px; padding: 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg2); }
.ac-run-panel h3 { font-size: 14px; }
.ac-inline-state { padding: 18px 0; color: var(--text3); font-size: 12px; }
.ac-run-row { display: grid; grid-template-columns: minmax(130px, .7fr) minmax(160px, .9fr) minmax(0, 2fr); gap: 12px; padding: 12px 0; border-top: 1px solid var(--border); color: var(--text3); font-size: 12px; }
.ac-run-row > div { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.ac-run-row strong { color: var(--text2); }
.ac-evidence span { overflow-wrap: anywhere; }
.ac-editor { max-width: 1180px; margin: 0 auto; }
.ac-editor-title { margin-bottom: 14px; }
.ac-editor-title h3 { font-size: 16px; }
.ac-form { display: grid; gap: 12px; }
.ac-card { padding: 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg2); }
.ac-card h4 { margin-bottom: 12px; font-size: 13px; }
.ac-grid { display: grid; gap: 12px; }
.ac-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.ac-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.ac-grid label, .ac-program-grid label, .ac-program-test label { min-width: 0; display: flex; flex-direction: column; gap: 6px; color: var(--text3); font-size: 12px; }
.ac-grid label.wide { grid-column: 1 / -1; }
.ac-grid input, .ac-grid select, .ac-grid textarea, .ac-program-grid textarea { box-sizing: border-box; width: 100%; border: 1px solid var(--border); border-radius: 8px; background: var(--bg3); color: var(--text); padding: 8px 10px; font: inherit; outline: none; }
.ac-grid textarea, .ac-program-grid textarea { resize: vertical; line-height: 1.5; }
.ac-program-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(280px, .8fr); gap: 14px; }
.ac-program-test { display: flex; flex-direction: column; gap: 10px; }
.ac-test-result { display: flex; flex-direction: column; gap: 4px; min-height: 54px; border: 1px solid var(--border); border-radius: 8px; padding: 9px; color: var(--text3); font-size: 12px; line-height: 1.5; }
.ac-test-result.success { border-color: rgba(74, 222, 128, .32); color: var(--green); }
.ac-check { display: inline-flex; align-items: center; gap: 7px; margin-top: 12px; color: var(--text2); font-size: 12px; }
.ac-policy-warning { margin: 8px 0 0; font-size: 12px; }
.ac-form-actions { justify-content: flex-end; }
@media (max-width: 980px) {
  .ac-head, .ac-editor-title { flex-direction: column; }
  .ac-table { overflow-x: auto; }
  .ac-table-head, .ac-row { min-width: 920px; }
  .ac-grid.three, .ac-program-grid { grid-template-columns: 1fr; }
}
@media (max-width: 680px) {
  .ac-head, .ac-list-shell, .ac-editor { padding-left: 14px; padding-right: 14px; }
  .ac-grid.two { grid-template-columns: 1fr; }
  .ac-run-row { grid-template-columns: 1fr; }
}
</style>
