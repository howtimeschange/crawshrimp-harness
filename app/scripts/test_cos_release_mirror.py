import base64
import copy
import hashlib
import importlib.util
import json
import io
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest import mock
import urllib.parse


HERE = Path(__file__).parent


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mirror = load_script("mirror-release-to-cos")
oidc = load_script("tencent-oidc-credentials")
access = load_script("verify-cos-release-access")
BASE = "https://downloads.example.com"


class MemoryStore:
    def __init__(self, current=None):
        self.current, self.objects, self.events = current, {}, []
        self.fail_key = None

    def read_json(self, key):
        return self.current

    def head(self, key):
        return self.objects.get(key)

    def upload(self, item):
        self.events.append(("upload", item["key"]))
        if item["key"] == self.fail_key:
            raise RuntimeError("Upload disconnected")
        self.objects[item["key"]] = {"Content-Length": item["size"], "x-cos-meta-sha256": item["sha256"]}

    def put_bytes(self, key, body, content_type):
        self.events.append(("metadata", key))
        if key.endswith("release.json"):
            self.current = json.loads(body)


class MirrorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root, self.tag = Path(self.temp.name), "v0.4.10"
        self.expected = mirror.release_names(self.tag)
        self.release = {"id": 1, "tag_name": self.tag, "draft": False, "prerelease": False,
                        "published_at": "2026-11-02T08:10:06Z", "assets": []}
        for name, platform in self.expected.items():
            path = self.root / platform / name
            path.parent.mkdir(exist_ok=True)
            path.write_bytes((name + " signed original bytes").encode())
        for name, suffixes in [("latest-mac.yml", ["mac-arm64.zip", "mac-x64.zip"]),
                               ("latest.yml", ["win-x64.exe"])]:
            platform = self.expected[name]
            lines = ["version: 0.4.10", "files:"]
            for suffix in suffixes:
                asset = f"crawshrimp-harness-{self.tag}-{suffix}"
                data = (self.root / platform / asset).read_bytes()
                digest = base64.b64encode(hashlib.sha512(data).digest()).decode()
                lines.extend([f"  - url: {asset}", f"    sha512: {digest}", f"    size: {len(data)}"])
            lines.extend([f"path: {asset}", f"sha512: {digest}"])
            (self.root / platform / name).write_text("\n".join(lines) + "\n")
        self.refresh_assets()
        self.latest = copy.deepcopy(self.release)

    def refresh_assets(self):
        self.release["assets"] = [{"name": name, "size": (self.root / platform / name).stat().st_size,
                                    "digest": "sha256:" + mirror.digest_file(self.root / platform / name)}
                                   for name, platform in self.expected.items()]

    def plan(self):
        return mirror.build_plan(self.release, self.latest, self.root, BASE)

    def test_preserves_signed_bytes_and_binds_each_update_to_immutable_files(self):
        plan = self.plan()
        self.assertEqual(len(plan["objects"]), 10)
        self.assertEqual(plan["metadata"]["latest-mac.yml"].count(b"/harness/releases/v0.4.10/"), 3)
        for item in plan["objects"]:
            self.assertEqual(mirror.digest_file(Path(item["path"])), item["sha256"])
        source = (self.root / "macos/latest-mac.yml").read_text()
        self.assertEqual([line for line in source.splitlines() if "sha512:" in line],
                         [line for line in plan["metadata"]["latest-mac.yml"].decode().splitlines() if "sha512:" in line])

    def test_rejects_draft_prerelease_and_nonstable_tags(self):
        for change in ({"draft": True}, {"prerelease": True}, {"tag_name": "v0.4.11-rc.1"},
                       {"tag_name": "v0.04.10"}, {"published_at": None}):
            with self.subTest(change=change):
                original = self.release
                self.release = {**original, **change}
                with self.assertRaises(ValueError):
                    self.plan()
                self.release = original

    def test_corrupt_or_wrong_size_file_is_rejected_before_upload(self):
        path = self.root / "windows" / f"crawshrimp-harness-{self.tag}-win-x64.exe"
        data = path.read_bytes()
        path.write_bytes(b"X" + data[1:])
        with self.assertRaisesRegex(ValueError, "SHA256"):
            self.plan()

    def test_rejects_missing_extra_or_duplicate_release_assets(self):
        original = copy.deepcopy(self.release["assets"])
        for assets in (original[:-1], original + [original[0]], original[:-1] + [original[0]]):
            self.release["assets"] = assets
            with self.assertRaisesRegex(ValueError, "asset set"):
                self.plan()

    def test_rejects_escaped_or_unexpected_local_files(self):
        path = self.root / "macos/other-file"
        path.symlink_to(__file__)
        with self.assertRaisesRegex(ValueError, "symlinks"):
            self.plan()
        path.unlink()
        path.write_text("debug file")
        with self.assertRaisesRegex(ValueError, "artifact set"):
            self.plan()

    def test_rejects_arbitrary_metadata_urls_and_wrong_versions(self):
        for value in ("https://evil.example.com/app.exe", "../app.exe"):
            source = "version: 0.4.10\nfiles:\n  - url: " + value + "\n"
            with self.assertRaisesRegex(ValueError, "unexpected updater"):
                mirror.rewrite_metadata(source, "latest.yml", self.tag, BASE)
        with self.assertRaisesRegex(ValueError, "version"):
            mirror.rewrite_metadata("version: 0.4.9\n", "latest.yml", self.tag, BASE)

    def test_rejects_insecure_public_urls_and_object_prefixes(self):
        for base in ("http://downloads.example.com", "https://user:pass@example.com", "https://x/a/../b", "https://x/?token=secret"):
            with self.subTest(base=base), self.assertRaises(ValueError):
                mirror.build_plan(self.release, self.latest, self.root, base)
        for prefix in ("../harness", "/harness", "harness//latest"):
            with self.subTest(prefix=prefix), self.assertRaises(ValueError):
                mirror.build_plan(self.release, self.latest, self.root, BASE, prefix)

    def test_no_feed_is_published_when_asset_upload_fails(self):
        plan, store = self.plan(), MemoryStore()
        store.fail_key = plan["objects"][2]["key"]
        with self.assertRaisesRegex(RuntimeError, "disconnected"):
            mirror.publish(plan, store, lambda *_: None)
        self.assertFalse(any(event[0] == "metadata" for event in store.events))

    def test_public_access_failure_blocks_feed_promotion(self):
        store = MemoryStore()
        def deny(*_):
            raise PermissionError("Public download denied")
        with self.assertRaises(PermissionError):
            mirror.publish(self.plan(), store, deny)
        self.assertFalse(any(event[0] == "metadata" for event in store.events))

    def test_retry_reuses_verified_objects_and_manifest_is_last(self):
        plan, store = self.plan(), MemoryStore()
        first = mirror.publish(plan, store, lambda *_: None)
        self.assertTrue(first["promoted"])
        self.assertEqual(store.events[-1], ("metadata", "harness/latest/release.json"))
        self.assertTrue(all(event[0] == "upload" for event in store.events[:10]))
        second = mirror.publish(plan, store, lambda *_: None)
        self.assertEqual(second["uploaded"], [])
        self.assertEqual(len(second["reused"]), 10)
        self.assertEqual(sum(event[0] == "upload" for event in store.events), 10)

    def test_conflicting_immutable_object_is_never_overwritten(self):
        plan, store = self.plan(), MemoryStore()
        store.objects[plan["objects"][0]["key"]] = {"Content-Length": 1, "x-cos-meta-sha256": "wrong"}
        with self.assertRaisesRegex(ValueError, "Immutable COS object conflicts"):
            mirror.publish(plan, store, lambda *_: None)
        self.assertEqual(store.events, [])

    def test_manual_older_backfill_does_not_create_or_downgrade_latest(self):
        self.latest["tag_name"] = "v0.4.11"
        for current in (None, {"tag_name": "v0.4.12"}):
            store = MemoryStore(current)
            result = mirror.publish(self.plan(), store, lambda *_: None)
            self.assertFalse(result["promoted"])
            self.assertFalse(any(event[0] == "metadata" for event in store.events))

    def test_existing_newer_cos_manifest_prevents_rollback_even_with_stale_github(self):
        store = MemoryStore({"tag_name": "v0.5.0"})
        self.assertFalse(mirror.publish(self.plan(), store, lambda *_: None)["promoted"])

    def test_public_range_verifies_bytes_and_total_download_size(self):
        path = self.root / 'range-fixture'
        path.write_bytes(b'A' * 5000)
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 206
        response.headers = {'Content-Range': 'bytes 0-4095/5000'}
        response.read.return_value = b'A' * 4096
        with mock.patch.object(mirror.urllib.request, 'urlopen', return_value=response):
            mirror.verify_public_range(BASE, path)
            response.headers['Content-Range'] = 'bytes 0-4095/9000'
            with self.assertRaisesRegex(ValueError, 'Public COS download'):
                mirror.verify_public_range(BASE, path)
            response.headers['Content-Range'] = 'bytes 0-4095/5000'
            response.read.return_value = b'B' * 4096
            with self.assertRaisesRegex(ValueError, 'Public COS download'):
                mirror.verify_public_range(BASE, path)

    def test_public_probe_rejects_ignored_range_for_large_objects(self):
        path = self.root / 'range-fixture'
        path.write_bytes(b'A' * 5000)
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.status, response.headers = 200, {'Content-Length': '5000'}
        response.read.return_value = b'A' * 4096
        with mock.patch.object(mirror.urllib.request, 'urlopen', return_value=response), self.assertRaises(ValueError):
            mirror.verify_public_range(BASE, path)

    def test_cleanup_only_deletes_older_formal_asset_keys_after_promotion(self):
        plan, store = self.plan(), MemoryStore()
        mirror.publish(plan, store, lambda *_: None)
        keys = ['harness/releases/v0.4.9/crawshrimp-harness-v0.4.9-mac-arm64.dmg',
                'harness/releases/v0.4.10/crawshrimp-harness-v0.4.10-mac-arm64.dmg',
                'harness/releases/v0.4.11/crawshrimp-harness-v0.4.11-mac-arm64.dmg',
                'harness/releases/v0.4.9/unknown.txt', 'harness/latest/release.json']
        store.list_keys = lambda prefix: (key for key in keys if key.startswith(prefix))
        deleted = []
        store.delete = lambda key: deleted.append(key)
        self.assertEqual(mirror.prune_old_releases(plan, store), [keys[0]])
        self.assertEqual(deleted, [keys[0]])
        store.current = {'tag_name': 'v0.4.11'}
        with self.assertRaisesRegex(ValueError, 'manifest changed'):
            mirror.prune_old_releases(plan, store)

    def test_skip_cleanup_promotes_verified_assets_without_any_list_or_delete(self):
        plan, store = self.plan(), MemoryStore()
        # MemoryStore has no list_keys/delete: any cleanup would fail this smoke test.
        release_path, latest_path = self.root / 'release.json', self.root / 'upstream.json'
        release_path.write_text(json.dumps(self.release))
        latest_path.write_text(json.dumps(self.latest))
        output = self.root / 'result.json'
        argv = ['mirror-release-to-cos.py', '--release-json', str(release_path),
                '--latest-release-json', str(latest_path), '--assets-root', str(self.root),
                '--bucket', 'release-bucket', '--region', 'ap-guangzhou', '--base-url', BASE,
                '--skip-cleanup', '--output', str(output)]
        public_bodies = [*plan['metadata'].values(), json.dumps(plan['manifest']).encode()]
        sdk = SimpleNamespace(CosConfig=mock.Mock(), CosS3Client=mock.Mock())
        with mock.patch('sys.argv', argv), mock.patch.dict('sys.modules', {'qcloud_cos': sdk}), \
             mock.patch.dict(mirror.os.environ, {'TENCENT_SECRET_ID': 'fake-id', 'TENCENT_SECRET_KEY': 'fake-key'}), \
             mock.patch.object(mirror.subprocess, 'run'), mock.patch.object(mirror, 'build_plan', return_value=plan), \
             mock.patch.object(mirror, 'CosStore', return_value=store), \
             mock.patch.object(mirror, 'verify_public_range'), \
             mock.patch.object(mirror.urllib.request, 'urlopen', side_effect=[io.BytesIO(b) for b in public_bodies]), \
             mock.patch('builtins.print'):
            mirror.main()
        result = json.loads(output.read_text())
        self.assertTrue(result['promoted'])
        self.assertTrue(result['cleanup_skipped'])
        self.assertEqual(result['deleted_old_objects'], [])
        self.assertEqual(len(result['uploaded']), 10)


