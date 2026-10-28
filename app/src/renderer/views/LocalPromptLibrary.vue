<template>
  <div class="local-prompt-library">
    <header class="lpl-head">
      <div>
        <h2>提示词库</h2>
        <p>整理常用提示词，编辑完整正文，按需设置匹配规则。</p>
      </div>
      <div class="lpl-head-actions">
        <template v-if="isListView">
          <button type="button" class="lpl-primary" :disabled="busy" @click="createLibrary">新建库</button>
        </template>
        <template v-else>
          <button type="button" class="lpl-secondary" :disabled="busy" @click="backToLibraryList">返回列表</button>
          <button type="button" class="lpl-secondary" :disabled="busy || !selectedLocalLibrary" @click="chooseWorkbookForImport">
            {{ importing ? '导入中...' : '导入更新' }}
          </button>
          <button type="button" class="lpl-primary" :disabled="busy || !selectedLocalLibrary" @click="saveLocalEdits">保存编辑</button>

        </template>
      </div>
    </header>

    <p v-if="!isListView && isDirty" class="lpl-notice warning" role="status">有未保存的更改。保存后可在其他任务中使用。</p>
    <p v-if="message && !isDirty" class="lpl-notice" role="status">{{ message }}</p>
    <p v-if="error" class="lpl-notice error">{{ error }}</p>
    <p v-if="cloudError" class="lpl-notice warning">{{ cloudError }}</p>

    <section v-if="isListView" class="lpl-library-list">
      <div class="lpl-library-list-head">
        <div>
          <h3>提示词库列表</h3>
          <p>{{ localLibraries.length }} 个本地库</p>
        </div>
      </div>
      <div class="lpl-library-table">
        <div class="lpl-library-header" role="row">
          <span>提示词库名称</span>
          <span>当前 Prompt 数量</span>
          <span>创建时间</span>
          <span>来源</span>
          <span>操作</span>
        </div>
        <div class="lpl-library-body">
          <div v-for="library in libraryRows" :key="library.library_uid" class="lpl-library-row">
            <div class="lpl-library-name">
              <strong>{{ library.name }}</strong>
              <span>{{ library.scenario }} · {{ statusLabel(library.status) }}</span>
            </div>
            <div>{{ templateCount(library) }} 条</div>
            <div>{{ formatDateTime(library.created_at || library.updated_at) }}</div>
            <div><span class="lpl-source-badge">{{ librarySourceLabel(library.source_type) }}</span></div>
            <div class="lpl-library-actions">
              <button type="button" class="lpl-secondary" @click="enterLibraryDetail(library)">进入编辑</button>
            </div>
          </div>
        </div>
      </div>
      <div v-if="!libraries.length" class="lpl-empty inline">
        <strong>暂无提示词库</strong>
        <p>点击右上角“新建库”，保存第一条常用提示词。</p>
      </div>
    </section>

    <section v-else-if="!selectedLibrary" class="lpl-empty">
      <strong>未选择提示词库</strong>
      <button type="button" class="lpl-secondary" :disabled="busy" @click="backToLibraryList">返回列表</button>
    </section>

    <section v-else class="lpl-detail">
      <section class="lpl-toolbar">
        <label class="wide">
          <span>库名称</span>
          <input v-model="libraryDraft.name" :disabled="busy || !selectedLocalLibrary" />
        </label>
        <label>
          <span>场景</span>
          <select v-model="libraryDraft.scenario" :disabled="busy || !selectedLocalLibrary">
            <option v-for="scenario in scenarioOptions" :key="scenario">{{ scenario }}</option>
          </select>
        </label>
        <label>
          <span>搜索</span>
          <input v-model.trim="keyword" type="search" placeholder="名称 / Prompt" />
        </label>
      </section>

      <section class="lpl-workspace lpl-master-detail">
        <aside class="lpl-entry-list" aria-label="提示词列表">
          <label><span>筛选分组</span><select v-model="groupFilter"><option value="all">全部 · {{ templates.length }} 条</option><option v-for="group in groupSummaries" :key="group.name" :value="group.name">{{ group.name }} · {{ group.total }} 条</option></select></label>
          <button v-for="(entry,index) in displayTemplates" :key="templateKey(entry,index)" class="lpl-entry" :class="{ active: selectedTemplate === entry }" :aria-pressed="selectedTemplate === entry" @click="selectedTemplateId = entry.local_uid || templateKey(entry, templates.indexOf(entry))"><strong>{{ entry.field_name || '未命名提示词' }}</strong><small>{{ entry.group_name || '未分组' }} · {{ entry.enabled ? '启用' : '停用' }}</small><p>{{ entry.prompt_text || '还没有正文' }}</p></button>
          <p v-if="!displayTemplates.length" class="lpl-no-match">没有匹配的提示词，换个关键词或分组试试。</p>
        </aside>
        <main class="lpl-editor-panel">
          <header class="lpl-table-head"><h3>提示词详情</h3><button v-if="selectedCloudLibrary" class="lpl-secondary" @click="copyCloudLibraryToLocal">保存为本地副本</button><button v-else class="lpl-secondary" :disabled="busy" @click="addPromptRow">新建提示词</button></header>
          <template v-if="selectedTemplate">
            <label class="lpl-editor-field"><span>标题 / 字段名</span><input v-model="selectedTemplate.field_name" :disabled="busy || !selectedLocalLibrary" /></label>
            <label class="lpl-editor-field"><span>提示词正文</span><textarea v-model="selectedTemplate.prompt_text" :disabled="busy || !selectedLocalLibrary" placeholder="写下画面要求与需要保留的细节…" /></label>
            <details class="lpl-editor-rules"><summary>匹配规则与排序</summary><div class="lpl-rule-fields"><label>分组<input v-model="selectedTemplate.group_name" :disabled="busy || !selectedLocalLibrary" /></label><label>女优先<input v-model.number="selectedTemplate.female_priority" type="number" :disabled="busy || !selectedLocalLibrary" /></label><label>男 / 中优先<input v-model.number="selectedTemplate.male_neutral_priority" type="number" :disabled="busy || !selectedLocalLibrary" /></label><label class="lpl-enabled"><input v-model="selectedTemplate.enabled" type="checkbox" :disabled="busy || !selectedLocalLibrary" />启用此提示词</label></div><p>自定义字段与款号表中的同名字段对应，填写的字段须同时匹配。</p><div class="lpl-rule-fields"><label v-for="name in PROMPT_CUSTOM_FIELDS" :key="name">{{ name }}<input v-model="selectedTemplate.custom_fields[name]" :disabled="busy || !selectedLocalLibrary" /></label></div></details>
            <div class="lpl-editor-footer"><span>编辑保留在当前草稿，点击“保存编辑”后生效。</span><details><summary>更多操作</summary><button class="lpl-icon danger" :disabled="busy || !selectedLocalLibrary" @click="requestPromptRemoval(selectedTemplate)">删除当前提示词</button></details></div>
          </template>
          <div v-else class="lpl-empty inline">从左侧选择提示词，或新建一条内容。</div>
        </main>
      </section>
    </section>
    <dialog v-if="showLeaveConfirm" ref="leaveDialog" class="lpl-remove-dialog" aria-labelledby="lpl-leave-title" @cancel.prevent="cancelLeave"><h3 id="lpl-leave-title">保存当前更改？</h3><p>当前提示词库有未保存的更改，可以保存后继续，或放弃这次编辑。</p><p v-if="error" class="lpl-notice error" role="alert">{{ error }}</p><div><button class="lpl-secondary" :disabled="busy" @click="cancelLeave">继续编辑</button><button class="lpl-secondary" :disabled="busy" @click="discardAndLeave">放弃更改</button><button class="lpl-primary" :disabled="busy" @click="saveAndLeave">{{ saving ? '保存中…' : '保存并继续' }}</button></div></dialog>
    <dialog v-if="showRemovePrompt" ref="removePromptDialog" class="lpl-remove-dialog" aria-labelledby="lpl-remove-title" @cancel.prevent="showRemovePrompt = false"><h3 id="lpl-remove-title">删除当前提示词？</h3><p>{{ removePromptTarget?.field_name || '未命名提示词' }}</p><p>将从当前草稿移除，保存编辑后生效。</p><div><button class="lpl-secondary" @click="showRemovePrompt = false">取消</button><button class="lpl-icon danger" @click="confirmPromptRemoval">确认移除</button></div></dialog>
  </div>
