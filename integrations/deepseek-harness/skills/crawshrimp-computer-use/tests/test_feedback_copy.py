import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from cu.feedback_copy import CATALOG, PUBLIC_PHASES, PhaseState
from cu.feedback_session import activity, phase
from cu.common import Refused


class FeedbackCopyTests(unittest.TestCase):
    def test_idle_rotation_is_neutral_and_does_not_invent_work(self):
        now=[0.0];state=PhaseState(clock=lambda:now[0])
        actual=[]
        for value in (0,6,12,18):
            now[0]=value;frame=state.frame();actual.append(frame['subtitle'])
            self.assertEqual(frame['phase'],'idle')
            self.assertFalse(any(word in frame['subtitle'] for word in ('思考','规划','读取','核对')))
        self.assertEqual(len(set(actual)),3)
        self.assertEqual(actual[0],actual[3])

    def test_reduced_motion_keeps_idle_copy_still(self):
        now=[0];state=PhaseState(True,lambda:now[0]);before=state.frame()
        now[0]=19;self.assertEqual(state.frame(),before)

    def test_unrenewed_phase_expires_without_keeping_stale_work_label(self):
        now=[0];state=PhaseState(clock=lambda:now[0]);state.set('thinking','old')
        now[0]=59;self.assertEqual(state.frame()['phase'],'thinking')
        now[0]=60;self.assertEqual(state.frame()['phase'],'idle')
        self.assertEqual(state.frame()['phase_token'],'')

    def test_late_operation_cannot_clear_a_newer_phase(self):
        state=PhaseState();state.set('observing','read-1');state.set('planning','agent-2')
        self.assertFalse(state.set('idle',if_token='read-1'))
        self.assertEqual(state.frame()['phase'],'planning')
        self.assertTrue(state.set('idle',if_token='agent-2'))

    def test_invalid_phase_is_rejected_before_startup(self):
        with patch('cu.feedback_session.start') as start:
            with self.assertRaises(Refused):phase('unused','made-up')
            start.assert_not_called()

    def test_read_scope_does_not_start_a_hud(self):
        with tempfile.TemporaryDirectory() as d, patch('cu.feedback_session.start') as start:
            with activity(d,'observing'):pass
            start.assert_not_called()
            self.assertEqual(list(Path(d).iterdir()),[])

    def test_display_failure_cannot_replace_operation_error(self):
        with patch('cu.feedback_session.phase',side_effect=RuntimeError('HUD unavailable')):
            with self.assertRaisesRegex(ValueError,'read failed'):
                with activity('unused','observing'):raise ValueError('read failed')

    def test_scope_clears_only_its_acknowledged_generation(self):
        with patch('cu.feedback_session.phase',return_value={'seq':'read-1'}), patch('cu.feedback_session.command') as command:
            with activity('unused','observing'):pass
            self.assertEqual(command.call_args.kwargs,{'if_phase':'read-1'})

    def test_all_published_phases_have_bounded_nonempty_copy(self):
        self.assertEqual(len(CATALOG),9)
        self.assertEqual(sum(len(x['subtitles']) for x in CATALOG.values()),11)
        for name in PUBLIC_PHASES:
            self.assertIn(name,CATALOG)
        for copy in CATALOG.values():
            self.assertTrue(0<len(copy['title'])<=14)
            self.assertTrue(all(0<len(s)<=24 for s in copy['subtitles']))
