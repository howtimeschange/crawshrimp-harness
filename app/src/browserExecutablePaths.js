'use strict'

const path = require('path')

function uniquePaths(paths) {
  const seen = new Set()
  return paths.filter(candidate => {
    const value = String(candidate || '').trim()
    if (!value) return false
    const key = value.replace(/\//g, '\\').toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getWindowsBrowserExecutableCandidates(env = process.env) {
  const programFiles = String(env.ProgramW6432 || env.ProgramFiles || 'C:\\Program Files').trim()
  const programFilesX86 = String(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)').trim()
  const localAppData = String(env.LOCALAPPDATA || '').trim()
  const join = path.win32.join

  return uniquePaths([
    join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    localAppData && join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    localAppData && join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ])
}

function getBrowserExecutableCandidates({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') return getWindowsBrowserExecutableCandidates(env)
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  ]
}

module.exports = {
  getBrowserExecutableCandidates,
  getWindowsBrowserExecutableCandidates,
}
