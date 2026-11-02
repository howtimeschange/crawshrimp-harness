from pathlib import Path
import json,sqlite3
from compression import zstd
b=Path(__file__).parent
results=[]
for name in ['discovery','script2','browser2','image','browser3','script3','browser4','script4','browser5','script5','browser-x','browser-x-cache','browser-x-final','video']:
 for mode in ['native','ptc']:
  f=b/f'{mode}-{name}.json'
  if not f.exists():continue
  d=json.loads(f.read_text())
  if not d.get('elapsedMs') or not d.get('events'):continue
  sid=d['events'][0]['data']['runtime_session_id'];files=list((b/mode/'data/agent/harness-sessions').glob(f'*/{sid}/session.v4.jsonl.zstd'))
  if not files:continue
  with zstd.open(files[0],'rt') as stream:rows=[json.loads(l) for l in stream]
  msgs=[r['data'] for r in rows if r['type']=='assistant/message' and r.get('data',{}).get('usage')]
  tokens={k:sum(m['usage'].get(k,0) for m in msgs) for k in ['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','totalTokens']}
  con=sqlite3.connect(b/mode/'data/crawshrimp.db');con.row_factory=sqlite3.Row
  events=[dict(r) for r in con.execute('select event_type,payload_json,created_at from agent_events where session_id=? order by seq',(d['session_id'],))]
  errs=[r for r in rows if r['type'] in ['tool/result','tool/ptc-dispatch'] and (r['data'].get('isError') or r['data'].get('error') or r['data'].get('message',{}).get('isError'))]
  approvals=[r['time'] for r in rows if r['type']=='approval/asked'];decisions=[r['time'] for r in rows if r['type']=='approval/decided']
  wait=sum(max(0,y-x) for x,y in zip(approvals,decisions))
  started=next((e['ms'] for e in d['events'] if e['type']=='run.started'),0)
  result={'mode':mode,'case':name,'elapsedMs':d.get('elapsedMs'),'queueMs':started,'approvalMs':wait,'activeMinusApprovalMs':d.get('elapsedMs',0)-started-wait,'modelRequests':len(msgs),'tokens':tokens,'toolErrors':len(errs),'artifactEvents':sum(e['event_type']=='artifact.created' for e in events),'outerCalls':sum(r['type']=='tool/call' for r in rows),'ptcChildCalls':sum(r['type']=='tool/ptc-dispatch-start' for r in rows),'sessionId':d['session_id']}
  results.append(result)
print(json.dumps(results,ensure_ascii=False,indent=2))
(b/'metrics.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
