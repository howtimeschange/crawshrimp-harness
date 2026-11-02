import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {hasManagedTextModel,firstRunCompletion} from './firstRun.mjs'

const source=readFileSync(new URL('../views/AgentWebView.vue',import.meta.url),'utf8')
function fixture(active){
 const counters={accountReads:0,modelMessages:0},frame={}
 const context={props:{active},document:{activeElement:{focus(){}}},window:{localStorage:{getItem(){return null}}},
  frameEl:{value:{contentWindow:frame}},frameOrigin:{value:'http://127.0.0.1:12345'},
  inlineLlmModalOpen:{value:false},loginWelcomeOpen:{value:false},onboardingPreviousFocus:null,onboardingError:{value:'keep-message'},onboardingStep:{value:'ready'},
  runtimeNeedsModelKey:{value:false},onboardingPresented:false,onboardingAccount:{value:{}},completedOnboardingOwners:new Set(),
  hasManagedTextModel,firstRunCompletion,refreshOnboardingAccount:async()=>{counters.accountReads++},
  pushRuntimeModelConfiguration:()=>{counters.modelMessages++}}
 for(const [name,next]of [['onboardingIsComplete','function showOnboardingSetup'],['showOnboardingSetup','async function finishOnboarding'],['openInlineLlmModal','function openLoginWelcome'],['syncRuntimeModelConfiguration','const exportingLogs'],['onWindowMessage','const MAX_ATTACHMENT_BYTES']]){
  const start=source.indexOf('function '+name+'('),end=source.indexOf('\n'+next,start)
  assert.ok(start>=0&&end>start,'Use the actual component function '+name)
  vm.runInNewContext(source.slice(start,end),context)
 }
 return {context,counters,request:(changes={})=>context.onWindowMessage({source:frame,origin:context.frameOrigin.value,data:{__crawshrimp:'llm-config-request',source:'composer'},...changes})}
}

test('a hidden persistent iframe cannot cover settings with model onboarding',()=>{
 const {context,counters,request}=fixture(false)
 request()
 assert.equal(context.inlineLlmModalOpen.value,false)
 assert.equal(context.onboardingError.value,'keep-message')
 assert.equal(context.onboardingStep.value,'ready')
 assert.equal(counters.accountReads,0)
})
test('visible composer configuration remains available with authenticated frame identity',()=>{
 const {context,counters,request}=fixture(true)
 request()
 assert.equal(context.inlineLlmModalOpen.value,true)
 assert.equal(context.onboardingStep.value,'choice')
 assert.equal(context.onboardingError.value,'')
 assert.equal(counters.accountReads,1)
})
test('foreign source or origin cannot open onboarding even while agent is visible',()=>{
 for(const change of [{source:{}},{origin:'https://untrusted.invalid'}]){
  const {context,counters,request}=fixture(true);request(change)
  assert.equal(context.inlineLlmModalOpen.value,false);assert.equal(counters.accountReads,0)
 }
})
test('late runtime status in settings defers its first automatic prompt until visible',()=>{
 const {context,counters}=fixture(false)
 context.syncRuntimeModelConfiguration({api_key_configured:false})
 assert.equal(context.runtimeNeedsModelKey.value,true)
 assert.equal(context.inlineLlmModalOpen.value,false)
 assert.equal(context.onboardingPresented,false)
 assert.equal(counters.accountReads,0)
 context.props.active=true;context.syncRuntimeModelConfiguration({api_key_configured:false})
 assert.equal(context.inlineLlmModalOpen.value,true)
 assert.equal(context.onboardingPresented,true)
 assert.equal(counters.accountReads,1)
})
test('background account completion does not steal the current settings flow',()=>{
 const {context}=fixture(false)
 context.onboardingAccount.value={user:{id:'local-owner'},models:[{kind:'text'}],onboardingRequired:true}
 assert.equal(context.showOnboardingSetup(),false)
 assert.equal(context.inlineLlmModalOpen.value,false)
 context.props.active=true
 assert.equal(context.showOnboardingSetup(),true)
 assert.equal(context.inlineLlmModalOpen.value,true)
})
