const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path')
function harness(document) {
 const source=fs.readFileSync(path.join(__dirname,'renderer/components/agent/resources/PdfPagePreview.vue'),'utf8').split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm,'')
 const props={active:true,document,number:2,width:600,zoom:1,initialSize:{width:595,height:842},root:{}}
 const context={defineProps:()=>props,ref:value=>({value}),computed:fn=>({get value(){return fn()}}),watch(){},onMounted(){},onUnmounted(){},window:{devicePixelRatio:2},TextLayer:class {async render(){} cancel(){}}}
 vm.runInNewContext(source+'\nglobalThis.h={render,clear,visible,canvas,textLayer,host,rendered,error}',context)
 const h=context.h;h.canvas.value={width:0,height:0,style:{},getContext:()=>({})};h.textLayer.value={replaceChildren(){}};h.host.value={style:{setProperty(){}}}
 return {...h,props}
}
const page={getViewport:({scale})=>({width:595*scale,height:842*scale}),render:()=>({promise:Promise.resolve(),cancel(){}}),streamTextContent:()=>({})}
test('continuous reader renders a visible page and releases raster when its tab is inactive',async()=>{
 const h=harness({getPage:async number=>{assert.equal(number,2);return page}});h.visible.value=true;await h.render()
 assert.equal(h.rendered.value,true);assert.ok(h.canvas.value.width>0);assert.ok(h.canvas.value.width*h.canvas.value.height<=8100000)
 h.props.active=false;await h.render();assert.equal(h.canvas.value.width,0);assert.equal(h.rendered.value,false)
})
test('late PDF page resolution cannot repaint a hidden or canceled page',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),h=harness({getPage:()=>pending});h.visible.value=true
 const painting=h.render();h.visible.value=false;h.clear();resolve(page);await painting
 assert.equal(h.canvas.value.width,0);assert.equal(h.rendered.value,false)
})


function documentHarness({ active = true, file = '/fixtures/report.pdf', getDocument } = {}) {
 const source=fs.readFileSync(path.join(__dirname,'renderer/components/agent/resources/PdfPreview.vue'),'utf8').split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm,'').replaceAll('import.meta.env.BASE_URL',JSON.stringify('./'))
 const props={active,path:file}, tasks=[], requested=[]
 let callback, unmount, initial
 const context={defineProps:()=>props,ref:value=>({value}),shallowRef:value=>({value}),
  watch(_source,fn){callback=fn;initial=fn([props.path,props.active])},onMounted(){},onUnmounted(fn){unmount=fn},
  GlobalWorkerOptions:{},workerUrl:'worker.mjs',URL,location:{href:'file:///app/index.html'},
  window:{cs:{async agentMediaUrl(file){requested.push(file);return 'http://localhost/media/file'}}},
  getDocument(options){
   const task=getDocument?.(options)||{promise:Promise.resolve({numPages:24,async getPage(){return page}}),destroyed:0,async destroy(){this.destroyed++}}
   tasks.push(task);return task
  }}
 vm.runInNewContext(source+'\nglobalThis.h={pages,zoom,loading,error,container,document,initialSize}',context)
 return {...context.h,props,tasks,requested,initial,unmount:()=>unmount(),update:()=>callback([props.path,props.active])}
}
for(const file of ['/Users/test/报告.pdf','C:\\Users\\test\\报告.pdf']) {
 test(`PDF worker is demand loaded and released without losing reading state (${file})`,async()=>{
  const h=documentHarness({active:false,file});await h.initial
  assert.equal(h.tasks.length,0);assert.equal(h.requested.length,0)
  h.props.active=true;await h.update();assert.equal(h.pages.value,24);assert.equal(h.requested[0],file)
  h.zoom.value=1.75;h.container.value={scrollTop:4321}
  h.props.active=false;await h.update()
  assert.equal(h.tasks[0].destroyed,1);assert.equal(h.document.value,null)
  assert.equal(h.pages.value,24);assert.equal(h.zoom.value,1.75);assert.equal(h.container.value.scrollTop,4321)
  h.props.active=true;await h.update();assert.equal(h.tasks.length,2);assert.ok(h.document.value)
  assert.equal(h.zoom.value,1.75);assert.equal(h.container.value.scrollTop,4321)
  h.props.path=file+'.new.pdf';await h.update();assert.equal(h.tasks[1].destroyed,1)
  assert.equal(h.zoom.value,1);assert.equal(h.container.value.scrollTop,0)
  h.unmount();await Promise.resolve();assert.equal(h.tasks[2].destroyed,1)
 })
}
test('rapid PDF reactivation waits for worker teardown and ignores the old load',async()=>{
 let finishLoad,finishDestroy
 const h=documentHarness({getDocument:()=>({promise:new Promise(r=>{finishLoad=r}),destroy:()=>new Promise(r=>{finishDestroy=r})})})
 await new Promise(setImmediate);assert.equal(h.tasks.length,1)
 h.props.active=false;await h.update();h.props.active=true;const reopening=h.update()
 await new Promise(setImmediate);assert.equal(h.tasks.length,1)
 finishLoad({numPages:99,async getPage(){throw Error('stale document must not be read')}})
 await h.initial;assert.equal(h.pages.value,0);assert.equal(h.error.value,'')
 finishDestroy();await new Promise(setImmediate);assert.equal(h.tasks.length,2)
 finishLoad({numPages:3,async getPage(){return page}});await reopening
 assert.equal(h.pages.value,3);assert.equal(h.error.value,'')
 h.unmount();await Promise.resolve();finishDestroy()
})
test('PDF failure and encrypted-document cancellation also release workers',async()=>{
 const h=documentHarness({getDocument:()=>({promise:Promise.reject(Error('bad PDF')),destroyed:0,async destroy(){this.destroyed++}})})
 await h.initial;await Promise.resolve();assert.equal(h.tasks[0].destroyed,1);assert.match(h.error.value,/bad PDF/)
 let reject
 const encrypted=documentHarness({getDocument:()=>({promise:new Promise((_,r)=>reject=r),destroyed:0,async destroy(){this.destroyed++;reject(Error('cancelled'))}})})
 await new Promise(setImmediate);encrypted.tasks[0].onPassword();await encrypted.initial
 assert.equal(encrypted.tasks[0].destroyed,1);assert.match(encrypted.error.value,/加密 PDF/)
})
test('unmount during URL resolution never creates a PDF worker',async()=>{
 const h=documentHarness();h.unmount();await h.initial
 assert.equal(h.tasks.length,0);assert.equal(h.document.value,null)
})

test('hiding a PDF during first-page loading cannot restore its document or dimensions',async()=>{
 let finishPage
 const h=documentHarness({getDocument:()=>({promise:Promise.resolve({numPages:99,getPage:()=>new Promise(r=>finishPage=r)}),destroyed:0,async destroy(){this.destroyed++}})})
 await new Promise(setImmediate);h.props.active=false;await h.update()
 finishPage(page);await h.initial
 assert.equal(h.document.value,null);assert.equal(h.pages.value,0);assert.equal(h.tasks[0].destroyed,1)
 assert.equal(h.loading.value,false);assert.equal(h.error.value,'')
})
