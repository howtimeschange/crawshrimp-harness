import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as balaWorkflow from '../app/src/renderer/utils/balaAiVideoWorkflow.js'
import {
  buildBalaMaterialPrepareParams,
  buildBalaAiStageRequest,
  applyBalaMaterialBatchToWorkspaceGroups,
  buildBalaMaterialRowsFromWorkspaceGroups,
  buildBalaVideoStageRequest,
  latestRunForTaskData,
  mergeBalaVideoResults,
  normalizeBalaMaterialGroups,
  normalizeBalaReviewBatchStyles,
  normalizeBalaTemplateCatalog,
  normalizeBalaVideoResultRows,
  normalizeStyleCodeLines,
  normalizeWorkflowStageStatus,
  parseRunOutputFiles,
  parseBalaReviewBoardUrl,
  qnVideoHistoryResultMatchesTask,
  summarizeBalaMaterialGroups,
  summarizeBalaReviewBatch,
} from '../app/src/renderer/utils/balaAiVideoWorkflow.js'

test('AI video workflow builds hidden Semir material prepare params from business fields', () => {
  const params = buildBalaMaterialPrepareParams({
    itemCodes: '208326102205\n208326102205，208326105214',
    cloudPath: ' 巴拉营运BU-商品//根目录/ ',
    exportFolder: ' /tmp/bala-video ',
    packageName: ' 第一批 ',
  })

  assert.deepEqual(normalizeStyleCodeLines('208326102205，208326102205\n208326105214'), [
    '208326102205',
    '208326105214',
  ])
  assert.equal(params.mode, 'new')
  assert.equal(params.folder_scan_depth, 2)
  assert.equal(params.duplicate_mode, 'first_per_hash')
  assert.equal(params.download_concurrency, 8)
  assert.equal(params.max_image_mb, 10)
  assert.equal(params.item_codes, '208326102205\n208326105214')
  assert.equal(params.cloud_path, '巴拉营运BU-商品//根目录/')
  assert.equal(params.export_folder, '/tmp/bala-video')
  assert.equal(params.package_name, '第一批')
})

test('AI video workflow normalizes task output files and material batch groups', () => {
  assert.deepEqual(parseRunOutputFiles('["/tmp/a.xlsx","/tmp/b.json"]'), ['/tmp/a.xlsx', '/tmp/b.json'])
  assert.equal(latestRunForTaskData({ runs: [{ id: 1 }, { id: 2 }] }, '2')?.id, 2)

  const groups = normalizeBalaMaterialGroups({
    fallbackCodes: ['208326108104'],
    batch: {
      status: 'selected',
      items: [{
        style_code: '208326102205',
        assets: [
          { id: 'm1', source_type: 'model', filename: 'front.jpg', path: '/tmp/front.jpg', image_url: '/image/m1', thumbnail_url: '/thumbnail/m1', selected: true },
          { id: 'd1', source_type: 'detail', filename: 'neck.jpg', path: '/tmp/neck.jpg', selected: false },
        ],
      }],
    },
    rows: [{
      输入款号: '208326102205',
      素材来源: '商品细节图',
      文件名: 'hangtag.jpg',
      下载结果: '已跳过',
      处理动作: '已过滤',
      备注: '标签类素材已过滤',
    }],
  })

  const main = groups.find(group => group.styleCode === '208326102205')
  assert.equal(main.modelPhotos.length, 1)
  assert.equal(main.modelPhotos[0].thumbnailUrl, '/thumbnail/m1')
  assert.equal(main.detailPhotos.length, 1)
  assert.equal(main.skippedRows.length, 1)
  assert.ok(groups.some(group => group.styleCode === '208326108104'))
  assert.deepEqual(summarizeBalaMaterialGroups(groups), {
    styleCount: 2,
    modelCount: 1,
    detailCount: 1,
    selectedCount: 1,
    skippedCount: 1,
    failedCount: 0,
  })
})

test('material recall merges later batches by style without dropping the current selections', () => {
  assert.equal(typeof balaWorkflow.mergeBalaMaterialGroups, 'function')
  const merged = balaWorkflow.mergeBalaMaterialGroups([
    {
      styleCode: '208326102205',
      modelPhotos: [{ id: 'old-model', path: '/tmp/old.jpg', name: 'old.jpg', selected: true, versions: [] }],
      detailPhotos: [], otherPhotos: [], skippedRows: [], errors: [], generated: [],
    },
  ], [
    {
      styleCode: '208326108104',
      modelPhotos: [{ id: 'new-model', path: '/tmp/new.jpg', name: 'new.jpg', selected: false, versions: [] }],
      detailPhotos: [], otherPhotos: [], skippedRows: [], errors: [], generated: [],
    },
  ])

  assert.deepEqual(merged.map(item => item.styleCode), ['208326102205', '208326108104'])
  assert.equal(merged[0].modelPhotos[0].selected, true)
})

test('material recall keeps one card per filename inside the same style and source type', () => {
  const merged = balaWorkflow.mergeBalaMaterialGroups([{
    styleCode: '208326102205',
    modelPhotos: [{ id: 'first-copy', path: '/tmp/first/1-AI.jpg', name: '1-AI.jpg', selected: true, versions: [] }],
    detailPhotos: [], otherPhotos: [], skippedRows: [], errors: [], generated: [],
  }], [{
    styleCode: '208326102205',
    modelPhotos: [{ id: 'later-copy', path: '/tmp/later/1-AI.jpg', name: '1-AI.jpg', selected: false, versions: [] }],
    detailPhotos: [], otherPhotos: [], skippedRows: [], errors: [], generated: [],
  }])

  assert.equal(merged[0].modelPhotos.length, 1)
  assert.equal(merged[0].modelPhotos[0].path, '/tmp/first/1-AI.jpg')
  assert.equal(merged[0].modelPhotos[0].selected, true)
})

