const test = require('node:test')
const assert = require('node:assert/strict')

const { getBrowserExecutableCandidates } = require('./browserExecutablePaths')

test('Windows browser candidates cover system, x86, and per-user Edge installations', () => {
  const candidates = getBrowserExecutableCandidates({
    platform: 'win32',
    env: {
      ProgramFiles: 'D:\\Apps',
      'ProgramFiles(x86)': 'D:\\Apps x86',
      LOCALAPPDATA: 'D:\\Users\\tester\\AppData\\Local',
    },
  })

  assert.ok(candidates.includes('D:\\Apps\\Microsoft\\Edge\\Application\\msedge.exe'))
  assert.ok(candidates.includes('D:\\Apps x86\\Microsoft\\Edge\\Application\\msedge.exe'))
  assert.ok(candidates.includes('D:\\Users\\tester\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe'))
  assert.ok(candidates.includes('D:\\Users\\tester\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'))
})

test('Windows browser candidates remain usable when installer environment variables are absent', () => {
  const candidates = getBrowserExecutableCandidates({ platform: 'win32', env: {} })

  assert.ok(candidates.includes('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'))
  assert.ok(candidates.includes('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'))
  assert.equal(new Set(candidates).size, candidates.length)
})
