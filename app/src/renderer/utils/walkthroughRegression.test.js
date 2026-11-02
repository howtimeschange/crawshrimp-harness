import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { mergeTaskLiveStatus } from './taskRunnerState.js'
const imageSource = readFileSync(new URL('../views/AiImageWorkbench.vue', import.meta.url), 'utf8')
function imageFunction(name, next, context) {
  context.submissionUnconfirmed ??= { value: false }
  context.unknownRetryKey ??= () => "test-key"
  context.beginUnknownRetry ??= () => { context.unknownRetryDialogOpen.value = true }
  context.activeJobUid ??= { value: "qa-job" }
  context.pendingActiveJobUid ??= { value: "" }
  context.taskSelectionGeneration ??= 0
  vm.runInNewContext(imageSource.slice(imageSource.indexOf(`async function ${name}(`), imageSource.indexOf(`\n${next}`, imageSource.indexOf(`async function ${name}(`))), context)
  return context[name]
}
for (const prompt of ['', '   \n  ']) test(`blank prompt rejected before creating a run: ${JSON.stringify(prompt)}`, async () => {
  let submissions = 0
  const context = { form: { prompt }, errorMessage: {value:''}, assertAdvancedJsonValid() {}, activeMissingKey:{value:false}, generating:{value:false}, compactPane:{}, selectedResults:new Set(), logs:{value:[]}, ensureCurrentTask: async()=>{ submissions++; throw new Error('unexpected submission') }, clearResultRevealTracking(){}, generatingJobUid:{}, generatingSnapshot:{}, normalizeGenerateError:e=>e.message }
  await imageFunction('generate', 'function normalizeGenerateError', context)()
  assert.equal(submissions, 0)
  assert.equal(context.generating.value, false)
  assert.match(context.errorMessage.value, /请输入.*提示词/)
})
test('unconfirmed image submission asks before starting another run', async () => {
  const context = { submissionUnconfirmed: { value: true }, unknownRetryDialogOpen: { value: false } }
  await imageFunction('generate', 'function normalizeGenerateError', context)()
  assert.equal(context.unknownRetryDialogOpen.value, true)
})
test('confirmed new generation submits once and consumes confirmation', async () => {
  let submissions = 0
  const draft = {job_uid:'qa-job',status:'failed',summary:{runs:[{run_uid:'old',error_code:'UNKNOWN_SUBMIT_RESULT'}]}}
  const context = { submissionUnconfirmed:{value:true}, generationConfigMessage:{value:''}, inputImportBusy:{value:false}, connectionNotice:{value:''}, structuredClonePlain: value=>structuredClone(value), retainSubmittedTaskInputs(){}, form:{prompt:'test'}, errorMessage:{value:''}, assertAdvancedJsonValid(){}, generating:{value:false}, compactPane:{}, selectedResults:new Set(), logs:{value:[]}, ensureCurrentTask:async()=>draft, clearResultRevealTracking(){}, generatingJobUid:{}, generatingSnapshot:{}, normalizeGenerateError:e=>e.message, beginResultRevealTracking(){}, currentJob:{value:draft}, activeJobUid:{value:'qa-job'}, buildJobPayload:()=>({prompt:'test'}), formSnapshot:()=>({prompt:'test'}), upsertJob(){}, clearSubmittedTaskInputs(){}, window:{cs:{runAiImageJob:async()=>{submissions++; throw new Error('fixture')},getAiImageJob:async()=>draft}}, hasActiveRuns:()=>false }
  await imageFunction('generate','function normalizeGenerateError',context)('test-key')
  assert.equal(submissions, 1)
  assert.equal(context.currentJob.value.summary.runs[0].run_uid, 'old')
})
test('new run does not inherit old target or 100 percent progress', () => {
  const task = { live: { status:'done', run_id:14, current_target:'000000000000', progress_percent:100 } }
  const started = mergeTaskLiveStatus(task, { status:'running', run_id:null, phase:'starting' })
  assert.equal(started.live.current_target, undefined)
  assert.equal(started.live.progress_percent, undefined)
  const next = mergeTaskLiveStatus(task, { status:'running', run_id:15 })
  assert.equal(next.live.current_target, undefined)
})

