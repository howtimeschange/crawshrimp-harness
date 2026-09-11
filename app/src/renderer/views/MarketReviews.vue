<template>
  <component :is="embedded ? 'section' : 'dialog'" ref="dialog" :class="['reviews-shell', embedded ? 'reviews-embedded' : 'reviews-dialog']" aria-labelledby="reviews-title" @cancel="cancel" @close="!embedded && emit('close')">
    <header class="reviews-header">
      <div>
        <component :is="embedded ? 'h3' : 'h2'" id="reviews-title" :tabindex="embedded ? -1 : undefined">{{ embedded ? '评分与评论' : item.name }}</component>
        <p>{{ embedded ? `当前版本 · v${item.version}` : `评分与评论 · v${item.version}` }}</p>
      </div>
      <button v-if="!embedded" class="close" aria-label="关闭评分与评论" :disabled="busy" @click="dialog.close()"><IconX :size="18" /></button>
    </header>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status" class="notice">{{ notice }}</p>
    <div v-if="loading" class="loading" role="status">正在加载评价…</div>
    <div v-else-if="error && !loaded" class="review-error-recovery"><p>评价暂时无法加载，已填写的内容会保留。</p><button @click="load()">重新加载</button></div><template v-else>
      <section class="rating-overview" aria-label="评分汇总">
        <div class="rating-score"><strong>{{ summary.total ? Number(summary.average).toFixed(1) : '—' }}</strong><span>满分 5 分</span><small>{{ summary.total || 0 }} 个评分</small></div>
        <div class="distribution"><div v-for="(key,index) in ['five','four','three','two','one']" :key="key"><span>{{ 5-index }} 星</span><div class="bar"><i :style="{width:`${summary.total ? (Number(summary[key]||0)/Number(summary.total))*100 : 0}%`}" /></div><span>{{ summary[key] || 0 }}</span></div></div>
      </section>
      <form v-if="canRate" class="write-review" @submit.prevent="save">
        <h3>{{ mine && !mine.deleted ? '编辑我的评价' : '写评价' }}</h3>
        <p v-if="mine?.hidden" class="moderated">你的评价暂未公开：{{ mine.moderation_note }}。修改后仍需管理员恢复展示。</p>
        <fieldset :disabled="busy"><legend>你的评分</legend><div class="star-input"><label v-for="star in 5" :key="star" :class="{filled:star<=stars}"><input v-model="stars" type="radio" name="rating" :value="star" :aria-label="`${star} 星`" required /><IconStar :size="27" :fill="star<=stars?'currentColor':'none'" :stroke-width="1.5"/></label><span>{{ stars ? ['','很差','一般','还不错','很好','非常好'][stars] : '请选择评分' }}</span></div></fieldset>
        <label class="field">公开昵称<input v-model="displayName" required maxlength="40" placeholder="不会公开你的邮箱" :disabled="busy" /></label>
        <label class="field">使用体验 <span class="optional">选填</span><textarea v-model="comment" maxlength="2000" rows="3" placeholder="哪些功能好用？遇到了什么问题？" :disabled="busy" /></label>
        <div class="form-actions"><button v-if="mine && !mine.deleted" type="button" class="subtle" :disabled="busy" @click="remove">删除我的评价</button><span>{{ comment.length }}/2000</span><button class="primary" :disabled="busy || !stars">{{ busy ? '正在保存…' : '发布评价' }}</button></div>
      </form>
      <p v-else class="eligibility">评分需使用绑定邮箱的账号；开发者不能评价自己的适配包。</p>
      <section class="review-list"><h3>用户评论 <span>最新发布</span></h3>
        <p v-if="!reviews.length" class="empty-reviews">{{ page ? '这一页暂时没有评论。' : '还没有评价，分享你的使用体验吧。' }}</p>
        <article v-for="review in reviews" :key="review.package_id + review.user_id">
          <div class="review-heading"><strong>{{ review.display_name }}</strong><time>{{ new Date(review.updated_at).toLocaleDateString() }}</time></div>
          <div class="stars" :aria-label="`${review.stars} 星`"><span aria-hidden="true">{{ '★'.repeat(review.stars) }}<span class="unfilled">{{ '★'.repeat(5-review.stars) }}</span></span></div>
          <p>{{ review.comment || '此用户仅留下了评分。' }}</p>
        </article>
        <div v-if="page || reviews.length===20" class="reviews-pagination"><button :disabled="busy||page===0" @click="page--;load()">上一页</button><span>第 {{ page+1 }} 页</span><button :disabled="busy||reviews.length<20" @click="page++;load()">下一页</button></div>
      </section>
    </template>
  </component>
