'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { atomicWriteFileSync } = require('./atomicFile')

test('atomicWriteFileSync keeps the previous file when the temporary write fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-atomic-file-'))
  const target = path.join(root, 'state.json')
  fs.writeFileSync(target, 'stable\n', 'utf8')
  const fsApi = Object.assign({}, fs, {
    writeFileSync(descriptor, data, options) {
      if (typeof descriptor === 'number') {
        fs.writeFileSync(descriptor, String(data).slice(0, 3), options)
        throw new Error('simulated interrupted write')
      }
      return fs.writeFileSync(descriptor, data, options)
    },
  })

  try {
    assert.throws(
      () => atomicWriteFileSync(target, 'replacement\n', { fsApi }),
      /interrupted write/,
    )
    assert.equal(fs.readFileSync(target, 'utf8'), 'stable\n')
    assert.deepEqual(fs.readdirSync(root), ['state.json'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('atomicWriteFileSync retries a locked Windows temporary file cleanup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-atomic-cleanup-'))
  const target = path.join(root, 'state.json')
  fs.writeFileSync(target, 'stable\n', 'utf8')
  let cleanupAttempts = 0
  const fsApi = Object.assign({}, fs, {
    writeFileSync(descriptor, data, options) {
      if (typeof descriptor === 'number') {
        fs.writeFileSync(descriptor, String(data).slice(0, 3), options)
        throw new Error('simulated interrupted write')
      }
      return fs.writeFileSync(descriptor, data, options)
    },
    unlinkSync(filePath) {
      if (path.basename(filePath).endsWith('.tmp')) {
        cleanupAttempts += 1
        if (cleanupAttempts === 1) {
          const error = new Error('sharing violation')
          error.code = 'EPERM'
          throw error
        }
      }
      return fs.unlinkSync(filePath)
    },
  })

  try {
    assert.throws(
      () => atomicWriteFileSync(target, 'replacement\n', {
        fsApi,
        platform: 'win32',
        retryDelaysMs: [0],
        sleepSync: () => {},
      }),
      /interrupted write/,
    )
    assert.equal(cleanupAttempts, 2)
    assert.equal(fs.readFileSync(target, 'utf8'), 'stable\n')
    assert.deepEqual(fs.readdirSync(root), ['state.json'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('atomicWriteFileSync retries a transient Windows rename failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-atomic-file-retry-'))
  const target = path.join(root, 'state.json')
  fs.writeFileSync(target, 'before\n', 'utf8')
  let attempts = 0
  const fsApi = Object.assign({}, fs, {
    renameSync(source, destination) {
      attempts += 1
      if (attempts === 1) {
        const error = new Error('sharing violation')
        error.code = 'EPERM'
        throw error
      }
      return fs.renameSync(source, destination)
    },
  })

  try {
    atomicWriteFileSync(target, 'after\n', {
      fsApi,
      platform: 'win32',
      retryDelaysMs: [0],
      sleepSync: () => {},
    })
    assert.equal(attempts, 2)
    assert.equal(fs.readFileSync(target, 'utf8'), 'after\n')
    assert.deepEqual(fs.readdirSync(root), ['state.json'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('atomicWriteFileSync retries Windows directory-not-empty replacement races', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-atomic-enotempty-'))
  const target = path.join(root, 'state.json')
  let attempts = 0
  const fsApi = Object.assign({}, fs, {
    renameSync(source, destination) {
      attempts += 1
      if (attempts === 1) {
        const error = new Error('directory not empty race')
        error.code = 'ENOTEMPTY'
        throw error
      }
      return fs.renameSync(source, destination)
    },
  })

  try {
    atomicWriteFileSync(target, 'after\n', {
      fsApi,
      platform: 'win32',
      retryDelaysMs: [0],
      sleepSync: () => {},
    })
    assert.equal(attempts, 2)
    assert.equal(fs.readFileSync(target, 'utf8'), 'after\n')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('atomicWriteFileSync fsyncs both the file and parent directory on POSIX', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-atomic-fsync-'))
  const target = path.join(root, 'state.json')
  let fsyncCalls = 0
  const fsApi = Object.assign({}, fs, {
    fsyncSync(descriptor) {
      fsyncCalls += 1
      return fs.fsyncSync(descriptor)
    },
  })

  try {
    atomicWriteFileSync(target, 'durable\n', { fsApi, platform: 'darwin' })
    assert.equal(fsyncCalls, 2)
    assert.equal(fs.readFileSync(target, 'utf8'), 'durable\n')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
