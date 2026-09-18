"""Process-wide bounded resources; queued work keeps its cancellation signal."""
import os
import sys
import threading
from contextlib import contextmanager


def memory_gib():
    try:
        override = float(os.environ.get('CRAWSHRIMP_MEMORY_GIB', '0'))
        if override > 0:
            return override
        if sys.platform == 'darwin':
            import ctypes
            value, size = ctypes.c_uint64(), ctypes.c_size_t(8)
            if ctypes.CDLL(None).sysctlbyname(b'hw.memsize', ctypes.byref(value), ctypes.byref(size), None, 0) == 0:
                return value.value / 2**30
        if os.name == 'nt':
            import ctypes
            class MemoryStatus(ctypes.Structure):
                _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [(name, ctypes.c_ulonglong) for name in ('total', 'available', 'page_total', 'page_available', 'virtual_total', 'virtual_available', 'extended')]
            status = MemoryStatus(); status.length = ctypes.sizeof(status)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return status.total / 2**30
        if hasattr(os, 'sysconf'):
            return os.sysconf('SC_PHYS_PAGES') * os.sysconf('SC_PAGE_SIZE') / 2**30
    except (ValueError, OSError, AttributeError):
        pass
    return 8.0  # Unknown hardware uses the conservative preset.

LOW_MEMORY = memory_gib() <= 8.5
OFFICE_WORKERS = 1 if LOW_MEMORY else 2
NETWORK_WORKERS = 4 if LOW_MEMORY else 8
POLL_WORKERS = 8 if LOW_MEMORY else 16
_network = threading.BoundedSemaphore(NETWORK_WORKERS)


@contextmanager
def network_slot():
    with _network:
        yield
