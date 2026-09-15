import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const scratch=path.join(root,'node_modules/.cache/harness-performance')
fs.mkdirSync(scratch,{recursive:true})
fs.writeFileSync(path.join(scratch,'index.html'),'<div id="app"></div><script type="module" src="./entry.js"></script>')
fs.writeFileSync(path.join(scratch,'entry.js'),`
import {createApp,h,ref,nextTick} from 'vue'
import Drawer from ${JSON.stringify(path.join(root,'src/renderer/views/TaskOutputDrawer.vue'))}
const logs=ref([])
createApp({setup:()=>()=>h(Drawer,{logs:logs.value,files:[],autoOpenOnFirstLog:true})}).mount('#app')
window.perfLogs=async(count)=>{
 const start=performance.now();logs.value=Array.from({length:count},(_,i)=>'[10:00:00] fixture '+i+' '+ '下载商品图片处理进度 '.repeat(8));
 await nextTick();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 return {elapsedMs:performance.now()-start,lines:document.querySelectorAll('.log-line').length,dom:document.querySelectorAll('*').length,heap:performance.memory?.usedJSHeapSize}
};
`)
await build({configFile:false,root:scratch,base:'./',plugins:[vue()],build:{outDir:path.join(root,'dist/performance'),emptyOutDir:true}})
