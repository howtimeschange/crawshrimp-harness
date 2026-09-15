"""Bounded live tails with durable, streaming-downloadable full task logs."""
from collections import OrderedDict, deque
import hashlib
import json
from pathlib import Path
import threading
import re
import weakref
from uuid import uuid4

from core import runtime_paths

MAX_LINES = 2000
MAX_BYTES = 1024 * 1024

class RunLogBuffer:
    def __init__(self, job_id):
        self.path = runtime_paths.child_dir('logs') / 'tasks' / (hashlib.sha256(job_id.encode()).hexdigest() + '.jsonl')
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.epoch = uuid4().hex
        self.next_cursor = 0
        self.entries = deque()
        self.bytes = 0
        self.lock = threading.RLock()
        if self.path.exists():
            with self.path.open('rb') as f:
                size = f.seek(0, 2)
                f.seek(max(0, size - MAX_BYTES))
                # Recover the cursor even if the final record exceeds the restore window.
                tail_start = f.tell()
                tail = f.read()
                match = re.search(rb', "cursor": (\d+)}\n?$', tail)
                if match:
                    self.next_cursor = int(match.group(1)) + 1
                f.seek(tail_start)
                if size > MAX_BYTES:
                    f.readline()
                for raw in f:
                    try:
                        item = json.loads(raw)
                        self._retain(int(item['cursor']), str(item['line']))
                        self.next_cursor = int(item['cursor']) + 1
                    except (ValueError, KeyError, TypeError):
                        continue

    def _retain(self, cursor, line):
        # A single pathological line cannot monopolize the live tail; full text stays on disk.
        visible = line if len(line) <= 8192 else line[:8192] + ' …（完整内容请下载日志）'
        size = len(visible.encode('utf-8'))
        self.entries.append((cursor, visible, size))
        self.bytes += size
        while len(self.entries) > MAX_LINES or self.bytes > MAX_BYTES:
            self.bytes -= self.entries.popleft()[2]

    def append(self, line):
        line = str(line)
        with self.lock:
            with self.path.open('a', encoding='utf-8') as f:
                f.write(json.dumps({'line': line, 'cursor': self.next_cursor}, ensure_ascii=False) + '\n')
            self._retain(self.next_cursor, line)
            self.next_cursor += 1

    def __iter__(self):
        with self.lock:
            return iter([line for _, line, _ in self.entries])

    def __len__(self):
        return len(self.entries)

    def read(self, cursor=None, epoch='', limit=500):
        with self.lock:
            limit = max(1, min(int(limit), 1000))
            first = self.entries[0][0] if self.entries else self.next_cursor
            reset = cursor is None or epoch != self.epoch or cursor < first or cursor > self.next_cursor
            items = list(self.entries)
            items = items[-limit:] if reset else [item for item in items if item[0] >= cursor][:limit]
            next_cursor = items[-1][0] + 1 if items else self.next_cursor
            return {'logs': [item[1] for item in items], 'cursor': next_cursor, 'epoch': self.epoch,
                    'reset': reset, 'has_more': next_cursor < self.next_cursor,
                    'truncated': reset and bool(items) and items[0][0] > 0, 'total': self.next_cursor}

    def clear(self):
        with self.lock:
            self.path.write_text('', encoding='utf-8')
            self.entries.clear(); self.bytes = 0; self.next_cursor = 0; self.epoch = uuid4().hex

    def stream_text(self):
        # Freeze the byte boundary so a continuing task cannot extend this download forever.
        size = self.path.stat().st_size if self.path.exists() else 0
        if not size:
            return
        with self.path.open('rb') as f:
            while f.tell() < size:
                raw = f.readline()
                if not raw:
                    break
                try:
                    yield (str(json.loads(raw)['line']) + '\n').encode('utf-8')
                except (ValueError, KeyError):
                    continue

class RunLogRegistry(OrderedDict):
    def __setitem__(self, key, value):
        super().__setitem__(key, value)
        self.move_to_end(key)
        while len(self) > 64:
            self.popitem(last=False)

_registry_lock = threading.RLock()
_live_buffers = weakref.WeakValueDictionary()
def buffer_for(registry, job_id):
    with _registry_lock:
        current = registry.get(job_id)
        if not isinstance(current, RunLogBuffer):
            identity = (str(runtime_paths.data_root()), job_id)
            replacement = _live_buffers.get(identity)
            if replacement is None:
                replacement = RunLogBuffer(job_id)
                _live_buffers[identity] = replacement
            if current:
                for line in current:
                    replacement.append(line)
            registry[job_id] = replacement
            current = replacement
        return current
