"""Durable per-run cancellation, independent of action and visual IPC locks."""
import os
from pathlib import Path
import subprocess
import time
try:
    from .common import Refused, read_json, write_json
except ImportError:
    from common import Refused, read_json, write_json

class Cancelled(Refused):
    pass

def marker(run):
    return Path(run).resolve() / 'cancel.json'

def cancelled(path=None):
    path = path or os.environ.get('CRAWSHRIMP_CU_CANCEL_FILE')
    return bool(path and Path(path).exists())

def check(path=None):
    if cancelled(path):
        raise Cancelled('User stopped this desktop run; partial input possible. Use a new run directory to restart.')

def cancel(run):
    path = marker(run)
    if not path.exists():
        write_json(path, {'status':'cancelled','source':'user_stop','requested_at':time.time()})
    return {'status':'cancelled','cancel_file':str(path),'cancellation':read_json(path)}

def run_process(command, payload, cancel_file=None, **options):
    """Reap only our child; allow cooperative event-pair cleanup before termination.

    A delivered OS/COM action cannot be recalled. Callers retain UNKNOWN receipts.
    """
    check(cancel_file)
    child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, **options)
    deadline = time.monotonic() + 25
    sent = False
    try:
        while True:
            try:
                out, err = child.communicate(input=payload if not sent else None, timeout=.05)
                check(cancel_file)
                return subprocess.CompletedProcess(command, child.returncode, out, err)
            except subprocess.TimeoutExpired:
                sent = True
            if cancelled(cancel_file):
                try: child.communicate(timeout=.75)
                except subprocess.TimeoutExpired: pass
                check(cancel_file)
            if time.monotonic() >= deadline:
                raise subprocess.TimeoutExpired(command, 25)
    finally:
        if child.poll() is None:
            child.terminate()
            try: child.communicate(timeout=1)
            except subprocess.TimeoutExpired:
                child.kill(); child.communicate()
