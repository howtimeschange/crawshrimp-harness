const { test } = require('node:test')
const assert = require('node:assert/strict')
const { applyManagedReasoning } = require('./managedReasoning')
const catalog = ['low','medium','high','tiered'].map(e => ({id:`gemini-3.8-flash-${e}`,kind:'text',protocol:'openai'}))
test('Gemini canonical choice uses only offered route and forwards the selected effort', () => {
  for (const effort of ['low','medium','high']) {
    const request = {model:'gemini-3.8-flash',reasoning_effort:effort,messages:[{role:'user',content:'test'}]}
    assert.deepEqual(applyManagedReasoning(request,catalog), {...request,model:`gemini-3.8-flash-${effort}`})
    assert.equal(request.model,'gemini-3.8-flash')
  }
  assert.equal(applyManagedReasoning({model:'gemini-3.8-flash'},catalog).model,'gemini-3.8-flash-tiered')
  assert.throws(()=>applyManagedReasoning({model:'gemini-3.8-flash',reasoning_effort:'max'},catalog))
  assert.throws(()=>applyManagedReasoning({model:'gemini-3.8-flash',reasoning_effort:'high'},[]))
})
test('other models and legacy selections retain original payload',()=>{
  for(const model of ['gpt-6.1-sol','deepseek-flash','gemini-3.8-flash-low','gpt-image-2.5-flare']){
    const body={model}; assert.equal(applyManagedReasoning(body,catalog),body)
  }
})
test('curation keeps newest roles, folds old models and never lists effort aliases',async()=>{
  const {managedModelList,managedReasoningWire}=await import('../../integrations/deepseek-harness/scripts/managed-model-selection.mjs')
  const models=['gpt-5.6-sol','gpt-6-sol','gpt-6.1-sol','gpt-6-astra','gpt-6-luna','gemini-3.8-flash','gemini-3.8-flash-low','gemini-3-flash','gemini-3.5-flash-lite','gemini-2.5-flash-lite','deepseek-flash','deepseek-v4-pro'].map(id=>({id:'managed-'+id}))
  const ids=managedModelList(models).map(m=>m.id)
  assert(ids.includes('managed-gpt-6.1-sol'));assert(ids.includes('managed-gpt-6-astra'));assert(ids.includes('managed-gpt-6-luna'))
  assert(!ids.includes('managed-gpt-6-sol'));assert(!ids.includes('managed-gemini-3-flash'));assert(!ids.includes('managed-gemini-3.8-flash-low'))
  assert.equal(managedModelList(models,true).length,models.length-1)
  assert.equal(managedModelList(models,false,'2.5').length,models.length-1)
  for(const effort of ['low','medium','high','xhigh','max']){
    assert.equal(managedReasoningWire({}, {id:'managed-gpt-6.1-sol',api:'openai-responses'},effort).reasoning.effort,effort)
  }
  assert.deepEqual(managedReasoningWire({reasoning:{effort:'low'}},{id:'managed-gpt-6.1-sol',api:'openai-responses'},undefined),{})
  assert.deepEqual(managedReasoningWire({}, {id:'managed-deepseek-flash',api:'openai-completions'},'max'),{thinking:{type:'enabled'},reasoning_effort:'max'})
  assert.deepEqual(managedReasoningWire({}, {id:'managed-deepseek-flash',api:'openai-completions'},'off'),{thinking:{type:'disabled'}})
})
test('rendered older-model footer is separate, clears model hover and never selects a model',async()=>{
  const fs=require('node:fs'),vm=require('node:vm')
  const {managedModelList,patchManagedModelMenu}=await import('../../integrations/deepseek-harness/scripts/managed-model-selection.mjs')
  const source=fs.readFileSync(require('node:path').join(__dirname,'../../integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js'),'utf8')
  assert.equal(patchManagedModelMenu(source),source)
  assert.throws(()=>patchManagedModelMenu('unexpected upstream'),/anchor changed/)
  const start=source.indexOf('function ModelSelect('),end=source.indexOf('\n\t\t//#endregion',start)
  const jsx=(type,props,key)=>({type,props,key})
  const state={pending:null,current:{provider:'crawshrimp-managed-openai-responses',model:'managed-gpt-6.1-sol'},status:'ready',error:null,failures:[],groups:[{id:'crawshrimp-managed-openai-responses',name:'抓虾官方',models:['6.1-sol','6-sol','5.6-sol'].map(v=>({id:'managed-gpt-'+v,name:'GPT '+v}))}]}
  let hook=0;const changes=[],selected=[]
  const Component=vm.runInNewContext(source.slice(start,end)+';ModelSelect',{
    react:{useSyncExternalStore:(_,snapshot)=>snapshot(),useState:value=>{const index=hook++;return [[true,'model','',false,null][index]??value,v=>changes.push([index,v])]},useRef:value=>({current:value}),useId:()=> 'test',useMemo:fn=>fn(),useEffect:()=>{},useLayoutEffect:()=>{},useCallback:fn=>fn()},
    MEASURE_STYLE:{},react_dom:{createPortal:node=>node},document:{body:{}},react_jsx_runtime:{jsx,jsxs:jsx,Fragment:'fragment'},ModelSelect_module_css_default:{},_deepseek_ai_dsh_client_ui_primitives:{rankByName:items=>items},orderModelProviders:groups=>groups,clsx:()=>'',queueMicrotask,managedModelList,
  })
  const tree=Component({renderSlot:()=>null,available:true,locked:false,directory:{subscribe(){},getSnapshot:()=>state},load(){},select:value=>selected.push(value),t:key=>key})
  const nodes=[];function visit(node){if(Array.isArray(node))return node.forEach(visit);if(!node||typeof node!=='object')return;nodes.push(node);visit(node.props?.children)}visit(tree)
  const footer=nodes.find(n=>n.props?.['data-managed-footer']==='')
  assert(footer);const list=nodes.find(n=>Array.isArray(n.props?.children)&&n.props.children.includes(footer))
  assert.equal(list.props.children.at(-1),footer)
  assert.equal(nodes.filter(n=>n.props?.role==='menuitemradio').length,1)
  footer.props.onMouseEnter();footer.props.children.props.onClick()
  assert(changes.some(([index,value])=>index===4&&value===-1))
  assert(changes.some(([index,value])=>index===3&&value===true))
  assert.deepEqual(selected,[])
})