</template>

<script setup>
import { useNativeDialog } from '../composables/useNativeDialog'
import { computed, nextTick, onMounted, onUnmounted, onUpdated, ref, watch } from 'vue'
import {
  DEFAULT_PROMPT_LIBRARY_NAME,
  PROMPT_IMPORT_HEADER_ROWS,
  PROMPT_CUSTOM_FIELDS,
  PROMPT_SCENARIOS,
  cloudPromptLibraryNotice,
  createLocalPromptUid,
  defaultPromptTemplate,
  normalizePromptLibrary,
  normalizePromptTemplate,
  parsePromptWorkbookImportCandidates,
} from '../utils/localPromptLibrary'
import { loadLocalPromptLibraryViewSources } from '../utils/localPromptLibraryViewState'

const scenarioOptions = PROMPT_SCENARIOS
const localLibraries = ref([])
const cloudLibraries = ref([])
const originalLibraries = ref({})
const selectedLibraryUid = ref('')
const viewMode = ref('list')
const libraryDraft = ref({ name: DEFAULT_PROMPT_LIBRARY_NAME, scenario: PROMPT_SCENARIOS[0] })
const selectedTemplateId = ref('')
const selectedTemplate = computed(() => templates.value.find(item => (item.local_uid || templateKey(item, templates.value.indexOf(item))) === selectedTemplateId.value) || null)
const showRemovePrompt = ref(false), removePromptDialog = ref(null), removePromptTarget = ref(null)
useNativeDialog(showRemovePrompt, removePromptDialog)
function requestPromptRemoval(template) { removePromptTarget.value = template; showRemovePrompt.value = true }
function confirmPromptRemoval() { removePromptRow(removePromptTarget.value); showRemovePrompt.value = false; removePromptTarget.value = null }
const groupFilter = ref('all')
const keyword = ref('')
const loading = ref(false)
const cloudLoading = ref(false)
const saving = ref(false)
const importing = ref(false)
const syncing = ref(false)
const message = ref('')
const error = ref('')
const cloudError = ref('')
const cloudStatus = ref(null)
const promptTextareas = ref([])
const componentMounted = ref(false)

