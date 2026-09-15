import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as balaWorkflow from './balaAiVideoWorkflow.js'

import {
  balaMaterialPanelControl,
  normalizeBalaVideoResultRows,
  resolveBalaAssetPreviewSource,
  resolveBalaVideoPlaybackSource,
} from './balaAiVideoWorkflow.js'

test('local AI-video images render only through the bridged preview cache', () => {
  const asset = {
    path: '/Users/xingyicheng/Downloads/巴拉 AI 视频/208326102205/01_模拍原图/1-AL.jpg',
  }
  const localPreviews = {
    [asset.path]: 'data:image/jpeg;base64,local-preview',
  }

  assert.equal(
    resolveBalaAssetPreviewSource(asset, { localPreviews }),
    'data:image/jpeg;base64,local-preview',
  )
  assert.equal(resolveBalaAssetPreviewSource(asset), '')
})

test('remote AI-video image URLs take precedence over local cached previews', () => {
  const asset = {
    imageUrl: '/api/assets/preview.png',
    path: '/Users/xingyicheng/Downloads/preview.png',
  }

  assert.equal(
    resolveBalaAssetPreviewSource(asset, {
      localPreviews: { [asset.path]: 'data:image/png;base64,local-preview' },
      resolveRemote: value => `http://127.0.0.1:18080${value}`,
    }),
    'http://127.0.0.1:18080/api/assets/preview.png',
  )
})

test('material panel control describes a horizontal collapse and keeps expansion reachable', () => {
  assert.deepEqual(balaMaterialPanelControl(true), {
    label: '收起',
    ariaLabel: '向左收起找图面板',
    direction: 'left',
  })
  assert.deepEqual(balaMaterialPanelControl(false), {
    label: '展开',
    ariaLabel: '向右展开找图面板',
    direction: 'right',
  })
})

test('AI-named recalled materials are not selected until the operator chooses them', () => {
  const groups = balaWorkflow.normalizeBalaMaterialGroups({
    batch: {
      items: [{
        style_code: '208326103208',
        assets: [{
          id: 'batch-ai-material',
          source_type: 'model',
          filename: '260510bala6811-1-AI.jpg',
          path: '/workspace/208326103208/01_模拍原图/260510bala6811-1-AI.jpg',
        }],
      }],
    },
    rows: [{
      输入款号: '208326103208',
      素材来源: '模拍图',
      文件名: '260510bala6811-2-AI.jpg',
      本地文件: '/workspace/208326103208/01_模拍原图/260510bala6811-2-AI.jpg',
      下载结果: '已下载',
    }],
  })

  const assets = groups.flatMap(group => [...group.modelPhotos, ...group.detailPhotos])
  assert.equal(assets.length, 2)
  assert.equal(assets.every(asset => asset.selected === false), true)
  assert.equal(balaWorkflow.summarizeBalaMaterialGroups(groups).selectedCount, 0)
})

test('recalled original materials collapse by content hash even when filenames differ', () => {
  const groups = balaWorkflow.normalizeBalaMaterialGroups({
    batch: {
      items: [{
        style_code: '208326103208',
        assets: [
          {
            id: 'same-origin-1',
            source_type: 'model',
            filename: '260510bala7218-1.jpg',
            path: '/workspace/208326103208/01_模拍原图/260510bala7218-1.jpg',
            content_hash: 'same-original-image',
          },
          {
            id: 'same-origin-2',
            source_type: 'model',
            filename: '260510bala7218-2.jpg',
            path: '/workspace/208326103208/01_模拍原图/260510bala7218-2.jpg',
            content_hash: 'same-original-image',
          },
        ],
      }],
    },
    rows: [{
      输入款号: '208326103208',
      素材来源: '模拍图',
      文件名: '260510bala7218-3.jpg',
      本地文件: '/workspace/208326103208/01_模拍原图/260510bala7218-3.jpg',
      下载结果: '已下载',
      content_hash: 'same-original-image',
    }],
  })

  assert.equal(groups.length, 1)
  assert.equal(groups[0].modelPhotos.length, 1)
  assert.equal(groups[0].modelPhotos[0].filename, '260510bala7218-1.jpg')
  assert.equal(groups[0].modelPhotos[0].contentHash, 'same-original-image')
})

test('video asset pool keeps archived AI-looking copies unselected when only path or filename marks AI', () => {
  const assets = balaWorkflow.buildBalaVideoAssetPool({
    materialStyle: {
      styleCode: '208426105206',
      modelPhotos: [
        {
          id: 'ai-copy-1',
          sourceType: 'model',
          filename: '2-AI-1.jpg',
          path: '/workspace/208426105206/03_AI图/2-AI-1.jpg',
          contentHash: 'same-ai-output',
        },
        {
          id: 'ai-copy-2',
          sourceType: 'model',
          filename: '2-AI-2.jpg',
          path: '/workspace/208426105206/03_AI图/2-AI-2.jpg',
          contentHash: 'same-ai-output',
        },
      ],
      detailPhotos: [],
    },
  })

  assert.equal(assets.length, 1)
  assert.equal(assets[0].kind, 'ai')
  assert.equal(assets[0].isAi, true)
  assert.equal(assets[0].displayKind, 'AI·模拍')
  assert.equal(assets[0].selected, false)
})