test('IPC failure reconciles optimistic running from persisted job', async () => {
  const draft = {job_uid:'qa-job',status:'draft',summary:{}}
  const context = { generationConfigMessage:{value:''}, inputImportBusy:{value:false}, connectionNotice:{value:''}, structuredClonePlain: value=>structuredClone(value), retainSubmittedTaskInputs(){}, form:{prompt:'test'}, errorMessage:{value:''}, assertAdvancedJsonValid(){}, activeMissingKey:{value:false}, generating:{value:false}, compactPane:{}, selectedResults:new Set(), logs:{value:[]}, ensureCurrentTask:async()=>draft, clearResultRevealTracking(){}, generatingJobUid:{}, generatingSnapshot:{}, normalizeGenerateError:e=>e.message, beginResultRevealTracking(){}, currentJob:{value:draft}, activeJobUid:{value:'qa-job'}, buildJobPayload:()=>({prompt:'test'}), formSnapshot:()=>({prompt:'test'}), upsertJob(){}, clearSubmittedTaskInputs(){}, window:{cs:{runAiImageJob:async()=>{throw new Error('connection failed')},getAiImageJob:async()=>draft}},hasActiveRuns:()=>false }
  await imageFunction('generate','function normalizeGenerateError',context)()
  assert.equal(context.currentJob.value.status,'draft')
  assert.equal(context.generating.value,false)
})

test('download shows progress, blocks duplicate clicks and reports partial failures', async () => {
  let release
  let picked = 0
  let calls = 0
  const context = {currentJob:{value:{job_uid:'qa'}},resultKey:item=>item.path,downloading:{value:false},downloadMessage:{value:''},errorMessage:{value:''},logs:{value:[]},chooseDirectory:async()=>{picked++;return '/qa'},window:{cs:{saveAsAiImageJob:async()=>{calls++;if(calls===1) return new Promise(resolve=>{release=()=>resolve({ok:true,files:['/qa/a.png']})});throw new Error('network unavailable')}}}}
  const save = imageFunction('saveAs','async function setAsMain',context)
  const pending = save([{path:'a.png'},{path:'b.png'}])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(context.downloading.value,true)
  assert.match(context.downloadMessage.value,/0\/2/)
  await save([{path:'a.png'}])
  assert.equal(picked,1)
  release()
  await pending
  assert.equal(context.downloading.value,false)
  assert.match(context.downloadMessage.value,/1\/2.*\/qa/)
  assert.match(context.errorMessage.value,/b.png.*network unavailable/)
})

test('autosave only updates draft content, never a local running status', async () => {
  let payload
  const context = {activeJobUid:{value:'qa'},window:{cs:{updateAiImageJob:async(uid,body)=>{payload=body;return {job_uid:uid,status:'draft'}}}}, generating:{value:false},hasGeneratedResults:()=>false,persistedCurrentJob:{value:{}},currentJob:{value:{status:'running'}},buildJobPayload:()=>({prompt:'changed'}),upsertJob(){}}
  await imageFunction('autosaveCurrentTask','function upsertJob',context)()
  assert.equal(payload.status,undefined)
  assert.equal(context.currentJob.value.status,'draft')
})

test('nav clicks use current rail width after expanded-to-collapsed refresh', () => {
  const slots = readFileSync(new URL('../../../../integrations/deepseek-harness/crawshrimp-slots/lib/client.js', import.meta.url), 'utf8')
  let width = 280
  let click
  const messages = []
  const context = {document:{createElement:()=>({dataset:{},addEventListener:(name,fn)=>{click=fn}})},updateNavButton:(button,item)=>{button.dataset.csNavItemId=item.id},currentRailWidth:()=>width,lastMaxRailWidth:280,postToShell:message=>messages.push(message)}
  vm.runInNewContext(slots.slice(slots.indexOf('    function makeNavButton('),slots.indexOf('    function findNavButton(')),context)
  context.makeNavButton({id:'ai-image'},'')
  click(); width=54; click(); width=280; click(); width=54; click()
  assert.deepEqual(messages.map(message=>message.railWidth),[280,54,280,54])
})

test('reactivating the same image job ignores its stale poll and keeps one timer', async () => {
  const timers = new Map(), requests = [], updates = []
  let timerId = 0
  const context = {
    jobPollingTimer: null, jobPollingUid: '', jobPollingInFlight: false,
    jobPollingGeneration: 0, workbenchVisible: true, document: { hidden: false },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId },
    clearTimeout(id) { timers.delete(id) },
    window: { cs: { getAiImageJob: () => new Promise(resolve => requests.push(resolve)) } },
    mergeResultCacheFromJob() {}, captureNewResultReveals() {},
    upsertJob(job) { updates.push(job.status) }, currentJob: { value: null }, logs: { value: [] },
    hasActiveRuns: job => job.status === 'running',
  }
  vm.runInNewContext(imageSource.slice(imageSource.indexOf('function stopJobPolling('), imageSource.indexOf('function parseAdvancedJsonValue(')), context)
  const tick = () => { const [id, fn] = [...timers][0]; timers.delete(id); return fn() }
  context.startJobPolling('same-job')
  const oldPoll = tick()
  context.stopJobPolling()
  context.startJobPolling('same-job')
  const currentPoll = tick()
  requests[1]({ status: 'running' }); await currentPoll
  requests[0]({ status: 'done' }); await oldPoll
  assert.deepEqual(updates, ['running'])
  assert.equal(timers.size, 1)
  assert.equal(context.jobPollingUid, 'same-job')
})


