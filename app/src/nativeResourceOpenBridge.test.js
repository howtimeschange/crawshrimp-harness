const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm')
const root=path.resolve(__dirname,'../..')
const bundle=path.join(root,'integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js')
test('installed development native chat opener crosses real slot/shell source guards into the workspace', {skip:!fs.existsSync(bundle)}, async()=>{
  const native=fs.readFileSync(bundle,'utf8'), slots=fs.readFileSync(path.join(root,'integrations/deepseek-harness/crawshrimp-slots/lib/client.js'),'utf8'), shell=fs.readFileSync(path.join(__dirname,'renderer/views/AgentWebView.vue'),'utf8')
  assert.ok(native.includes('crawshrimp-file-workspace-v1'))
  const opened=[],fallback=[],dispose=[],nativeWindow={location:{origin:'http://native.test'}}
  const shellContext={frameEl:{value:{contentWindow:nativeWindow}},frameOrigin:{value:'http://native.test'},activeRuntimeSessionId:{value:'session-a'},resourcesPanel:{value:{openResource:item=>opened.push(item)}},window:{cs:{openFile:()=>{throw new Error('must use panel')}}}}
  vm.runInNewContext(shell.slice(shell.indexOf('function onWindowMessage('),shell.indexOf('const IMAGE_MIME_PREFIX')),shellContext)
  nativeWindow.parent={postMessage:(data,origin)=>{assert.equal(origin,'http://shell.test');shellContext.onWindowMessage({data,origin:'http://native.test',source:nativeWindow})}}
  const nativeContext={window:nativeWindow,URL,document:{referrer:'http://shell.test/'},sessionId:'session-a',ctx:{on:(event,cb)=>dispose.push(cb),sessions:{list:{getSnapshot:()=>({byId:{'session-a':{cwd:'/中文工作区'}}})}},remote:{session:{openWorkspacePath:async value=>{fallback.push(value);return {ok:true}}}}}}
  vm.createContext(nativeContext)
  vm.runInContext(slots.slice(slots.indexOf('    function shellOrigin('),slots.indexOf('    function shellDirectoryPickerEnabled(')),nativeContext)
  vm.runInContext(slots.slice(slots.indexOf('      const openResource ='),slots.indexOf('      attachmentBridgeDisposed = false',slots.indexOf('      const openResource ='))),nativeContext)
  const resolver=native.slice(native.indexOf('function isWindowsStylePath('),native.indexOf('//#endregion',native.indexOf('function resolveWorkspacePath(')))
  const body=native.match(/openFile: async \(path\) => \{([\s\S]*?)\n\s*\},\n\s*loadOlder:/)?.[1]
  assert.ok(body,'exact native opener must be found')
  vm.runInContext(resolver+'\nglobalThis.openNativeFile = async path => {'+body+'}',nativeContext)
  await nativeContext.openNativeFile('材料/销售.csv')
  assert.equal(opened.length,1);assert.equal(opened[0].path,'/中文工作区/材料/销售.csv');assert.equal(opened[0].filename,'销售.csv');assert.equal(fallback.length,0)
  const message={__crawshrimp:'open-file',path:'/private.csv',runtimeSessionId:'session-a'}
  shellContext.onWindowMessage({data:message,origin:'http://other.test',source:nativeWindow})
  shellContext.onWindowMessage({data:message,origin:'http://native.test',source:{}})
  nativeWindow.__crawshrimpOpenResource('/other-session.csv','session-b')
  assert.equal(opened.length,1)
  await nativeContext.openNativeFile('.');assert.equal(fallback[0].path,'/中文工作区/.')
  dispose[0]();assert.equal(nativeWindow.__crawshrimpOpenResource,undefined)
  await nativeContext.openNativeFile('standalone.md');assert.equal(fallback[1].path,'/中文工作区/standalone.md')
})