class OidcTests(unittest.TestCase):
    def setUp(self):
        self.env = {"GITHUB_REPOSITORY": "howtimeschange/crawshrimp-harness", "GITHUB_REF": "refs/heads/main",
                    "ACTIONS_ID_TOKEN_REQUEST_URL": "https://token.actions.example/request?api-version=2",
                    "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "fake-github-request-capability",
                    "COS_OIDC_PROVIDER": "github-harness-releases", "GITHUB_RUN_ID": "123",
                    "COS_ROLE_ARN": "qcs::cam::uin/793301325:roleName/harness-release-ci"}

    def test_oidc_exchange_uses_explicit_audience_and_sts_skip_authorization(self):
        requests = []
        def request(url, **kwargs):
            requests.append((url, kwargs))
            if len(requests) == 1:
                return {"value": "fake-oidc-token"}
            return {"Response": {"Credentials": {"TmpSecretId": "id", "TmpSecretKey": "key", "Token": "session"}}}
        result = oidc.exchange(self.env, request)
        self.assertIn("audience=sts.tencentcloudapi.com", requests[0][0])
        self.assertEqual(requests[1][1]["headers"]["Authorization"], "SKIP")
        self.assertNotIn("X-TC-Token", requests[1][1]["headers"])
        body = json.loads(requests[1][1]["body"])
        self.assertEqual(body["DurationSeconds"], 3600)
        self.assertEqual(body["WebIdentityToken"], "fake-oidc-token")
        self.assertEqual(set(result), {"TENCENT_SECRET_ID", "TENCENT_SECRET_KEY", "TENCENT_TOKEN"})

    def test_wrong_repository_or_pull_request_cannot_request_credentials(self):
        for change in ({"GITHUB_REPOSITORY": "attacker/harness"}, {"GITHUB_REF": "refs/pull/1/merge"},
                       {"GITHUB_REF": "refs/tags/v0.4.11-rc.1"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                oidc.exchange({**self.env, **change}, lambda *_args, **_kwargs: self.fail("Unexpected network request"))

    def test_sts_error_does_not_echo_credential_or_request_tokens(self):
        responses = iter([{"value": "fake-oidc-token"}, {"Response": {"Error": {
            "Code": "AuthFailure", "Message": "message with fake-oidc-token"}}}])
        with self.assertRaisesRegex(RuntimeError, "AuthFailure") as caught:
            oidc.exchange(self.env, lambda *_args, **_kwargs: next(responses))
        self.assertNotIn("fake-oidc-token", str(caught.exception))

    def test_actual_trust_requires_github_issuer_audience_and_exact_repository(self):
        trust = json.loads((HERE.parent.parent / 'docs/tencent-cos-release-trust.json').read_text())['statement'][0]
        self.assertEqual(trust['condition']['string_equal']['oidc:iss'], 'https://token.actions.githubusercontent.com')
        self.assertEqual(trust['condition']['string_equal']['oidc:aud'], 'sts.tencentcloudapi.com')
        subjects = trust['condition']['string_like']['oidc:sub']
        self.assertEqual(len(subjects), 2)
        self.assertTrue(all(subject.startswith('repo:howtimeschange@4083536/crawshrimp-harness@1334537867:ref:refs/') for subject in subjects))
        policy = json.loads((HERE.parent.parent / 'docs/tencent-cos-release-policy.json').read_text())['statement'][0]
        self.assertEqual(policy['resource'], ['qcs::cos:ap-guangzhou:uid/1252445586:crawshrimp-harness-releases-1252445586/harness/*'])
        self.assertTrue(all('Delete' not in action and 'Bucket' not in action and '*' not in action for action in policy['action']))
        statements = json.loads((HERE.parent.parent / 'docs/tencent-cos-release-policy.json').read_text())['statement']
        self.assertEqual(statements[1]['action'], ['name/cos:DeleteObject'])
        self.assertTrue(statements[1]['resource'][0].endswith('/harness/releases/*'))
        self.assertEqual(statements[2]['condition'], {'string_equal': {'cos:prefix': 'harness%2Freleases%2F'}})


class CosAccessTests(unittest.TestCase):
    def test_list_policy_matches_encoded_request_and_only_release_directory(self):
        statements = json.loads((HERE.parent.parent / 'docs/tencent-cos-release-policy.json').read_text())['statement']
        listing = [statement for statement in statements if 'name/cos:GetBucket' in statement['action']]
        self.assertEqual(len(listing), 1)
        self.assertEqual(listing[0]['effect'], 'allow')
        self.assertEqual(listing[0]['action'], ['name/cos:GetBucket'])
        self.assertEqual(listing[0]['resource'], [
            'qcs::cos:ap-guangzhou:uid/1252445586:crawshrimp-harness-releases-1252445586/*'])
        # COS evaluates prefix conditions against the URL-encoded query value.
        self.assertEqual(listing[0]['condition'], {'string_equal': {
            'cos:prefix': urllib.parse.quote(access.RELEASE_PREFIX, safe='')}})
        for prefix in access.DENIED_PREFIXES:
            self.assertNotEqual(urllib.parse.quote(prefix or '', safe=''),
                             listing[0]['condition']['string_equal']['cos:prefix'])
        self.assertEqual(sum('name/cos:GetBucket' in s['action'] for s in statements), 1)

    @staticmethod
    def denied(status=403, code='AccessDenied'):
        error = RuntimeError('COS rejected the request')
        error.get_status_code = lambda: status
        error.get_error_code = lambda: code
        return error

    def test_access_probe_checks_allowed_and_denied_boundaries_using_only_list(self):
        client = mock.Mock(spec=['list_objects'])
        client.list_objects.side_effect = [{}, *[self.denied() for _ in access.DENIED_PREFIXES]]
        access.verify_access(client, 'release-bucket')
        calls = [mock.call(Bucket='release-bucket', Prefix='harness/releases/', MaxKeys=1)]
        calls.extend(mock.call(**{'Bucket': 'release-bucket', 'MaxKeys': 1,
                                  **({'Prefix': prefix} if prefix is not None else {})})
                     for prefix in access.DENIED_PREFIXES)
        self.assertEqual(client.list_objects.call_args_list, calls)

    def test_access_probe_stops_immediately_if_allowed_prefix_is_denied(self):
        client = mock.Mock(spec=['list_objects'])
        client.list_objects.side_effect = self.denied()
        with self.assertRaises(RuntimeError):
            access.verify_access(client, 'release-bucket')
        self.assertEqual(client.list_objects.call_count, 1)

    def test_access_probe_fails_closed_for_each_unexpectedly_allowed_prefix(self):
        for index, prefix in enumerate(access.DENIED_PREFIXES):
            with self.subTest(prefix=prefix):
                client = mock.Mock(spec=['list_objects'])
                client.list_objects.side_effect = [{}, *[self.denied() for _ in range(index)], {}]
                with self.assertRaisesRegex(RuntimeError, 'exceeds the release-directory boundary'):
                    access.verify_access(client, 'release-bucket')
                self.assertEqual(client.list_objects.call_count, index + 2)

    def test_access_probe_does_not_mistake_auth_or_server_errors_for_a_scoped_denial(self):
        for error in (self.denied(403, 'SignatureDoesNotMatch'), self.denied(500, 'InternalError'),
                      TimeoutError('network timeout')):
            with self.subTest(error=error):
                client = mock.Mock(spec=['list_objects'])
                client.list_objects.side_effect = [{}, error]
                with self.assertRaises(type(error)) as caught:
                    access.verify_access(client, 'release-bucket')
                self.assertIs(caught.exception, error)


class CosUploadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'asset.zip'
        self.client = mock.Mock(spec=['put_object', 'create_multipart_upload', 'upload_part',
                                      'complete_multipart_upload', 'abort_multipart_upload'])
        self.client.create_multipart_upload.return_value = {'UploadId': 'new-upload-only'}
        self.store = mirror.CosStore(self.client, 'release-bucket')

    def item(self, data):
        self.path.write_bytes(data)
        return {'name': self.path.name, 'path': str(self.path), 'key': 'harness/releases/v0.4.10/asset.zip',
                'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

    def test_small_asset_uses_md5_checked_object_upload_with_immutable_metadata(self):
        item = self.item(b'signed original bytes')
        received = []
        self.client.put_object.side_effect = lambda **kwargs: received.append(kwargs['Body'].read())
        self.store.upload(item)
        self.assertEqual(received, [b'signed original bytes'])
        call = self.client.put_object.call_args.kwargs
        self.assertTrue(call['EnableMD5'])
        self.assertEqual(call['Bucket'], 'release-bucket')
        self.assertEqual(call['Key'], item['key'])
        self.assertEqual(call['Metadata'], {'x-cos-meta-sha256': item['sha256']})
        self.assertIn('immutable', call['CacheControl'])
        self.assertEqual(call['StorageClass'], 'STANDARD')
        self.client.create_multipart_upload.assert_not_called()

    def test_large_asset_preserves_bytes_md5_and_order_without_listing_remote_uploads(self):
        data = b'A' * (8 * 1024 * 1024) + b'B' * (8 * 1024 * 1024) + b'C' * 17
        item, received = self.item(data), {}
        second_started = threading.Event()
        def upload(**kwargs):
            number = kwargs['PartNumber']
            if number == 1:
                self.assertTrue(second_started.wait(5))
            elif number == 2:
                second_started.set()
            received[number] = kwargs['Body']
            self.assertTrue(kwargs['EnableMD5'])
            self.assertEqual(kwargs['UploadId'], 'new-upload-only')
            self.assertEqual(kwargs['Bucket'], 'release-bucket')
            self.assertEqual(kwargs['Key'], item['key'])
            return {'eTaG': f'"part-{number}"'}
        self.client.upload_part.side_effect = upload
        self.store.upload(item)
        self.assertEqual(b''.join(received[n] for n in sorted(received)), data)
        self.assertEqual([len(received[n]) for n in sorted(received)], [8 * 1024 * 1024, 8 * 1024 * 1024, 17])
        self.assertEqual(self.client.create_multipart_upload.call_args.kwargs['Metadata'],
                         {'x-cos-meta-sha256': item['sha256']})
        self.assertEqual(self.client.complete_multipart_upload.call_args.kwargs['MultipartUpload'],
                         {'Part': [{'PartNumber': n, 'ETag': f'"part-{n}"'} for n in range(1, 4)]})
        self.client.abort_multipart_upload.assert_not_called()

    def test_failed_part_aborts_only_the_new_upload_and_never_completes(self):
        item = self.item(b'A' * (8 * 1024 * 1024 + 1))
        failure = RuntimeError('part upload disconnected')
        self.client.upload_part.side_effect = failure
        with self.assertRaises(RuntimeError) as caught:
            self.store.upload(item)
        self.assertIs(caught.exception, failure)
        self.client.complete_multipart_upload.assert_not_called()
        self.client.abort_multipart_upload.assert_called_once_with(
            Bucket='release-bucket', Key=item['key'], UploadId='new-upload-only')

    def test_failed_completion_preserves_error_even_if_abort_also_fails(self):
        item = self.item(b'A' * (8 * 1024 * 1024 + 1))
        self.client.upload_part.return_value = {'ETag': 'part-etag'}
        failure = RuntimeError('completion response lost')
        self.client.complete_multipart_upload.side_effect = failure
        self.client.abort_multipart_upload.side_effect = RuntimeError('abort failed')
        with self.assertRaises(RuntimeError) as caught:
            self.store.upload(item)
        self.assertIs(caught.exception, failure)
        self.client.abort_multipart_upload.assert_called_once_with(
            Bucket='release-bucket', Key=item['key'], UploadId='new-upload-only')

    def test_failed_initiation_does_not_abort_any_existing_upload(self):
        item = self.item(b'A' * (8 * 1024 * 1024 + 1))
        self.client.create_multipart_upload.side_effect = RuntimeError('initiate denied')
        with self.assertRaisesRegex(RuntimeError, 'initiate denied'):
            self.store.upload(item)
        self.client.upload_part.assert_not_called()
        self.client.complete_multipart_upload.assert_not_called()
        self.client.abort_multipart_upload.assert_not_called()

    def test_truncated_file_cannot_complete_or_publish_partial_bytes(self):
        item = self.item(b'A' * (8 * 1024 * 1024 + 1))
        self.path.write_bytes(b'A')
        with self.assertRaisesRegex(ValueError, 'changed during multipart upload'):
            self.store.upload(item)
        self.client.complete_multipart_upload.assert_not_called()
        self.client.abort_multipart_upload.assert_called_once()


if __name__ == "__main__":
    unittest.main()
