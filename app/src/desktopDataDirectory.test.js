'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { prepareDesktopDataDirectoryAsync } = require('./desktopDataDirectory')
const { hardenWindowsPathsSync } = require('./windowsAcl')
test('worker prepares fallback and preserves token across restarts', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-data-test-'))
  try {
    const blocked = path.join(tmp, 'file'); fs.writeFileSync(blocked, 'file')
    const options = { candidates: [blocked, path.join(tmp,'data')], homeDir: os.homedir(), env: {} }
    const result = await prepareDesktopDataDirectoryAsync(options)
    assert.equal(result.errors.length, 1); assert.equal(result.token.length, 64)
    assert.equal((await prepareDesktopDataDirectoryAsync(options)).token, result.token)
    for (const name of ['adapters','adapter-meta','data','logs']) assert.ok(fs.statSync(path.join(result.root,name)).isDirectory())
  } finally { fs.rmSync(tmp, {recursive:true,force:true}) }
})
test('ACL batch uses one fail-closed process and encoded literal paths', () => {
  const calls=[]
  hardenWindowsPathsSync(["/test/quote'中文", '/test/second'], { platform:'win32', fsApi:{lstatSync:()=>({isSymbolicLink:()=>false,isDirectory:()=>true})}, execFileSyncApi:(...args)=>calls.push(args) })
  assert.equal(calls.length,1)
  const script=Buffer.from(calls[0][1].at(-1),'base64').toString('utf16le')
  assert.ok(script.includes("$ErrorActionPreference='Stop'")); assert.ok(script.includes('SetAccessRuleProtection($true,$false)'))
  assert.throws(()=>hardenWindowsPathsSync(['/test'], {platform:'win32',fsApi:{lstatSync:()=>({isSymbolicLink:()=>true})}}), /not a link/)
})