test('material recall keeps same filename from different selected cloud folders', () => {
  const merged = balaWorkflow.mergeBalaMaterialGroups([{
    styleCode: '208326121202',
    modelPhotos: [{
      id: 'selected-june',
      path: '/tmp/june/208326121202-01315.jpg',
      name: '208326121202-01315.jpg',
      folder: '模拍原图/期货/2P/中童/208326121202-品类已回5.21-AI新回字6.5已选6.5',
      selected: true,
      versions: [],
    }],
    detailPhotos: [], otherPhotos: [], skippedRows: [], errors: [], generated: [],
  }], [{
    styleCode: '208326121202',
    modelPhotos: [{
      id: 'selected-july',
      path: '/tmp/july/208326121202-01315.jpg',
      name: '208326121202-01315.jpg',
      folder: '模拍原图/期货/2P/中童/208326121202-卫衣-已选7.24',
      selected: true,
      versions: [],
    }],
    detailPhotos: [], otherPhotos: [], skippedRows: [], errors: [], generated: [],
  }])

  assert.equal(merged[0].modelPhotos.length, 2)
  assert.deepEqual(merged[0].modelPhotos.map(asset => asset.folder), [
    '模拍原图/期货/2P/中童/208326121202-品类已回5.21-AI新回字6.5已选6.5',
    '模拍原图/期货/2P/中童/208326121202-卫衣-已选7.24',
  ])
  assert.equal(merged[0].modelPhotos.every(asset => asset.selected), true)
})

test('material batch recovery includes restored AI result versions and relinks new batch ids', () => {
  const groups = [{
    styleCode: '208326102205',
    modelPhotos: [{
      id: 'old-source-id',
      name: 'front.jpg',
      path: '/workspace/208326102205/01_模拍原图/front.jpg',
      sourceType: 'model',
      selected: true,
      versions: [{
        id: 'ai-version',
        label: '换脸 01',
        operationType: 'face_swap',
        previewPath: '/workspace/208326102205/03_AI图/front-ai.png',
        selected: true,
      }, {
        id: 'deleted-ai-version',
        previewPath: '/workspace/208326102205/03_AI图/deleted.png',
        deleted: true,
      }],
    }],
    detailPhotos: [{
      id: 'old-detail-id',
      name: 'neck.jpg',
      path: '/workspace/208326102205/02_商品细节图/neck.jpg',
      sourceType: 'detail',
      selected: false,
      versions: [{
        id: 'detail-ai-version',
        label: '细节换背景',
        operationType: 'background_swap',
        previewPath: '/workspace/208326102205/03_AI图/neck-ai.png',
        selected: true,
      }],
    }],
  }]

  const rows = buildBalaMaterialRowsFromWorkspaceGroups(groups)

  assert.deepEqual(rows.map(row => [row.素材来源, row.本地文件, row.备注]), [
    ['模拍图', '/workspace/208326102205/01_模拍原图/front.jpg', '从本地工作区恢复'],
    ['模拍图', '/workspace/208326102205/03_AI图/front-ai.png', '从本地 AI 结果恢复'],
    ['商品细节图', '/workspace/208326102205/02_商品细节图/neck.jpg', '从本地工作区恢复'],
    ['商品细节图', '/workspace/208326102205/03_AI图/neck-ai.png', '从本地 AI 结果恢复'],
  ])

  const result = applyBalaMaterialBatchToWorkspaceGroups(groups, {
    items: [{
      assets: [
        { id: 'new-source-id', path: '/workspace/208326102205/01_模拍原图/front.jpg', image_url: '/image/source' },
        { id: 'new-ai-id', path: '/workspace/208326102205/03_AI图/front-ai.png', image_url: '/image/ai' },
        { id: 'new-detail-id', path: '/workspace/208326102205/02_商品细节图/neck.jpg', thumbnail_url: '/thumb/detail' },
        { id: 'new-detail-ai-id', path: '/workspace/208326102205/03_AI图/neck-ai.png', image_url: '/image/detail-ai' },
      ],
    }],
  })

  assert.deepEqual(result, { linkedAssets: 2, linkedVersions: 2, totalLinked: 4 })
  assert.equal(groups[0].modelPhotos[0].id, 'new-source-id')
  assert.equal(groups[0].modelPhotos[0].versions[0].materialAssetId, 'new-ai-id')
  assert.equal(groups[0].modelPhotos[0].versions[0].sourceAssetId, 'new-source-id')
  assert.equal(groups[0].modelPhotos[0].versions[0].imageUrl, '/image/ai')
  assert.equal(groups[0].detailPhotos[0].id, 'new-detail-id')
  assert.equal(groups[0].detailPhotos[0].versions[0].materialAssetId, 'new-detail-ai-id')
  assert.equal(groups[0].detailPhotos[0].versions[0].imageUrl, '/image/detail-ai')
})

test('restored material groups dedupe legacy paths without reselecting AI-named files', () => {
  const restored = balaWorkflow.mergeBalaMaterialGroups([], [{
    styleCode: '208326108104',
    modelPhotos: [
      { id: 'direct', path: '/workspace/208326108104/01_模拍原图/same.jpg', name: 'same.jpg', selected: false, versions: [] },
      { id: 'legacy', path: '/workspace/legacy/208326108104/01_模拍原图/same.jpg', name: 'same.jpg', selected: false, versions: [] },
      { id: 'saved-ai', path: '/workspace/legacy/208326108104/01_模拍原图/o-AI(2).png', name: 'o-AI(2).png', selected: false, versions: [] },
    ],
    detailPhotos: [], otherPhotos: [], skippedRows: [], errors: [], generated: [],
  }])

  assert.equal(restored[0].modelPhotos.length, 2)
  assert.equal(restored[0].modelPhotos.find(asset => asset.name === 'o-AI(2).png')?.selected, false)
})