test('recheck ignores stale job and trace responses, including A-B-A switching', async () => {
  const requests = [], traces = [], updates = []
  const context = {
    activeJobUid: { value: 'A' }, pendingActiveJobUid: { value: '' }, taskSelectionGeneration: 0,
    resultRecheckGeneration: 0, currentJob: { value: { job_uid: 'A' } }, errorMessage: { value: '' },
    resultOwnerJobUid: item => item.jobUid, upsertJob: job => updates.push(job.job_uid),
    window: { cs: {
      getAiImageJob: () => new Promise(resolve => requests.push(resolve)),
      traceAiImageManagedRequest: () => new Promise(resolve => traces.push(resolve)),
    } },
  }
  const recheck = imageFunction('recheckResultRecord', 'async function retryFailedRun', context)
  const first = recheck({ jobUid: 'A', runUid: 'r' })
  context.pendingActiveJobUid.value = 'B'; context.taskSelectionGeneration++
  context.activeJobUid.value = 'B'; context.pendingActiveJobUid.value = ''
  context.activeJobUid.value = 'A'; context.taskSelectionGeneration++
  requests.shift()({ job_uid: 'A', summary: {} }); await first
  assert.deepEqual(updates, [])
  assert.equal(context.errorMessage.value, '')
  const second = recheck({ jobUid: 'A', runUid: 'r' })
  requests.shift()({ job_uid: 'A', summary: { runs: [{ run_uid: 'r', managed_request_id: 'id' }] } })
  await new Promise(resolve => setImmediate(resolve))
  context.activeJobUid.value = 'B'; context.taskSelectionGeneration++
  traces.shift()({ status: 'found', request_id: 'id', state: 'completed' }); await second
  assert.equal(context.currentJob.value.job_uid, 'A')
  assert.equal(context.errorMessage.value, '')
})

test('batch unknown result requires confirmation bound to task and contents', async () => {
  let submissions = 0
  const draft = { job_uid: 'A', title: 'A', prompt: 'old', summary: {} }
  const context = {
    submissionUnconfirmed: { value: true }, activeJobUid: { value: 'A' }, pendingActiveJobUid: { value: '' },
    taskSelectionGeneration: 0, batchDialogOwner: { jobUid: 'A', selectionGeneration: 0 }, unknownRetryIntent: null, unknownRetryDialogOpen: { value: false },
    batchGenerationDialog: { open: true, submitting: false, error: '', titlePrefix: 'A', prompts: [{ prompt: 'new' }], referenceImagePaths: [] },
    batchPromptCards: { value: [{ title: 'one', prompt: 'new', count: 1 }] }, batchPromptStats: { value: { promptCount: 1, totalImages: 1 } },
    batchConfigMessage: { value: '' }, batchNanoBanana: { value: false }, inputImportBusy: { value: false },
    connectionNotice: { value: '' }, generating: { value: false }, selectedResults: new Set(),
    form: { title: 'A' }, formSnapshot: () => ({ title: 'A', prompt: 'old' }),
    assertAdvancedJsonValid() {}, nextTaskTitle: () => 'next', inputStateFromParams: () => ({}), serializeInputs: () => ({}),
    structuredClonePlain: value => structuredClone(value), ensureCurrentTask: async () => draft,
    beginResultRevealTracking() {}, generatingJobUid: {}, generatingSnapshot: {}, buildBatchJobPayload: () => ({}),
    currentJob: { value: draft }, upsertJob() {}, logs: { value: [] }, normalizeBatchPromptCount: () => 1,
    window: { cs: { updateAiImageJob: async () => draft, batchRunAiImageJob: async () => { submissions++; return { accepted: true, job: draft } } } },
    captureNewResultReveals() {}, compactPane: {}, retainSubmittedTaskInputs() {}, closeBatchPromptLibraryPicker() {},
    hasActiveRuns: () => false, clearResultRevealTracking() {}, normalizeGenerateError: e => e.message,
    errorMessage: { value: '' }, persistWorkbenchState() {}, globalThis,
  }
  imageFunction('submitBatchGeneration', 'async function generate', context)
  vm.runInNewContext(imageSource.slice(imageSource.indexOf('function unknownRetryKey('), imageSource.indexOf('function restoreFailedRunInputs(')), context)
  await context.submitBatchGeneration()
  assert.equal(submissions, 0)
  assert.equal(context.unknownRetryDialogOpen.value, true)
  context.batchGenerationDialog.prompts[0].prompt = 'changed'
  context.confirmUnknownRetry()
  assert.equal(submissions, 0)
  assert.match(context.errorMessage.value, /已变化/)
  await context.submitBatchGeneration()
  context.taskSelectionGeneration++
  context.confirmUnknownRetry()
  assert.equal(submissions, 0)
  context.batchDialogOwner.selectionGeneration = context.taskSelectionGeneration
  await context.submitBatchGeneration()
  context.confirmUnknownRetry()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(submissions, 1)
  assert.equal(context.unknownRetryDialogOpen.value, false)
})


