'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { createManagedAccount } = require('./managedAccount')
const execFileAsync = promisify(execFile)
const localPython = path.resolve(__dirname, '../../venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const python = process.env.PYTHON || (fs.existsSync(localPython) ? localPython : process.platform === 'win32' ? 'python' : 'python3')

test('candidate queue receipts cross broker and Python into the workbench without any POST', async t => {
  const root = path.resolve(__dirname, '../..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-queue-receipt-'))
  const id = 'bf765baf-935b-5f75-8c93-4dd07aecb100', owner = 'fixture-owner', calls = []
  const cases = [
    { state: 'waiting', queue: { request_id: id, state: 'waiting' } },
    { state: 'waiting', queue: { request_id: id, state: 'running' } },
    { state: 'unknown', queue: { request_id: id, state: 'unknown' } },
    { state: 'waiting', queue: { request_id: id, state: 'not_dispatched' } },
    { state: 'completed', queue: { request_id: id, state: 'completed' } },
    { state: 'upstream_rejected', queue: { request_id: id, state: 'rejected' } },
    { state: 'waiting', queue: null, queueStatus: 'unavailable' },
    { state: 'unknown', queue: null, queueStatus: 'classification_unconfirmed' },
    { state: 'waiting', queue: { request_id: 'other-request', state: 'completed' } },
    { state: 'unknown' },
    { state: 'in_progress' },
    { state: 'not_dispatched' },
  ]
  const storage = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() }
  fs.writeFileSync(path.join(dir, 'modeljetty-session.enc'), JSON.stringify({ session: JSON.stringify({ access_token: 'fixture-token', expiresAt: Date.now() + 3600000 }) }))
  const account = createManagedAccount({ issuer: 'https://account.example', directory: dir, runtimeDirectory: () => dir, runtimeEpoch: 'fixture-epoch', safeStorage: storage, openExternal: async () => {}, fetcher: async (url, init) => {
    const u = new URL(url)
    if (u.pathname === '/account/me') return Response.json({ user: { id: owner }, plan: 'pro' })
    if (u.pathname === '/account/models') return Response.json({ models: [{ id: 'gpt-image-2', kind: 'image', protocol: 'openai', available: true }] })
    calls.push({ method: init.method, path: u.pathname })
    assert.equal(init.method, 'GET')
    assert.equal(u.pathname, '/account/requests/' + id)
    return Response.json({ request: { id: `${owner}:${id}`, ...cases[calls.length - 1] } })
  } })
  t.after(() => { account.dispose(); fs.rmSync(dir, { recursive: true, force: true }) })
  await account.run('status')
  const py = `import json,sys\nfrom unittest.mock import patch\nfrom core import ai_image_service, data_sink\nfrom core.managed_models import session\ndirectory, count = sys.argv[1], int(sys.argv[2])\nwith patch('core.runtime_paths.data_root', return_value=__import__('pathlib').Path(directory)):\n data_sink.init_db()\n job=data_sink.create_ai_image_job({'model_key':'custom-managed-openai/gpt-image-2'})\n data_sink.update_ai_image_job(job['job_uid'],{'summary':{'runs':[{'run_uid':'run','managed_owner_id':'fixture-owner','managed_request_id':'${id}'}]}})\n print(json.dumps([ai_image_service.trace_managed_image_request(job['job_uid'],'run') for _ in range(count)]))\n`
  const { stdout } = await execFileAsync(python, ['-c', py, dir, String(cases.length)], { cwd: root, env: { ...process.env, CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH: 'fixture-epoch' } })
  const traces = JSON.parse(stdout)
  assert.equal(calls.length, cases.length)
  assert.deepEqual(traces.map(v => v.state), cases.map(v => v.state))
  assert.deepEqual(traces.slice(0, 6).map(v => v.queue.state), ['waiting', 'running', 'unknown', 'not_dispatched', 'completed', 'rejected'])
  assert.deepEqual(traces.slice(6, 9).map(v => v.queue_status), ['unavailable', 'classification_unconfirmed', 'invalid'])
  assert.equal(traces[8].queue, null)
  assert.equal('queue' in traces[9], false)
  const source = fs.readFileSync(path.join(root, 'app/src/renderer/views/AiImageWorkbench.vue'), 'utf8')
  const fragment = source.slice(source.indexOf('async function recheckResultRecord('), source.indexOf('async function retryFailedRun('))
  const descriptions = ['排队中', '已开始处理', '结果未知', '未派发', '处理完成', '已拒绝', '队列状态暂不可确认', '队列状态暂不可确认', '队列状态暂不可确认', '结果未知', '处理中', '未转发']
  for (let i = 0; i < traces.length; i++) {
    let submissionCount = 0
    const job = { job_uid: 'fixture-job', summary: { runs: [{ run_uid: 'run', managed_request_id: id }] } }
    const context = { activeJobUid: { value: 'fixture-job' }, pendingActiveJobUid: { value: '' }, taskSelectionGeneration: 0, resultRecheckGeneration: 0, currentJob: { value: null }, errorMessage: { value: '' }, resultOwnerJobUid: () => 'fixture-job', upsertJob() {}, window: { cs: { getAiImageJob: async () => job, traceAiImageManagedRequest: async () => traces[i], runAiImageJob: async () => { submissionCount++ } } } }
    vm.runInNewContext(fragment, context)
    await context.recheckResultRecord({ runUid: 'run' })
    assert.match(context.errorMessage.value, new RegExp(descriptions[i]))
    assert.match(context.errorMessage.value, /未重复生成/)
    assert.equal(submissionCount, 0)
  }
})

