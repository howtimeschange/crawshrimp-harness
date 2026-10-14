'use strict'

const fs = require('node:fs')
const path = require('node:path')

const HARNESS_TYPE_AND_MAP_SUFFIXES = [
  '.d.ts',
  '.d.mts',
  '.d.cts',
  '.map',
]

const PYTHON_TEST_DIR_NAMES = new Set([
  'test',
  'tests',
])

const HARNESS_TEST_DIR_NAMES = new Set([
  '__tests__',
  'test',
  'tests',
])

const DEBUG_FILE_NAMES = new Set([
  'vc140.pdb',
  'vc141.pdb',
  'vc142.pdb',
  'vc143.pdb',
])

const PYTHON_DEVELOPMENT_DIR_NAMES = new Set([
  'include',
  'includes',
])

function normalizeTarget({ platform, arch } = {}) {
  if (!platform || !arch) {
    throw new Error('[prune-packaged-runtime] platform and arch are required')
  }
  if (!['darwin', 'win32'].includes(platform)) {
    throw new Error(`[prune-packaged-runtime] unsupported platform: ${platform}`)
  }
  if (!['x64', 'arm64'].includes(arch)) {
    throw new Error(`[prune-packaged-runtime] unsupported arch: ${arch}`)
  }
  if (platform === 'win32' && arch !== 'x64') {
    throw new Error('[prune-packaged-runtime] unsupported Windows arch: win32-arm64')
  }
  return { platform, arch }
}

function realDirectoryBoundary(directory) {
  const real = fs.realpathSync(directory)
  return { real, prefix: real.endsWith(path.sep) ? real : real + path.sep }
}

function insideBoundary(candidate, boundary) {
  const real = fs.realpathSync(candidate)
  return real === boundary.real || real.startsWith(boundary.prefix)
}

function makeResult() {
  return { removed: [], skipped: [], bytes: 0 }
}

function relativeToRoot(root, target) {
  return path.relative(root, target).replaceAll(path.sep, '/')
}

function safeSize(target) {
  let stat
  try {
    stat = fs.lstatSync(target)
  } catch {
    return 0
  }
  if (stat.isSymbolicLink()) return stat.size
  if (stat.isFile()) return stat.size
  if (!stat.isDirectory()) return 0
  let total = 0
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    total += safeSize(path.join(target, entry.name))
  }
  return total
}

function removePath(target, { root, boundary, reason, result }) {
  if (!fs.existsSync(target)) return
  let stat
  try {
    stat = fs.lstatSync(target)
  } catch (error) {
    result.skipped.push({ path: relativeToRoot(root, target), reason: `${reason}: ${error.message}` })
    return
  }
  if (!stat.isSymbolicLink()) {
    try {
      if (!insideBoundary(target, boundary)) {
        result.skipped.push({ path: relativeToRoot(root, target), reason: `${reason}: outside resources boundary` })
        return
      }
    } catch (error) {
      result.skipped.push({ path: relativeToRoot(root, target), reason: `${reason}: ${error.message}` })
      return
    }
  }
  const bytes = safeSize(target)
  fs.rmSync(target, { recursive: true, force: true })
  result.bytes += bytes
  result.removed.push({ path: relativeToRoot(root, target), reason, bytes })
}

function walkDirectory(root, visitor) {
  const pending = [root]
  while (pending.length) {
    const current = pending.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name)
      const action = visitor(target, entry)
      if (action === 'skip') continue
      if (entry.isDirectory()) pending.push(target)
    }
  }
}

function pathSegmentsBetween(root, target) {
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return []
  return relative.split(path.sep)
}

function hasSuffix(name, suffixes) {
  return suffixes.some(suffix => name.endsWith(suffix))
}

function prunePythonRuntime(resourcesRoot, boundary, result) {
  const pythonRoot = path.join(resourcesRoot, 'python')
  if (!fs.existsSync(pythonRoot)) return

  walkDirectory(pythonRoot, (target, entry) => {
    if (entry.isSymbolicLink()) return 'skip'
    if (!entry.isDirectory()) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdb')) {
        removePath(target, { root: resourcesRoot, boundary, reason: 'python-debug-symbol', result })
      }
      return undefined
    }

    const lower = entry.name.toLowerCase()
    const segments = pathSegmentsBetween(pythonRoot, target).map(segment => segment.toLowerCase())
    if (PYTHON_TEST_DIR_NAMES.has(lower)) {
      removePath(target, { root: resourcesRoot, boundary, reason: 'python-test-directory', result })
      return 'skip'
    }
    if (lower === '__pycache__' && segments.some(segment => PYTHON_TEST_DIR_NAMES.has(segment))) {
      removePath(target, { root: resourcesRoot, boundary, reason: 'python-test-bytecode-cache', result })
      return 'skip'
    }
    if (PYTHON_DEVELOPMENT_DIR_NAMES.has(lower) && segments.length <= 3) {
      removePath(target, { root: resourcesRoot, boundary, reason: 'python-development-headers', result })
      return 'skip'
    }
    return undefined
  })
}

