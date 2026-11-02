import asyncio,json,time,sys
from pathlib import Path
import httpx
base=Path.cwd()/'.codex-tmp/dont-stop/dsh-ptc-ecosystem-20261022'
async def turn(mode,name,prompt,session_id=None,timeout=900):
 port=20150 if mode=='native' else 20160
 token=next((base/mode/'data').rglob('api-token')).read_text().strip()
 async with httpx.AsyncClient(base_url=f'http://127.0.0.1:{port}',headers={'x-crawshrimp-token':token},trust_env=False,timeout=timeout) as c:
  if not session_id:
   r=await c.post('/agent/sessions',json={'title':'PTC生态验证-'+name});r.raise_for_status();session_id=r.json()['session']['session_id']
  before=(await c.get(f'/agent/sessions/{session_id}')).json()
  cursor=before.get("session",before).get("last_event_seq",0)
  start=time.monotonic();r=await c.post(f'/agent/sessions/{session_id}/turns',json={'text':prompt});r.raise_for_status();submitted=r.json();events=[];result={'mode':mode,'name':name,'session_id':session_id,'submitted':submitted,'events':events};dest=base/f'{mode}-{name}.json';dest.write_text(json.dumps(result,ensure_ascii=False,indent=2))
  print(mode,name,'submitted',flush=True)
  ui=None
  if name.startswith('script') or name.startswith('browser'):
   from playwright.async_api import async_playwright
   pw=await async_playwright().start()
   ui=await pw.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
   page=await ui.new_page()
   info=(await c.get('/agent/runtime')).json()
   await page.goto(info['web_launch_url'])
   sid=before.get('session',before)['runtime_session_id']
   await page.evaluate('(sessionId)=>localStorage.setItem("dsh.sessions.current",JSON.stringify({sessionId}))',sid)
   await page.reload()
   async def approve_test():
    for _ in range(300):
     await asyncio.sleep(1)
     button=page.get_by_role('button',name='允许一次',exact=True)
     if await button.count():
      body=await page.locator('body').inner_text()
      # Only the isolated fixture click or explicitly named local PDF export.
      if ('http://127.0.0.1:20180/' in body or ('PTC-ECO-' in body and '123456789012.pdf' in body) or (name.startswith('browser-x') and '只读浏览' in body and 'x.com' in body)):
       await button.click()
       print(mode,name,'approved scoped test action',flush=True)
   watcher=asyncio.create_task(approve_test())
  async with asyncio.timeout(timeout):
   async with c.stream('GET',f'/agent/sessions/{session_id}/events?after_seq={cursor}') as stream:
    stream.raise_for_status();event='';data=[]
    async for line in stream.aiter_lines():
     if line.startswith('event:'):event=line[6:].strip()
     elif line.startswith('data:'):data.append(line[5:].strip())
     elif not line and data:
      payload=json.loads('\n'.join(data));events.append({'type':event,'ms':round((time.monotonic()-start)*1000),'data':payload});dest.write_text(json.dumps(result,ensure_ascii=False,indent=2));data=[]
      if event in ['run.completed','run.failed','run.cancelled','run.canceled']:
       result['elapsedMs']=round((time.monotonic()-start)*1000);result['terminal']=event;break
  state=(await c.get(f'/agent/sessions/{session_id}')).json();result['session']=state;dest.write_text(json.dumps(result,ensure_ascii=False,indent=2));print(mode,name,result.get('terminal'),'ms',result.get('elapsedMs'),'eventtypes',sorted(set(e['type'] for e in events)),flush=True)
  if ui:
   watcher.cancel()
   await ui.close()
   await pw.stop()
  return result
if __name__=='__main__':
 mode,name,prompt_file=sys.argv[1:4]
 asyncio.run(turn(mode,name,Path(prompt_file).read_text(),sys.argv[4] if len(sys.argv)>4 else None))