</template>
<script setup>
import {readRequest} from '../utils/readRequest.mjs'
import {ref,onMounted,onUnmounted} from 'vue'
import {IconStar,IconX} from '@tabler/icons-vue'
const props=defineProps({item:{type:Object,required:true},embedded:{type:Boolean,default:false}})
const emit=defineEmits(['close','changed','busy'])
const dialog=ref(null),loading=ref(true),busy=ref(false),error=ref(''),notice=ref('')
const loaded=ref(false)
const reviews=ref([]),mine=ref(null),summary=ref({}),canRate=ref(false),page=ref(0)
const stars=ref(0),displayName=ref(''),comment=ref('')
let alive=true,loadGeneration=0
const message=e=>String(e?.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,'')
function cancel(event){if(busy.value)event.preventDefault()}
async function load(prefill=false,propagate=false){
  const gen=++loadGeneration
  loading.value=true;error.value=''
  try{
    const result=await readRequest(()=>window.cs.marketAction('ratings',{id:props.item.id,page:page.value}))
    if(!alive||gen!==loadGeneration)return
    loaded.value=true;reviews.value=result.reviews;mine.value=result.mine;summary.value=result.summary;canRate.value=result.canRate
    if(prefill&&result.mine&&!result.mine.deleted){stars.value=result.mine.stars;displayName.value=result.mine.display_name;comment.value=result.mine.comment}
    emit('changed',result.summary)
  }catch(e){if(alive&&gen===loadGeneration)error.value=message(e);if(propagate)throw e}finally{if(alive&&gen===loadGeneration)loading.value=false}
}
async function save(){busy.value=true;emit('busy',true);error.value='';notice.value='';try{await window.cs.marketAction('rate',{id:props.item.id,stars:stars.value,displayName:displayName.value,comment:comment.value});page.value=0;await load(false,true);notice.value=mine.value?.hidden?'评价已保存，当前暂未公开。':'评价已发布。'}catch(e){error.value=message(e)+'；请刷新确认结果后再操作。'}finally{busy.value=false;emit('busy',false)}}
async function remove(){busy.value=true;emit('busy',true);error.value='';try{await window.cs.marketAction('remove-rating',{id:props.item.id});stars.value=0;comment.value='';await load(false,true);notice.value='你的评价已删除。'}catch(e){error.value=message(e)}finally{busy.value=false;emit('busy',false)}}
onMounted(()=>{if(!props.embedded)dialog.value.showModal();load(true)})
onUnmounted(()=>{alive=false;loadGeneration++})
</script>
<style scoped>
.reviews-dialog{margin:auto;width:min(640px,calc(100vw - 48px));max-height:85vh;overflow:auto;padding:26px;border:1px solid var(--border);border-radius:16px;background:var(--bg2);color:var(--text);font:inherit}.reviews-dialog::backdrop{background:#0009}.reviews-embedded{display:block;color:var(--text);font:inherit}.reviews-header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:22px}h2{font-size:20px;line-height:1.4;margin:0}h3{font-size:14px;margin:0 0 14px}p{font-size:13px;line-height:1.7;margin:0;color:var(--text2)}.reviews-header p{font-size:12px;margin-top:5px;color:var(--text2)}button,input,textarea{font:inherit;font-size:13px;border:1px solid var(--border);border-radius:7px;color:var(--text);background:var(--bg3);padding:9px 12px}button{cursor:pointer}button:disabled{opacity:.45;cursor:default}.close{display:grid;place-items:center;padding:7px;background:none}.rating-overview{display:grid;grid-template-columns:120px 1fr;gap:32px;padding:10px 0 26px;border-bottom:1px solid var(--border)}.rating-score{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px}.rating-score strong{font-size:48px;line-height:1.1;letter-spacing:-2px}.rating-score span,.rating-score small{color:var(--text2);font-size:11px}.distribution{display:grid;gap:7px;align-content:center}.distribution>div{display:grid;grid-template-columns:30px 1fr 28px;gap:9px;align-items:center;font-size:11px;color:var(--text2)}.distribution>div>span:last-child{text-align:right}.bar{height:5px;border-radius:5px;background:var(--bg4);overflow:hidden}.bar i{display:block;height:100%;background:var(--orange);border-radius:5px}.write-review{padding:24px 0;border-bottom:1px solid var(--border);display:grid;gap:14px}.write-review h3{margin:0}fieldset{padding:0;margin:0;border:0}legend{font-size:12px;color:var(--text2);margin-bottom:8px}.star-input{display:flex;align-items:center;gap:7px}.star-input label{position:relative;display:grid;place-items:center;color:var(--text2);cursor:pointer}.star-input .filled{color:var(--orange-text)}.star-input input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer}.star-input label:focus-within{outline:2px solid var(--orange);outline-offset:3px;border-radius:4px}.star-input span{margin-left:9px;font-size:12px;color:var(--text2)}.field{display:flex;flex-wrap:wrap;gap:7px;font-size:12px;color:var(--text2)}.field input,.field textarea{width:100%;box-sizing:border-box;background:var(--bg);resize:vertical}.optional{color:var(--text2)}.form-actions{display:flex;align-items:center;gap:12px}.form-actions>span{margin-left:auto;font-size:11px;color:var(--text2)}.subtle{background:none;font-size:12px}.primary{background:var(--orange);border-color:var(--orange);color:var(--on-orange,#fff)}.review-list{padding-top:24px}.review-list h3{display:flex;justify-content:space-between}.review-list h3 span{font-size:11px;font-weight:400;color:var(--text2)}article{padding:18px 0;border-bottom:1px solid var(--border)}.review-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:12px}.review-heading time{font-size:11px;color:var(--text2)}.stars{color:var(--orange-text);font-size:14px;letter-spacing:2px;margin:7px 0}.unfilled{color:var(--text2)}article p{white-space:pre-wrap;overflow-wrap:anywhere}.empty-reviews,.eligibility{padding:20px 0;font-size:12px;color:var(--text2)}.reviews-pagination{display:flex;justify-content:center;align-items:center;gap:12px;margin-top:18px;font-size:12px}.error,.moderated{color:var(--red);margin-bottom:12px}.notice{color:var(--green);margin-bottom:12px}.loading{text-align:center;padding:50px;color:var(--text2)}

.reviews-dialog{box-sizing:border-box;border-radius:12px;padding:24px}button{min-height:36px}button:hover:not(:disabled){background:var(--bg4)}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--orange);outline-offset:3px}input::placeholder,textarea::placeholder{color:var(--text2);opacity:1}.primary{font-weight:600}.primary:hover:not(:disabled){background:var(--orange-text);color:var(--on-orange,#fff)}:root[data-theme="light"] .primary{background:var(--orange-strong);border-color:var(--orange-strong);color:#fff}.rating-score strong{letter-spacing:-.03em}.reviews-pagination{position:static;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:16px}.star-input label{width:36px;height:36px}.review-error-recovery{padding:24px 0;display:grid;gap:14px}.error{color:var(--text);padding:12px;border:1px solid var(--red);border-radius:8px;background:var(--bg3)}.notice{color:var(--text);padding:10px;background:var(--bg3);border-radius:8px}@media(max-width:600px){.reviews-dialog{width:calc(100vw - 32px);padding:18px}.rating-overview{grid-template-columns:100px 1fr;gap:16px}.form-actions{flex-wrap:wrap}.star-input{gap:3px;flex-wrap:wrap}.review-heading{align-items:flex-start}.review-heading strong{overflow-wrap:anywhere}}:root[data-theme="light"] .primary:hover:not(:disabled){background:var(--orange-text);border-color:var(--orange-text);color:#fff}@media(prefers-reduced-motion:reduce){*{transition:none}}
</style>
