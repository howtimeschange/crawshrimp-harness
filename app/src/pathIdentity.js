'use strict'

const fs = require('node:fs')
const path = require('node:path')

function normalizePathIdentity(value, {
  pathApi = path,
  platform = process.platform,
} = {}) {
  const resolved = pathApi.normalize(pathApi.resolve(String(value || '')))
  return platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved
}

function samePathIdentity(left, right, options = {}) {
  return normalizePathIdentity(left, options) === normalizePathIdentity(right, options)
}

function assertNoLinkComponentsSync(value, {
  fsApi = fs,
  pathApi = path,
  platform = process.platform,
  allowMissing = false,
} = {}) {
  const absolute = pathApi.resolve(String(value || ''))
  const parsed = pathApi.parse(absolute)
  const relative = pathApi.relative(parsed.root, absolute)
  const realpath = fsApi.realpathSync.native || fsApi.realpathSync
  let current = parsed.root
  for (const part of relative.split(pathApi.sep).filter(Boolean)) {
    current = pathApi.join(current, part)
    let currentStat
    try {
      currentStat = fsApi.lstatSync(current)
    } catch (error) {
      if (allowMissing && error?.code === 'ENOENT') return absolute
      throw error
    }
    if (currentStat.isSymbolicLink()) throw new Error('路径不能包含符号链接或连接点')
    if (!samePathIdentity(current, realpath(current), { pathApi, platform })) {
      throw new Error('路径不能包含符号链接或连接点')
    }
  }
  const real = realpath(absolute)
  if (!samePathIdentity(absolute, real, { pathApi, platform })) {
    throw new Error('路径不能包含符号链接或连接点')
  }
  return real
}

module.exports = {
  assertNoLinkComponentsSync,
  normalizePathIdentity,
  samePathIdentity,
}
