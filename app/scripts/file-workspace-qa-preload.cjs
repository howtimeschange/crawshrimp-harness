const {contextBridge,ipcRenderer}=require('electron')
const listen=(channel,fn)=>{const handler=(_,data)=>fn(data);ipcRenderer.on(channel,handler);return()=>ipcRenderer.removeListener(channel,handler)}
contextBridge.exposeInMainWorld('qaNative',{
 listTabs:()=>ipcRenderer.invoke('qa:tabs'), startStream:id=>ipcRenderer.invoke('qa:start',id), stopStream:id=>ipcRenderer.invoke('qa:stop',id),
 onFrame:fn=>listen('agent:browser:frame',fn), onStatus:fn=>listen('agent:browser:status',fn),
})
