import os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from core import data_sink, adapter_loader
from core.run_logs import RunLogBuffer, RunLogRegistry, buffer_for

class PerformanceRepairs(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'CRAWSHRIMP_DATA': self.tmp.name})
        self.env.start()
    def tearDown(self):
        self.env.stop(); self.tmp.cleanup()
    def test_logs_bounded_incremental_restore_clear_and_full_download(self):
        logs = RunLogBuffer('fixture')
        for i in range(5000): logs.append(str(i))
        self.assertEqual(len(logs), 2000)
        first = logs.read()
        self.assertEqual(len(first['logs']), 500)
        self.assertTrue(first['truncated'])
        self.assertEqual(logs.read(first['cursor'], first['epoch'])['logs'], [])
        logs.append('last')
        self.assertEqual(logs.read(first['cursor'], first['epoch'])['logs'], ['last'])
        self.assertEqual(len(b''.join(logs.stream_text()).splitlines()), 5001)
        restored = RunLogBuffer('fixture')
        self.assertTrue(restored.read(first['cursor'], first['epoch'])['reset'])
        self.assertEqual(restored.next_cursor, 5001)
        restored.clear()
        self.assertTrue(restored.read(first['cursor'], first['epoch'])['reset'])
        self.assertEqual(b''.join(restored.stream_text()), b'')
    def test_huge_line_and_registry_bound(self):
        logs = RunLogBuffer('huge'); logs.append('x' * 2000000)
        self.assertLess(logs.bytes, 10000)
        self.assertEqual(len(b''.join(logs.stream_text())), 2000001)
        self.assertEqual(RunLogBuffer('huge').next_cursor, 1)
        registry = RunLogRegistry()
        for i in range(70): buffer_for(registry, str(i)).append('value')
        self.assertEqual(len(registry), 64)
        self.assertEqual(buffer_for(registry, '0').read()['logs'], ['value'])
    def test_latest_runs_single_connection_and_chunking(self):
        data_sink.init_db()
        with data_sink._get_conn() as conn:
            conn.executemany("INSERT INTO task_runs(adapter_id,task_id,status) VALUES(?,?,?)", [('a', str(i), 'running') for i in range(801)])
        last = data_sink.begin_run('a', '0')
        with patch.object(data_sink, '_get_conn', wraps=data_sink._get_conn) as connect:
            rows = data_sink.get_latest_runs([('a', str(i)) for i in range(802)])
            self.assertEqual(connect.call_count, 1)
        self.assertEqual(len(rows), 801)
        self.assertEqual(rows[('a','0')]['id'], last)
    def test_manifest_cache_invalidates_and_isolates_mutations(self):
        manifest = Path(self.tmp.name) / 'manifest.yaml'
        text = 'id: demo\nname: Demo\nversion: 1.0.0\nentry_url: https://example.com\ntasks: []\n'
        manifest.write_text(text)
        adapter_loader._read_manifest_file(manifest).name = 'Changed'
        with patch.object(adapter_loader.yaml, 'safe_load', wraps=adapter_loader.yaml.safe_load) as parse:
            self.assertEqual(adapter_loader._read_manifest_file(manifest).name, 'Demo')
            self.assertEqual(parse.call_count, 0)
            replacement = manifest.with_suffix('.tmp'); replacement.write_text(text.replace('Demo','Next')); replacement.replace(manifest)
            self.assertEqual(adapter_loader._read_manifest_file(manifest).name, 'Next')
            self.assertEqual(parse.call_count, 1)