test('workspace snapshots preserve explicit AI-version selection state', () => {
  const styleWorkspaces = [{
    styleCode: '208326103208',
    modelPhotos: [{
      id: 'source-1',
      sourceType: 'model',
      name: 'source.jpg',
      path: '/workspace/208326103208/01_模拍原图/source.jpg',
      selected: false,
      editSelected: false,
      versions: [
        {
          id: 'ai-cleared',
          action: 'AI 换脸',
          operationType: 'face_swap',
          label: '手动清除的 AI 图',
          status: 'approved',
          previewPath: '/workspace/208326103208/AI结果/ai-cleared.png',
          selected: false,
          editSelected: false,
        },
        {
          id: 'ai-kept',
          action: 'AI 换脸',
          operationType: 'face_swap',
          label: '保留的 AI 图',
          status: 'approved',
          previewPath: '/workspace/208326103208/AI结果/ai-kept.png',
          selected: true,
          editSelected: true,
        },
      ],
    }],
    detailPhotos: [],
  }]

  const snapshot = balaWorkflow.serializeBalaImageWorkspaceState(styleWorkspaces)
  const savedVersions = snapshot[0].modelPhotos[0].versions
  assert.equal(savedVersions[0].selected, false)
  assert.equal(savedVersions[0].editSelected, false)
  assert.equal(savedVersions[1].selected, true)
  assert.equal(savedVersions[1].editSelected, true)

  const restored = [{
    styleCode: '208326103208',
    modelPhotos: [{
      id: 'source-1',
      sourceType: 'model',
      name: 'source.jpg',
      path: '/workspace/208326103208/01_模拍原图/source.jpg',
      selected: false,
      editSelected: false,
      versions: [],
    }],
    detailPhotos: [],
  }]
  balaWorkflow.restoreBalaImageWorkspaceState(restored, snapshot)
  const restoredVersions = restored[0].modelPhotos[0].versions
  assert.equal(restoredVersions.find(version => version.label === '手动清除的 AI 图').selected, false)
  assert.equal(restoredVersions.find(version => version.label === '手动清除的 AI 图').editSelected, false)
  assert.equal(restoredVersions.find(version => version.label === '保留的 AI 图').selected, true)
  assert.equal(restoredVersions.find(version => version.label === '保留的 AI 图').editSelected, true)

  const reviewStyle = balaWorkflow.buildBalaReviewWorkspaceStyles(restored)[0]
  const reviewAssets = reviewStyle.assets.filter(asset => asset.kind === 'ai')
  assert.equal(reviewAssets.find(asset => asset.label === '手动清除的 AI 图').selected, false)
  assert.equal(reviewAssets.find(asset => asset.label === '保留的 AI 图').selected, true)
})


test('video results resolve downloadable local files and remote playback URLs', () => {
  assert.equal(
    resolveBalaVideoPlaybackSource({ path: '/Users/xingyicheng/Downloads/result clip.mp4' }),
    'file:///Users/xingyicheng/Downloads/result%20clip.mp4',
  )
  assert.equal(
    resolveBalaVideoPlaybackSource({ videoUrl: 'https://cdn.example.com/result.mp4', path: '/ignored.mp4' }),
    'https://cdn.example.com/result.mp4',
  )
  assert.equal(
    resolveBalaVideoPlaybackSource({ path: '/Users/xingyicheng/Downloads/巴拉AI视频成片' }),
    '',
  )
})




test('video result normalization keeps local files and remote playback URLs in separate fields', () => {
  const [localResult, remoteResult] = normalizeBalaVideoResultRows([
    {
      状态: '已下载',
      本地视频文件: '/Users/xingyicheng/Downloads/local-result.mp4',
    },
    {
      status: 'completed',
      video_url: 'https://cdn.example.com/remote-result.mp4',
    },
  ], { id: 'task-1', styleCode: '208326102205' })

  assert.equal(localResult.path, '/Users/xingyicheng/Downloads/local-result.mp4')
  assert.equal(localResult.videoUrl, '')
  assert.equal(remoteResult.path, '')
  assert.equal(remoteResult.videoUrl, 'https://cdn.example.com/remote-result.mp4')
  assert.equal(remoteResult.status, '已完成')
})

test('clearing a failed video task clears every persisted result for that task', () => {
  assert.equal(typeof balaWorkflow.clearBalaVideoTaskHistory, 'function')

  const result = balaWorkflow.clearBalaVideoTaskHistory([
    {
      id: 'video-task-42-output-row',
      taskRefId: 'video-task-42',
      status: '失败',
      error: '文件过大，不能超过10M',
    },
    {
      id: 'video-task-42',
      taskRefId: 'video-task-42',
      status: '生成中',
      providerStatus: 'running',
    },
    {
      id: 'video-task-99',
      taskRefId: 'video-task-99',
      status: '已完成',
    },
  ], [{
    id: 'video-task-42-output-row',
    taskRefId: 'video-task-42',
  }])

  assert.deepEqual(result, {
    taskRefIds: ['video-task-42'],
    results: [{
      id: 'video-task-99',
      taskRefId: 'video-task-99',
      status: '已完成',
    }],
  })
})



















test('AI edit version previews fall back after a generated preview is broken', () => {
  assert.equal(typeof balaWorkflow.resolveBalaVersionPreviewSource, 'function')
  assert.equal(
    balaWorkflow.resolveBalaVersionPreviewSource(
      { id: 'generated' },
      { id: 'source' },
      {
        resolvePreview: asset => `${asset.id}.jpg`,
        brokenSources: { 'generated.jpg': true },
      },
    ),
    'source.jpg',
  )
})
