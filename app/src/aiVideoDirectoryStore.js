'use strict'

const fs = require('node:fs')
const path = require('node:path')

const { signAiVideoCapability } = require('./backendApi')
const { atomicWriteFileSync } = require('./atomicFile')
const { assertNoLinkComponentsSync } = require('./pathIdentity')

const STORE_VERSION = 1
const MAX_STORE_BYTES = 64 * 1024

function canonicalAiVideoInputDirectory(rawPath, {
  fsApi = fs,
  pathApi = path,
  platform = process.platform,
} = {}) {
  const value = String(rawPath || '').trim()
  if (!value || !pathApi.isAbsolute(value)) throw new Error('AI 视频图库路径无效')
  const absolute = pathApi.resolve(value)
  const selectedStat = fsApi.lstatSync(absolute)
  if (selectedStat.isSymbolicLink()) throw new Error('AI 视频图库不能是符号链接')
  if (!selectedStat.isDirectory()) throw new Error('AI 视频图库不是目录')
  const real = assertNoLinkComponentsSync(absolute, { fsApi, pathApi, platform })
  const realStat = fsApi.lstatSync(real)
  if (realStat.isSymbolicLink() || !realStat.isDirectory()) throw new Error('AI 视频图库不是安全目录')
  return real
}

function rememberAiVideoInputDirectory(storePath, rawPath, {
  fsApi = fs,
  pathApi = path,
  platform = process.platform,
  retryDelaysMs,
  sleepSync,
} = {}) {
  const target = String(storePath || '').trim()
  if (!target) throw new Error('AI 视频图库存储路径无效')
  const canonical = canonicalAiVideoInputDirectory(rawPath, { fsApi, pathApi, platform })
  const payload = `${JSON.stringify({
    version: STORE_VERSION,
    inputDirectory: canonical,
  }, null, 2)}\n`
  atomicWriteFileSync(target, payload, {
    fsApi,
    mode: 0o600,
    platform,
    retryDelaysMs,
    sleepSync,
  })
  return canonical
}

function readSavedAiVideoInputDirectory(storePath, {
  secret,
  fsApi = fs,
  pathApi = path,
  platform = process.platform,
} = {}) {
  try {
    const target = String(storePath || '').trim()
    if (!target || !String(secret || '').trim()) return null
    const storeStat = fsApi.lstatSync(target)
    if (storeStat.isSymbolicLink() || !storeStat.isFile() || storeStat.size > MAX_STORE_BYTES) return null
    const payload = JSON.parse(fsApi.readFileSync(target, 'utf8'))
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    if (payload.version !== STORE_VERSION) return null
    const canonical = canonicalAiVideoInputDirectory(payload.inputDirectory, { fsApi, pathApi, platform })
    return {
      directoryToken: signAiVideoCapability({
        secret,
        kind: 'directory',
        scope: 'input',
        filePath: canonical,
      }),
      name: pathApi.basename(canonical),
      scope: 'input',
    }
  } catch {
    return null
  }
}

module.exports = {
  canonicalAiVideoInputDirectory,
  readSavedAiVideoInputDirectory,
  rememberAiVideoInputDirectory,
}
