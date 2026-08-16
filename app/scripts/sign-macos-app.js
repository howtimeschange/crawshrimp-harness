'use strict'

const fs = require('fs')
const path = require('path')
const { signAsync } = require('@electron/osx-sign')

const MACH_O_MAGICS = new Set([
  0xfeedface,
  0xfeedfacf,
  0xcefaedfe,
  0xcffaedfe,
  0xcafebabe,
  0xcafebabf,
  0xbebafeca,
  0xbfbafeca,
])
const NON_NATIVE_RESOURCE_EXTENSIONS = new Set([
  '.css',
  '.csv',
  '.d.ts',
  '.gif',
  '.html',
  '.icns',
  '.ico',
  '.jpeg',
  '.jpg',
  '.js',
  '.json',
  '.map',
  '.md',
  '.mjs',
  '.cjs',
  '.pak',
  '.png',
  '.svg',
  '.toml',
  '.txt',
  '.wasm',
  '.woff',
  '.woff2',
  '.xml',
  '.yaml',
  '.yml',
])

function isMachOFile(filePath) {
  const header = Buffer.alloc(4)
  let descriptor
  try {
    descriptor = fs.openSync(filePath, 'r')
    if (fs.readSync(descriptor, header, 0, header.length, 0) !== header.length) return false
    return MACH_O_MAGICS.has(header.readUInt32BE(0))
  } catch {
    return false
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

function hasNonNativeResourceExtension(filePath) {
  const basename = path.basename(filePath).toLowerCase()
  if (basename.endsWith('.d.ts') || basename.endsWith('.d.ts.map')) return true
  return NON_NATIVE_RESOURCE_EXTENSIONS.has(path.extname(basename))
}

function createPythonDataIgnore(existingIgnore = () => false) {
  return filePath => {
    if (existingIgnore(filePath)) return true
    if (hasNonNativeResourceExtension(filePath)) return true
    try {
      if (!fs.statSync(filePath).isFile()) return false
    } catch {
      return false
    }
    return !isMachOFile(filePath)
  }
}

async function signMacApp(options) {
  return signAsync({
    ...options,
    ignore: createPythonDataIgnore(options.ignore),
  })
}

module.exports = signMacApp
module.exports.default = signMacApp
module.exports.createPythonDataIgnore = createPythonDataIgnore
module.exports.hasNonNativeResourceExtension = hasNonNativeResourceExtension
module.exports.isMachOFile = isMachOFile