test('workspace polling ignores hidden duplicate batch files and stays stable after the first render', () => {
  assert.equal(typeof balaWorkflow.reconcileBalaWorkspaceFiles, 'function')

  const preferredPath = '/workspace/latest/208326102205/01_模拍原图/1-AI.jpg'
  const existingGroups = [{
    styleCode: '208326102205',
    modelPhotos: [{
      id: 'visible-copy',
      path: preferredPath,
      name: '1-AI.jpg',
      filename: '1-AI.jpg',
      sourceType: 'model',
      fileVersion: 'v1',
      selected: true,
      versions: [],
    }],
    detailPhotos: [],
    otherPhotos: [],
    skippedRows: [],
    errors: [],
    generated: [],
  }]
  const scannedFiles = [
    {
      path: '/workspace/legacy/208326102205/01_模拍原图/1-AI.jpg',
      name: '1-AI.jpg',
      styleCode: '208326102205',
      sourceType: 'model',
      version: 'v1',
    },
    {
      path: preferredPath,
      name: '1-AI.jpg',
      styleCode: '208326102205',
      sourceType: 'model',
      version: 'v1',
    },
  ]

  const firstPoll = balaWorkflow.reconcileBalaWorkspaceFiles(existingGroups, scannedFiles)
  const secondPoll = balaWorkflow.reconcileBalaWorkspaceFiles(firstPoll.groups, scannedFiles)

  assert.equal(firstPoll.changed, false)
  assert.deepEqual(firstPoll.changedPaths, [])
  assert.equal(firstPoll.groups[0].modelPhotos.length, 1)
  assert.equal(firstPoll.groups[0].modelPhotos[0].path, preferredPath)
  assert.equal(secondPoll.changed, false)
  assert.deepEqual(secondPoll.changedPaths, [])
})

test('AI-named material is not auto-selected while duplicate filenames collapse across source folders', () => {
  const groups = normalizeBalaMaterialGroups({
    batch: {
      status: 'pending_selection',
      items: [{
        style_code: '208326102205',
        assets: [
          { id: 'detail-copy', source_type: 'detail', filename: 'same.jpg', path: '/tmp/detail/same.jpg' },
          { id: 'ai', source_type: 'model', filename: 'lookAI-result.jpg', path: '/tmp/model/lookAI-result.jpg' },
          { id: 'model-copy', source_type: 'model', filename: 'same.jpg', path: '/tmp/model/same.jpg' },
        ],
      }],
    },
  })

  assert.equal(groups[0].modelPhotos.find(asset => asset.filename === 'lookAI-result.jpg')?.selected, false)
  assert.equal(groups[0].modelPhotos.length + groups[0].detailPhotos.length, 2)
  assert.equal(balaWorkflow.sortBalaMaterialAssets([
    { filename: 'z.jpg', selected: false },
    { filename: 'firstAI.jpg', selected: true },
  ])[0].filename, 'firstAI.jpg')
})

test('AI image generation is marked backend-only so it never creates an about:blank CDP tab', () => {
  const api = fs.readFileSync('core/api_server.py', 'utf8')
  assert.match(api, /def _is_browserless_task\(adapter_id: str, task_id: str\) -> bool:/)
  assert.match(api, /is_browserless_task = _is_browserless_task\(adapter_id, task_id\)/)
  assert.match(api, /if is_browserless_task:[\s\S]{0,260}tab = \{"id": "", "url": "backend:\/\/task"\}/)
})

test('AI video workflow restores downloaded Excel rows into material groups without duplicating batch assets', () => {
  const downloadedRow = {
    输入款号: '208326102205',
    素材来源: '模拍图',
    文件名: '1-AI.jpg',
    下载结果: '已下载',
    本地文件: '/tmp/208326102205/01_模拍原图/1-AI.jpg',
    处理动作: '保留AI模拍图',
  }

  const rowOnlyGroups = normalizeBalaMaterialGroups({ rows: [downloadedRow] })
  assert.equal(rowOnlyGroups.length, 1)
  assert.equal(rowOnlyGroups[0].modelPhotos.length, 1)
  assert.equal(rowOnlyGroups[0].modelPhotos[0].path, downloadedRow.本地文件)
  assert.equal(rowOnlyGroups[0].modelPhotos[0].selected, false)

  const groupsWithBatch = normalizeBalaMaterialGroups({
    batch: {
      status: 'pending_selection',
      items: [{
        style_code: '208326102205',
        assets: [{
          id: 'model-1',
          source_type: 'model',
          filename: '1-AI.jpg',
          path: downloadedRow.本地文件,
          selected: true,
        }],
      }],
    },
    rows: [downloadedRow],
  })
  assert.equal(groupsWithBatch[0].modelPhotos.length, 1)
  assert.equal(groupsWithBatch[0].modelPhotos[0].selected, true)

  const persistedSelection = normalizeBalaMaterialGroups({
    batch: {
      status: 'selected',
      items: [{
        style_code: '208326102205',
        assets: [{
          id: 'model-1',
          source_type: 'model',
          filename: '1-AI.jpg',
          path: downloadedRow.本地文件,
          selected: true,
        }],
      }],
    },
  })
  assert.equal(persistedSelection[0].modelPhotos[0].selected, true)
})

test('AI edit source filtering preserves the reactive source object used by click selection', () => {
  const source = {
    name: 'front.jpg',
    selected: true,
    editSelected: false,
    versions: [
      { id: 'v1', editSelected: false, deleted: false },
      { id: 'v2', editSelected: true, deleted: false },
      { id: 'v3', editSelected: true, deleted: true },
    ],
  }
  const style = { modelPhotos: [source] }

  assert.equal(typeof balaWorkflow.selectEditableSourcesForStyle, 'function')
  const visible = balaWorkflow.selectEditableSourcesForStyle(style)
  assert.equal(visible[0], source)
  visible[0].editSelected = true
  assert.equal(source.editSelected, true)
  assert.deepEqual(
    balaWorkflow.selectVisibleEditableVersions(source, true).map(item => item.id),
    ['v2'],
  )
  assert.equal(balaWorkflow.selectEditableSourcesForStyle(style, true)[0], source)
})

test('AI edit source filtering includes selected detail photos from the material step', () => {
  const model = { name: 'front.jpg', sourceType: 'model', selected: true, versions: [] }
  const detail = { name: 'neck.jpg', sourceType: 'detail', selected: true, versions: [] }
  const hiddenDetail = { name: 'tag.jpg', sourceType: 'detail', selected: false, versions: [] }
  const style = { modelPhotos: [model], detailPhotos: [detail, hiddenDetail] }

  assert.deepEqual(
    balaWorkflow.selectEditableSourcesForStyle(style).map(item => [item.name, item.sourceType]),
    [['front.jpg', 'model'], ['neck.jpg', 'detail']],
  )
})