const busy = computed(() => loading.value || saving.value || importing.value || syncing.value)
const libraries = computed(() => [...localLibraries.value, ...cloudLibraries.value])
const libraryRows = computed(() => [...libraries.value].sort((left, right) => {
  const rightTime = Date.parse(right.created_at || right.updated_at || '') || 0
  const leftTime = Date.parse(left.created_at || left.updated_at || '') || 0
  return rightTime - leftTime || String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN')
}))
const isListView = computed(() => viewMode.value === 'list')
const selectedLibrary = computed(() => selectedLibraryUid.value ? libraries.value.find(library => library.library_uid === selectedLibraryUid.value) || null : null)
const selectedLocalLibrary = computed(() => selectedLibrary.value?.source_type === 'local' ? selectedLibrary.value : null)
const selectedCloudLibrary = computed(() => selectedLibrary.value?.source_type === 'cloud' ? selectedLibrary.value : null)
const templates = computed(() => selectedLibrary.value?.templates || [])
const cloudBaseUrl = computed(() => String(cloudStatus.value?.base_url || '').trim())
const cloudPromptManageUrl = computed(() => buildCloudPromptManageUrl(cloudBaseUrl.value))
const isDirty = computed(() => {
  if (!selectedLocalLibrary.value) return false
  const original = originalLibraries.value[selectedLibraryUid.value]
  if (!original) return false
  const payload = (library, name, scenario) => JSON.stringify({ name, scenario, templates: (library.templates || []).map(normalizePromptTemplate) })
  return payload(selectedLocalLibrary.value, libraryDraft.value.name, libraryDraft.value.scenario) !== payload(original, original.name, original.scenario || PROMPT_SCENARIOS[0])
})
const showLeaveConfirm = ref(false), leaveDialog = ref(null)
useNativeDialog(showLeaveConfirm, leaveDialog)
let pendingLeave = null
function requestLeave(action) {
  if (busy.value) return
  if (!isDirty.value) return action()
  pendingLeave = action
  showLeaveConfirm.value = true
}
function cancelLeave() { if (busy.value) return; pendingLeave = null; showLeaveConfirm.value = false }
function finishLeave() { const action = pendingLeave; pendingLeave = null; showLeaveConfirm.value = false; action?.() }
function discardAndLeave() {
  if (busy.value) return
  const original = originalLibraries.value[selectedLibraryUid.value]
  if (original && selectedLocalLibrary.value) Object.assign(selectedLocalLibrary.value, JSON.parse(JSON.stringify(original)))
  syncLibraryDraft()
  message.value = ''; error.value = ''
  finishLeave()
}
async function saveAndLeave() { if (await saveLocalEdits()) finishLeave() }
function rememberSavedLibraries() { originalLibraries.value = Object.fromEntries(localLibraries.value.map(library => [library.library_uid, JSON.parse(JSON.stringify(library))])) }
function warnBeforeUnload(event) { if (isDirty.value) { event.preventDefault(); event.returnValue = '' } }
watch(isDirty, dirty => { if (dirty) message.value = '' })
const groupSummaries = computed(() => {
  const groups = new Map()
  for (const template of templates.value) {
    const name = template.group_name || '未分组'
    const current = groups.get(name) || { name, total: 0, enabled: 0 }
    current.total += 1
    if (template.enabled) current.enabled += 1
    groups.set(name, current)
  }
  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
})
const displayTemplates = computed(() => {
  const search = keyword.value.trim().toLowerCase()
  return templates.value.filter(template => {
    if (groupFilter.value !== 'all' && (template.group_name || '未分组') !== groupFilter.value) return false
    if (!search) return true
    const haystack = `${template.group_name} ${template.field_name} ${template.prompt_text}`.toLowerCase()
    return haystack.includes(search)
  })
})

