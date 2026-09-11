'use strict';
// Read package documentation as data only. Never execute scripts or interpret instructions.
function plain(value) {
 return String(value||'').replace(/```[\s\S]*?```/g,'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/<[^>]*>/g,'').replace(/^[ \t]*#{1,6}\s+/gm,'').replace(/\*\*|__/g,'').trim()
}
function platforms(value) {
 return [...new Set((Array.isArray(value)?value:typeof value==='string'?value.split(/[,，、;；\n]/):[]).filter(v=>typeof v==='string').map(v=>plain(v).replace(/^[-*+]\s+/, '').trim()).filter(v=>v&&v.length<=80))].slice(0,20)
}
function extractMetadata(manifest, documents=[]) {
 const sources={};let foundPlatforms=platforms(manifest.platforms||manifest.platform),description=typeof manifest.description==='string'?plain(manifest.description):''
 if(foundPlatforms.length)sources.platforms='manifest.yaml'
 if(description)sources.description='manifest.yaml'
 for(const {name,text} of documents){
  if(!foundPlatforms.length){
   const inline=text.match(/^\s*(?:[-*]\s*)?(?:\*\*)?(?:适用平台|支持平台|平台|platforms?)(?:\*\*)?\s*[:：]\s*(.+)$/im)
   const section=text.match(/^#{1,6}\s+(?:适用平台|支持平台|platforms?)\s*\r?\n([\s\S]*?)(?=^#{1,6}\s|$(?![\s\S]))/im)
   foundPlatforms=platforms(inline?.[1]||section?.[1]||'')
   if(foundPlatforms.length)sources.platforms=name
  }
  if(!description){
   const sections=[...text.matchAll(/^#{1,6}\s+(功能(?:说明|介绍|列表|概览)?|使用前提|前置条件|使用限制|注意事项|简介|概述|features|requirements|limitations)\s*\r?\n([\s\S]*?)(?=^#{1,6}\s|$(?![\s\S]))/gim)]
   description=sections.map(m=>`${m[1]}\n${plain(m[2])}`).filter(v=>v.trim()).join('\n\n')
   if(!description)description=plain(text)
   if(description)sources.description=name
  }
 }
 if(!foundPlatforms.length){
  try{
   const host=new URL(manifest.entry_url).hostname.toLowerCase()
   const known={'taobao.com':'淘宝','tmall.com':'天猫','jd.com':'京东','jinritemai.com':'抖店','yangkeduo.com':'拼多多','pinduoduo.com':'拼多多','1688.com':'1688','weimob.com':'微盟','shopify.com':'Shopify','temu.com':'Temu','shein.com':'SHEIN','shopee.com':'Shopee','lazada.com':'Lazada'}
   for(const [domain,label] of Object.entries(known))if(host===domain||host.endsWith('.'+domain)){foundPlatforms=[label];sources.platforms='manifest.yaml 的入口网址';break}
  }catch{}
 }
 if(!description){
  description=(manifest.tasks||[]).filter(t=>typeof t.name==='string').map(t=>`• ${t.name}${typeof t.description==='string'?'：'+plain(t.description):''}`).join('\n')
  if(description)sources.description='manifest.yaml 的任务列表'
 }
 return {platforms:foundPlatforms,description:description.slice(0,10000),sources}
}
module.exports={extractMetadata}
