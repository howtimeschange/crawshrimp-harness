from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request,urlopen
import re
root=Path(__file__).resolve().parent
text='抓虾把重复工作交给智能体从一句任务到浏览器执行与文件付本地优先桌面台输入业务后台和授权商品表整理成份周报汇总运营可跟进结果检查流示意脚复用产物留存'
font_specs=[('Noto Sans SC:wght@500;700','NotoSC'),('Inter:wght@500;600;700;800','Inter'),('JetBrains Mono:wght@500','JBMono')]
css=[]
for family,name in font_specs:
 params={'family':family,'display':'swap'}
 if name=='NotoSC':params['text']=text
 req=Request('https://fonts.googleapis.com/css2?'+urlencode(params),headers={'User-Agent':'Mozilla/5.0'})
 source=urlopen(req,timeout=30).read().decode()
 for i,block in enumerate(re.findall(r'@font-face\s*\{.*?\}',source,re.S)):
  match=re.search(r'url\((https://[^)]+)\)',block)
  if not match:continue
  url=match.group(1);ext='.woff2' if '.woff2' in url else '.ttf';target=root/'fonts'/f'{name}-{i}{ext}'
  target.write_bytes(urlopen(url,timeout=30).read())
  block=block.replace(url,f'./{target.name}').replace(re.search(r"font-family:\s*[^;]+;",block).group(0),f"font-family: '{name}';")
  css.append(block)
for slug in ['notosanssc','inter','jetbrainsmono']:
 url=f'https://raw.githubusercontent.com/google/fonts/main/ofl/{slug}/OFL.txt'
 (root/'fonts'/f'OFL-{slug}.txt').write_bytes(urlopen(url,timeout=30).read())
(root/'fonts'/'fonts.css').write_text('\n'.join(css))
print('Self-hosted font faces:',len(css))
