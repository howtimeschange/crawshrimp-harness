'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  canonicalAiVideoInputDirectory,
  readSavedAiVideoInputDirectory,
  rememberAiVideoInputDirectory,
} = require('./aiVideoDirectoryStore')
const { verifyAiVideoCapability } = require('./backendApi')

const SECRET_A = 'a'.repeat(64)
const SECRET_B = 'b'.repeat(64)

test('saved input directory survives a process secret rotation by issuing a fresh capability', () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-ai-video-directory-')))
  try {
    const inputDirectory = path.join(root, 'reference-library')
    const storePath = path.join(root, 'data', 'ai-video-input-directory.json')
    fs.mkdirSync(inputDirectory)

    rememberAiVideoInputDirectory(storePath, inputDirectory)

    const storedText = fs.readFileSync(storePath, 'utf8')
    const stored = JSON.parse(storedText)
    assert.deepEqual(stored, {
      version: 1,
      inputDirectory: fs.realpathSync.native(inputDirectory),
    })
    assert.doesNotMatch(storedText, /avcap[12]\./)
    assert.equal(storedText.includes(SECRET_A), false)
    assert.equal(storedText.includes(SECRET_B), false)
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(storePath).mode & 0o777, 0o600)
    }

    const firstProcess = readSavedAiVideoInputDirectory(storePath, { secret: SECRET_A })
    const restartedProcess = readSavedAiVideoInputDirectory(storePath, { secret: SECRET_B })

    assert.deepEqual(Object.keys(firstProcess).sort(), ['directoryToken', 'name', 'scope'])
    assert.equal(firstProcess.name, 'reference-library')
    assert.equal(firstProcess.scope, 'input')
    assert.equal(restartedProcess.name, 'reference-library')
    assert.notEqual(firstProcess.directoryToken, restartedProcess.directoryToken)

    const firstGrant = verifyAiVideoCapability(firstProcess.directoryToken, {
      secret: SECRET_A,
      expectedKind: 'directory',
      allowedScopes: ['input'],
    })
    const restartedGrant = verifyAiVideoCapability(restartedProcess.directoryToken, {
      secret: SECRET_B,
      expectedKind: 'directory',
      allowedScopes: ['input'],
    })
    assert.equal(firstGrant.path, fs.realpathSync.native(inputDirectory))
    assert.equal(restartedGrant.path, fs.realpathSync.native(inputDirectory))
    assert.throws(() => verifyAiVideoCapability(firstProcess.directoryToken, {
      secret: SECRET_B,
    }), /认证无效/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Windows path casing changes do not masquerade as a symlink', () => {
  const realpathSync = () => 'C:\\Media'
  realpathSync.native = realpathSync
  const directoryStat = {
    isDirectory: () => true,
    isSymbolicLink: () => false,
  }
  const fsApi = {
    lstatSync: () => directoryStat,
    realpathSync,
  }

  assert.equal(canonicalAiVideoInputDirectory('c:\\media', {
    fsApi,
    pathApi: path.win32,
    platform: 'win32',
  }), 'C:\\Media')
})

test('saved input directory returns empty when the store or canonical directory is unsafe', () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-ai-video-directory-invalid-')))
  try {
    const storePath = path.join(root, 'ai-video-input-directory.json')
    assert.equal(readSavedAiVideoInputDirectory(storePath, { secret: SECRET_A }), null)

    fs.writeFileSync(storePath, '{invalid json', 'utf8')
    assert.equal(readSavedAiVideoInputDirectory(storePath, { secret: SECRET_A }), null)

    const selectedDirectory = path.join(root, 'selected')
    const movedDirectory = path.join(root, 'moved')
    fs.mkdirSync(selectedDirectory)
    rememberAiVideoInputDirectory(storePath, selectedDirectory)
    fs.renameSync(selectedDirectory, movedDirectory)
    fs.symlinkSync(movedDirectory, selectedDirectory, 'dir')

    assert.equal(readSavedAiVideoInputDirectory(storePath, { secret: SECRET_A }), null)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('saved input directory retries a transient Windows sharing violation', () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-ai-video-directory-retry-')))
  try {
    const inputDirectory = path.join(root, 'reference-library')
    const storePath = path.join(root, 'data', 'ai-video-input-directory.json')
    fs.mkdirSync(inputDirectory)
    let renameAttempts = 0
    const fsApi = Object.assign({}, fs, {
      realpathSync: fs.realpathSync,
      renameSync(source, target) {
        renameAttempts += 1
        if (renameAttempts === 1) {
          const error = new Error('file is busy')
          error.code = 'EBUSY'
          throw error
        }
        return fs.renameSync(source, target)
      },
    })

    rememberAiVideoInputDirectory(storePath, inputDirectory, {
      fsApi,
      platform: 'win32',
      retryDelaysMs: [0, 0],
      sleepSync: () => {},
    })

    assert.equal(renameAttempts, 2)
    assert.equal(JSON.parse(fs.readFileSync(storePath, 'utf8')).inputDirectory, inputDirectory)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