watch(selectedLibraryUid, () => {
  groupFilter.value = 'all'
  syncLibraryDraft()
})

watch(displayTemplates, resizePromptTextareas, { flush: 'post' })
watch(templates, ensureSelectedTemplate)
function ensureSelectedTemplate() {
  if (!templates.value.some(item => item.local_uid === selectedTemplateId.value)) selectedTemplateId.value = templates.value[0]?.local_uid || ''
}
function prepareLibrary(library) {
  const normalized = normalizePromptLibrary({ ...library, source_type: 'local' })
  normalized.templates = normalized.templates.map(template => ({ ...template, local_uid: template.local_uid || createLocalPromptUid() }))
  return normalized
}

function ensureSelectedLibrary() {
  if (!libraries.value.some(library => library.library_uid === selectedLibraryUid.value)) {
    selectedLibraryUid.value = libraries.value[0]?.library_uid || ''
  }
}

async function loadLibraries() {
  loading.value = true
  error.value = ''
  try {
    const state = await loadLocalPromptLibraryViewSources({
      listLocalPromptLibraries: () => window.cs.listLocalPromptLibraries(),
      loadCloudLibraries,
      onLocalReady: libraries => {
        localLibraries.value = libraries.map(prepareLibrary)
        rememberSavedLibraries()
        ensureSelectedLibrary()
        syncLibraryDraft()
        loading.value = false
      },
    })
    void state.cloudRefresh
  } catch (err) {
    error.value = err?.message || String(err)
    loading.value = false
  }
}

async function loadLocalLibraries() {
  const payload = await window.cs.listLocalPromptLibraries()
  localLibraries.value = (Array.isArray(payload?.libraries) ? payload.libraries : [])
    .map(prepareLibrary)
  rememberSavedLibraries()
}

async function refreshCloudApprovalStatus() {
  try {
    cloudStatus.value = await window.cs.getCloudApprovalStatus()
  } catch {
    cloudStatus.value = null
  }
}

async function loadCloudLibraries() {
  cloudLibraries.value = []
}

async function createLibrary() {
  error.value = ''
  message.value = ''
  try {
    const response = await window.cs.createLocalPromptLibrary({
      name: DEFAULT_PROMPT_LIBRARY_NAME,
      scenario: PROMPT_SCENARIOS[0],
      templates: [{ ...defaultPromptTemplate(PROMPT_SCENARIOS[0]), local_uid: createLocalPromptUid() }],
    })
    await loadLocalLibraries()
    selectedLibraryUid.value = response?.library?.library_uid || selectedLibraryUid.value
    viewMode.value = 'detail'
    syncLibraryDraft()
    message.value = '本地提示词库已创建'
  } catch (err) {
    error.value = err?.message || String(err)
  }
}

function chooseWorkbookForImport() { requestLeave(importWorkbook) }
async function importWorkbook() {
  importing.value = true
  error.value = ''
  message.value = ''
  try {
    const selected = await window.cs.browseFile({
      title: '选择提示词库 Excel',
      excel: true,
    })
    if (!selected) return
    const importResult = await readPromptWorkbookTemplates(selected)
    const parsedTemplates = importResult.templates
      .map(template => ({ ...template, local_uid: createLocalPromptUid() }))
    if (!parsedTemplates.length) {
      throw new Error(`没有识别到可导入的 Prompt 行（已尝试第 ${PROMPT_IMPORT_HEADER_ROWS.join('、')} 行作为表头）`)
    }

    const response = await window.cs.importLocalPromptLibrary({
      library_uid: selectedLocalLibrary.value?.library_uid || '',
      name: libraryDraft.value.name || selectedLocalLibrary.value?.name || DEFAULT_PROMPT_LIBRARY_NAME,
      scenario: libraryDraft.value.scenario || selectedLocalLibrary.value?.scenario || PROMPT_SCENARIOS[0],
      import_source_path: selected,
      templates: parsedTemplates,
    })
    await loadLocalLibraries()
    selectedLibraryUid.value = response?.library?.library_uid || selectedLibraryUid.value
    viewMode.value = 'detail'
    syncLibraryDraft()
    const headerText = importResult.header_row ? `（表头第 ${importResult.header_row} 行）` : ''
    message.value = `已导入更新 ${parsedTemplates.length} 条 Prompt${headerText}`
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    importing.value = false
  }
}

