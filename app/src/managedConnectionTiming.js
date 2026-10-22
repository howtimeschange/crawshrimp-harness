'use strict'
const { AsyncLocalStorage } = require('node:async_hooks')
const { channel } = require('node:diagnostics_channel')
const context = new AsyncLocalStorage(), requests = new WeakMap(), sockets = new WeakMap()
let installed = false
function install() {
  if(installed)return
  installed=true
  const listen=(name,fn)=>channel(name).subscribe(value=>{try{fn(value)}catch{}})
  listen('undici:request:create',({request})=>{const trace=context.getStore();if(trace)requests.set(request,trace)})
  listen('undici:client:beforeConnect',()=>{const trace=context.getStore();if(trace){if(trace.connectStarted!==undefined)trace.ambiguous=true;trace.connectStarted=performance.now()}})
  listen('undici:client:connected',({socket})=>{
    const trace=context.getStore()
    if(socket&&trace?.connectStarted!==undefined&&!trace.ambiguous)sockets.set(socket,{ms:Math.round(performance.now()-trace.connectStarted),used:false})
  })
  listen('undici:client:sendHeaders',({request,socket})=>{
    const trace=requests.get(request);if(!trace)return
    trace.event.sentMs=Math.round(performance.now()-trace.started)
    const connection=sockets.get(socket)
    if(connection){trace.event.connection=connection.used?'reused':'new';if(!connection.used)trace.event.connectionMs=connection.ms;connection.used=true}
  })
}
function withConnectionTiming(event, started, operation) {
  event.connection='unavailable'
  try{install()}catch{return operation()}
  return context.run({event,started},operation)
}
module.exports={withConnectionTiming}
