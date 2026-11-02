"""Real process signal regression for a server embedded in the API event loop."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.request


CHILD = r'''
import asyncio, json, os, signal
from contextlib import asynccontextmanager
from pathlib import Path
import uvicorn
from fastapi import FastAPI
from starlette.responses import StreamingResponse
from core.agent import api
from core.agent.service import AgentService
from core.log_writer import writer, flush_logs

directory = Path(os.environ['QUIT_TEST_DIR'])
outer_port = int(os.environ['QUIT_TEST_PORT'])
release = asyncio.Event()
mcp = FastAPI()
@mcp.get('/subscription')
async def subscription():
    async def stream():
        yield b'data: ready\n\n'
        await release.wait()
    return StreamingResponse(stream(), media_type='text/event-stream')
api.build_agent_mcp_asgi = lambda *a, **kw: mcp
@asynccontextmanager
async def lifespan(app):
    service = AgentService()
    await service._start_mcp_server()
    while not service._mcp_uvicorn.started:
        await asyncio.sleep(.01)
    owner = signal.getsignal(signal.SIGTERM).__self__
    (directory/'ready.json').write_text(json.dumps({'owner': owner.config.port, 'mcp': service.mcp_port}))
    try:
        yield
    finally:
        # Mirror Worker stopping its owned subscription before stopping MCP.
        release.set()
        await service._stop_mcp_server()
        receipt = directory/'receipt.log'
        for i in range(128):
            writer().append(receipt, f'{i}\n'.encode())
        await asyncio.to_thread(flush_logs)
        (directory/'cleanup.json').write_text(json.dumps({'mcpClosed': service._mcp_socket is None, 'flushedLines': len(receipt.read_text().splitlines())}))
app = FastAPI(lifespan=lifespan)
@app.get('/')
async def status():
    return {'ready': True}
uvicorn.run(app, host='127.0.0.1', port=outer_port, access_log=False, timeout_graceful_shutdown=.2)
'''


def test_sigterm_reaches_outer_server_and_drains_embedded_subscription(tmp_path):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    env = {**os.environ, 'QUIT_TEST_DIR': str(tmp_path), 'QUIT_TEST_PORT': str(port),
           'CRAWSHRIMP_PORT': str(port), 'CRAWSHRIMP_DATA': str(tmp_path/'Data')}
    project_root = str(Path(__file__).resolve().parents[1])
    env['PYTHONPATH'] = os.pathsep.join(filter(None, [project_root, env.get('PYTHONPATH')]))
    child = tmp_path/'child.py'
    child.write_text(CHILD)
    log = (tmp_path/'child.log').open('wb')
    proc = subprocess.Popen([sys.executable, str(child)], env=env, stdout=log, stderr=subprocess.STDOUT)
    subscription = None
    try:
        deadline = time.monotonic()+10
        while not (tmp_path/'ready.json').exists() and time.monotonic()<deadline:
            assert proc.poll() is None, (tmp_path/'child.log').read_text()
            time.sleep(.02)
        ready = json.loads((tmp_path/'ready.json').read_text())
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=1) as response:
            assert response.status == 200
        subscription = urllib.request.urlopen(f'http://127.0.0.1:{ready["mcp"]}/subscription', timeout=1)
        assert subscription.readline() == b'data: ready\n'
        start = time.monotonic()
        proc.send_signal(signal.SIGTERM)
        try:
            code = proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            raise AssertionError(f'SIGTERM owner={ready["owner"]}, outer={port}; outer cleanup never completed')
        cleanup = json.loads((tmp_path/'cleanup.json').read_text())
        assert ready['owner'] == port
        assert code in (0, -signal.SIGTERM)
        assert cleanup == {'mcpClosed': True, 'flushedLines': 128}
        assert (tmp_path/'receipt.log').read_text() == ''.join(f'{i}\n' for i in range(128))
        for stopped_port in [port, ready['mcp']]:
            with socket.socket() as sock:
                assert sock.connect_ex(('127.0.0.1', stopped_port)) != 0
        print(json.dumps({'sigtermOwnerIsOuter': True, 'elapsedMs': round((time.monotonic()-start)*1000), **cleanup}))
    finally:
        if subscription:
            subscription.close()
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=3)
        log.close()