async function readPromptWorkbookTemplates(selected) {
  const candidates = []
  for (const headerRow of PROMPT_IMPORT_HEADER_ROWS) {
    const workbook = await window.cs.readExcel(selected, { header_row: headerRow })
    if (workbook?.error) throw new Error(workbook.error)
    candidates.push({ header_row: headerRow, workbook })

    const result = parsePromptWorkbookImportCandidates(candidates)
    if (result.templates.length) return result
  }
  return parsePromptWorkbookImportCandidates(candidates)
}

async function saveLocalEdits() {
  if (!selectedLocalLibrary.value || saving.value) return false
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    const response = await window.cs.saveLocalPromptLibrary(selectedLocalLibrary.value.library_uid, {
      name: libraryDraft.value.name || DEFAULT_PROMPT_LIBRARY_NAME,
      scenario: libraryDraft.value.scenario || PROMPT_SCENARIOS[0],
      templates: templates.value.map(normalizePromptTemplate),
    })
    await loadLocalLibraries()
    selectedLibraryUid.value = response?.library?.library_uid || selectedLibraryUid.value
    viewMode.value = 'detail'
    syncLibraryDraft()
    message.value = '本地提示词库已保存'
    return true
  } catch (err) {
    error.value = err?.message || String(err)
    return false
  } finally {
    saving.value = false
  }
}

async function syncSelectedLibrary() {
  if (!selectedLocalLibrary.value) return
  syncing.value = true
  error.value = ''
  message.value = ''
  try {
    await saveLocalEdits()
    const response = await window.cs.syncLocalPromptLibraryToCloud(selectedLocalLibrary.value.library_uid)
    await loadLocalLibraries()
    await loadCloudLibraries({ silent: true })
    selectedLibraryUid.value = response?.library?.library_uid || selectedLibraryUid.value
    viewMode.value = 'detail'
    const cloudId = response?.cloud?.library?.id || response?.library?.cloud_library_id
    message.value = cloudId ? `已同步到云端提示词库 #${cloudId}` : '已同步到云端提示词库'
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    syncing.value = false
  }
}

function syncLibraryDraft() {
  ensureSelectedTemplate()
  if (!selectedLibrary.value) {
    libraryDraft.value = { name: DEFAULT_PROMPT_LIBRARY_NAME, scenario: PROMPT_SCENARIOS[0] }
    return
  }
  libraryDraft.value = {
    name: selectedLibrary.value.name,
    scenario: selectedLibrary.value.scenario || PROMPT_SCENARIOS[0],
  }
}

function addPromptRow() {
  if (!selectedLocalLibrary.value) return
  const groupName = groupFilter.value !== 'all'
    ? groupFilter.value
    : templates.value[0]?.group_name || selectedLibrary.value.scenario || PROMPT_SCENARIOS[0]
  const localUid = createLocalPromptUid()
  keyword.value = ''
  selectedTemplateId.value = localUid
  selectedLibrary.value.templates.unshift({
    ...defaultPromptTemplate(groupName),
    local_uid: localUid,
    field_name: '',
    prompt_text: '',
  })
}

function removePromptRow(template) {
  if (!selectedLocalLibrary.value) return
  selectedLocalLibrary.value.templates = selectedLocalLibrary.value.templates.filter(row => row !== template)
}

async function copyCloudLibraryToLocal() {
  if (!selectedCloudLibrary.value) return
  error.value = ''
  message.value = ''
  try {
    const cloudLibrary = selectedCloudLibrary.value
    const cloudTemplates = Array.isArray(selectedCloudLibrary.value.templates) ? selectedCloudLibrary.value.templates : []
    if (!cloudTemplates.length) throw new Error('线上库没有可复制的 Prompt 模板')
    const response = await window.cs.createLocalPromptLibrary({
      name: `${cloudLibrary.name} 本地副本`,
      scenario: cloudLibrary.scenario || PROMPT_SCENARIOS[0],
      templates: cloudTemplates.map(template => ({
        ...normalizePromptTemplate(template),
        local_uid: createLocalPromptUid(),
      })),
    })
    await loadLocalLibraries()
    selectedLibraryUid.value = response?.library?.library_uid || selectedLibraryUid.value
    viewMode.value = 'detail'
    syncLibraryDraft()
    message.value = `已保存为本地副本：${cloudTemplates.length} 条 Prompt`
  } catch (err) {
    error.value = err?.message || String(err)
  }
}

function enterLibraryDetail(library) {
  selectedLibraryUid.value = library?.library_uid || ''
  viewMode.value = 'detail'
  groupFilter.value = 'all'
  syncLibraryDraft()
  resizePromptTextareas()
}

function backToLibraryList() { requestLeave(() => { viewMode.value = 'list'; keyword.value = '' }) }

async function openCloudPromptManager() {
  const url = cloudPromptManageUrl.value
  if (!url) return
  try {
    await window.cs.openExternalUrl(url)
  } catch (err) {
    error.value = err?.message || String(err)
  }
}

