import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { accountMemoryOptions } from '../../integrations/deepseek-harness/crawshrimp-product-bridge/lib/memory.js'
import { MemoryStore } from '../../integrations/deepseek-harness/crawshrimp-product-bridge/lib/memory-store.js'
const require = createRequire(import.meta.url)
const { createManagedAccount } = require('./managedAccount.js')
test('actual desktop broker authenticates DSH memory and logout invalidates a retained runtime file', async t => {
 const dir = mkdtempSync(join(tmpdir(), 'harness-memory-broker-'))
 const previous = process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH
 process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH = 'test-desktop'
 const storage = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() }
 writeFileSync(join(dir,'modeljetty-session.enc'),JSON.stringify({session:JSON.stringify({access_token:'fixture',expiresAt:Date.now()+3600000})}))
 const account = createManagedAccount({ issuer:'https://fixture.invalid', directory:dir, runtimeDirectory:()=>dir, runtimeEpoch:'test-desktop', safeStorage:storage, openExternal:async()=>{}, fetcher:async url => Response.json(new URL(url).pathname==='/account/me'?{user:{id:'fixture-owner'}}:{models:[]}) })
 t.after(()=>{account.dispose();rmSync(dir,{recursive:true,force:true});if(previous===undefined)delete process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH;else process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH=previous})
 await account.run('status')
 const runtimeFile=join(dir,'managed-model-session.json'), runtime=JSON.parse(readFileSync(runtimeFile))
 const route=runtime.baseURL+'/account/memory-session'
 assert.equal((await fetch(route)).status,401)
 assert.equal((await fetch(route,{headers:{Authorization:'Bearer '+runtime.brokerToken,Origin:'https://example.invalid'}})).status,401)
 const authenticated=await fetch(route,{headers:{Authorization:'Bearer '+runtime.brokerToken}})
 assert.deepEqual(await authenticated.json(),{accountId:'fixture-owner',accountSessionEpoch:runtime.accountSessionEpoch})
 const store=new MemoryStore(join(dir,'memory.sqlite'),Date.now,accountMemoryOptions(dir))
 await store.save('account',{key:'preference',content:'fixture',evidence:'fixture',level:'preference'},'session')
 assert.equal((await store.list('workspace:test')).some(row=>row.scope==='account'),true)
 await account.run('logout')
 writeFileSync(runtimeFile,JSON.stringify(runtime),{mode:0o600})
 assert.equal((await store.list('workspace:test')).some(row=>row.scope==='account'),false)
 await assert.rejects(store.save('account',{key:'other',content:'fixture',evidence:'fixture',level:'preference'},'session'),/请先登录/)
})
