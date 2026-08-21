'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { assertNoLinkComponentsSync } = require('./pathIdentity')

function loadWindowsAcl() {
  try {
    return require('./windowsAcl')
  } catch (error) {
    assert.fail(`Windows ACL hardening module is missing: ${error.message}`)
  }
}

test('Windows ACL hardening protects a directory for the current user, SYSTEM, and Administrators', () => {
  const { hardenWindowsPathSync } = loadWindowsAcl()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-acl-'))
  const calls = []
  const currentUserSid = 'S-1-5-21-111-222-333-1001'
  const execFileSyncApi = (executable, args, options) => {
    calls.push({ executable, args, options })
    if (executable === 'powershell.exe') return `${currentUserSid}\r\n`
    return ''
  }

  try {
    assert.equal(hardenWindowsPathSync(root, { platform: 'win32', execFileSyncApi }), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }

  assert.equal(calls[0].executable, 'powershell.exe')
  assert.deepEqual(calls[1].args, [
    path.resolve(root),
    '/grant:r',
    `*${currentUserSid}:(OI)(CI)F`,
    '*S-1-5-18:(OI)(CI)F',
    '*S-1-5-32-544:(OI)(CI)F',
    '/Q',
  ])
  assert.deepEqual(calls[2].args, [path.resolve(root), '/inheritance:r', '/Q'])
  assert.deepEqual(calls[3].args, [
    path.resolve(root),
    '/remove',
    '*S-1-1-0',
    '*S-1-5-7',
    '*S-1-5-11',
    '*S-1-5-32-545',
    '*S-1-5-32-546',
    '/Q',
  ])
  assert.equal(calls[4].executable, 'powershell.exe')
  assert.equal(calls[4].args.at(-3), path.resolve(root))
  assert.equal(calls[4].args.at(-2), 'directory')
  assert.equal(calls[4].args.at(-1), currentUserSid)
  assert.match(calls[4].args[4], /SetAccessRuleProtection\(\$true, \$false\)/)
  assert.match(calls[4].args[4], /Directory\]::SetAccessControl/)
  for (const call of calls) {
    assert.equal(call.options.shell, false)
    assert.equal(call.options.windowsHide, true)
  }
})

test('Windows ACL hardening uses file-only ACEs and rejects links', () => {
  const { hardenWindowsPathSync } = loadWindowsAcl()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-acl-file-'))
  const filePath = path.join(root, 'api-token')
  const linkPath = path.join(root, 'api-token-link')
  fs.writeFileSync(filePath, 'secret')
  fs.symlinkSync(filePath, linkPath)
  const calls = []
  const execFileSyncApi = (executable, args) => {
    calls.push({ executable, args })
    return executable === 'powershell.exe' ? 'S-1-5-21-1-2-3-1001\n' : ''
  }

  try {
    assert.equal(hardenWindowsPathSync(filePath, { platform: 'win32', execFileSyncApi }), true)
    assert.match(calls[1].args[2], /:F$/)
    assert.doesNotMatch(calls[1].args[2], /\(OI\)|\(CI\)/)
    assert.equal(calls.at(-1).args.at(-2), 'file')
    assert.match(calls.at(-1).args[4], /File\]::SetAccessControl/)
    assert.throws(
      () => hardenWindowsPathSync(linkPath, { platform: 'win32', execFileSyncApi }),
      /symbolic link/i,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Windows ACL hardening is a no-op on other platforms', () => {
  const { hardenWindowsPathSync } = loadWindowsAcl()
  let called = false
  assert.equal(hardenWindowsPathSync('/tmp/unused', {
    platform: 'darwin',
    execFileSyncApi: () => { called = true },
  }), false)
  assert.equal(called, false)
})

test('Windows data root guard rejects broad drive, profile, and AppData roots', () => {
  const { assertSafeWindowsDataRootSync } = loadWindowsAcl()
  const options = {
    platform: 'win32',
    pathApi: path.win32,
    homeDir: 'C:\\Users\\Alice',
    env: {
      USERPROFILE: 'C:\\Users\\Alice',
      LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local',
      APPDATA: 'C:\\Users\\Alice\\AppData\\Roaming',
      SystemRoot: 'C:\\Windows',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      ProgramData: 'C:\\ProgramData',
      PUBLIC: 'C:\\Users\\Public',
    },
  }

  for (const unsafe of [
    'C:\\',
    'C:\\Users\\Alice',
    'C:\\Users\\Alice\\AppData\\Local',
    'C:\\Users\\Alice\\AppData\\Roaming',
    'C:\\Users',
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\ProgramData',
    'C:\\Users\\Public',
  ]) {
    assert.throws(
      () => assertSafeWindowsDataRootSync(unsafe, options),
      /dedicated child directory/,
    )
  }
  assert.equal(
    assertSafeWindowsDataRootSync('C:\\Users\\Alice\\AppData\\Local\\crawshrimp', options),
    'C:\\Users\\Alice\\AppData\\Local\\crawshrimp',
  )
})

test('Windows data root guard rejects the profiles root without USERPROFILE', () => {
  const { assertSafeWindowsDataRootSync } = loadWindowsAcl()
  const options = {
    platform: 'win32',
    pathApi: path.win32,
    homeDir: 'C:\\Users\\Alice',
    env: {},
  }

  assert.throws(
    () => assertSafeWindowsDataRootSync('C:\\Users', options),
    /dedicated child directory/,
  )
})

test('Windows data root preflight rejects a junction parent before creating children', (t) => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-acl-junction-')))
  const outside = path.join(root, 'outside')
  const link = path.join(root, 'junction')
  const requested = path.join(link, 'crawshrimp')
  fs.mkdirSync(outside)
  try {
    fs.symlinkSync(outside, link, 'dir')
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true })
    t.skip(`directory link unavailable: ${error.code || error.message}`)
    return
  }

  try {
    assert.throws(
      () => assertNoLinkComponentsSync(requested, { allowMissing: true }),
      /符号链接或连接点/,
    )
    assert.equal(fs.existsSync(path.join(outside, 'crawshrimp')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
