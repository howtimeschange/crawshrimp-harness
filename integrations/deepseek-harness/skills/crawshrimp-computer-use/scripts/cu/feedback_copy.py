"""Shared native-banner copy; phase changes describe reported work, not a timer's guess."""
import json
from pathlib import Path
import time

CATALOG = json.loads((Path(__file__).resolve().parents[2] / 'assets/feedback-copy.json').read_text(encoding='utf-8'))
PUBLIC_PHASES = ('idle', 'thinking', 'planning', 'observing', 'verifying', 'waiting')
ROTATION_SECONDS = 6
PHASE_TTL_SECONDS = 60


class PhaseState:
    def __init__(self, reduced_motion=False, clock=time.monotonic):
        self.clock = clock
        self.reduced_motion = reduced_motion
        self.set('idle')

    def set(self, phase, token='', if_token=None):
        if phase not in CATALOG:
            raise ValueError('Unknown feedback phase')
        if if_token is not None and if_token != self.token:
            return False
        self.phase, self.token, self.since = phase, token, self.clock()
        return True

    def frame(self):
        elapsed = max(0, self.clock() - self.since)
        if self.phase != 'idle' and elapsed >= PHASE_TTL_SECONDS:
            self.set('idle')
            elapsed = 0
        copy = CATALOG[self.phase]
        index = 0 if self.reduced_motion else int(elapsed / ROTATION_SECONDS) % len(copy['subtitles'])
        return {'phase': self.phase, 'phase_token': self.token, 'title': copy['title'], 'subtitle': copy['subtitles'][index]}
