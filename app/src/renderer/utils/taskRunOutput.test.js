import test from 'node:test'
import assert from 'node:assert/strict'
import { currentRunOutput, cloudDriveDownloadSummary, latestRunLogs } from './taskRunOutput.js'
const oldArtifacts = ['run12.xlsx','run13.zip','run13.xlsx'].map(path => ({path}))
test('success, no match, stopped and success each use only their run files', () => {
  const runs = [
    {run_id:13,output_files:'["run13.zip","run13.xlsx"]'},
    {run_id:14,output_files:'["run14.xlsx"]'},
    {run_id:15,output_files:'[]'},
    {run_id:16,output_files:'["run16.zip","run16.xlsx"]'},
  ]
  for (const run of runs) {
    const detail = {runs:[run],artifacts:oldArtifacts,summary:{run_id:13,output_files:['run13.zip']}}
    assert.deepEqual(currentRunOutput(detail).files,JSON.parse(run.output_files))
  }
  assert.deepEqual(currentRunOutput({runs, artifacts:oldArtifacts},15).files,[])
  assert.deepEqual(currentRunOutput({runs, artifacts:oldArtifacts},99).files,[])
})
test('unmatched statistics count distinct codes separately from download rows', () => {
  const missing = {'输入编码':'000000000000','下载结果':'未匹配到图片'}
  assert.equal(cloudDriveDownloadSummary([missing]).text,'下载 0 张，未匹配 1 个款号')
  assert.equal(cloudDriveDownloadSummary([missing,missing,{'输入编码':'202426107205','下载结果':'已下载'},{'输入编码':'202426107205','下载结果':'已下载'}]).text,'下载 2 张，未匹配 1 个款号')
  assert.equal(cloudDriveDownloadSummary([{'下载结果':'下载失败'}]).failed,1)
})

test('current log view excludes prior targets and completion messages', () => {
  const logs = ['old target 000000000000', 'Done. 2 records.', '', '─── 新运行 09-10 12:55:00 ───', 'Starting...', 'Stopped. 0 records.']
  assert.deepEqual(latestRunLogs(logs), logs.slice(3))
  assert.deepEqual(latestRunLogs(['Starting...']), ['Starting...'])
})
