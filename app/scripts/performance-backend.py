"""Measure real source data-path, SQLite, log functions using disposable fixtures.
No API server startup, provider calls, or user data access.
"""
import ast, json, logging, os, platform, sqlite3, sys, time
from pathlib import Path
from typing import Optional
root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root))
output = Path(os.environ.get('PERF_OUTPUT', str(root / '.codex-tmp/performance-2026-09-15/backend')))
output.mkdir(parents=True, exist_ok=True)
os.environ['CRAWSHRIMP_DATA'] = str(output / 'data')
from core import runtime_paths
from core.windows_acl import harden_windows_path
logger = logging.getLogger('perf')
result = {'platform': platform.platform(), 'machine': platform.machine(), 'scenarios': []}
def save():
    (output / 'results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
def extract(source_path, names, scope):
    tree = ast.parse(source_path.read_text(encoding='utf-8'))
    nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names]
    assert len(nodes) == len(names)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source_path), 'exec'), scope)
def measure(name, fn, repetitions=5):
    times=[]
    for _ in range(repetitions):
        t=time.perf_counter(); value=fn(); times.append((time.perf_counter()-t)*1000)
    result['scenarios'].append({'name':name,'timesMs':times,'value':value});save()
measure('data-root-revalidation-100', lambda: [runtime_paths.data_root() for _ in range(100)] and 100)
scope=dict(globals())
extract(root/'core/data_sink.py', {'_db_path','_harden_db_file_permissions','_get_conn','get_latest_run'}, scope)
db=scope['_db_path']()
with sqlite3.connect(db) as c:
    c.execute('CREATE TABLE IF NOT EXISTS task_runs(id INTEGER PRIMARY KEY,adapter_id TEXT, task_id TEXT,status TEXT)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_task_runs_adapter_task ON task_runs(adapter_id,task_id)')
    c.executemany('INSERT OR REPLACE INTO task_runs VALUES(?,?,?,?)', [(i,'fixture',str(i%300),'completed') for i in range(100000)])
measure('latest-run-300-real-connections', lambda: sum(scope['get_latest_run']('fixture',str(i)) is not None for i in range(300)))
def shared_query():
    with sqlite3.connect(db) as c:
        return sum(c.execute('SELECT * FROM task_runs WHERE adapter_id=? AND task_id=? ORDER BY id DESC LIMIT 1',('fixture',str(i))).fetchone() is not None for i in range(300))
measure('latest-run-300-shared-connection-control',shared_query)
logscope={'_run_logs':{}}
extract(root/'core/api_server.py',{'_append_run_log'},logscope)
for count in (1000,10000,100000):
    logscope['_run_logs'].clear()
    for i in range(count):logscope['_append_run_log'](['fixture'],f'[{i}] '+ 'download product image progress '*8)
    measure(f'log-full-json-{count}',lambda:len(json.dumps({'logs':logscope['_run_logs']['fixture']}).encode()),3)
result['finishedAt']=time.time();save()
