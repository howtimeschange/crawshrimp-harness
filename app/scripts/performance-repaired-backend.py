import ast,json,os,platform,sys,time,sqlite3,logging,types
from pathlib import Path
from typing import Iterable,Optional
root=Path(__file__).resolve().parents[2];sys.path.insert(0,str(root))
output=Path(os.environ['PERF_OUTPUT']);output.mkdir(parents=True,exist_ok=True)
os.environ['CRAWSHRIMP_DATA']=str(output/'data')
from core import runtime_paths
from core.windows_acl import harden_windows_path
logger=logging.getLogger('perf')
source=root/'core/data_sink.py'
names={'_db_path','_harden_db_file_permissions','_get_conn','get_latest_run','get_latest_runs'}
nodes=[n for n in ast.parse(source.read_text(encoding='utf-8')).body if isinstance(n,ast.FunctionDef) and n.name in names]
assert len(nodes)==len(names)
scope=dict(globals());exec(compile(ast.Module(body=nodes,type_ignores=[]),str(source),'exec'),scope)
data_sink=types.SimpleNamespace(**{name:scope[name] for name in names})
from core.run_logs import RunLogBuffer
# Disposable minimal database; production query and connection functions.
db=data_sink._db_path()
with sqlite3.connect(db) as c:
 c.execute('CREATE TABLE IF NOT EXISTS task_runs(id INTEGER PRIMARY KEY,adapter_id TEXT,task_id TEXT,status TEXT)')
 c.execute('CREATE INDEX IF NOT EXISTS idx_task_runs_adapter_task ON task_runs(adapter_id,task_id)')
 c.executemany('INSERT OR REPLACE INTO task_runs VALUES(?,?,?,?)',[(i,'fixture',str(i%300),'done') for i in range(100000)])
rows=[]
for name,fn in [('old-300-connections',lambda:[data_sink.get_latest_run('fixture',str(i)) for i in range(300)]),('new-batch-300',lambda:data_sink.get_latest_runs(('fixture',str(i)) for i in range(300)))]:
 times=[]
 for _ in range(5):
  t=time.perf_counter();result=fn();times.append((time.perf_counter()-t)*1000);assert len(result)==300
 rows.append(dict(name=name,timesMs=times))
logs=RunLogBuffer('fixture');logs.clear();t=time.perf_counter()
for i in range(50000):logs.append(f'[{i}] '+'download product image progress '*8)
payload=logs.read();t2=time.perf_counter()
rows.append(dict(name='logs-50000',appendMs=(t2-t)*1000,retainedLines=len(logs),retainedBytes=logs.bytes,initialResponseBytes=len(json.dumps(payload).encode()),incrementalEmptyBytes=len(json.dumps(logs.read(payload['cursor'],payload['epoch'])).encode()),downloadLines=sum(1 for _ in logs.stream_text())))
(output/'results.json').write_text(json.dumps(dict(platform=platform.platform(),scenarios=rows),indent=2))