test('batch confirmation cannot dispatch if selection changes during task preparation', async () => {
  let resolveTask, submissions = 0
  const draft = { job_uid: 'A', summary: {} }
  const context = {
    submissionUnconfirmed: { value: true }, activeJobUid: { value: 'A' }, pendingActiveJobUid: { value: '' },
    taskSelectionGeneration: 0, batchDialogOwner: { jobUid: 'A', selectionGeneration: 0 },
    unknownRetryIntent: null, unknownRetryDialogOpen: { value: false },
    batchGenerationDialog: { open: true, submitting: false, error: '', titlePrefix: 'A', prompts: [{ prompt: 'new' }], referenceImagePaths: [] },
    batchPromptCards: { value: [{ title: 'one', prompt: 'new', count: 1 }] }, batchPromptStats: { value: { promptCount: 1, totalImages: 1 } },
    batchConfigMessage: { value: '' }, batchNanoBanana: { value: false }, inputImportBusy: { value: false },
    connectionNotice: { value: '' }, generating: { value: false }, selectedResults: new Set(),
    form: {}, formSnapshot: () => ({ prompt: 'old' }), assertAdvancedJsonValid() {}, nextTaskTitle: () => 'next',
    inputStateFromParams: () => ({}), serializeInputs: () => ({}), structuredClonePlain: value => structuredClone(value),
    ensureCurrentTask: () => new Promise(resolve => { resolveTask = resolve }),
    generatingJobUid: {}, generatingSnapshot: {}, logs: { value: [] }, clearResultRevealTracking() {},
    normalizeGenerateError: e => e.message, errorMessage: { value: '' }, persistWorkbenchState() {},
    window: { cs: { batchRunAiImageJob: () => { submissions++ } } },
  }
  imageFunction('submitBatchGeneration', 'async function generate', context)
  vm.runInNewContext(imageSource.slice(imageSource.indexOf('function unknownRetryKey('), imageSource.indexOf('function restoreFailedRunInputs(')), context)
  await context.submitBatchGeneration()
  context.confirmUnknownRetry()
  context.pendingActiveJobUid.value = 'B'; context.taskSelectionGeneration++
  resolveTask(draft)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(submissions, 0)
  assert.equal(context.generating.value, false)
})

test('confirmed task preparation stops before reading or creating a different task', async () => {
  let releaseSave, reads = 0, creates = 0
  const context = {
    activeJobUid: { value: 'A' }, currentJob: { value: { job_uid: 'A' } },
    pendingActiveJobUid: { value: '' }, taskSelectionGeneration: 0,
    autosaveCurrentTask: () => new Promise(resolve => { releaseSave = resolve }),
    window: { cs: { getAiImageJob: async () => { reads++; return null } } },
    createTaskFromCurrentForm: async () => { creates++; return { job_uid: 'new' } },
  }
  const ensure = imageFunction('ensureCurrentTask', 'async function createTaskFromCurrentForm', context)
  const pending = ensure({ confirmedJobUid: 'A', selectionGeneration: 0 })
  context.activeJobUid.value = 'B'; context.currentJob.value = { job_uid: 'B' }; context.taskSelectionGeneration++
  releaseSave(null)
  await assert.rejects(pending, /任务已切换/)
  assert.equal(reads, 0)
  assert.equal(creates, 0)
})
