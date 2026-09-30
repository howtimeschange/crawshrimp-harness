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