function isProtectedHarnessContent(harnessRoot, target) {
  const segments = pathSegmentsBetween(harnessRoot, target)
  return segments.some(segment => ['docs', 'knowledge', 'examples'].includes(segment))
}

function shouldPruneHarnessTestDirectory(harnessRoot, target) {
  const segments = pathSegmentsBetween(harnessRoot, target)
  if (segments.includes('node_modules')) return true
  return segments[0] === 'skills' && segments[1] === 'cli'
}

function pruneHarnessFiles(resourcesRoot, boundary, result) {
  const harnessRoot = path.join(resourcesRoot, 'deepseek-harness')
  if (!fs.existsSync(harnessRoot)) return

  walkDirectory(harnessRoot, (target, entry) => {
    if (entry.isSymbolicLink()) return 'skip'
    if (isProtectedHarnessContent(harnessRoot, target)) return undefined
    if (entry.isDirectory()) {
      if (HARNESS_TEST_DIR_NAMES.has(entry.name) && shouldPruneHarnessTestDirectory(harnessRoot, target)) {
        removePath(target, { root: resourcesRoot, boundary, reason: 'harness-test-directory', result })
        return 'skip'
      }
      return undefined
    }
    if (!entry.isFile()) return undefined
    const lower = entry.name.toLowerCase()
    if (hasSuffix(lower, HARNESS_TYPE_AND_MAP_SUFFIXES)) {
      removePath(target, { root: resourcesRoot, boundary, reason: 'harness-type-or-map-file', result })
    } else if (lower.endsWith('.pdb') || DEBUG_FILE_NAMES.has(lower)) {
      removePath(target, { root: resourcesRoot, boundary, reason: 'harness-debug-symbol', result })
    }
    return undefined
  })
}

function nodePtyPrebuildMatchesTarget(name, target) {
  return name === `${target.platform}-${target.arch}`
}

function pruneNodePtyPrebuilds(resourcesRoot, boundary, target, result) {
  const harnessRoot = path.join(resourcesRoot, 'deepseek-harness')
  if (!fs.existsSync(harnessRoot)) return

  walkDirectory(harnessRoot, (candidate, entry) => {
    if (entry.isSymbolicLink()) return 'skip'
    if (!entry.isDirectory() || entry.name !== 'prebuilds') return undefined
    if (path.basename(path.dirname(candidate)) !== 'node-pty') return undefined
    for (const prebuild of fs.readdirSync(candidate, { withFileTypes: true })) {
      const prebuildPath = path.join(candidate, prebuild.name)
      if (!prebuild.isDirectory()) continue
      if (!nodePtyPrebuildMatchesTarget(prebuild.name, target)) {
        removePath(prebuildPath, { root: resourcesRoot, boundary, reason: 'node-pty-other-target-prebuild', result })
      }
    }
    return 'skip'
  })
}

function prunePackagedRuntime(resourcesPath, options = {}) {
  const target = normalizeTarget(options)
  const resourcesRoot = path.resolve(resourcesPath)
  if (!fs.existsSync(resourcesRoot) || !fs.statSync(resourcesRoot).isDirectory()) {
    throw new Error(`[prune-packaged-runtime] resourcesPath must be an existing directory: ${resourcesPath}`)
  }

  const boundary = realDirectoryBoundary(resourcesRoot)
  const result = makeResult()
  prunePythonRuntime(resourcesRoot, boundary, result)
  pruneHarnessFiles(resourcesRoot, boundary, result)
  pruneNodePtyPrebuilds(resourcesRoot, boundary, target, result)
  result.removed.sort((a, b) => a.path.localeCompare(b.path))
  result.skipped.sort((a, b) => a.path.localeCompare(b.path))
  return result
}

module.exports = {
  prunePackagedRuntime,
  nodePtyPrebuildMatchesTarget,
  shouldPruneHarnessTestDirectory,
}