function templateKey(template, index) {
  return template.local_uid || `${template.group_name}-${template.field_name}-${index}`
}

function templateCount(library) {
  return Array.isArray(library?.templates) ? library.templates.length : 0
}

function formatDateTime(value) {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function resizePromptTextarea(eventOrTextarea) {
  const textarea = eventOrTextarea?.target || eventOrTextarea
  if (!textarea?.style) return
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}

function resizePromptTextareas() {
  nextTick(() => {
    for (const textarea of promptTextareas.value.flat()) {
      resizePromptTextarea(textarea)
    }
  })
}

function statusLabel(status) {
  if (status === 'synced') return '已同步'
  if (status === 'published') return '已发布'
  if (status === 'draft') return '本地草稿'
  return status || '本地草稿'
}

function librarySourceLabel(sourceType) {
  return sourceType === 'cloud' ? '线上' : '本地'
}

function buildCloudPromptManageUrl(baseUrl) {
  const text = String(baseUrl || '').trim()
  if (!text) return ''
  try {
    const url = new URL(text)
    url.searchParams.set('page', 'prompts')
    return url.toString()
  } catch {
    return ''
  }
}

onMounted(async () => {
  componentMounted.value = true
  window.addEventListener('beforeunload', warnBeforeUnload)
  await loadLibraries()
  resizePromptTextareas()
})

onUnmounted(() => {
  componentMounted.value = false
  window.removeEventListener('beforeunload', warnBeforeUnload)
})

onUpdated(resizePromptTextareas)
</script>

<style scoped>
.local-prompt-library {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}

.lpl-head,
.lpl-toolbar,
.lpl-table-head,
.lpl-library-list-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.lpl-head {
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border);
}

.lpl-head h2,
.lpl-head p,
.lpl-table-head h3,
.lpl-table-head span,
.lpl-library-list-head h3,
.lpl-library-list-head p {
  margin: 0;
}

.lpl-head h2 {
  font-size: 18px;
  font-weight: 800;
}

.lpl-head p,
.lpl-table-head span,
.lpl-groups-head span,
.lpl-sync-meta,
.lpl-empty {
  color: var(--text2);
  font-size: 12px;
}

.lpl-head-actions {
  display: flex;
  align-items: end;
  gap: 8px;
}

.lpl-head-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.lpl-primary,
.lpl-secondary,
.lpl-icon,
.lpl-groups button {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  padding: 8px 12px;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}

.lpl-primary {
  border-color: rgba(var(--orange-rgb), .48);
  background: var(--orange);
  color: #fff;
  font-weight: 700;
}

.lpl-secondary {
  border-color: var(--border);
  background: var(--bg3);
  color: var(--text);
  font-weight: 700;
}

.lpl-secondary:hover {
  border-color: rgba(var(--orange-rgb), .48);
  background: rgba(var(--orange-rgb), .12);
}

.lpl-primary:disabled,
.lpl-secondary:disabled {
  cursor: not-allowed;
  opacity: .55;
}

.lpl-icon.danger {
  color: var(--red);
}

.lpl-notice {
  margin: 10px 24px 0;
  border: 1px solid rgba(74, 222, 128, .35);
  border-radius: 8px;
  background: rgba(74, 222, 128, .08);
  color: var(--green);
  padding: 9px 12px;
}

.lpl-notice.error {
  border-color: rgba(248, 113, 113, .42);
  background: rgba(248, 113, 113, .08);
  color: var(--red);
}

.lpl-notice.warning {
  border-color: rgba(251, 191, 36, .38);
  background: rgba(251, 191, 36, .08);
  color: var(--yellow);
}

.lpl-source-badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 22px;
  border: 1px solid rgba(148, 163, 184, .32);
  border-radius: 999px;
  background: rgba(148, 163, 184, .1);
  color: var(--text2);
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 750;
}

.lpl-toolbar {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(120px, 150px) minmax(180px, 240px);
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}

.lpl-toolbar label {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.lpl-toolbar span {
  color: var(--text2);
  font-size: 12px;
}

.lpl-toolbar input,
.lpl-toolbar select,
.lpl-template-cell input,
.lpl-template-cell textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  padding: 7px 9px;
  font-size: 13px;
  outline: none;
}

.lpl-toolbar input:focus,
.lpl-toolbar select:focus,
.lpl-template-cell input:focus,
.lpl-template-cell textarea:focus {
  border-color: var(--orange);
}

.lpl-toolbar input:disabled,
.lpl-toolbar select:disabled,
.lpl-template-cell input:disabled,
.lpl-template-cell textarea:disabled,
.lpl-icon:disabled {
  cursor: not-allowed;
  opacity: .68;
}

