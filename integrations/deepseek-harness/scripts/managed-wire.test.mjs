import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {streamSimple} from '../node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js'

for (const id of ['managed-deepseek-flash','managed-deepseek-v4-pro']) {
  test(`${id}: system role and tool history reach the actual SDK wire`, async () => {
    const payloads=[]
    const server=http.createServer(async(req,res)=>{
      let raw='';for await (const chunk of req) raw+=chunk
      payloads.push(JSON.parse(raw))
      res.writeHead(200,{'Content-Type':'text/event-stream'})
      res.end('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',choices:[{index:0,delta:{content:'ok'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\ndata: [DONE]\n\n')
    })
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
    try {
      const model={id,name:id,api:'openai-completions',provider:'crawshrimp-managed-openai',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,reasoning:true,input:['text'],contextWindow:1000000,maxTokens:8192,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},compat:{supportsDeveloperRole:false,thinkingFormat:'deepseek',requiresReasoningContentOnAssistantMessages:true}}
      const base=[{role:'system',content:'Use real evidence.',timestamp:0,toolsAdded:[{name:'lookup',description:'Read public page',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}]},{role:'user',content:'Check the public page.',timestamp:0}]
      const history=[...base,{role:'assistant',content:[{type:'toolCall',id:'call1',name:'lookup',arguments:{query:'public page'}}],api:model.api,provider:model.provider,model:id,stopReason:'toolUse',timestamp:1,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}},{role:'toolResult',toolCallId:'call1',toolName:'lookup',content:[{type:'text',text:'Found public contact page'}],isError:false,timestamp:2}]
      for(const messages of [base,history]) {
        const stream=streamSimple(model,{systemPrompt:'Use real evidence.',messages},{apiKey:'fixture-local-only',maxTokens:64})
        const result=await stream.result()
        assert.equal(result.stopReason,'stop')
      }
      assert.equal(payloads.length,2)
      for(const body of payloads){assert.equal(body.messages[0].role,'system');assert(!body.messages.some(m=>m.role==='developer'))}
      const assistant=payloads[1].messages.find(m=>m.role==='assistant')
      assert.equal(assistant.reasoning_content,'')
      assert.equal(payloads[1].messages.at(-1).role,'tool')
    } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
  })
}
