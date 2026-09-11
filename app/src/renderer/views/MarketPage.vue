<template>
  <section class="market-page">
    <header><div class="market-heading"><h1>开放市场</h1><p>发现与分享社区脚本</p></div><button class="primary" :disabled="busy" @click="startPublish">发布适配包 <IconPlus :size="16" /></button></header>
    <div class="toolbar"><nav aria-label="市场分类"><button :class="{selected: !mine}" :aria-current="!mine ? 'page' : undefined" @click="switchTab(false)">发现脚本</button><button :class="{selected: mine}" :aria-current="mine ? 'page' : undefined" @click="switchTab(true)">我的发布</button></nav><span v-if="version">当前抓虾 {{ version }}</span></div>
    <form v-if="user" class="search" @submit.prevent="page=0; load()"><label><IconSearch :size="18"/><input v-model="search" placeholder="搜索脚本名称" aria-label="搜索脚本名称" maxlength="80" /></label><input v-model="platform" placeholder="适用平台，例如淘宝" aria-label="筛选适用平台" maxlength="80"/><select v-if="mine" v-model="status" aria-label="审核状态" @change="page=0;load()"><option value="all">全部状态</option><option v-for="(label,key) in labels" :key="key" :value="key">{{ label }}</option></select><button :disabled="busy">搜索</button><button v-if="search || platform || status!=='all'" type="button" class="text-button" :disabled="busy" @click="resetFilters">重置</button></form>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="message" class="message" role="status">{{ message }}</p>
    <div class="market-body">
      <div v-if="loading && !items.length" class="market-empty" role="status">
        <span class="empty-icon"><IconPackage :size="28" :stroke-width="1.5" /></span>
        <p>正在加载脚本…</p>
      </div>
      <div v-else-if="!user" class="market-empty">
        <span class="empty-icon"><IconPackage :size="28" :stroke-width="1.5" /></span>
        <div class="empty-copy">
          <h2>{{ mine ? '登录后，管理你的发布' : '登录后，探索社区脚本' }}</h2>
          <p>{{ mine ? '分享你的适配包，查看审核进度与发布记录。' : '发现适合你的工具，一键安装到抓虾，随时打开使用。' }}</p>
        </div>
        <button class="empty-action" @click="$emit('login')">登录 / 注册</button>
        <p class="empty-hint">{{ mine ? '适配包审核通过后，会向所有用户开放。' : '安装完成后，可直接打开，也可在「我的脚本」中找到。' }}</p>
      </div>
      <div v-else-if="!items.length && !error" class="market-empty">
        <span class="empty-icon"><IconPackage :size="28" :stroke-width="1.5" /></span>
        <div class="empty-copy">
          <h2>{{ mine ? '还没有发布适配包' : '暂时没有符合条件的脚本' }}</h2>
          <p>{{ mine ? '上传完整 ZIP，和社区分享你的自动化工具。' : '试试其他名称或平台，也可以发布自己的适配包。' }}</p>
        </div>
        <button v-if="mine" class="empty-action" @click="startPublish">发布适配包</button>
        <p v-if="mine" class="empty-hint">提交后可在这里查看审核进度。</p>
      </div>
    <div v-else-if="mine" class="published-list" aria-label="我的发布记录">
      <div class="published-head" aria-hidden="true"><span>脚本</span><span>版本 / 状态</span><span>适用平台</span><span>操作</span></div>
      <article v-for="item in items" :key="item.id" class="published-row">
        <div class="published-identity"><PackageIcon :src="item.icon"/><div><button class="title-link" @click="showHistory(item)">{{ item.name }}</button><p>{{ item.author }} · {{ formatDate(item.created_at) }}</p></div></div>
        <div class="published-state"><strong>v{{ item.version }}</strong><span class="badge" :data-status="item.status">{{ labels[item.status] }}</span></div>
        <div class="tags"><span v-for="p in item.platforms" :key="p">{{ p }}</span></div>
        <div class="row-actions"><button :disabled="busy" @click="download(item)">下载源包</button><button class="manage-button" :disabled="busy" @click="showHistory(item)">版本管理 <IconChevronRight :size="14"/></button></div>
      </article>
    </div>
    <div v-else class="cards"><article v-for="item in items" :key="item.id" class="market-card">
      <div class="card-top"><PackageIcon :src="item.icon"/><span v-if="item.installed" class="badge">已安装</span><span v-else-if="item.updateAvailable" class="badge" data-status="pending">可更新</span></div>
      <h2><button class="title-link" @click="showDetails(item)">{{ item.name }}</button></h2><div class="byline">{{ item.author }} · v{{ item.version }}</div>
      <p class="description">{{ item.description }}</p><div class="tags"><span v-for="p in item.platforms" :key="p">{{ p }}</span></div>
      <button class="rating-link" @click="showDetails(item,true)"><span class="rating-star">★</span><strong>{{ item.rating?.total ? Number(item.rating.average).toFixed(1) : '暂无评分' }}</strong><span>{{ item.rating?.total || 0 }} 个评分</span></button>
      <div class="compatibility">抓虾 {{ item.harness_range }}<small v-if="!item.compatible">当前客户端版本不适用</small></div>
      <footer><span>{{ formatSize(item.size_bytes) }}</span><button :disabled="busy" @click="showDetails(item)">查看详情</button><button class="install-button" :disabled="busy || (!item.compatible && !item.installed)" @click="installOrOpen(item)">{{ installLabel(item) }}<IconCheck v-if="item.installed" :size="14"/><IconDownload v-else :size="14"/></button></footer>
    </article></div>
    </div>
    <div v-if="user && (items.length || page > 0)" class="market-pagination"><button :disabled="busy || page===0" @click="page--;load()">上一页</button><span>第 {{ page+1 }} 页 · 本页 {{ items.length }} 条</span><button :disabled="busy || items.length<30" @click="page++;load()">下一页</button></div>
    <div v-if="user && items.length && !mine" class="market-note">安装完成后，可以直接打开，也可以在<button @click="$emit('scripts')">我的脚本</button>中找到。</div>
    <dialog class="publish-dialog" aria-labelledby="publish-title" ref="publishDialog" @cancel="onCancel" @close="clearZip"><form @submit.prevent="publish">
      <div class="dialog-title"><div><h2 id="publish-title">{{ updateTarget ? '发布新版本' : '发布适配包' }}</h2></div><button type="button" :disabled="busy" @click="publishDialog.close()" aria-label="关闭发布窗口"><IconX :size="18"/></button></div>
      <p>{{ updateTarget ? `为「${updateTarget.name}」上传更新，已上架版本在审核期间保持可用。` : '分享可复用的脚本，审核通过后向社区开放。' }}</p><ol class="publish-steps" aria-label="发布步骤"><li :class="{active:!selectedZip}"><span>1</span>选择 ZIP</li><li :class="{active:selectedZip}"><span>2</span>确认发布信息</li><li><span>3</span>提交审核</li></ol>
      <button type="button" class="zip-drop" :class="{dragging}" :disabled="busy" @click="prepareZip()" @dragover.prevent="dragging=!busy" @dragleave.prevent="dragging=false" @drop.prevent="dropZip">
        <IconPackage :size="28"/><strong>{{ preparing ? '正在校验适配包…' : selectedZip ? selectedZip.filename : '拖拽 ZIP 到这里，或点击选择' }}</strong>
        <span>{{ selectedZip ? `v${selectedZip.version} · ${(selectedZip.size/1024/1024).toFixed(2)} MB · 点击或拖入更换` : '完整适配包 · 最大 50 MB · 自动读取脚本版本' }}</span>
      </button>
      <div v-if="selectedZip" class="fields">
        <div class="wide icon-picker"><PackageIcon :src="form.icon"/><div><label class="icon-upload">自定义图标（选填）<input type="file" accept="image/png,image/jpeg,image/webp" :disabled="busy" @change="selectIcon"/></label><small>PNG、JPG 或 WebP，最大 2 MB；不选则使用默认虾图标。</small><button v-if="form.icon" type="button" :disabled="busy" @click="form.icon=''">恢复默认</button></div></div>
        <label>脚本名称<input v-model="form.name" required maxlength="80" placeholder="例如：商品信息批量导出"/></label>
        <label>开发者名称<input v-model="form.author" required maxlength="80" placeholder="对外展示的署名"/></label>
        <label>脚本版本<span class="detected-version">v{{ selectedZip.version }} <small>从 ZIP 自动读取</small></span></label>
        <label>适配抓虾版本<input v-model="form.harness_range" required placeholder=">=0.2.0 <0.3.0" maxlength="100"/></label>
        <label class="wide">适用平台<small v-if="selectedZip.sources?.platforms" class="extract-hint">已从 {{ selectedZip.sources.platforms }} 提取，可修改</small><input v-model="form.platforms" required maxlength="1600" placeholder="淘宝，京东，抖店（多个平台用逗号分隔）"/></label>
        <label class="wide">功能说明与使用前提<small v-if="selectedZip.sources?.description" class="extract-hint">已从 {{ selectedZip.sources.description }} 提取，请确认后发布</small><textarea v-model="form.description" required minlength="10" maxlength="10000" rows="4" placeholder="可以实现什么效果？需要哪些权限？有哪些使用限制？"/></label>
      </div>
      <p class="hint">ZIP 需包含 manifest.yaml 和脚本依赖。选择后先在本地校验，点击提交审核才会上传。</p>
      <p v-if="publishError" class="error" role="alert">{{ publishError }}</p>
      <div class="dialog-actions"><button type="button" :disabled="busy" @click="publishDialog.close()">取消</button><button class="primary" :disabled="busy || !selectedZip">{{ working ? '正在提交…' : '提交审核' }}</button></div>
    </form></dialog>
    <dialog ref="historyDialog" class="version-dialog" aria-labelledby="history-title" @cancel="cancelHistory" @close="historyAction=null">
      <header class="version-header"><div class="version-identity"><PackageIcon :src="historyItem?.icon"/><div><h2 id="history-title">{{ historyItem?.name }}</h2><p>版本管理 · {{ historyItem?.author }}</p></div></div><button :disabled="working" aria-label="关闭版本管理" @click="historyDialog.close()"><IconX :size="18"/></button></header>
      <div class="version-scroll">
        <div class="version-overview"><div><span>当前上架</span><strong>{{ liveRelease ? 'v'+liveRelease.version : '暂无上架版本' }}</strong></div><div><span>发布记录</span><strong>{{ historyItems.length }} 个版本</strong></div><p>新版本通过审核后自动替换旧版，历史记录持续保留。</p></div>
        <div v-if="historyNotice" class="state-notice" role="status"><IconInfoCircle :size="20"/><div><strong>当前可查看发布信息</strong><p>{{ historyNotice }}</p></div></div>
        <div v-if="historyError" class="state-notice error" role="alert"><IconAlertCircle :size="20"/><div><strong>暂时无法更新版本记录</strong><p>{{ historyError }}</p><button :disabled="historyLoading" @click="refreshHistory">重新加载</button></div></div>
        <div class="section-heading"><h3>版本记录</h3><span>按提交时间排列</span></div>
        <div v-if="historyLoading" class="history-skeleton" role="status">正在获取版本与审核记录…</div>
        <div v-else class="version-table"><div class="version-table-head" aria-hidden="true"><span>版本 / 提交时间</span><span>状态</span><span>版本操作</span></div>
          <article v-for="release in historyItems" :key="release.id" class="version-row">
            <div class="version-main"><strong>v{{ release.version }}</strong><span>{{ formatDate(release.created_at) }}</span></div><span class="badge" :data-status="release.status">{{ labels[release.status] }}</span>
            <div class="release-actions"><button :disabled="working" @click="download(release)">下载源包</button><button v-if="canManage && ['draft','pending'].includes(release.status)" :disabled="working" @click="beginAction(release,'cancel')">撤回审核</button><button v-if="canManage && release.status==='approved'" class="danger-button" :disabled="working" @click="beginAction(release,'unlist')">下架</button><button v-if="canManage && ['draft','canceled','rejected','withdrawn'].includes(release.status)" :disabled="working" @click="beginAction(release,'submit')">重新送审</button></div>
            <p v-if="release.review_note" class="version-note"><span>处理说明</span>{{ release.review_note }}</p>
          </article>
        </div>
        <form v-if="historyAction" ref="actionForm" tabindex="-1" class="release-confirm" @submit.prevent="changeRelease"><h3>{{ actionLabels[historyAction.action] }} · v{{ historyAction.release.version }}</h3><p>{{ historyAction.action==='unlist' ? '下架后停止新的安装，同时撤回本脚本待审版本；已经安装的副本不受影响。' : historyAction.action==='cancel' ? '撤回后不再进入审核，已上架版本不受影响。你可以再次提交。' : '重新进入审核，通过后才会上架。修改内容请上传新版本。' }}</p><label v-if="historyAction.action!=='submit'">操作说明（选填）<textarea v-model="historyNote" rows="2" maxlength="2000" placeholder="说明本次操作的原因，方便之后追溯" /></label><div class="dialog-actions"><button type="button" :disabled="working" @click="historyAction=null">取消</button><button :class="historyAction.action==='submit'?'primary':'danger-button'" :disabled="working">{{ working?'处理中…':'确认'+actionLabels[historyAction.action] }}</button></div></form>
        <details v-if="historyEvents.length" class="audit-events"><summary>查看操作记录 · {{ historyEvents.length }} 条</summary><ol><li v-for="event in historyEvents" :key="event.id"><span>{{ labels[event.to_status] }}</span><time>{{ formatDate(event.created_at) }}</time><p v-if="event.note">{{ event.note }}</p></li></ol></details>
      </div>
      <footer class="version-footer"><span>相同脚本标识沿用版本历史</span><button class="primary" :disabled="working || !canManage" @click="startUpdate"><IconPlus :size="16"/>发布新版本</button></footer>
    </dialog>
    <dialog ref="detailDialog" class="detail-dialog" aria-labelledby="detail-title" @cancel="cancelDetail">
      <template v-if="detailItem">
        <header class="version-header">
          <div class="version-identity">
            <PackageIcon :src="detailItem.icon"/>
            <div>
              <h2 id="detail-title">{{ detailItem.name }}</h2>
              <p>{{ detailItem.author }} · v{{ detailItem.version }}</p>
            </div>
          </div>
          <button :disabled="working || detailReviewBusy" aria-label="关闭脚本详情" @click="detailDialog.close()"><IconX :size="18"/></button>
        </header>
        <div class="version-scroll detail-scroll">
          <section class="detail-hero" aria-label="脚本概览">
            <div class="detail-rating">
              <strong>{{ detailItem.rating?.total ? Number(detailItem.rating.average).toFixed(1) : '—' }}</strong>
              <span>{{ detailItem.rating?.total || 0 }} 个评分</span>
            </div>
            <div class="tags"><span v-for="p in detailItem.platforms" :key="p">{{ p }}</span></div>
          </section>
          <section class="detail-section">
            <h3>功能说明与使用前提</h3>
            <p class="full-description">{{ detailItem.description }}</p>
            <dl class="package-facts">
              <div><dt>适配抓虾</dt><dd>{{ detailItem.harness_range }}</dd></div>
              <div><dt>文件大小</dt><dd>{{ formatSize(detailItem.size_bytes) }}</dd></div>
              <div><dt>更新时间</dt><dd>{{ formatDate(detailItem.created_at) }}</dd></div>
            </dl>
          </section>
          <div ref="detailReviews" class="detail-reviews">
            <MarketReviews :key="detailItem.id" embedded :item="detailItem" @busy="detailReviewBusy=$event" @changed="detailItem && (detailItem.rating=$event)" />
          </div>
        </div>
        <footer class="version-footer detail-footer">
          <span>{{ detailItem.installed ? '已安装到本地，可直接打开复用。' : '安装后会自动写入本地脚本，无需手动导入。' }}</span>
          <button class="primary" :disabled="busy || detailReviewBusy || (!detailItem.compatible && !detailItem.installed)" @click="installOrOpen(detailItem)">{{ installLabel(detailItem) }}</button>
        </footer>
      </template>
    </dialog>
  </section>