.lpl-empty {
  display: grid;
  place-items: center;
  gap: 12px;
  min-height: 220px;
}

.lpl-empty.inline {
  min-height: 90px;
}

.lpl-library-list,
.lpl-detail {
  flex: 1 1 0;
  min-height: 0;
}

.lpl-library-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 24px 20px;
}

.lpl-library-list-head {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  padding: 13px 14px;
}

.lpl-library-list-head h3 {
  font-size: 15px;
}

.lpl-library-list-head p,
.lpl-library-name span {
  color: var(--text2);
  font-size: 12px;
}

.lpl-library-table {
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
}

.lpl-library-header,
.lpl-library-row {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) 150px 190px 110px 110px;
  align-items: center;
}

.lpl-library-header {
  position: sticky;
  top: 0;
  z-index: 1;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg2) 88%, #000 12%);
}

.lpl-library-header span,
.lpl-library-row > div {
  padding: 10px 12px;
}

.lpl-library-header span {
  color: var(--text2);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.lpl-library-row {
  min-height: 60px;
  border-bottom: 1px solid var(--border);
}

.lpl-library-row:last-child {
  border-bottom: none;
}

.lpl-library-row:hover {
  background: rgba(255, 255, 255, .018);
}

.lpl-library-row > div {
  min-width: 0;
  color: var(--text);
  font-size: 13px;
}

.lpl-library-name {
  display: grid;
  gap: 4px;
}

.lpl-library-name strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lpl-library-actions {
  display: flex;
  justify-content: flex-end;
}

.lpl-detail {
  display: flex;
  flex-direction: column;
}

.lpl-workspace {
  flex: 1 1 0;
  min-height: 0;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 14px;
  overflow: hidden;
  padding: 14px 24px 20px;
}

.lpl-groups {
  align-self: stretch;
  min-height: 0;
  display: grid;
  gap: 8px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  padding: 12px;
}

.lpl-groups-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 6px;
}

.lpl-groups button {
  display: grid;
  gap: 4px;
  width: 100%;
  text-align: left;
}

.lpl-groups button.active,
.lpl-groups button:hover {
  border-color: rgba(var(--orange-rgb), .52);
  background: var(--orange-bg);
  color: var(--orange-text);
}

.lpl-sync-meta {
  display: grid;
  gap: 4px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
}

.lpl-table-panel {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
}

.lpl-table-head {
  padding: 13px 14px;
  border-bottom: 1px solid var(--border);
}

.lpl-table-head > div {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px;
}

.lpl-edit-list {
  flex: 1 1 0;
  height: auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 14px;
}

.lpl-template-table {
  min-width: 1120px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg);
}

.lpl-template-header,
.lpl-template-row {
  display: grid;
  grid-template-columns: 92px minmax(120px, 150px) minmax(190px, 240px) 76px 76px minmax(420px, 1fr) 76px;
  align-items: stretch;
}