test('client timeout before and after simulated dispatch keeps one original receipt and never resubmits', async t => {
  const root = path.resolve(__dirname, '../..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-queue-timeout-'))
  const owner = 'fixture-owner', states = new Map(), counts = { posts: 0, dispatches: 0, reads: 0, aborts: 0 }
  const storage = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() }
  fs.writeFileSync(path.join(dir, 'modeljetty-session.enc'), JSON.stringify({ session: JSON.stringify({ access_token: 'fixture-token', expiresAt: Date.now() + 3600000 }) }))
  const account = createManagedAccount({ issuer: 'https://account.example', directory: dir, runtimeDirectory: () => dir, runtimeEpoch: 'fixture-epoch', safeStorage: storage, openExternal: async () => {}, fetcher: async (url, init) => {
    const u = new URL(url)
    if (u.pathname === '/account/me') return Response.json({ user: { id: owner }, plan: 'pro' })
    if (u.pathname === '/account/models') return Response.json({ models: [{ id: 'gpt-image-2', kind: 'image', protocol: 'openai', available: true }] })
    if (u.pathname.startsWith('/account/requests/')) {
      assert.equal(init.method, 'GET'); counts.reads++
      const id = u.pathname.split('/').pop(), entry = states.get(id)
      assert.ok(entry)
      return Response.json({ request: { id: `${owner}:${id}`, state: entry.account, queue: { request_id: id, state: entry.queue } } })
    }
    assert.equal(u.pathname, '/account/inference/v1/images/generations')
    assert.equal(init.method, 'POST'); counts.posts++
    const id = new Headers(init.headers).get('x-request-id'), prompt = JSON.parse(init.body).prompt
    assert.ok(!states.has(id), 'same request id must never be sent twice')
    if (prompt === 'queue-expired') {
      states.set(id, { account: 'not_dispatched', queue: 'not_dispatched' })
      return Response.json({ error: 'image_request_not_dispatched', request_id: id }, { status: 503 })
    }
    const dispatch = prompt === 'after-dispatch'
    const entry = { account: 'waiting', queue: dispatch ? 'running' : 'waiting' }
    states.set(id, entry)
    if (dispatch) counts.dispatches++
    await new Promise((resolve, reject) => {
      const aborted = () => {
        counts.aborts++
        entry.account = dispatch ? 'unknown' : 'not_dispatched'
        entry.queue = dispatch ? 'unknown' : 'not_dispatched'
        if (dispatch) setTimeout(() => { entry.account = 'completed'; entry.queue = 'completed' }, 200)
        reject(new DOMException('fixture client disconnected', 'AbortError'))
      }
      if (init.signal.aborted) aborted()
      else init.signal.addEventListener('abort', aborted, { once: true })
    })
  } })
  t.after(() => { account.dispose(); fs.rmSync(dir, { recursive: true, force: true }) })
  await account.run('status')
  const py = `import json,sys,time\nfrom pathlib import Path\nfrom unittest.mock import patch\nfrom core import ai_image_service,data_sink,managed_models,image_providers\nfrom core.image_providers import CompatibleImageClient\ndirectory=Path(sys.argv[1])\nwith patch('core.runtime_paths.data_root',return_value=directory):\n data_sink.init_db()\n s=managed_models.session()\n p={'id':'custom-managed-openai','name':'fixture','protocol':'openai','base_url':s['baseURL']+'/v1','models':['gpt-image-2']}\n settings={'ai.image.custom_providers':[p],'ai.image.custom.custom-managed-openai.api_key':s['brokerToken']}\n original=image_providers._compatible_transport\n def short(*args,**kwargs):\n  kwargs['timeout']=0.10\n  return original(*args,**kwargs)\n output=[]\n with patch('core.managed_models.image_providers',return_value=[p]),patch('core.image_providers._compatible_transport',side_effect=short):\n  for prompt in ('before-dispatch','after-dispatch','queue-expired'):\n   job=data_sink.create_ai_image_job({'model_key':'custom-managed-openai/gpt-image-2','prompt':prompt,'params':{'size':'1024x1024'}})\n   result=ai_image_service.run_job_with_one_xm(job['job_uid'],settings=settings)\n   run=data_sink.get_ai_image_job(job['job_uid'])['summary']['runs'][-1]\n   assert not result['ok'] and run['error_code']=='UNKNOWN_SUBMIT_RESULT'\n   first=ai_image_service.trace_managed_image_request(job['job_uid'],run['run_uid'])\n   try: ai_image_service.retry_workbench_run(job['job_uid'],run['run_uid'],settings=settings); raise AssertionError('unexpected retry')\n   except ValueError as e: assert '回执未知' in str(e)\n   time.sleep(.5)\n   second=ai_image_service.trace_managed_image_request(job['job_uid'],run['run_uid'])\n   assert first['request_id']==run['managed_request_id']==second['request_id']\n   assert data_sink.get_ai_image_job(job['job_uid'])['summary']['runs'][-1]['error_code']=='UNKNOWN_SUBMIT_RESULT'\n   output.append([first['queue']['state'],second['queue']['state']])\n print(json.dumps(output))\n`
  const { stdout } = await execFileAsync(python, ['-c', py, dir], { cwd: root, env: { ...process.env, CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH: 'fixture-epoch' }, timeout: 10000 })
  const observed = JSON.parse(stdout)
  assert.ok(['waiting', 'not_dispatched'].includes(observed[0][0]))
  assert.ok(['running', 'unknown'].includes(observed[1][0]))
  assert.deepEqual(observed[2], ['not_dispatched', 'not_dispatched'])
  assert.deepEqual(observed.map(x => x[1]), ['not_dispatched', 'completed', 'not_dispatched'])
  assert.deepEqual(counts, { posts: 3, dispatches: 1, reads: 6, aborts: 2 })
})