</template>
<script setup>
import {readRequest} from '../utils/readRequest.mjs'
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import MarketReviews from './MarketReviews.vue'
import PackageIcon from '../components/PackageIcon.vue'
const detailDialog=ref(null),detailItem=ref(null),detailReviews=ref(null),detailReviewBusy=ref(false),updateTarget=ref(null)
async function showDetails(item,focusReviews=false){detailItem.value=item;detailReviewBusy.value=false;await nextTick();if(!detailDialog.value.open)detailDialog.value.showModal();if(focusReviews){await nextTick();requestAnimationFrame(()=>{const reduceMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;detailReviews.value?.scrollIntoView({block:'start',behavior:reduceMotion?'auto':'smooth'});detailReviews.value?.querySelector('#reviews-title')?.focus({preventScroll:true})})}}
const formatDate=value=>new Date(value).toLocaleDateString('zh-CN')
const formatSize=value=>value<1048576 ? `${Math.max(1,Math.round(value/1024))} KB` : `${(value/1048576).toFixed(1)} MB`
function resetFilters(){search.value='';platform.value='';status.value='all';page.value=0;load()}
const status=ref('all'),historyDialog=ref(null),historyItem=ref(null),historyItems=ref([]),historyLoading=ref(false),historyError=ref(''),historyAction=ref(null),historyNote=ref('')
const actionLabels={cancel:'撤回提交',unlist:'下架',submit:'提交审核'}
const historyNotice=ref(''),historyEvents=ref([]),canManage=ref(false),actionForm=ref(null)
const liveRelease=computed(()=>historyItems.value.find(r=>r.status==='approved'))
let historyGeneration=0
async function showHistory(item){historyItem.value=item;historyItems.value=[item];historyEvents.value=[];historyAction.value=null;historyNote.value='';historyError.value='';historyNotice.value='';canManage.value=false;historyDialog.value.showModal();await refreshHistory()}
async function refreshHistory(){const gen=++historyGeneration;historyLoading.value=true;historyError.value='';historyNotice.value='';try{const result=await readRequest(()=>window.cs.marketAction('history',{id:historyItem.value.id}));if(gen!==historyGeneration)return;historyItems.value=result.items;historyEvents.value=result.events||[];canManage.value=result.available!==false;if(result.notice)historyNotice.value=result.notice}catch(e){if(gen!==historyGeneration)return;canManage.value=false;const text=cleanError(e);if(text.includes('不支持的市场操作'))historyNotice.value='客户端已加载新版页面，但发布服务尚未更新。请重新打开客户端后管理版本；当前记录和源包仍可查看。';else if(text.includes('初始化')||text.includes('服务端尚未更新'))historyNotice.value='版本服务正在更新。当前可查看已有记录和下载源包，暂不支持更改发布状态。';else historyError.value=text}finally{if(gen===historyGeneration)historyLoading.value=false}}
async function beginAction(release,action){historyAction.value={release,action};historyNote.value='';await nextTick();actionForm.value?.focus();actionForm.value?.scrollIntoView({block:'nearest',behavior:'auto'})}
function cancelHistory(event){if(working.value)event.preventDefault()}
function cancelDetail(event){if(working.value||detailReviewBusy.value)event.preventDefault()}
function startUpdate(){updateTarget.value=historyItem.value;historyDialog.value.close();startPublish(true)}
async function changeRelease(){working.value=true;historyError.value='';try{await window.cs.marketAction(historyAction.value.action,{id:historyAction.value.release.id,note:historyNote.value});historyAction.value=null;historyNote.value='';await Promise.all([refreshHistory(),load()]);await nextTick();historyDialog.value?.querySelector('button')?.focus()}catch(e){historyError.value=cleanError(e)}finally{working.value=false}}
import { IconPackage, IconPlus, IconSearch, IconDownload, IconCheck, IconChevronRight, IconX, IconInfoCircle, IconAlertCircle } from '@tabler/icons-vue'
const emit = defineEmits(['login','scripts','installed','open-script'])
const installStages = ref({})
const items=ref([]), user=ref(null), mine=ref(false), search=ref(''), platform=ref(''), page=ref(0), version=ref(''), error=ref(''), message=ref(''), loading=ref(false), working=ref(false), publishError=ref(''), publishDialog=ref(null)
const busy=computed(()=>loading.value||working.value||preparing.value)
const selectedZip=ref(null),preparing=ref(false),dragging=ref(false)
const form=ref({icon:'',name:'',author:'',harness_range:'>=0.2.0',platforms:'',description:''})
const labels={draft:'待完成提交',pending:'审核中',approved:'已上架',rejected:'未通过',withdrawn:'已下架',canceled:'已撤回',superseded:'历史版本'}
const cleanError=e=>String(e?.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
let stop, stopProgress, generation=0, listKey=''
const currentListKey=()=>JSON.stringify({mine:mine.value,status:status.value,search:search.value,platform:platform.value,page:page.value})
async function load(){const gen=++generation,key=currentListKey();if(key!==listKey)items.value=[];loading.value=true;error.value='';try{const state=await readRequest(()=>window.cs.accountAction('status'));if(gen!==generation)return;user.value=state.user;if(!state.user){items.value=[];listKey='';return}const result=await readRequest(()=>window.cs.marketAction('list',{mine:mine.value,status:status.value,search:search.value,platform:platform.value,page:page.value}));if(gen===generation){items.value=result.items;version.value=result.version;listKey=key}}catch(e){if(gen===generation){error.value=cleanError(e);if(key!==listKey)items.value=[]}}finally{if(gen===generation)loading.value=false}}
function switchTab(value){mine.value=value;page.value=0;load()}
function startPublish(isUpdate=false){if(isUpdate!==true)updateTarget.value=null;publishError.value='';if(!user.value){error.value='请先登录后发布脚本';return}if(user.value.anonymous){error.value='请在账号设置中绑定邮箱后发布';return}publishDialog.value.showModal()}
async function selectIcon(event){
  const file=event.target.files?.[0];event.target.value='';if(!file)return
  preparing.value=true;publishError.value=''
  let bitmap
  try{
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024)throw Error('请选择不超过 2 MB 的 PNG、JPG 或 WebP 图片')
    bitmap=await createImageBitmap(file)
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128
    const scale=Math.min(128/bitmap.width,128/bitmap.height),w=bitmap.width*scale,h=bitmap.height*scale
    canvas.getContext('2d').drawImage(bitmap,(128-w)/2,(128-h)/2,w,h)
    const icon=canvas.toDataURL('image/png')
    if(icon.length>100000)throw Error('图标内容过于复杂，请选择更简单的图片')
    form.value.icon=icon
  }catch(e){publishError.value=cleanError(e)}finally{bitmap?.close();preparing.value=false}
}
async function clearZip(){const token=selectedZip.value?.token;form.value.icon='';selectedZip.value=null;dragging.value=false;await window.cs.marketAction('discard-zip',{token}).catch(()=>{})}
async function prepareZip(file){
  if(busy.value)return
  preparing.value=true;publishError.value='';selectedZip.value=null
  try{
    let input={}
    if(file){if(!file.name.toLowerCase().endsWith('.zip')||file.size>50*1024*1024)throw Error('请选择不超过 50 MB 的 ZIP 适配包');input={name:file.name,bytes:new Uint8Array(await file.arrayBuffer())}}
    const result=await window.cs.marketAction('prepare-zip',input)
    if(result.canceled)return
    if(updateTarget.value?.adapter_id && result.adapterId!==updateTarget.value.adapter_id)throw Error('此 ZIP 的脚本标识与当前脚本不同，请选择同一脚本的新版本')
    selectedZip.value=result
    if(updateTarget.value){form.value.icon=updateTarget.value.icon||'';form.value.harness_range=updateTarget.value.harness_range}
    form.value.name=result.name||'';form.value.author=result.author||''
    form.value.platforms=(result.platforms||[]).join('，');form.value.description=result.description||''
  }catch(e){publishError.value=cleanError(e)}finally{preparing.value=false}
}
function dropZip(event){dragging.value=false;if(busy.value)return;if(event.dataTransfer.files.length!==1){publishError.value='请每次选择一个 ZIP 适配包';return}prepareZip(event.dataTransfer.files[0])}
function onCancel(e){if(busy.value)e.preventDefault()}
async function publish(){working.value=true;publishError.value='';try{const result=await window.cs.marketAction('publish',{...form.value,zipToken:selectedZip.value?.token});if(result.canceled)return;publishDialog.value.close();message.value=(!result.status || result.status==='pending')?'适配包已提交审核，可在「我的发布」查看进度。':`同版本适配包已经存在，当前状态：${labels[result.status]||result.status}。可在版本管理中操作。`;mine.value=true;page.value=0;await load()}catch(e){publishError.value=cleanError(e)+'。若提交结果不确定，请关闭窗口并刷新「我的发布」确认后再操作。'}finally{working.value=false}}
function installLabel(item) {
  if (item.installed) return '打开'
  const labels = {downloading:'下载中…', installing:'安装中…', failed:'重试安装'}
  return labels[installStages.value[item.id]] || (item.compatible ? (item.updateAvailable?'更新':'安装') : '版本不兼容')
}
async function installOrOpen(item) {
  if (item.installed) { emit('open-script', item.adapterId); return }
  working.value=true;error.value='';message.value='';installStages.value[item.id]='downloading'
  try {
    const result=await window.cs.marketAction('install',{id:item.id})
    item.installed=true;item.adapterId=result.adapter.id;installStages.value[item.id]='installed'
    message.value=`「${item.name}」已安装，可以直接打开。`
    emit('installed')
  } catch(e) { installStages.value[item.id]='failed';error.value=cleanError(e) }
  finally { working.value=false }
}
async function download(item){working.value=true;error.value='';try{const result=await window.cs.marketAction('download',{id:item.id});if(!result.canceled)message.value='源包已保存。'}catch(e){error.value=cleanError(e)}finally{working.value=false}}
async function submitDraft(item){working.value=true;try{await window.cs.marketAction('submit',{id:item.id});await load()}catch(e){error.value=cleanError(e)+'；若文件未上传完成，请重新发布。'}finally{working.value=false}}
onMounted(()=>{load();stopProgress=window.cs.onMarketProgress?.(progress=>{installStages.value[progress.id]=progress.stage});stop=window.cs.onAccountChanged(()=>{publishDialog.value?.close();historyDialog.value?.close();detailDialog.value?.close();historyGeneration++;detailReviewBusy.value=false;items.value=[];listKey='';load()})});onUnmounted(()=>{generation++;stop?.();stopProgress?.()})
</script>
<style scoped>
.market-page{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:auto;box-sizing:border-box;padding:24px 32px;max-width:1440px;margin:0 auto;color:var(--text);font-size:13px}
.market-page>*{flex-shrink:0;box-sizing:border-box}
.market-page>header,.toolbar,.card-top,.dialog-title,.dialog-actions,.version-header,.version-footer{display:flex;align-items:center;justify-content:space-between;gap:16px}
.market-page>header{margin-bottom:12px;min-height:40px}.market-heading{display:flex;align-items:baseline;gap:14px;min-width:0}.market-heading p{margin:0;font-size:12px}
h1{font-size:22px;line-height:1.4;margin:0;letter-spacing:-.02em}h2{font-size:18px;line-height:1.5;margin:0;overflow-wrap:anywhere}h3{font-size:14px;line-height:1.5;margin:0}p{color:var(--text2);font-size:13px;line-height:1.65;margin:0}button,input,textarea,select{font:inherit;box-sizing:border-box}
button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:36px;padding:7px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--text);cursor:pointer;transition:background-color .15s,color .15s,border-color .15s;white-space:nowrap}
button:hover:not(:disabled){background:var(--bg3);border-color:var(--border-strong,var(--text2))}button:disabled{opacity:.5;cursor:not-allowed}
button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--orange);outline-offset:3px}
.primary{background:var(--orange);border-color:var(--orange);color:var(--on-orange,#fff);font-weight:600}.primary:hover:not(:disabled){background:var(--orange-text);border-color:var(--orange-text);color:var(--on-orange,#fff)}
:root[data-theme="light"] .primary{background:var(--orange-strong);border-color:var(--orange-strong);color:#fff}
.text-button{border-color:transparent;background:transparent;color:var(--text2)}
.toolbar{border-bottom:1px solid var(--border);font-size:12px;color:var(--text2)}.toolbar nav{display:flex;gap:24px}.toolbar nav button{border:0;border-bottom:2px solid transparent;border-radius:0;padding:12px 0;background:none;color:var(--text2)}.toolbar nav button.selected{color:var(--text);border-bottom-color:var(--orange);font-weight:600}
.search{display:flex;align-items:center;gap:10px;margin:18px 0 20px}.search label{display:flex;align-items:center;gap:8px;flex:1;min-width:140px;border:1px solid var(--border);border-radius:8px;padding-left:12px;color:var(--text2);background:var(--bg2)}
input,textarea,select{min-width:0;min-height:38px;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--text)}input::placeholder,textarea::placeholder{color:var(--text2);opacity:1}.search label input{border:0;flex:1;width:100%;background:none}.search>input{width:180px}.search select{width:140px;appearance:auto;color-scheme:dark}.search option{background:var(--bg2);color:var(--text)}:root[data-theme="light"] .search select{color-scheme:light}
.market-body{flex:1 0 auto;min-height:260px;display:flex;flex-direction:column}.market-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:64px 20px;text-align:center}.empty-icon{display:grid;place-items:center;width:52px;height:52px;border-radius:12px;background:var(--bg2);color:var(--text2)}.empty-copy{max-width:420px;display:grid;gap:8px}.empty-copy h2{font-size:18px}.empty-hint{max-width:420px;font-size:12px}.empty-action{min-width:132px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr));gap:16px}.market-card{display:flex;flex-direction:column;min-width:0;padding:20px;border:1px solid var(--border);border-radius:12px;background:var(--bg2)}.market-card h2{margin-top:14px}.title-link{padding:0;border:0;background:transparent;min-height:0;white-space:normal;justify-content:flex-start;text-align:left;font-size:inherit;font-weight:600;line-height:1.5;overflow-wrap:anywhere}.title-link:hover:not(:disabled){background:transparent;color:var(--orange-text)}.byline{font-size:12px;color:var(--text2);margin-top:5px}.description{margin:14px 0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;min-height:64px;overflow-wrap:anywhere}.tags{display:flex;gap:6px;flex-wrap:wrap;align-content:flex-start}.tags span,.badge{width:fit-content;padding:3px 7px;border-radius:5px;font-size:12px;line-height:1.5;background:var(--bg3);color:var(--text2);white-space:nowrap}.badge[data-status="approved"]{background:var(--orange-bg);color:var(--orange-text)}.badge[data-status="pending"]{background:var(--bg3);color:var(--text)}.badge[data-status="rejected"]{border:1px solid var(--red);color:var(--text)}.rating-link{align-self:flex-start;margin-top:14px;padding:3px 0;border:0;background:transparent;min-height:32px;font-size:12px}.rating-link:hover:not(:disabled){background:transparent;color:var(--orange-text)}.rating-star{color:var(--orange-text)}.rating-link>span:last-child{color:var(--text2)}.compatibility{font-size:12px;color:var(--text2);margin:8px 0 16px}.compatibility small{display:block;margin-top:4px;color:var(--orange-text)}.market-card footer{display:flex;align-items:center;gap:8px;border-top:1px solid var(--border);padding-top:14px;margin-top:auto}.market-card footer>span{font-size:12px;color:var(--text2);margin-right:auto}.market-card footer button{font-size:12px}.install-button,.manage-button{color:var(--orange-text)}.install-button{border-color:var(--orange)}
.published-list{border:1px solid var(--border);border-radius:10px;background:var(--bg2);overflow:hidden}.published-head,.published-row{display:grid;grid-template-columns:minmax(200px,1fr) 145px minmax(100px,.4fr) 200px;gap:20px;align-items:center;padding:16px 20px}.published-head{font-size:12px;color:var(--text2);padding-top:12px;padding-bottom:12px;background:var(--bg3)}.published-head>span:last-child{text-align:right}.published-row+.published-row{border-top:1px solid var(--border)}.published-identity{display:flex;gap:14px;align-items:center;min-width:0}.published-identity>div{min-width:0}.published-identity .title-link{font-size:14px}.published-identity p{margin-top:5px;font-size:12px}.published-state{display:flex;flex-direction:column;align-items:flex-start;gap:6px}.published-state strong{font-weight:500;font-variant-numeric:tabular-nums}.row-actions{display:flex;gap:8px;justify-content:flex-end}.row-actions button{font-size:12px}.published-row .adapter-icon{flex-shrink:0}
.market-pagination{position:static;display:flex;align-items:center;justify-content:flex-end;gap:12px;clear:both;flex:0 0 auto;margin-top:20px;padding:16px 0 4px;border-top:1px solid var(--border);font-size:12px;color:var(--text2);background:var(--bg)}.market-pagination span{font-variant-numeric:tabular-nums}.market-note{padding:16px 0 0;font-size:12px;color:var(--text2)}.market-note button{padding:0 4px;min-height:0;border:0;background:none;color:var(--orange-text)}.error{color:var(--text);background:var(--bg3);border:1px solid var(--red);border-radius:8px;padding:12px;margin-bottom:14px}.message{padding:10px 12px;background:var(--bg3);border-radius:8px;margin-bottom:14px;color:var(--text)}
dialog{inset:0;margin:auto;box-sizing:border-box;border:1px solid var(--border);border-radius:12px;background:var(--bg2);color:var(--text);font:inherit;width:min(680px,calc(100vw - 40px));max-height:calc(100dvh - 56px);overflow:auto;padding:24px}dialog::backdrop{background:#0009}.dialog-title{align-items:flex-start}.dialog-title+p{margin-top:8px}.dialog-title button,.version-header>button{width:36px;padding:0;flex-shrink:0;background:transparent}.publish-steps{display:flex;list-style:none;padding:16px 0;margin:16px 0 0;border-top:1px solid var(--border);gap:24px;color:var(--text2);font-size:12px}.publish-steps li{display:flex;gap:7px;align-items:center}.publish-steps li>span{display:grid;place-items:center;width:21px;height:21px;border-radius:50%;background:var(--bg3);color:var(--text2)}.publish-steps li.active{color:var(--text);font-weight:600}.publish-steps li.active>span{background:var(--orange-bg);color:var(--orange-text)}.zip-drop{display:flex;flex-direction:column;width:100%;gap:8px;white-space:normal;padding:24px 16px;margin:4px 0 18px;border:1px dashed var(--border-strong,var(--text2));background:var(--bg);text-align:center}.zip-drop strong{overflow-wrap:anywhere;max-width:100%}.zip-drop span{font-size:12px;color:var(--text2)}.zip-drop.dragging{border-color:var(--orange);background:var(--orange-bg)}.zip-drop svg{color:var(--orange-text)}.fields{display:grid;grid-template-columns:1fr 1fr;gap:18px 16px;margin:18px 0}.fields label{display:grid;gap:7px;font-size:12px;color:var(--text2)}.wide{grid-column:1/-1}.fields input,.fields textarea{width:100%;background:var(--bg)}textarea{resize:vertical}.hint{font-size:12px;color:var(--text2);margin-top:16px}.dialog-actions{justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid var(--border)}.detected-version{display:flex;align-items:center;gap:8px;min-height:38px;font-size:13px;color:var(--text)}.detected-version small,.extract-hint{color:var(--text2);font-size:12px;font-weight:400}.icon-picker{display:flex;align-items:center;gap:16px;padding-bottom:16px;border-bottom:1px solid var(--border)}.icon-picker>.adapter-icon{width:48px;height:48px;flex-shrink:0}.icon-picker>div{min-width:0}.icon-picker small{display:block;color:var(--text2);font-size:12px;line-height:1.5;margin-top:7px}.icon-upload input{padding:6px 0;border:0;font-size:12px;max-width:100%;background:transparent}.icon-upload input::file-selector-button{font:inherit;padding:6px 9px;background:var(--bg3);color:var(--text);border:1px solid var(--border);border-radius:6px;margin-right:8px}.icon-picker button{font-size:12px;margin-top:8px}
.version-dialog,.detail-dialog{padding:0;width:min(840px,calc(100vw - 40px));overflow:hidden}.detail-dialog{width:min(920px,calc(100vw - 40px))}.version-dialog[open],.detail-dialog[open]{display:flex;flex-direction:column}.version-header{padding:22px 24px;border-bottom:1px solid var(--border);flex-shrink:0;align-items:flex-start}.version-identity{display:flex;align-items:center;gap:14px;min-width:0}.version-identity .adapter-icon{width:42px;height:42px;flex-shrink:0}.version-identity>div{min-width:0}.version-identity h2{font-size:18px}.version-identity p{font-size:12px;margin-top:5px}.version-scroll{overflow:auto;padding:24px;min-height:0}.detail-scroll{padding:0 24px 24px}.detail-hero{display:grid;grid-template-columns:112px minmax(0,1fr);gap:24px;align-items:center;padding:24px 0;border-bottom:1px solid var(--border)}.detail-rating{display:grid;gap:4px;justify-items:center;padding:14px;border-radius:8px;background:var(--bg3)}.detail-rating strong{font-size:30px;line-height:1;font-weight:650}.detail-rating span{font-size:12px;color:var(--text2)}.detail-section{padding:22px 0}.detail-reviews{scroll-margin-top:24px;border-top:1px solid var(--border);padding-top:24px}.detail-footer{gap:18px}.detail-footer>span{overflow-wrap:anywhere}.version-overview{display:flex;flex-wrap:wrap;align-items:flex-start;gap:16px 40px;padding-bottom:20px;border-bottom:1px solid var(--border);margin-bottom:20px}.version-overview>div{display:grid;gap:6px}.version-overview span{font-size:12px;color:var(--text2)}.version-overview strong{font-size:16px;font-weight:600}.version-overview p{flex-basis:100%;font-size:12px}.state-notice{display:flex;gap:10px;padding:14px;border:1px solid var(--border);border-radius:8px;margin-bottom:20px;background:var(--bg3);color:var(--text)}.state-notice svg{flex-shrink:0;color:var(--orange-text)}.state-notice strong{font-size:13px}.state-notice p{margin-top:5px;font-size:12px}.state-notice button{margin-top:10px}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 12px}.section-heading>span{color:var(--text2);font-size:12px}.history-skeleton{padding:32px 0;color:var(--text2)}.version-table-head,.version-row{display:grid;grid-template-columns:minmax(140px,1fr) 100px 240px;gap:16px;align-items:center;padding:14px 0}.version-table-head{font-size:12px;color:var(--text2);border-bottom:1px solid var(--border)}.version-table-head>span:last-child{text-align:right}.version-row{border-bottom:1px solid var(--border)}.version-main{display:grid;gap:6px}.version-main strong{font-size:14px;font-variant-numeric:tabular-nums}.version-main>span{font-size:12px;color:var(--text2)}.release-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}.release-actions button{font-size:12px}.version-note{grid-column:1/-1;display:flex;gap:12px;font-size:12px;overflow-wrap:anywhere}.version-note>span{flex-shrink:0}.version-footer{flex-shrink:0;padding:16px 24px;border-top:1px solid var(--border);background:var(--bg2)}.version-footer>span{font-size:12px;color:var(--text2)}.danger-button{color:var(--text);border-color:var(--red)}.release-confirm{margin-top:20px;padding:18px;background:var(--bg3);border-radius:8px}.release-confirm p{margin-top:8px}.release-confirm label{display:grid;gap:8px;margin-top:14px;color:var(--text2);font-size:12px}.release-confirm:focus{outline:2px solid var(--orange);outline-offset:3px}.audit-events{margin-top:20px;font-size:12px;color:var(--text2)}.audit-events summary{cursor:pointer;padding:8px 0}.audit-events ol{list-style:none;padding:0}.audit-events li{padding:10px 0;border-bottom:1px solid var(--border)}.audit-events time{margin-left:16px}.audit-events p{font-size:12px}.full-description{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0 24px;max-width:70ch}.detail-dialog h3{margin-top:0}.package-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;padding-top:20px;border-top:1px solid var(--border);margin:0}.package-facts dt{color:var(--text2);font-size:12px;margin-bottom:6px}.package-facts dd{margin:0;overflow-wrap:anywhere;font-size:13px}
@media(max-width:1000px){.published-head,.published-row{grid-template-columns:minmax(180px,1fr) 125px 200px;gap:14px}.published-head>span:nth-child(3),.published-row>.tags{display:none}.search>input{width:145px}}
@media(max-width:720px){.market-page{padding:20px}.market-heading p{display:none}.search{flex-wrap:wrap}.search label{flex-basis:100%}.search>input{flex:1;width:auto}.search select{width:130px}.published-head{display:none}.published-row{grid-template-columns:minmax(0,1fr) auto;padding:16px}.published-state{align-items:flex-end}.row-actions{grid-column:1/-1}.version-table-head{display:none}.version-row{grid-template-columns:1fr auto}.release-actions{grid-column:1/-1;justify-content:flex-start}.version-header,.version-scroll{padding:18px}.detail-scroll{padding:0 18px 18px}.detail-hero{grid-template-columns:1fr;gap:14px}.detail-rating{justify-items:start}.version-footer{padding:14px 18px}.version-footer>span{max-width:45%}.detail-footer>span{max-width:none}.fields{grid-template-columns:1fr}.publish-steps{gap:14px}.package-facts{grid-template-columns:1fr}.market-pagination{justify-content:center;gap:8px}.market-pagination button{padding:7px 9px}}
:root[data-theme="light"] .primary:hover:not(:disabled){background:var(--orange-text);border-color:var(--orange-text);color:#fff}
@media(prefers-reduced-motion:reduce){button{transition:none}}

</style>