.lpl-template-header {
  position: sticky;
  top: 0;
  z-index: 1;
  background: color-mix(in srgb, var(--bg2) 88%, #000 12%);
  border-bottom: 1px solid var(--border);
}

.lpl-template-header span {
  color: var(--text2);
  font-size: 12px;
  font-weight: 800;
  padding: 9px 10px;
  white-space: nowrap;
}

.lpl-template-row {
  border-bottom: 1px solid var(--border);
  transition: background .14s ease, opacity .14s ease;
}

.lpl-template-row:last-child {
  border-bottom: none;
}

.lpl-template-row:hover {
  background: rgba(255, 255, 255, .018);
}

.lpl-template-row.disabled {
  opacity: .64;
}

.lpl-template-cell {
  min-width: 0;
  display: flex;
  align-items: center;
  border-right: 1px solid var(--border);
  padding: 7px 8px;
}

.lpl-template-cell:last-child {
  border-right: none;
}

.lpl-template-cell.compact input {
  text-align: center;
}

.lpl-template-cell.prompt {
  align-items: stretch;
}

.lpl-template-cell.prompt textarea {
  min-height: 54px;
  overflow: hidden;
  resize: none;
  line-height: 1.45;
}

.lpl-template-cell.action {
  justify-content: center;
}

.lpl-switch {
  display: inline-grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  color: var(--text2);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.lpl-switch.readonly {
  cursor: not-allowed;
}

.lpl-switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.lpl-switch-track {
  position: relative;
  width: 32px;
  height: 18px;
  border: 1px solid rgba(148, 163, 184, .4);
  border-radius: 999px;
  background: rgba(148, 163, 184, .18);
  transition: background .16s ease, border-color .16s ease;
}

.lpl-switch-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: #cbd5e1;
  transition: transform .16s ease, background .16s ease;
}

.lpl-switch input:checked + .lpl-switch-track {
  border-color: rgba(var(--orange-rgb), .72);
  background: rgba(var(--orange-rgb), .3);
}

.lpl-switch input:checked + .lpl-switch-track::after {
  transform: translateX(14px);
  background: #fff;
}

.lpl-switch strong {
  overflow: hidden;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1080px) {
  .lpl-workspace {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .lpl-groups {
    position: static;
    max-height: min(180px, 30vh);
  }

  .lpl-toolbar {
    grid-template-columns: 1fr;
  }

  .lpl-library-list-head {
    align-items: flex-start;
  }

  .lpl-library-header {
    display: none;
  }

  .lpl-library-row {
    grid-template-columns: 1fr;
    align-items: start;
  }

  .lpl-library-actions {
    justify-content: flex-start;
  }

  .lpl-template-table {
    min-width: 0;
  }

  .lpl-template-header {
    display: none;
  }

  .lpl-template-row {
    grid-template-columns: 1fr;
  }

  .lpl-template-cell {
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .lpl-template-cell:last-child {
    border-bottom: none;
  }
}
.lpl-custom-fields { margin-top: 8px; font-size: 12px; color: var(--text2); }
.lpl-custom-fields summary { cursor: pointer; }
.lpl-custom-fields > div { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px; }
.lpl-custom-fields label { display: grid; gap: 4px; }
</style>

<style scoped>
.lpl-master-detail{display:grid;grid-template-columns:240px minmax(0,1fr);min-width:0;min-height:0;flex:1}.lpl-entry-list{padding:18px 14px;border-right:1px solid var(--border);overflow:auto;background:var(--bg2);min-width:0}.lpl-entry-list>label{display:flex;flex-direction:column;gap:8px;margin-bottom:16px;color:var(--text2);font-size:12px}.lpl-entry-list select{max-width:100%;background:var(--bg);border:1px solid var(--border);padding:8px;border-radius:6px}.lpl-entry{width:100%;text-align:left;display:flex;flex-direction:column;gap:7px;border:1px solid transparent;background:transparent;color:var(--text);padding:12px;border-radius:8px;margin-bottom:5px;white-space:normal}.lpl-entry.active{border-color:var(--border-strong);background:var(--bg3)}.lpl-entry strong{font-size:13px;overflow-wrap:anywhere}.lpl-entry small,.lpl-entry p,.lpl-no-match{font-size:12px;line-height:1.65;color:var(--text2)}.lpl-entry p{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}.lpl-editor-panel{min-width:0;overflow:auto;padding:20px 24px}.lpl-editor-panel .lpl-table-head{padding:0 0 20px}.lpl-editor-field{display:flex;flex-direction:column;gap:9px;margin-bottom:20px;font-size:13px}.lpl-editor-field input,.lpl-editor-field textarea,.lpl-rule-fields input{width:100%;padding:10px;background:var(--bg);border:1px solid var(--border-strong);border-radius:7px;color:var(--text);font:inherit}.lpl-editor-field textarea{min-height:300px;resize:vertical;line-height:1.9}.lpl-editor-rules>summary{padding:14px 0;color:var(--text2);cursor:pointer}.lpl-editor-rules p{font-size:12px;color:var(--text2);margin:15px 0}.lpl-rule-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.lpl-rule-fields label{display:flex;flex-direction:column;gap:7px;font-size:12px}.lpl-rule-fields .lpl-enabled{flex-direction:row;align-items:center}.lpl-enabled input{width:auto}.lpl-editor-footer{display:flex;justify-content:space-between;align-items:flex-start;gap:15px;padding:20px 0;font-size:12px;color:var(--text2)}.lpl-editor-footer details{flex:none}.lpl-editor-footer summary{cursor:pointer}.lpl-editor-footer button{margin-top:10px}.lpl-remove-dialog{margin:auto;width:min(440px,calc(100vw - 40px));padding:24px;background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:12px}.lpl-remove-dialog::backdrop{background:var(--scrim)}.lpl-remove-dialog p{margin:15px 0;font-size:13px;overflow-wrap:anywhere}.lpl-remove-dialog>div{display:flex;justify-content:flex-end;gap:10px}.lpl-detail{min-height:0;display:flex;flex-direction:column}.lpl-toolbar{flex:none}
@media(max-width:1000px){.lpl-master-detail{grid-template-columns:190px minmax(0,1fr)}.lpl-editor-panel{padding:18px}}@media(max-width:700px){.lpl-master-detail{display:flex;flex-direction:column;overflow:auto}.lpl-entry-list{max-height:230px;flex:none;border-right:0;border-bottom:1px solid var(--border)}.lpl-editor-panel{overflow:visible}.lpl-rule-fields{grid-template-columns:1fr}.lpl-editor-footer{flex-wrap:wrap}}
</style>
