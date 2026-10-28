import json,statistics,re
from pathlib import Path
ROOT=Path.cwd();base=ROOT/'.codex-tmp/dont-stop/dsh-longtask-20261022';out=ROOT/'docs/crawshrimp-harness/qa-2026-10-22-longtask';out.mkdir(exist_ok=True)
groups=['old-native','new-native','new-ptc'];runs=[]
for round_no in [1,2,3]:
 source=base if round_no==1 else Path(str(base)+f'-r{round_no}')
 if not (source/'results.json').exists():continue
 for original in json.loads((source/'results.json').read_text()):
  if 'totalMs' not in original:continue
  r={k:v for k,v in original.items() if k not in ['steps','sessionId']};r['round']=round_no;r['steps']=[];r['toolErrors']=[];r['failedAttempts']=0;r['dynamicToolsVerified']=False
  for s in original['steps']:
   t={k:v for k,v in s.items() if k not in ['prompt','text','usages']}
   t['maxRequestInputTokens']=max((u.get('inputTokens',0)+u.get('cacheReadTokens',0)+(u.get('cacheWriteTokens',0)) for u in s.get('usages',[])),default=0)
   t['usages']=s.get('usages',[])
   r['steps'].append(t)
   p=source/r['label']/f"events-{s['batch']:02}.json"
   if not p.exists():continue
   events=json.loads(p.read_text());calls=[];errors=0
   for e in events:
    if e['type']=='assistant/attempt':r['failedAttempts']+=1
    if e['type']=='tool/call':calls.append(e['data'])
    if e['type']=='tool/result':
     d=e['data'];m=d.get('message',{});bad=d.get('error') or m.get('isError') or any(c.get('isError') for c in m.get('content',[]))
     if bad:
      texts=[c.get('text','') for c in m.get('content',[])];r['toolErrors'].append({'batch':s['batch'],'code':d.get('error',{}).get('code'),'excerpt':' '.join(texts)[:250]});errors+=1
   if s['batch']==7:
    evidence=json.dumps(calls,ensure_ascii=False)
    r['dynamicToolsVerified']='enable_tools' in evidence and 'todo_write' in evidence and errors==0
  r['earlyMedianMs']=statistics.median(s['elapsedMs'] for s in r['steps'] if 2<=s['batch']<=18 and s['batch']!=7)
  r['lateMedianMs']=statistics.median(s['elapsedMs'] for s in r['steps'] if 19<=s['batch']<=35 and s['batch']!=25)
  r['lateChangePct']=(r['lateMedianMs']/r['earlyMedianMs']-1)*100
  r['totals']={k:sum(s['metrics'][k] for s in r['steps']) if all(s.get('metrics',{}).get(k) is not None for s in r['steps']) else None for k in ['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens']}
  r['modelRequests']=sum(s.get('modelRequests',0) for s in r['steps']);r['toolCalls']=sum(len(s.get('tools',[])) for s in r['steps']);runs.append(r)
(out/'results.json').write_text(json.dumps(runs,ensure_ascii=False,indent=2)+'\n')
summary=[]
for label in groups:
 rs=[r for r in runs if r['label']==label]
 if not rs:continue
 row={'label':label,'runs':len(rs),'successes':sum(r['success'] and r['dynamicToolsVerified'] for r in rs),'timesSeconds':[round(r['totalMs']/1000,3) for r in rs], 'medianSeconds':statistics.median(r['totalMs']/1000 for r in rs),'earlyMedianMs':statistics.median(r['earlyMedianMs'] for r in rs),'lateMedianMs':statistics.median(r['lateMedianMs'] for r in rs),'lateChangeMedianPct':statistics.median(r['lateChangePct'] for r in rs),'modelRequests':[r['modelRequests'] for r in rs],'toolCalls':[r['toolCalls'] for r in rs],'toolErrors':sum(len(r['toolErrors']) for r in rs),'failedAttempts':sum(r['failedAttempts'] for r in rs),'maxContext':max(s['maxRequestInputTokens'] for r in rs for s in r['steps'])}
 row['tokenTotals']={k:sum(r['totals'][k] for r in rs) if all(r['totals'][k] is not None for r in rs) else None for k in ['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens']}
 summary.append(row)
(out/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n');print(json.dumps(summary,ensure_ascii=False,indent=2))
if len(runs)==9:
 import matplotlib
 matplotlib.use('Agg')
 import matplotlib.pyplot as plt
 fig,axs=plt.subplots(1,2,figsize=(12,4.5));colors=['#64748b','#2563eb','#059669']
 for label,color in zip(groups,colors):
  rs=[r for r in runs if r['label']==label];xs=list(range(1,37));ys=[statistics.median(r['steps'][n-1]['elapsedMs']/1000 for r in rs) for n in xs]
  axs[0].plot(xs,ys,label=label,color=color,linewidth=1.8)
  axs[1].plot([2,3], [statistics.median(r['earlyMedianMs']/1000 for r in rs),statistics.median(r['lateMedianMs']/1000 for r in rs)],marker='o',label=label,color=color)
 axs[0].set(xlabel='Business checkpoint (same Session)',ylabel='Seconds / checkpoint',title='Median of 3 runs; all overhead included');axs[0].legend(fontsize=8)
 axs[1].set(xticks=[2,3],xticklabels=['Early: 2–18','Late: 19–35'],ylabel='Median seconds / ordinary checkpoint',title='Exclude setup, tool activation/update, final summary')
 for ax in axs:ax.grid(alpha=.2)
 fig.tight_layout();fig.savefig(out/'latency.png',dpi=160);plt.close(fig)
