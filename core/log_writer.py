"""Bounded batched task-log writer. Barriers preserve download/clear ordering."""
import atexit
import queue
import threading
import logging


class LogWriter:
    def __init__(self):
        self.queue = queue.Queue(maxsize=1024)
        self.errors = {}
        self.thread = threading.Thread(target=self._run, name='task-log-writer', daemon=True)
        self.thread.start()

    def append(self, path, raw):
        self.check(path)
        self.queue.put((path, raw, None))
        self.check(path)

    def check(self, path):
        error = self.errors.get(path)
        if error is not None:
            raise OSError('任务日志写入失败') from error

    def flush(self, path=None):
        done = threading.Event()
        self.queue.put((None, None, done))
        done.wait()
        # Global lifecycle barriers must not prevent unrelated tasks from
        # reaching terminal state. Downloads/appends check their own path.
        if path is not None:
            self.check(path)

    def _run(self):
        while True:
            first = self.queue.get()
            batch = [first]
            while len(batch) < 256:
                try:
                    batch.append(self.queue.get_nowait())
                except queue.Empty:
                    break
            groups = {}
            barriers = []
            try:
                for path, raw, barrier in batch:
                    if barrier is not None:
                        barriers.append(barrier)
                    else:
                        groups.setdefault(path, []).append(raw)
                for path, lines in groups.items():
                    try:
                        with path.open('ab') as stream:
                            stream.write(b''.join(lines))
                    except Exception as exc:
                        self.errors[path] = exc
                        logging.getLogger(__name__).error('Task log write failed (%s)', type(exc).__name__)
            finally:
                for barrier in barriers:
                    barrier.set()
                for _ in batch:
                    self.queue.task_done()


_lock = threading.Lock()
_writer = None

def writer():
    global _writer
    with _lock:
        if _writer is None:
            _writer = LogWriter()
        return _writer


def flush_logs(path=None):
    if _writer is not None:
        _writer.flush(path)


atexit.register(flush_logs)
