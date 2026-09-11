'use strict'
const fs = require('node:fs/promises')
const crypto = require('node:crypto')
const yauzl = require('yauzl')
const semver = require('semver')
const YAML = require('yaml')
const {extractMetadata}=require('./marketplaceMetadata')
const MAX_ZIP = 50 * 1024 * 1024
function validateMetadata(input) {
  const result = {}
  for (const [key, min, max] of [['name',1,80],['author',1,80],['description',10,10000],['version',1,60],['harness_range',1,100]]) {
    const value = String(input[key] || '').trim()
    if (value.length < min || value.length > max) throw new Error(`${key} 长度应为 ${min}–${max} 字符`)
    result[key] = value
  }
  if (!semver.valid(result.version)) throw new Error('脚本版本请输入完整版本号，例如 1.0.0')
  if (!semver.validRange(result.harness_range)) throw new Error('抓虾版本范围无效，例如 >=0.2.0 <0.3.0')
  result.icon=String(input.icon||'')
  if(result.icon && (result.icon.length>100000 || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(result.icon)))throw new Error('图标需为不超过 75 KB 的 PNG 图片')
  result.platforms = [...new Set((Array.isArray(input.platforms) ? input.platforms : String(input.platforms || '').split(/[,，]/)).map(x => String(x).trim()).filter(Boolean))]
  if (!result.platforms.length || result.platforms.length > 20 || result.platforms.some(x => x.length > 80)) throw new Error('请填写 1–20 个适用平台，每个平台不超过 80 字符')
  return result
}
function validateZip(buffer) {
  if (!buffer.length || buffer.length > MAX_ZIP) throw new Error('ZIP 大小需在 1 字节到 50 MB 之间')
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(new Error('ZIP 文件损坏或格式不支持'))
      let total = 0, count = 0, manifestText = ''
      const names = new Set(), manifests = [], documents = []
      let docBytes=0
      const fail = message => { zip.close(); reject(new Error(message)) }
      zip.on('error', () => fail('ZIP 文件损坏或包含不安全路径'))
      zip.on('entry', entry => {
        const name = entry.fileName
        total += entry.uncompressedSize; count++
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000
        if (count > 5000 || total > 200 * 1024 * 1024) return fail('ZIP 解压体积或文件数量超出限制')
        if (entry.generalPurposeBitFlag & 1 || mode === 0xa000 || /(^\/|\\|(^|\/)\.\.(\/|$)|^[A-Za-z]:)/.test(name) || names.has(name)) return fail('ZIP 不支持加密、符号链接、重复文件或不安全路径')
        names.add(name)
        if (/(^|\/)manifest\.yaml$/.test(name) && !name.startsWith('__MACOSX/')) manifests.push(name)
        if (/(^|\/)manifest\.yaml$/.test(name) && entry.uncompressedSize > 1024 * 1024) return fail('manifest.yaml 不能超过 1 MB')
        zip.openReadStream(entry, (error, stream) => {
          if (error) return fail('ZIP 内容无法读取')
          const isDoc=/(^|\/)(readme(?:[._-](?:zh(?:[._-]cn)?|en))?|说明|使用说明)\.(md|txt)$/i.test(name) && name.split('/').length<=2 && entry.uncompressedSize<=262144 && docBytes+entry.uncompressedSize<=1048576
          if(isDoc)docBytes+=entry.uncompressedSize
          const chunks = []
          stream.on('error', () => fail('ZIP 内容损坏'))
          stream.on('data', chunk => { if (manifests.includes(name)||isDoc) chunks.push(chunk) })
          stream.on('end', () => { if(isDoc)documents.push({name,text:Buffer.concat(chunks).toString('utf8')}); if (manifests.includes(name)) manifestText = Buffer.concat(chunks).toString('utf8'); zip.readEntry() })
        })
      })
      zip.on('end', () => {
        if (manifests.length !== 1 || manifests[0].split('/').length > 2) return fail('ZIP 根目录或单一顶层目录必须包含一个 manifest.yaml')
        try {
          const manifest = YAML.parse(manifestText, {maxAliasCount: 0})
          if (!manifest || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(manifest.id || '') || typeof manifest.name !== 'string' || !manifest.name.trim() || typeof manifest.entry_url !== 'string' || !manifest.entry_url.trim()) return fail('manifest.yaml 缺少有效 id、name 或 entry_url')
          if (manifest.tasks !== undefined && !Array.isArray(manifest.tasks)) return fail('manifest.yaml 的 tasks 必须是列表')
          const root = manifests[0].slice(0, -'manifest.yaml'.length)
          const references = []
          if (manifest.auth?.check_script) references.push(manifest.auth.check_script)
          for (const task of manifest.tasks || []) {
            if (!task || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(task.id || '') || typeof task.name !== 'string' || !task.name.trim() || typeof task.script !== 'string') return fail('任务缺少有效 id、name 或 script')
            references.push(task.script)
            if (task.param_probe_script) references.push(task.param_probe_script)
          }
          if (references.some(file => typeof file !== 'string' || !names.has(root + file) || file.endsWith('/'))) return fail('ZIP 缺少 manifest.yaml 引用的脚本文件')
          const metadata=extractMetadata(manifest,documents.filter(d=>d.name.slice(0,d.name.lastIndexOf('/')+1)===root).sort((a,b)=>a.name.localeCompare(b.name)))
          resolve({ ...metadata, files: count, unpackedBytes: total, adapterId: manifest.id, version: String(manifest.version || '1.0.0'), name: manifest.name, author: typeof manifest.author === 'string' ? manifest.author : '' })
        } catch { fail('manifest.yaml 格式无效或包含不支持的 YAML 别名') }
      })
      zip.readEntry()
    })
  })
}
const objectPath = p => `${p.owner_id}/${p.id}.zip`
function createMarketplace({ getClient, accountState, version, chooseZip, saveZip, installZip,
  getInstalled = async () => [], readInstalls = () => ({}), writeInstalls = () => {}, notify = () => {}, readTimeoutMs = 12000 }) {
  const flights = new Map()
  let installQueue=Promise.resolve()
  const preparations = new Map()
  const check = result => {
    if(result.error){
      const message=String(result.error.message||'')
      const known=[['Version already exists','该版本号已发布过不同内容，请更新 manifest.yaml 中的版本号'],['Administrator withdrew','此版本已被管理员下架，请修正后上传新版本'],['newer or equal','已有更新版本，不能将旧版本重新上架'],['ZIP missing','ZIP 尚未上传完成，请重新选择相同文件继续提交'],['Status changed','状态已变化，请刷新后重试']]
      throw new Error(known.find(([key])=>message.includes(key))?.[1] || (['42P01','PGRST205','PGRST202'].includes(result.error.code)?'开放市场服务端尚未更新到生命周期版本，请联系管理员':'市场请求失败，请刷新检查结果后重试'))
    }
    return result.data
  }
  async function perform(action, input = {}, signal) {
    const state = await accountState()
    if (!state.user) throw new Error('请先登录账号后使用开放市场')
    signal?.throwIfAborted()
    const client = getClient()
    const read = query => { signal?.throwIfAborted(); return signal && query.abortSignal ? query.abortSignal(signal) : query }
    if (action === 'list') {
      let query = client.from('market_packages').select('*').order('created_at', { ascending: false }).range(Math.max(0, Number(input.page)||0)*30, Math.max(0, Number(input.page)||0)*30+29)
      query = input.mine ? query.eq('owner_id', state.user.id) : query.eq('status','approved')
      if (input.search) query = query.ilike('name', `%${String(input.search).slice(0,80).replace(/[%_]/g,'')}%`)
      if(input.mine && input.status && input.status!=='all') query=query.eq('status',input.status)
      if (input.platform) query = query.contains('platforms',[String(input.platform).slice(0,80)])
      const [rows, installed] = await Promise.all([
        (async () => {
          const rows = check(await read(query))
          const summaries = rows.length ? check(await read(client.rpc('market_rating_summary',{package_ids:rows.map(p=>p.id)}))) : []
          return rows.map(p => ({...p,rating:summaries.find(r=>r.package_id===p.id) || {average:0,total:0}}))
        })(),
        getInstalled(),
      ])
      const receipts = readInstalls()
      return { items: rows.map(p => {
        const receipt = receipts[p.id]
        const local = receipt && installed.find(a => a.id === receipt.adapterId && a.version === p.version)
        const current=installed.find(a=>a.id===p.adapter_id)
        return {...p, compatible: semver.satisfies(version, p.harness_range), installed: Boolean(local), updateAvailable:Boolean(current && semver.valid(current.version) && semver.gt(p.version,current.version)), localVersion:current?.version||'', adapterId: local?.id || ''}
      }), version }
    }
    if (action === 'ratings') {
      const page = Math.max(0, Math.min(100000, Math.floor(Number(input.page)||0)))
      // select('*') also works before script_id exists; never retry a missing-column error.
      const [row, mine, summaries] = await Promise.all([
        Promise.resolve(read(client.from('market_packages').select('*').eq('id',input.id).single())).then(check),
        Promise.resolve(read(client.from('market_ratings').select('*').eq('package_id',input.id).eq('user_id',state.user.id).maybeSingle())).then(check),
        Promise.resolve(read(client.rpc('market_rating_summary',{package_ids:[input.id]}))).then(check),
      ])
      const releaseIds=row.script_id ? check(await read(client.from('market_packages').select('id').eq('script_id',row.script_id).in('status',['approved','superseded']).limit(100))).map(r=>r.id) : [row.id]
      if(!releaseIds.includes(row.id))releaseIds.push(row.id)
      const reviews = check(await read(client.from('market_ratings').select('package_id,user_id,display_name,stars,comment,created_at,updated_at').in('package_id',releaseIds).eq('hidden',false).eq('deleted',false).order('created_at',{ascending:false}).range(page*20,page*20+19)))
      return {reviews,mine,summary:summaries[0] || {average:0,total:0},canRate:!state.user.anonymous && row.owner_id!==state.user.id && row.status==='approved'}
    }
    if (action === 'rate') {
      if (state.user.anonymous) throw new Error('请先绑定邮箱，再发表评价')
      const stars=Number(input.stars), name=String(input.displayName||'').trim(), comment=String(input.comment||'').trim()
      if (!Number.isInteger(stars)||stars<1||stars>5||!name||name.length>40||comment.length>2000) throw new Error('请选择 1–5 星，昵称不超过 40 字，评论不超过 2000 字')
      check(await client.rpc('market_rate',{package_id:input.id,stars,display_name:name,comment}))
      return {ok:true}
    }
    if (action === 'remove-rating') {
      check(await client.rpc('market_remove_rating',{package_id:input.id}))
      return {ok:true}
    }
    if (action === 'discard-zip') { if(input.token) preparations.delete(input.token); return {ok:true} }
    if (action === 'prepare-zip') {
      if (state.user.anonymous) throw new Error('请先绑定邮箱，再发布脚本')
      let bytes, filename
      if (input.bytes !== undefined) {
        if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength>MAX_ZIP) throw new Error('请选择不超过 50 MB 的 ZIP 适配包')
        bytes=Buffer.from(input.bytes);filename=String(input.name||'')
      } else {
        const file=input.path || await chooseZip()
        if(!file)return {canceled:true}
        const stat=await fs.stat(file)
        if(!stat.isFile()||stat.size>MAX_ZIP)throw new Error('请选择不超过 50 MB 的 ZIP 适配包')
        bytes=await fs.readFile(file);filename=require('node:path').basename(file)
      }
      if(!filename.toLowerCase().endsWith('.zip'))throw new Error('请选择 ZIP 适配包')
      const archive=await validateZip(bytes)
      if(!semver.valid(archive.version))throw new Error('ZIP 中的脚本版本不是有效版本号')
      const token=crypto.randomUUID()
      if(preparations.size>=8) preparations.delete(preparations.keys().next().value)
      preparations.set(token,{token,owner:state.user.id,bytes,archive})
      return {token,adapterId:archive.adapterId,filename,size:bytes.length,version:archive.version,name:archive.name,author:archive.author,platforms:archive.platforms,description:archive.description,sources:archive.sources}
    }
    if (action === 'publish') {
      if (state.user.anonymous) throw new Error('请先绑定邮箱，再发布脚本')
      const prepared=preparations.get(input.zipToken)
      if(!prepared || prepared.token!==input.zipToken || prepared.owner!==state.user.id)throw new Error('请先选择并校验 ZIP 适配包')
      const {bytes,archive}=prepared
      const metadata=validateMetadata({...input,version:archive.version})
      const digest=crypto.createHash('sha256').update(bytes).digest('hex')
      const row=check(await client.rpc('market_begin_release',{metadata,adapter:archive.adapterId,digest,bytes:bytes.length}))
      if(row.status==='draft') {
        const uploaded=await client.storage.from('market-packages').upload(objectPath(row),bytes,{contentType:'application/zip',cacheControl:'0',upsert:false})
        // An immutable existing object may be the result of a previous uncertain upload.
        if(uploaded.error) {
          const prior=check(await client.storage.from('market-packages').download(objectPath(row),{cacheNonce:crypto.randomUUID()},{cache:'no-store'}))
          if(crypto.createHash('sha256').update(Buffer.from(await prior.arrayBuffer())).digest('hex')!==digest) throw new Error('云端 ZIP 不一致，请联系管理员')
        }
        check(await client.rpc('market_submit',{package_id:row.id}))
      }
      preparations.delete(input.zipToken)
      return {id:row.id,scriptId:row.script_id,version:row.version,status:row.status==='draft'?'pending':row.status,existing:row.status!=='draft'}
    }
    if(action==='history') {
      const row=check(await read(client.from('market_packages').select('*').eq('id',input.id).single()))
      const [releases,eventResult]=await Promise.all([
        row.script_id ? Promise.resolve(read(client.from('market_packages').select('*').eq('script_id',row.script_id).order('created_at',{ascending:false}).limit(100))).then(check) : [row],
        read(client.from('market_events').select('*').eq('package_id',row.id).order('created_at',{ascending:false}).limit(100)),
      ])
      if(eventResult.error && ['42P01','PGRST205'].includes(eventResult.error.code))return {items:releases,events:[],available:false,notice:'版本服务正在更新。当前可查看已有记录和下载源包，暂不支持更改发布状态。'}
      const events=check(eventResult)
      return {items:releases,events,available:true}
    }
    if(action==='cancel'||action==='unlist') {check(await client.rpc('market_owner_action',{package_id:input.id,action,note:String(input.note||'').slice(0,2000)}));return {ok:true}}
    if (action === 'submit') { check(await client.rpc('market_submit',{package_id:input.id})); return {ok:true} }
    if (action === 'download' || action === 'install') {
      const row = check(await client.from('market_packages').select('*').eq('id', input.id).single())
      if (action === 'install') {
        if (row.status !== 'approved') throw new Error('该适配包尚未上架或已下架，不能安装')
        if (!semver.satisfies(version, row.harness_range)) throw new Error(`此脚本要求抓虾 ${row.harness_range}，请先更新客户端`)
        notify({id:row.id, stage:'downloading'})
      }
      const blob = check(await client.storage.from('market-packages').download(objectPath(row), {cacheNonce: crypto.randomUUID()}, {cache:'no-store'}))
      if (blob.size > MAX_ZIP) throw new Error('文件超出大小限制')
      const bytes = Buffer.from(await blob.arrayBuffer())
      if (bytes.length !== Number(row.size_bytes) || crypto.createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error('文件完整性校验失败，请联系发布者')
      const archive = await validateZip(bytes)
      if ((row.adapter_id && archive.adapterId!==row.adapter_id) || archive.version !== row.version) throw new Error('适配包版本与发布信息不一致')
      if (action === 'install') {
        const installed = await getInstalled()
        const existing = installed.find(a => a.id === archive.adapterId)
        const receipts = readInstalls()
        if (existing) {
          const ownReceipt = receipts[row.id]
          if (ownReceipt?.adapterId === existing.id && existing.version === row.version) return {ok:true, adapter:existing, alreadyInstalled:true}
          const foreignPublisher = Object.values(receipts).some(r => r.adapterId === existing.id && r.ownerId !== row.owner_id)
          if (foreignPublisher) throw new Error('此脚本标识已由另一开发者的市场脚本使用，请先检查来源')
          if (!semver.valid(existing.version) || semver.gt(existing.version, row.version)) throw new Error('本地脚本版本更高，已保留当前版本')
        }
        notify({id:row.id, stage:'installing'})
        const result = await installZip(bytes)
        if (!result?.ok || result.adapter?.id !== archive.adapterId) throw new Error(result?.error || '安装未完成，请重试')
        const actual = (await getInstalled()).find(a => a.id === archive.adapterId && a.version === archive.version)
        if (!actual) throw new Error('安装结果尚未确认，请在「我的脚本」检查')
        writeInstalls({...readInstalls(), [row.id]:{adapterId:archive.adapterId, ownerId:row.owner_id, version:row.version, icon:row.icon||''}})
        notify({id:row.id, stage:'installed'})
        return {ok:true, adapter:actual}
      }
      return saveZip(bytes, `${row.name.replace(/[^\p{L}\p{N}_-]/gu,'_')}-${row.version}.zip`)
    }
    throw new Error('不支持的市场操作')
  }
  function run(action, input = {}) {
    if (['list','ratings','history'].includes(action)) {
      // One budget for the complete read, including account refresh and local backend reads.
      const controller = new AbortController()
      let timer
      const timeout = new Promise((_,reject) => { timer=setTimeout(() => {
        const error=new Error('加载超时，请检查网络后重试')
        controller.abort(error);reject(error)
      },readTimeoutMs) })
      return Promise.race([perform(action,input,controller.signal),timeout]).finally(() => {clearTimeout(timer);controller.abort()})
    }
    if (action !== 'install') return perform(action, input)
    if (flights.has(input.id)) return flights.get(input.id)
    const flight = installQueue.then(()=>perform(action, input)).catch(error => {notify({id:input.id,stage:'failed'});throw error}).finally(() => flights.delete(input.id))
    installQueue=flight.catch(()=>{})
    flights.set(input.id, flight)
    return flight
  }
  return {run}
}
module.exports = {createMarketplace, validateMetadata, validateZip, MAX_ZIP}