test('AI edit selected-only filter still shows running generation placeholders', () => {
  assert.equal(typeof balaWorkflow.selectVisibleEditableVersions, 'function')
  const source = {
    versions: [
      { id: 'done-hidden', status: 'pending', editSelected: false },
      { id: 'running-visible', status: 'running', editSelected: false },
      { id: 'selected-visible', status: 'pending', editSelected: true },
      { id: 'deleted-hidden', status: 'running', deleted: true },
    ],
  }

  assert.deepEqual(
    balaWorkflow.selectVisibleEditableVersions(source, true).map(version => version.id),
    ['running-visible', 'selected-visible'],
  )
})

test('AI model library applies age and gender filters together', () => {
  const items = [
    { id: 'girl-young', ageLabel: '幼童', gender: '女' },
    { id: 'boy-young', ageLabel: '幼童', gender: '男' },
    { id: 'boy-older', ageLabel: '中大童', gender: '男' },
  ]

  assert.equal(typeof balaWorkflow.filterBalaModelLibraryItems, 'function')
  assert.deepEqual(
    balaWorkflow.filterBalaModelLibraryItems(items, { age: '幼童', gender: '男' }).map(item => item.id),
    ['boy-young'],
  )
  assert.deepEqual(
    balaWorkflow.filterBalaModelLibraryItems(items, { age: '', gender: '男' }).map(item => item.id),
    ['boy-young', 'boy-older'],
  )
})

test('AI model labels hide internal numeric group identifiers', () => {
  assert.equal(typeof balaWorkflow.formatBalaModelDisplayLabel, 'function')
  const label = balaWorkflow.formatBalaModelDisplayLabel({
    group: '100',
    group_label: '100 男 幼童',
    age_label: '幼童',
    gender: '男',
    expression: '标准',
  })
  assert.equal(label, '幼童 / 男 / 标准')
  assert.doesNotMatch(label, /\b(?:66|73|100|140)\b/)
})

test('AI video workflow derives independent search and download progress', () => {
  assert.equal(typeof balaWorkflow.normalizeBalaMaterialProgress, 'function')
  const progress = balaWorkflow.normalizeBalaMaterialProgress({
    search_total_codes: 4,
    search_completed_codes: 3,
    download_total: 20,
    download_completed: 7,
    download_success: 6,
    download_failed: 1,
  })
  assert.deepEqual(progress, {
    searchTotal: 4,
    searchCompleted: 3,
    searchProgress: 75,
    downloadTotal: 20,
    downloadCompleted: 7,
    downloadProgress: 35,
    downloaded: 6,
    failed: 1,
  })
})

test('AI video workflow only binds material polling to a newly started run', () => {
  assert.equal(typeof balaWorkflow.selectNewTaskRun, 'function')
  assert.equal(balaWorkflow.selectNewTaskRun({
    live: { run_id: null, status: 'running' },
    last_run: { id: 6, status: 'done' },
  }, '6'), null)
  assert.deepEqual(balaWorkflow.selectNewTaskRun({
    live: { run_id: 7, status: 'running' },
    last_run: { id: 6, status: 'done' },
  }, '6'), {
    runId: '7',
    status: 'running',
    source: 'live',
    snapshot: { run_id: 7, status: 'running' },
  })
  assert.deepEqual(balaWorkflow.selectNewTaskRun({
    live: null,
    last_run: { id: 7, status: 'error', error: '目标页面启动失败' },
  }, '6'), {
    runId: '7',
    status: 'failed',
    source: 'last_run',
    snapshot: { id: 7, status: 'error', error: '目标页面启动失败' },
  })
})

test('AI video workflow rebases runtime Excel paths into the selected workspace package', () => {
  assert.equal(typeof balaWorkflow.rebaseBalaMaterialRowsToWorkspace, 'function')
  const rows = balaWorkflow.rebaseBalaMaterialRowsToWorkspace({
    workspaceDir: '/Users/demo/巴拉AI视频工作区',
    outputFiles: [
      '/Users/demo/巴拉AI视频工作区/208326102205_20260715',
      '/Users/demo/巴拉AI视频工作区/巴拉AI视频素材准备结果.xlsx',
    ],
    rows: [{
      输入款号: '208326102205',
      素材来源: '模拍图',
      文件名: '1-AI.jpg',
      下载结果: '已下载',
      本地文件: '/runtime/6/208326102205/01_模拍原图/1-AI.jpg',
    }],
  })
  assert.equal(rows[0].本地文件, '/Users/demo/巴拉AI视频工作区/208326102205_20260715/208326102205/01_模拍原图/1-AI.jpg')

  assert.deepEqual(balaWorkflow.rebaseBalaMaterialRowsToWorkspace({
    workspaceDir: '/Users/demo/另一个工作区',
    outputFiles: ['/Users/demo/巴拉AI视频工作区/208326102205_20260715'],
    rows: [{ 本地文件: '/runtime/file.jpg' }],
  }), [])
})

test('AI video workflow status normalization maps runtime states to UI stages', () => {
  assert.equal(normalizeWorkflowStageStatus('running'), 'running')
  assert.equal(normalizeWorkflowStageStatus('queued'), 'queued')
  assert.equal(normalizeWorkflowStageStatus('done'), 'done')
  assert.equal(normalizeWorkflowStageStatus('partial_failed'), 'partial')
  assert.equal(normalizeWorkflowStageStatus('error'), 'failed')
  assert.equal(normalizeWorkflowStageStatus('stopped'), 'stopped')
})

test('buildBalaAiStageRequest targets AI generation with selected material images', () => {
  const request = buildBalaAiStageRequest({
    next_task: {
      adapter_id: 'bala-ai-video-assistant',
      task_id: 'bala_ai_face_background_generate',
      params: {
        operation_type: 'pose_swap',
        source_images: { paths: ['/tmp/model.jpg'] },
        pose_prompt: '自然侧身行走',
      },
    },
  })

  assert.equal(request.adapterId, 'bala-ai-video-assistant')
  assert.equal(request.taskId, 'bala_ai_face_background_generate')
  assert.equal(request.params.operation_type, 'pose_swap')
  assert.deepEqual(request.params.source_images.paths, ['/tmp/model.jpg'])
})

test('Bala model library picker exposes visual age and gender filters', () => {
  const source = fs.readFileSync('app/src/renderer/components/BalaModelLibraryPickerModal.vue', 'utf8')

  assert.match(source, /选择 AI 模特素材/)
  assert.match(source, /新生儿/)
  assert.match(source, /婴童/)
  assert.match(source, /幼童/)
  assert.match(source, /中大童/)
  assert.match(source, /通用/)
  assert.match(source, /女/)
  assert.match(source, /男/)
  assert.match(source, /image_url/)
  assert.match(source, /selectedModelIds/)
  assert.match(source, /confirmSelection/)
})

