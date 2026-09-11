'use strict'
// --live creates a safe QA package, approves it, installs it, then withdraws it.
const { app, safeStorage, net } = require('electron')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { createAccountAuth } = require('../src/accountAuth')
const { createMarketplace } = require('../src/marketplace')
const { createClient } = require('@supabase/supabase-js')
const config = require('../src/accountConfig.json')
app.setName('crawshrimp-harness')
if (!process.argv.includes('--live')) { console.error('Pass --live for real QA workflow'); app.exit(1) }
app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-acceptance-'))
  const fetch = (url, options) => net.fetch(url, {...options, cache:'no-store'})
  const auth = createAccountAuth({config, directory:path.join(os.homedir(),'Library/Application Support/crawshrimp-harness/account'), safeStorage, openExternal:async()=>{}, createClient:(u,k,o)=>createClient(u,k,{...o,global:{fetch}})})
  let id, approved = false
  try {
    const client = auth.getClient()
    assert.equal((await client.rpc('market_is_admin')).data, true)
    const filename = path.join(dir, 'market-qa.zip')
    const adapterId = `market-acceptance-${randomUUID()}`
    const python = (code, args=[]) => execFileSync(path.resolve(__dirname,'../../venv/bin/python3'), ['-c',code,...args], {cwd:path.resolve(__dirname,'../..'), env:{...process.env,CRAWSHRIMP_DATA:path.join(dir,'local-data')}, encoding:'utf8'})
    python(`import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
 z.writestr('manifest.yaml','id: ${adapterId}\\nname: Market acceptance\\nentry_url: https://example.com\\nversion: 1.0.0\\nauthor: QA\\ntasks:\\n  - id: check\\n    name: Check\\n    script: check.js\\n')
 z.writestr('check.js','(() => ({ok: true}))()')`, [filename])
    let receipts = {}, installCalls = 0
    const getInstalled = async () => JSON.parse(python('from core import adapter_loader as a; import json; a.scan_all(); print(json.dumps(a.list_all()))'))
    const installZip = async bytes => {
      installCalls++
      const target = path.join(dir,'install.zip')
      fs.writeFileSync(target,bytes)
      const adapter = JSON.parse(python('from core.adapter_loader import install_from_zip; import sys; print(install_from_zip(sys.argv[1]).model_dump_json())',[target]))
      return {ok:true,adapter}
    }
    const market = createMarketplace({getClient:()=>client,accountState:()=>auth.run('status'),version:'0.2.0',chooseZip:async()=>filename,installZip,getInstalled,readInstalls:()=>receipts,writeInstalls:r=>{receipts=r}})
    const icon='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII='
    const prepared = await market.run('prepare-zip')
    id = (await market.run('publish',{zipToken:prepared.token,icon,name:'[验收] 一键安装示例',author:'抓虾 QA',description:'仅验证安装链路，不执行脚本、不访问业务数据。验证完成后下架。',version:'1.0.0',harness_range:'>=0.2.0 <0.3.0',platforms:['测试']})).id
    console.log('QA package',id)
    const row = (await client.from('market_packages').select('*').eq('id',id).single()).data
    assert.equal(row.status,'pending')
    assert.equal(row.icon,icon)
    const reader = createClient(config.url,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch}})
    assert.ifError((await reader.auth.signInAnonymously()).error)
    const object = row.owner_id+'/'+id+'.zip'
    const download = () => reader.storage.from('market-packages').download(object,{cacheNonce:randomUUID()},{cache:'no-store'})
    assert.equal((await reader.from('market_packages').select('id').eq('id',id)).data.length,0)
    assert.ok((await download()).error)
    assert.ok((await reader.rpc('market_review',{package_id:id,decision:'approved',note:''})).error)
    const session = (await client.auth.getSession()).data.session
    const response = await fetch('https://analytics.crawshrimp.com/api/market/review',{method:'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:JSON.stringify({id,decision:'approved',note:'无副作用安装验收'})})
    assert.equal(response.status,200); approved=true
    const blob = await download(); assert.ifError(blob.error)
    assert.deepEqual(Buffer.from(await blob.data.arrayBuffer()),fs.readFileSync(filename))
    const ratings = await market.run('ratings',{id})
    assert.equal(ratings.summary.total,0)
    assert.equal(ratings.canRate,false)
    await assert.rejects(market.run('rate',{id,stars:5,displayName:'QA',comment:'Self-rating must be rejected'}))
    assert.ok((await reader.rpc('market_rate',{package_id:id,stars:5,display_name:'QA',comment:''})).error)
    const result = await market.run('install',{id})
    assert.equal(result.adapter.id,adapterId)
    assert.equal(receipts[id].icon,icon)
    assert.equal((await market.run('install',{id})).alreadyInstalled,true)
    assert.equal(installCalls,1)
    assert.equal((await market.run('list',{mine:true})).items.find(p=>p.id===id).installed,true)
    assert.ok((await client.storage.from('market-packages').update(object,Buffer.from('replacement'),{contentType:'application/zip'})).error)
    assert.ifError((await client.rpc('market_review',{package_id:id,decision:'withdrawn',note:'验收完成，示例下架'})).error); approved=false
    assert.equal((await reader.from('market_packages').select('id').eq('id',id)).data.length,0)
    assert.ok((await download()).error)
    await reader.auth.signOut({scope:'local'})
    console.log('PASS: pending hidden -> review -> download -> automatic local install -> installed readback -> no duplicate install -> withdrawn hidden')
  } finally {
    if (approved && id) {
      const result = await auth.getClient().rpc('market_review',{package_id:id,decision:'withdrawn',note:'验收结束撤下测试包'})
      if (result.error) console.error('QA withdrawal needs attention:',id)
    }
    auth.dispose(); fs.rmSync(dir,{recursive:true,force:true})
  }
  app.quit()
}).catch(e=>{console.error('FAIL:',e.message);app.exit(1)})
