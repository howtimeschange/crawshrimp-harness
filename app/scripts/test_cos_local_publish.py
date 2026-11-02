"""Run the real CLI validator and pinned SDK against a loopback-only COS model."""
import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
import urllib.error
import urllib.request
from unittest import mock

import qcloud_cos
from qcloud_cos.cos_exception import CosServiceError

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('sdk_contract_fixture', HERE / 'test_cos_sdk_contract.py')
sdk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sdk)
mirror = sdk.mirror
REAL_OPEN, REAL_RUN = urllib.request.urlopen, subprocess.run
OLD_KEY = 'harness/releases/v0.4.9/crawshrimp-harness-v0.4.9-mac-arm64.dmg'


class LocalPublishTests(sdk.LocalCosCase):
    def fixture(self):
        tag, root = 'v0.4.10', self.root / 'release-assets'
        expected = mirror.release_names(tag)
        for index, (name, platform) in enumerate(expected.items()):
            path = root / platform / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'A' * (8 * 1024 * 1024 + 1) if index == 0 else (name + ' signed fixture').encode())
        for name, suffixes in [('latest-mac.yml', ['mac-arm64.zip', 'mac-x64.zip']), ('latest.yml', ['win-x64.exe'])]:
            platform = expected[name]
            lines = ['version: 0.4.10', 'files:']
            for suffix in suffixes:
                asset = f'crawshrimp-harness-{tag}-{suffix}'
                data = (root / platform / asset).read_bytes()
                digest = base64.b64encode(hashlib.sha512(data).digest()).decode()
                lines.extend([f'  - url: {asset}', f'    sha512: {digest}', f'    size: {len(data)}'])
            lines.extend([f'path: {asset}', f'sha512: {digest}'])
            (root / platform / name).write_text('\n'.join(lines) + '\n')
        release = {'id': 1, 'tag_name': tag, 'draft': False, 'prerelease': False,
                   'published_at': '2026-11-02T12:55:15Z', 'assets': [
                       {'name': name, 'size': (root / platform / name).stat().st_size,
                        'digest': 'sha256:' + mirror.digest_file(root / platform / name)}
                       for name, platform in expected.items()]}
        (self.root / 'release.json').write_text(json.dumps(release))
        self.server.objects[OLD_KEY] = (b'old signed bytes', {})
        return root, release

    def run_cli(self, skip_cleanup=True, upload_probe_only=False):
        argv = ['mirror', '--release-json', str(self.root / 'release.json'),
                '--latest-release-json', str(self.root / 'release.json'),
                '--assets-root', str(self.root / 'release-assets'), '--bucket', sdk.BUCKET,
                '--region', 'ap-guangzhou', '--base-url', 'https://downloads.example.com',
                '--output', str(self.root / 'mirror-result.json')]
        if skip_cleanup:
            argv.append('--skip-cleanup')
        if upload_probe_only:
            argv.append('--upload-probe-only')
        def public_open(request, **kwargs):
            url = request.full_url if isinstance(request, urllib.request.Request) else request
            if not url.startswith('https://downloads.example.com/'):
                raise AssertionError('Unexpected external URL in offline contract')
            url = self.base + url[len('https://downloads.example.com'):]
            local = urllib.request.Request(url, headers=dict(request.header_items())
                                           if isinstance(request, urllib.request.Request) else {})
            return REAL_OPEN(local, **kwargs)
        def validate(*args, **kwargs):
            return REAL_RUN(*args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
        with mock.patch('sys.argv', argv), mock.patch.dict('os.environ', {
                'TENCENT_SECRET_ID': 'local-fake-id', 'TENCENT_SECRET_KEY': 'local-fake-key',
                'TENCENT_TOKEN': 'local-fake-token'}), \
             mock.patch.object(qcloud_cos, 'CosConfig', return_value=self.client._conf), \
             mock.patch.object(qcloud_cos, 'CosS3Client', return_value=self.client), \
             mock.patch.object(mirror.urllib.request, 'urlopen', side_effect=public_open), \
             mock.patch.object(mirror.subprocess, 'run', side_effect=validate), mock.patch('sys.stdout', new=io.StringIO()):
            mirror.main()
        return json.loads((self.root / 'mirror-result.json').read_text())

    def test_full_cli_validator_sdk_metadata_skip_cleanup_and_idempotent_retry(self):
        root, release = self.fixture()
        result = self.run_cli()
        self.assertTrue(result['promoted'])
        self.assertTrue(result['cleanup_skipped'])
        self.assertEqual(result['deleted_old_objects'], [])
        self.assertEqual(len(result['uploaded']), 10)
        for forbidden in ('DeleteObject', 'GetBucket', 'ListMultipartUploads'):
            self.assertNotIn(forbidden, self.actions())
        self.assertEqual(self.server.objects[OLD_KEY][0], b'old signed bytes')
        for asset in release['assets']:
            body = self.server.objects['harness/releases/v0.4.10/' + asset['name']][0]
            self.assertEqual('sha256:' + hashlib.sha256(body).hexdigest(), asset['digest'])
        manifest = json.loads(self.server.objects['harness/latest/release.json'][0])
        self.assertEqual(len(manifest['assets']), 10)
        self.assertEqual(manifest['tag_name'], 'v0.4.10')
        for name in ('latest.yml', 'latest-mac.yml'):
            rewritten = self.server.objects['harness/latest/' + name][0].decode()
            self.assertIn('https://downloads.example.com/harness/releases/v0.4.10/', rewritten)
            self.assertEqual([s.strip() for s in rewritten.splitlines() if 'sha512:' in s],
                [s.strip() for s in (root / mirror.release_names('v0.4.10')[name] / name).read_text().splitlines() if 'sha512:' in s])
        self.server.events.clear()
        retry = self.run_cli()
        self.assertEqual(retry['uploaded'], [])
        self.assertEqual(len(retry['reused']), 10)
        self.assertNotIn('InitiateMultipartUpload', self.actions())
        self.assertTrue(all(not e['key'].startswith('harness/releases/') for e in self.server.events if e['action'] == 'PutObject'))
        self.assertNotIn('DeleteObject', self.actions())

    def test_minimal_multipart_probe_then_publication_reuses_only_approved_blockmap(self):
        root, release = self.fixture()
        probe = self.run_cli(upload_probe_only=True)
        candidates = [asset for asset in release['assets'] if asset['name'].endswith('.blockmap')]
        expected = min(candidates, key=lambda asset: asset['size'])
        self.assertEqual(probe['key'], 'harness/releases/v0.4.10/' + expected['name'])
        self.assertEqual(probe['size'], expected['size'])
        self.assertTrue(probe['multipart_exercised'])
        self.assertFalse(probe['promoted'])
        self.assertEqual(probe['deleted_old_objects'], [])
        self.assertEqual(self.actions().count('UploadPart'), 2)
        self.assertIn('CompleteMultipartUpload', self.actions())
        self.assertEqual(probe['large_part_probe']['part_size'], mirror.PART_SIZE)
        self.assertTrue(probe['large_part_probe']['aborted'])
        self.assertEqual(self.server.uploads, {})
        self.assertFalse(any(key.startswith('harness/latest/') for key in self.server.objects))
        self.assertEqual(set(self.server.objects), {OLD_KEY, probe['key']})
        self.server.events.clear()
        retry = self.run_cli(upload_probe_only=True)
        self.assertTrue(retry['reused'])
        self.assertFalse(retry['multipart_exercised'])
        self.assertEqual(self.actions().count('InitiateMultipartUpload'), 1)
        self.assertEqual(self.server.uploads, {})
        self.server.events.clear()
        published = self.run_cli()
        self.assertEqual(published['reused'], [probe['key']])
        self.assertEqual(len(published['uploaded']), 9)
        self.assertNotIn('DeleteObject', self.actions())

    def test_minimal_probe_public_failure_cannot_promote_metadata(self):
        self.fixture()
        self.server.deny_public_once = True
        with self.assertRaises(urllib.error.HTTPError):
            self.run_cli(upload_probe_only=True)
        self.assertFalse(any(key.startswith('harness/latest/') for key in self.server.objects))
        self.assertNotIn('DeleteObject', self.actions())

    def test_full_size_probe_abort_failure_blocks_all_feed_publication(self):
        self.fixture()
        self.server.fail_action, self.server.fail_count = 'AbortMultipartUpload', 1
        with self.assertRaises(CosServiceError):
            self.run_cli(upload_probe_only=True)
        self.assertFalse(any(key.startswith('harness/latest/') for key in self.server.objects))
        self.assertEqual(len(self.server.uploads), 1)
        self.assertEqual(len(self.server.objects), 2)  # Existing release plus verified blockmap only.
        self.assertNotIn('DeleteObject', self.actions())

    def test_minimal_probe_never_overwrites_a_conflicting_immutable_object(self):
        _, release = self.fixture()
        asset = min((a for a in release['assets'] if a['name'].endswith('.blockmap')), key=lambda a: a['size'])
        key = 'harness/releases/v0.4.10/' + asset['name']
        self.server.objects[key] = (b'conflicting bytes', {})
        with self.assertRaisesRegex(ValueError, 'Immutable COS object conflicts'):
            self.run_cli(upload_probe_only=True)
        self.assertEqual(self.server.objects[key][0], b'conflicting bytes')
        self.assertNotIn('InitiateMultipartUpload', self.actions())
        self.assertNotIn('PutObject', self.actions())

    def test_minimal_probe_rejects_current_newer_release_without_uploading(self):
        self.fixture()
        self.server.objects['harness/latest/release.json'] = (json.dumps({'tag_name': 'v0.4.11'}).encode(), {})
        with self.assertRaisesRegex(ValueError, 'latest stable release'):
            self.run_cli(upload_probe_only=True)
        self.assertNotIn('InitiateMultipartUpload', self.actions())
        self.assertNotIn('PutObject', self.actions())

    def test_public_failure_blocks_feeds_then_retry_reuses_completed_asset(self):
        self.fixture()
        self.server.deny_public_once = True
        with self.assertRaises(urllib.error.HTTPError):
            self.run_cli()
        self.assertFalse(any(key.startswith('harness/latest/') for key in self.server.objects))
        self.server.events.clear()
        result = self.run_cli()
        self.assertEqual(len(result['reused']), 1)
        self.assertEqual(len(result['uploaded']), 9)
        self.assertNotIn('InitiateMultipartUpload', self.actions())
        self.assertNotIn('DeleteObject', self.actions())

    def test_lost_completion_blocks_feeds_then_recovers_without_reupload(self):
        self.fixture()
        self.server.lose_completion_response = True
        with self.assertRaises(CosServiceError):
            self.run_cli()
        self.assertFalse(any(key.startswith('harness/latest/') for key in self.server.objects))
        self.server.events.clear()
        result = self.run_cli()
        self.assertEqual(len(result['reused']), 1)
        self.assertNotIn('InitiateMultipartUpload', self.actions())
        self.assertNotIn('DeleteObject', self.actions())

    def test_bad_uploaded_hash_metadata_cannot_promote_feeds(self):
        self.fixture()
        self.server.corrupt_head = True
        with self.assertRaisesRegex(ValueError, 'COS upload verification failed'):
            self.run_cli()
        self.assertFalse(any(key.startswith('harness/latest/') for key in self.server.objects))
        self.assertNotIn('DeleteObject', self.actions())

    def test_corrupt_release_bytes_fail_real_node_validation_before_any_sdk_request(self):
        root, _ = self.fixture()
        (root / 'windows/crawshrimp-harness-v0.4.10-win-x64.exe').write_bytes(b'corrupt')
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_cli()
        self.assertEqual(self.server.events, [])

    def test_default_cleanup_still_removes_only_verified_older_formal_assets(self):
        self.fixture()
        result = self.run_cli(skip_cleanup=False)
        self.assertFalse(result['cleanup_skipped'])
        self.assertEqual(result['deleted_old_objects'], [OLD_KEY])
        self.assertNotIn(OLD_KEY, self.server.objects)
        deletes = [e['key'] for e in self.server.events if e['action'] == 'DeleteObject']
        self.assertEqual(deletes, [OLD_KEY])
        self.assertEqual(len([k for k in self.server.objects if k.startswith('harness/releases/v0.4.10/')]), 10)


if __name__ == '__main__':
    unittest.main()