test('TaskRunner opens Bala material selection drawer after Semir material preparation', () => {
  const source = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')

  assert.match(source, /BalaAiMaterialSelectionDrawer/)
  assert.match(source, /createBalaMaterialBatch/)
  assert.match(source, /semir_video_material_prepare/)
  assert.match(source, /@start-ai-stage=/)
  assert.match(source, /emit\('open-task'/)
})

test('Bala material drawer scopes prompts and required fields per AI operation', () => {
  const source = fs.readFileSync('app/src/renderer/views/BalaAiMaterialSelectionDrawer.vue', 'utf8')
  const exportStart = source.indexOf('async function exportToAi')
  const exportSource = source.slice(exportStart)

  assert.match(source, /const backgroundPrompt = ref\(''\)/)
  assert.match(source, /const posePrompt = ref\(''\)/)
  assert.match(source, /仅替换脸部，保留原背景、姿势、构图和服装/)
  assert.match(source, /换背景\/换姿势请写在上方主 Prompt/)
  assert.match(source, /selectedOperation\.value !== 'background_swap' \|\| backgroundPrompt\.value\.trim\(\)\.length > 0/)
  assert.match(source, /selectedOperation\.value !== 'outfit_swap' \|\| garmentImagePaths\.value\.length > 0/)
  assert.match(source, /selectedOperation\.value !== 'pose_swap' \|\| posePrompt\.value\.trim\(\)\.length > 0/)
  assert.match(exportSource, /const promptExtraValue = \['background_swap', 'pose_swap'\]\.includes\(selectedOperation\.value\) \? '' : promptExtra\.value/)
  assert.match(exportSource, /background_prompt: selectedOperation\.value === 'background_swap' \? backgroundPrompt\.value\.trim\(\) : ''/)
  assert.match(exportSource, /garment_images: selectedOperation\.value === 'outfit_swap' \? \{ paths: garmentImagePaths\.value \} : \{ paths: \[\] \}/)
  assert.match(exportSource, /pose_prompt: selectedOperation\.value === 'pose_swap' \? posePrompt\.value\.trim\(\) : ''/)
  assert.match(exportSource, /prompt_extra: promptExtraValue/)
})

test('App handles Bala workflow open-task handoff with initial params', () => {
  const source = fs.readFileSync('app/src/renderer/App.vue', 'utf8')

  assert.match(source, /@open-task="openTaskFromRunner"/)
  assert.match(source, /taskRunnerHandoffParams/)
  assert.match(source, /taskRunnerHandoffKey/)
  assert.match(source, /function openTaskFromRunner/)
  assert.match(source, /activeTaskId\.value = taskId/)
})

test('Bala review helpers parse board URL and build qn video handoff params', () => {
  const parsed = parseBalaReviewBoardUrl('http://127.0.0.1:18765/bala-ai-video-review/bala-1?token=abc')
  assert.deepEqual(parsed, { batchId: 'bala-1', token: 'abc' })

  const request = buildBalaVideoStageRequest({
    next_task: {
      adapter_id: 'bala-ai-video-assistant',
      task_id: 'qn_img2video_batch',
      params: {
        material_images: { paths: ['/tmp/approved.png'] },
        download_template_previews: true,
        download_videos: true,
      },
    },
  })
  assert.equal(request.taskId, 'qn_img2video_batch')
  assert.deepEqual(request.params.material_images.paths, ['/tmp/approved.png'])
  assert.equal(request.params.download_template_previews, true)
  assert.equal(request.params.download_videos, true)

  const summary = summarizeBalaReviewBatch({
    items: [{ assets: [
      { kind: 'origin', status: 'pending' },
      { kind: 'ai', status: 'pending' },
      { kind: 'ai', status: 'approved' },
    ] }],
  })
  assert.deepEqual(summary, { total: 3, pending: 2, approved: 1, rejected: 0, generating: 0, failed: 0 })
})

test('AI video workflow maps real review batch assets into style cards', () => {
  const styles = normalizeBalaReviewBatchStyles({
    items: [{
      style_code: '208326102205',
      assets: [
        { id: 'origin-1', kind: 'origin', path: '/tmp/source.jpg', status: 'reference' },
        {
          id: 'ai-1',
          kind: 'ai',
          status: 'approved',
          operation_type: 'background_swap',
          path: '/tmp/result.png',
          source_path: '/tmp/source.jpg',
          image_url: '/bala-ai-video-review/api/batch/image/ai-1?token=t',
        },
      ],
    }],
  })

  assert.equal(styles.length, 1)
  assert.equal(styles[0].styleCode, '208326102205')
  assert.equal(styles[0].sourceAssets[0].role, '原图')
  assert.equal(styles[0].sourceAssets[0].action, '原图')
  assert.equal(styles[0].sourceAssets[0].operationType, 'origin')
  assert.equal(styles[0].assets[0].status, 'approved')
  assert.equal(styles[0].assets[0].action, 'AI 换背景')
})

test('Bala material prepare defaults to a new browser page', () => {
  const manifestSource = fs.readFileSync('adapters/bala-ai-video-assistant/manifest.yaml', 'utf8')
  const materialTaskBlock = manifestSource.split('  - id: bala_ai_face_background_generate')[0]
  assert.match(materialTaskBlock, /- id: mode[\s\S]*?default: new/)
  assert.match(materialTaskBlock, /label: 全新页面（推荐）/)
})

test('AI video workflow normalizes local template catalog and qn result rows', () => {
  const templates = normalizeBalaTemplateCatalog({
    templates: [{
      templateId: '641241_62536236_21',
      title: '领口',
      slotDescription: '7:模特全身(必填)',
      ratio: '3:4',
      duration: 13,
      localPreviewVideo: '/tmp/template.mp4',
      localCoverImage: '/tmp/template.png',
    }],
  })
  assert.equal(templates[0].id, '641241_62536236_21')
  assert.equal(templates[0].description, '7:模特全身(必填)')
  assert.equal(templates[0].video, '/tmp/template.mp4')

  const results = normalizeBalaVideoResultRows([{
    款号: '208326102205',
    模板名称: '领口',
    提交任务ID: 'task-1',
    本地视频文件: '/tmp/out.mp4',
    执行结果: '成功',
  }], { provider: 'qn' })
  assert.equal(results[0].styleCode, '208326102205')
  assert.equal(results[0].status, '已完成')
  assert.equal(results[0].progress, 100)
  assert.equal(results[0].path, '/tmp/out.mp4')
})

test('completed business-manager result replaces the same task loading placeholder', () => {
  const merged = mergeBalaVideoResults([
    {
      id: 'video-task-42',
      taskRefId: 'video-task-42',
      status: '生成中',
      path: '',
      videoUrl: '',
    },
  ], [
    {
      id: 'video-task-42-provider-result-7',
      taskRefId: 'video-task-42',
      status: '已完成',
      path: '/tmp/finished.mp4',
      videoUrl: '',
    },
  ])

  assert.deepEqual(merged, [{
    id: 'video-task-42-provider-result-7',
    taskRefId: 'video-task-42',
    status: '已完成',
    path: '/tmp/finished.mp4',
    videoUrl: '',
  }])
})

test('failed business-manager result replaces the same task loading placeholder', () => {
  const merged = mergeBalaVideoResults([
    {
      id: 'video-task-42-progress',
      taskRefId: 'video-task-42',
      status: '生成中',
      providerStatus: 'running',
      progress: 100,
      path: '',
      videoUrl: '',
    },
  ], [
    {
      id: 'video-task-42-failed',
      taskRefId: 'video-task-42',
      status: '失败',
      providerStatus: 'failed',
      path: '',
      videoUrl: '',
      error: '文件过大，不能超过10M',
    },
  ])

  assert.deepEqual(merged, [{
    id: 'video-task-42-failed',
    taskRefId: 'video-task-42',
    status: '失败',
    providerStatus: 'failed',
    path: '',
    videoUrl: '',
    error: '文件过大，不能超过10M',
  }])
})

test('business-manager history matching does not restore stale same-style results for a tracked run', () => {
  const task = {
    styleCode: '208326105009',
    runId: '205',
    providerTaskId: '205',
  }

  assert.equal(qnVideoHistoryResultMatchesTask({
    raw: {
      款号: '208326105009',
      提交任务ID: '163496606139',
    },
    taskId: '163496606139',
  }, task), false)
  assert.equal(qnVideoHistoryResultMatchesTask({
    raw: {
      款号: '208326105009',
      提交任务ID: '205',
    },
    taskId: '205',
  }, task), true)
  assert.equal(qnVideoHistoryResultMatchesTask({
    raw: {
      款号: '208326105009',
    },
  }, task), false)
  assert.equal(qnVideoHistoryResultMatchesTask({
    raw: {
      款号: '208326105009',
    },
  }, { styleCode: '208326105009' }), true)
})

test('Bala image review drawer exposes approval, retry, refresh, and video handoff actions', () => {
  const source = fs.readFileSync('app/src/renderer/views/BalaAiImageReviewDrawer.vue', 'utf8')

  assert.match(source, /巴拉 AI 图片审核/)
  assert.match(source, /getBalaReviewBatch/)
  assert.match(source, /saveBalaReviewDecisions/)
  assert.match(source, /refreshBalaReviewBatch/)
  assert.match(source, /regenerateBalaReviewAsset/)
  assert.match(source, /exportBalaVideoInput/)
  assert.match(source, /start-video-stage/)
  assert.match(source, /进入视频生成/)
  assert.match(source, /submit_async:\s*true/)
  assert.match(source, /QN_VIDEO_MODEL_OPTIONS/)
  assert.match(source, /<span>生成档位<\/span>/)
  assert.match(source, /<span>视频时长<\/span>/)
  assert.match(source, /video_model:\s*normalizeQnVideoModel\(videoModel\.value\)/)
  assert.match(source, /video_duration:\s*normalizeQnVideoDuration\(videoDuration\.value\)/)
})

test('TaskRunner opens Bala image review drawer after AI generation', () => {
  const source = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')

  assert.match(source, /BalaAiImageReviewDrawer/)
  assert.match(source, /bala_ai_face_background_generate/)
  assert.match(source, /findBalaReviewBoardUrl/)
  assert.match(source, /maybeOpenBalaImageReview/)
  assert.match(source, /@start-video-stage=/)
})

test('Bala review bridge is exposed in preload and dev fallback', () => {
  const preload = fs.readFileSync('app/src/preload.js', 'utf8')
  const devBridge = fs.readFileSync('app/src/renderer/utils/devCsBridge.js', 'utf8')

  for (const source of [preload, devBridge]) {
    assert.match(source, /getBalaReviewBatch/)
    assert.match(source, /saveBalaReviewDecisions/)
    assert.match(source, /refreshBalaReviewBatch/)
    assert.match(source, /regenerateBalaReviewAsset/)
    assert.match(source, /exportBalaVideoInput/)
    assert.match(source, /listBalaVideoTemplates/)
    assert.match(source, /runBalaSeedanceVideo/)
    assert.match(source, /\/bala-ai-video-review\/api/)
    assert.match(source, /\/bala-ai-video-templates\/api/)
    assert.match(source, /\/bala-ai-video-seedance\/api\/run/)
  }
})

test('HappyHorse bridge is exposed in preload and browser fallback', () => {
  const preload = fs.readFileSync('app/src/preload.js', 'utf8')
  const devBridge = fs.readFileSync('app/src/renderer/utils/devCsBridge.js', 'utf8')

  for (const source of [preload, devBridge]) {
    assert.match(source, /getBalaVideoProviderStatus/)
    assert.match(source, /runBalaHappyHorseVideo/)
    assert.match(source, /\/bala-ai-video-providers\/api\/status/)
    assert.match(source, /\/bala-ai-video-happyhorse\/api\/run/)
  }
})

test('AI capability settings provide local secret fields for video providers', () => {
  const settings = fs.readFileSync('app/src/renderer/views/SettingsPage.vue', 'utf8')

  assert.match(settings, /id: 'ai-video'/)
  assert.match(settings, /ai\.video\.seedance_api_key/)
  assert.match(settings, /ai\.video\.bailian_api_key/)
  assert.match(settings, /type="password"/)
})

test('review workspace collapses repeated original filenames in the same style', () => {
  const styles = balaWorkflow.buildBalaReviewWorkspaceStyles([{
    styleCode: '208326102205',
    modelPhotos: [
      { id: 'first', name: '1-AI.jpg', path: '/tmp/first/1-AI.jpg', sourceType: 'model', selected: true },
      { id: 'later', name: '1-AI.jpg', path: '/tmp/later/1-AI.jpg', sourceType: 'model', selected: true },
    ],
    detailPhotos: [],
  }])
  assert.equal(styles[0].assets.length, 1)
  assert.equal(styles[0].assets[0].path, '/tmp/first/1-AI.jpg')
})

test('review workspace merges remote origin decisions by path and keeps remote-only retries', () => {
  assert.equal(typeof balaWorkflow.mergeBalaReviewWorkspaceStyles, 'function')
  const local = [{
    styleCode: '208326102205',
    assets: [
      { id: 'local-origin', kind: 'origin', path: '/tmp/source.jpg', sourcePath: '/tmp/source.jpg', status: 'pending' },
      { id: 'local-ai', kind: 'ai', path: '/tmp/ai.png', sourcePath: '/tmp/source.jpg', status: 'pending' },
    ],
    sourceAssets: [{ id: 'detail-1', kind: 'reference', path: '/tmp/detail.jpg' }],
  }]
  const remote = [{
    styleCode: '208326102205',
    assets: [
      { id: 'remote-ai', kind: 'ai', path: '/tmp/ai.png', sourcePath: '/tmp/source.jpg', status: 'approved' },
      { id: 'retry-new', kind: 'ai', path: '/tmp/retry.png', sourcePath: '/tmp/source.jpg', status: 'pending' },
    ],
    sourceAssets: [
      { id: 'remote-origin', kind: 'origin', path: '/tmp/source.jpg', sourcePath: '/tmp/source.jpg', status: 'rejected' },
    ],
  }]

  const merged = balaWorkflow.mergeBalaReviewWorkspaceStyles(local, remote)

  assert.deepEqual(merged[0].assets.map(asset => [asset.id, asset.kind, asset.status]), [
    ['remote-origin', 'origin', 'rejected'],
    ['remote-ai', 'ai', 'approved'],
    ['retry-new', 'ai', 'pending'],
  ])
  assert.equal(merged[0].sourceAssets.length, 1)
})

test('workspace versions keep results from different review batches that reuse the same asset id', () => {
  assert.equal(typeof balaWorkflow.mergeBalaWorkspaceVersions, 'function')
  const existing = [{
    id: '208326102205-ai-1-face-job',
    remoteAssetId: '208326102205-ai-1',
    jobUid: 'face-job',
    operationType: 'face_swap',
    previewPath: '/tmp/face.png',
  }]
  const merged = balaWorkflow.mergeBalaWorkspaceVersions(existing, [{
    id: '208326102205-ai-1',
    jobUid: 'background-job',
    operationType: 'background_swap',
    path: '/tmp/background.png',
  }])

  assert.equal(merged.length, 2)
  assert.deepEqual(merged.map(item => [item.remoteAssetId, item.jobUid, item.operationType, item.previewPath]), [
    ['208326102205-ai-1', 'face-job', 'face_swap', '/tmp/face.png'],
    ['208326102205-ai-1', 'background-job', 'background_swap', '/tmp/background.png'],
  ])
  assert.notEqual(merged[0].id, merged[1].id)
})

test('workspace versions replace pathless running placeholders with finished AI results', () => {
  assert.equal(typeof balaWorkflow.mergeBalaWorkspaceVersions, 'function')
  const existing = [{
    id: 'pending-face',
    operationType: 'face_swap',
    status: 'running',
    progress: 18,
  }]
  const merged = balaWorkflow.mergeBalaWorkspaceVersions(existing, [{
    id: 'remote-face',
    operationType: 'face_swap',
    path: '/tmp/finished-face.png',
    status: 'pending',
  }])

  assert.equal(merged.length, 1)
  assert.equal(merged[0].remoteAssetId, 'remote-face')
  assert.equal(merged[0].previewPath, '/tmp/finished-face.png')
  assert.equal(merged[0].status, 'pending')
})

test('workspace versions replace AI cache paths with archived workspace paths for the same job', () => {
  assert.equal(typeof balaWorkflow.mergeBalaWorkspaceVersions, 'function')
  const existing = [{
    id: 'remote-face-job-cache',
    remoteAssetId: 'remote-face',
    operationType: 'face_swap',
    status: 'pending',
    jobUid: 'face-job',
    previewPath: '/Users/me/Library/Application Support/crawshrimp/ai-image-cache/result-face.png',
  }]
  const merged = balaWorkflow.mergeBalaWorkspaceVersions(existing, [{
    id: 'remote-face',
    operationType: 'face_swap',
    status: 'pending',
    jobUid: 'face-job',
    path: '/Users/me/Downloads/AI视频/208326102205/03_AI图/result-01.png',
  }])

  assert.equal(merged.length, 1)
  assert.equal(merged[0].previewPath, '/Users/me/Downloads/AI视频/208326102205/03_AI图/result-01.png')
  assert.equal(merged[0].jobUid, 'face-job')
})

test('review workspace keeps same-id AI assets from different persisted batches', () => {
  const first = [{
    styleCode: '208326102205',
    assets: [{
      id: '208326102205-ai-1',
      remoteAssetId: '208326102205-ai-1',
      kind: 'ai',
      jobUid: 'face-job',
      reviewBoardUrl: 'http://127.0.0.1/review/face?token=face',
      path: '/tmp/face.png',
      status: 'pending',
    }],
    sourceAssets: [],
  }]
  const second = [{
    styleCode: '208326102205',
    assets: [{
      id: '208326102205-ai-1',
      remoteAssetId: '208326102205-ai-1',
      kind: 'ai',
      jobUid: 'pose-job',
      reviewBoardUrl: 'http://127.0.0.1/review/pose?token=pose',
      path: '/tmp/pose.png',
      status: 'approved',
    }],
    sourceAssets: [],
  }]

  const merged = balaWorkflow.mergeBalaReviewWorkspaceStyles(first, second)

  assert.equal(merged[0].assets.length, 2)
  assert.deepEqual(merged[0].assets.map(asset => asset.jobUid), ['face-job', 'pose-job'])
})

test('AI image workspace metadata survives reload without persisting thumbnail payloads', () => {
  assert.equal(typeof balaWorkflow.serializeBalaImageWorkspaceState, 'function')
  assert.equal(typeof balaWorkflow.restoreBalaImageWorkspaceState, 'function')
  const original = [{
    styleCode: '208326102205',
    modelPhotos: [{
      id: 'source-1',
      path: '/tmp/source.jpg',
      thumbnailDataUrl: 'data:image/webp;base64,huge-payload',
      reviewStatus: 'approved',
      versions: [{
        id: 'face-version',
        remoteAssetId: '208326102205-ai-1',
        jobUid: 'face-job',
        runUid: 'face-run',
        operationType: 'face_swap',
        previewPath: '/tmp/face.png',
        reviewBoardUrl: 'http://127.0.0.1/review/face?token=face',
        status: 'approved',
      }],
    }],
    detailPhotos: [{
      id: 'detail-1',
      path: '/tmp/detail.jpg',
      thumbnailDataUrl: 'data:image/webp;base64,detail-payload',
      reviewStatus: 'pending',
      versions: [{
        id: 'detail-version',
        remoteAssetId: '208326102205-ai-detail-1',
        jobUid: 'detail-job',
        operationType: 'background_swap',
        previewPath: '/tmp/detail-ai.png',
        status: 'pending',
      }],
    }],
  }]

  const snapshot = balaWorkflow.serializeBalaImageWorkspaceState(original)
  assert.doesNotMatch(JSON.stringify(snapshot), /huge-payload/)
  assert.doesNotMatch(JSON.stringify(snapshot), /detail-payload/)

  const restored = [{
    styleCode: '208326102205',
    modelPhotos: [{ id: 'source-1', path: '/tmp/source.jpg', versions: [] }],
    detailPhotos: [{ id: 'detail-1', path: '/tmp/detail.jpg', versions: [] }],
  }]
  balaWorkflow.restoreBalaImageWorkspaceState(restored, snapshot)

  assert.equal(restored[0].modelPhotos[0].reviewStatus, 'approved')
  assert.deepEqual(restored[0].modelPhotos[0].versions.map(version => ({
    jobUid: version.jobUid,
    previewPath: version.previewPath,
    reviewBoardUrl: version.reviewBoardUrl,
    status: version.status,
  })), [{
    jobUid: 'face-job',
    previewPath: '/tmp/face.png',
    reviewBoardUrl: 'http://127.0.0.1/review/face?token=face',
    status: 'approved',
  }])
  assert.deepEqual(restored[0].detailPhotos[0].versions.map(version => ({
    jobUid: version.jobUid,
    previewPath: version.previewPath,
    status: version.status,
  })), [{
    jobUid: 'detail-job',
    previewPath: '/tmp/detail-ai.png',
    status: 'pending',
  }])
})

test('video asset pool lets pending model detail and AI images be manually selected for video tasks', () => {
  assert.equal(typeof balaWorkflow.buildBalaVideoAssetPool, 'function')
  const assets = balaWorkflow.buildBalaVideoAssetPool({
    reviewStyle: {
      styleCode: '208326102205',
      assets: [
        { id: 'approved-face', label: '正面', operationType: 'face_swap', status: 'approved', path: '/tmp/face.png', thumbnailUrl: 'http://127.0.0.1:18765/thumbnail/approved-face' },
        { id: 'pending-outfit', label: '侧面', operationType: 'outfit_swap', status: 'pending', path: '/tmp/outfit.png' },
        { id: 'pending-detail-ai', label: 'AI细节', kind: 'ai', operationType: 'background_swap', status: 'pending', path: '/tmp/ai-detail.png', sourcePath: '/workspace/208326102205/02_商品细节图/detail.jpg' },
        { id: 'retry-pose', label: '背面', operationType: 'pose_swap', status: 'retry', path: '/tmp/pose.png', videoSelected: true },
        { id: 'rejected-bg', label: '背景', operationType: 'background_swap', status: 'rejected', path: '/tmp/bg.png' },
      ],
      sourceAssets: [
        { id: 'approved-origin', name: '原图', sourceType: 'model', status: 'approved', path: '/tmp/source.jpg', selected: true },
        { id: 'pending-origin', name: '待审模特', sourceType: 'model', status: 'pending', path: '/tmp/pending-source.jpg' },
        { id: 'pending-detail', name: '待审细节', sourceType: 'detail', status: 'pending', path: '/tmp/pending-detail.jpg', selected: true },
        { id: 'archived-ai-name', name: '旧归档-AI.jpg', sourceType: 'model', status: 'approved', path: '/workspace/208326102205/03_AI图/旧归档-AI.jpg' },
        { id: 'rejected-detail', name: '细节', sourceType: 'detail', status: 'rejected', path: '/tmp/detail.jpg' },
      ],
    },
  })

  assert.deepEqual(assets.map(asset => [
    asset.id,
    asset.kind,
    asset.businessKind,
    asset.displayKind,
    asset.status,
    asset.selected,
    asset.selectable,
  ]), [
    ['vasset-approved-face', 'ai', '模拍', 'AI·模拍', 'approved', true, true],
    ['vasset-pending-outfit', 'ai', '模拍', 'AI·模拍', 'pending', true, true],
    ['vasset-pending-detail-ai', 'ai', '素材', 'AI·细节', 'pending', true, true],
    ['vasset-retry-pose', 'ai', '模拍', 'AI·模拍', 'retry', true, true],
    ['vasset-208326102205-source-approved-origin', 'origin', '模拍', '模特图', 'approved', true, true],
    ['vasset-208326102205-source-pending-origin', 'origin', '模拍', '模特图', 'pending', false, true],
    ['vasset-208326102205-source-pending-detail', 'reference', '素材', '细节图', 'pending', true, true],
    ['vasset-208326102205-source-archived-ai-name', 'ai', '模拍', 'AI·模拍', 'approved', false, true],
  ])
  assert.equal(assets[0].thumbnailUrl, 'http://127.0.0.1:18765/thumbnail/approved-face')
})
