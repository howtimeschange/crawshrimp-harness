"""Offline HTTP contracts with the pinned SDK; never contacts Tencent or uses real keys.

Run after installing cos-release-requirements.txt. The local policy evaluator only
models the checked-in policy subset; it is not a replacement for Tencent IAM.
"""
import base64
import fnmatch
import hashlib
import importlib.util
import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from unittest import mock

import requests
from qcloud_cos import CosConfig, CosS3Client
from qcloud_cos.cos_exception import CosServiceError

HERE = Path(__file__).parent
def script(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

mirror = script('mirror-release-to-cos')
access = script('verify-cos-release-access')
BUCKET = 'crawshrimp-harness-releases-1252445586'
RESOURCE = 'qcs::cos:ap-guangzhou:uid/1252445586:' + BUCKET + '/'


class LocalCos(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self):
        super().__init__(('127.0.0.1', 0), Handler)
        self.policy = json.loads((HERE.parent.parent / 'docs/tencent-cos-release-policy.json').read_text())
        self.objects, self.uploads, self.events = {}, {}, []
        self.lock = threading.Lock()
        self.fail_action, self.fail_count, self.corrupt_head = None, 0, False
        self.lose_completion_response = False
        self.deny_public_once = False

    def allowed(self, action, key, raw_prefix):
        for statement in self.policy['statement']:
            if ('name/cos:' + action not in statement['action'] or
                not any(fnmatch.fnmatchcase(RESOURCE + key, resource) for resource in statement['resource'])):
                continue
            expected = statement.get('condition', {}).get('string_equal', {}).get('cos:prefix')
            if expected is not None and raw_prefix not in (expected if isinstance(expected, list) else [expected]):
                continue
            return statement['effect'] == 'allow'
        return False


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *_):
        pass

    def response(self, status=200, body=b'', headers=None):
        self.send_response(status)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('x-cos-request-id', 'local-contract-only')
        for key, value in (headers or {}).items():
            self.send_header(key, str(value))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def error(self, code='AccessDenied', status=403):
        root = ET.Element('Error')
        for key, value in [('Code', code), ('Message', 'local contract response'), ('Resource', self.path),
                           ('RequestId', 'local-contract-only')]:
            ET.SubElement(root, key).text = value
        self.response(status, ET.tostring(root), {'Content-Type': 'application/xml'})

    def handle_request(self):
        parsed = urllib.parse.urlsplit(self.path)
        key = urllib.parse.unquote(parsed.path.lstrip('/'))
        query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        raw_prefix = next((part.split('=', 1)[1] for part in parsed.query.split('&')
                           if part.startswith('prefix=')), None)
        multipart = 'uploadId' in query
        action = { 'HEAD': 'HeadObject', 'GET': 'GetObject', 'PUT': 'PutObject',
                   'POST': 'InitiateMultipartUpload', 'DELETE': 'DeleteObject'}[self.command]
        if self.command == 'GET' and 'uploads' in query:
            action = 'ListMultipartUploads'
        elif self.command == 'GET' and not key:
            action = 'GetBucket'
        elif multipart:
            action = {'PUT': 'UploadPart', 'POST': 'CompleteMultipartUpload',
                      'DELETE': 'AbortMultipartUpload'}[self.command]
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        signed = bool(self.headers.get('Authorization'))
        with self.server.lock:
            self.server.events.append({'action': action, 'key': key, 'raw_prefix': raw_prefix,
                                       'signed': signed, 'md5': self.headers.get('Content-MD5')})
            allowed = (self.server.allowed(action, key, raw_prefix) if signed else
                       action == 'GetObject' and key.startswith('harness/'))
            if not allowed:
                return self.error()
            if not signed and self.server.deny_public_once:
                self.server.deny_public_once = False
                return self.error()
            if action == self.server.fail_action and self.server.fail_count:
                self.server.fail_count -= 1
                return self.error('InternalError', 500)
            if action in ('PutObject', 'UploadPart'):
                if self.headers.get('Content-MD5') != base64.b64encode(hashlib.md5(body).digest()).decode():
                    return self.error('BadDigest', 400)
            metadata = {k: v for k, v in self.headers.items()
                        if k.lower().startswith('x-cos-meta-') or k.lower() in ('cache-control', 'content-disposition')}
            if action == 'PutObject':
                self.server.objects[key] = (body, metadata)
                return self.response(headers={'ETag': '"' + hashlib.md5(body).hexdigest() + '"'})
            if action == 'InitiateMultipartUpload':
                upload_id = 'local-upload-' + str(len(self.server.events))
                self.server.uploads[upload_id] = {'key': key, 'parts': {}, 'metadata': metadata}
                return self.response(body=f'<InitiateMultipartUploadResult><UploadId>{upload_id}</UploadId></InitiateMultipartUploadResult>'.encode())
            if multipart:
                upload_id = query['uploadId'][0]
                upload = self.server.uploads.get(upload_id)
                if not upload or upload['key'] != key:
                    return self.error('NoSuchUpload', 404)
                if action == 'UploadPart':
                    upload['parts'][int(query['partNumber'][0])] = body
                    return self.response(headers={'ETag': '"' + hashlib.md5(body).hexdigest() + '"'})
                if action == 'AbortMultipartUpload':
                    del self.server.uploads[upload_id]
                    return self.response(204)
                numbers = []
                for part in ET.fromstring(body).findall('Part'):
                    number = int(part.findtext('PartNumber'))
                    if part.findtext('ETag').strip('"') != hashlib.md5(upload['parts'][number]).hexdigest():
                        return self.error('InvalidPart', 400)
                    numbers.append(number)
                if numbers != sorted(upload['parts']):
                    return self.error('InvalidPartOrder', 400)
                data = b''.join(upload['parts'][number] for number in numbers)
                self.server.objects[key] = (data, upload['metadata'])
                del self.server.uploads[upload_id]
                if self.server.lose_completion_response:
                    self.server.lose_completion_response = False
                    return self.error('InternalError', 500)
                return self.response(body=b'<CompleteMultipartUploadResult><ETag>"complete"</ETag></CompleteMultipartUploadResult>')
            if action == 'GetBucket':
                root = ET.Element('ListBucketResult')
                ET.SubElement(root, 'IsTruncated').text = 'false'
                for name in sorted(self.server.objects):
                    if name.startswith(query.get('prefix', [''])[0]):
                        ET.SubElement(ET.SubElement(root, 'Contents'), 'Key').text = name
                return self.response(body=ET.tostring(root))
            if key not in self.server.objects:
                return self.error('NoSuchKey', 404)
            data, metadata = self.server.objects[key]
            if action == 'DeleteObject':
                del self.server.objects[key]
                return self.response(204)
            if action == 'HeadObject':
                headers = {**metadata, 'Content-Length': str(len(data))}
                if self.server.corrupt_head:
                    headers['x-cos-meta-sha256'] = 'corrupt'
                # HEAD represents the object's length, without sending its bytes.
                self.send_response(200)
                self.send_header('x-cos-request-id', 'local-contract-only')
                for name, value in headers.items():
                    self.send_header(name, value)
                self.end_headers()
                return
            if self.headers.get('Range'):
                end = min(int(self.headers['Range'].split('-')[1]), len(data) - 1)
                return self.response(206, data[:end + 1], {'Content-Range': f'bytes 0-{end}/{len(data)}'})
            return self.response(body=data)

    do_GET = do_HEAD = do_PUT = do_POST = do_DELETE = handle_request


class LocalCosCase(unittest.TestCase):
    def setUp(self):
        self.server = LocalCos()
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'
        self.session = requests.Session()
        self.session.trust_env = False
        self.client = CosS3Client(CosConfig(Region='ap-guangzhou', SecretId='local-fake-id',
            SecretKey='local-fake-key', Token='local-fake-token', Scheme='http',
            Domain=f'127.0.0.1:{self.server.server_port}', Timeout=3), retry=0, session=self.session)
        self.store = mirror.CosStore(self.client, BUCKET)
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        logging.getLogger('qcloud_cos').setLevel(logging.CRITICAL)

    def tearDown(self):
        self.session.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(3)

    def item(self, data=b'signed local fixture', name='asset.zip'):
        path = self.root / name
        path.write_bytes(data)
        return {'name': name, 'path': str(path), 'key': 'harness/releases/v0.4.10/' + name,
                'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

    def actions(self):
        return [e['action'] for e in self.server.events]


class SdkContractTests(LocalCosCase):
    def test_real_sdk_reproduces_original_implicit_bucket_query_failure(self):
        item = self.item(b'A' * (8 * 1024 * 1024 + 1))
        with self.assertRaises(CosServiceError) as caught:
            self.client.upload_file(Bucket=BUCKET, Key=item['key'], LocalFilePath=item['path'], PartSize=8, EnableMD5=True)
        self.assertEqual(caught.exception.get_error_code(), 'AccessDenied')
        self.assertEqual(self.actions(), ['ListMultipartUploads'])
        self.assertEqual(self.server.uploads, {})

    def test_actual_signed_query_encoding_and_all_permission_boundaries(self):
        access.verify_access(self.client, BUCKET)
        self.assertEqual(self.actions(), ['GetBucket'] * 6)
        self.assertEqual(self.server.events[0]['raw_prefix'], 'harness%2Freleases%2F')
        self.assertTrue(all(e['signed'] for e in self.server.events))
        with self.assertRaises(CosServiceError):
            self.client.put_object(Bucket=BUCKET, Key='unrelated/asset', Body=b'x', EnableMD5=True)

    def test_small_object_real_sdk_md5_metadata_and_byte_readback(self):
        item = self.item()
        self.store.upload(item)
        self.assertTrue(mirror.same_object(self.store.head(item['key']), item['size'], item['sha256']))
        data, metadata = self.server.objects[item['key']]
        self.assertEqual(data, Path(item['path']).read_bytes())
        self.assertEqual(metadata['x-cos-meta-sha256'], item['sha256'])
        self.assertEqual(self.actions(), ['PutObject', 'HeadObject'])

    def test_large_object_real_sdk_fresh_multipart_md5_order_and_readback(self):
        data = b'A' * (1024 * 1024) + b'B' * 19
        item = self.item(data)
        self.store.upload(item)
        self.assertEqual(self.server.objects[item['key']][0], data)
        self.assertEqual(self.actions()[0], 'InitiateMultipartUpload')
        self.assertEqual(self.actions()[-1], 'CompleteMultipartUpload')
        self.assertEqual(self.actions().count('UploadPart'), 2)
        self.assertNotIn('ListMultipartUploads', self.actions())
        self.assertTrue(all(e['md5'] for e in self.server.events if e['action'] == 'UploadPart'))
        self.assertEqual(self.server.uploads, {})

    def test_part_failure_aborts_then_clean_retry_preserves_bytes(self):
        item = self.item(b'A' * (1024 * 1024 + 1))
        self.server.fail_action, self.server.fail_count = 'UploadPart', 1
        with self.assertRaises(CosServiceError):
            self.store.upload(item)
        self.assertEqual(self.server.uploads, {})
        self.assertNotIn(item['key'], self.server.objects)
        self.assertIn('AbortMultipartUpload', self.actions())
        self.store.upload(item)
        self.assertEqual(self.server.objects[item['key']][0], Path(item['path']).read_bytes())
        self.assertNotIn('DeleteObject', self.actions())

    def test_restart_ignores_uncommitted_upload_without_listing_or_aborting_it(self):
        item = self.item(b'A' * (1024 * 1024 + 1))
        stale = {'key': item['key'], 'parts': {1: b'interrupted bytes'}, 'metadata': {}}
        self.server.uploads['interrupted-process-upload'] = stale
        self.store.upload(item)
        self.assertEqual(self.server.objects[item['key']][0], Path(item['path']).read_bytes())
        self.assertEqual(self.server.uploads, {'interrupted-process-upload': stale})
        self.assertNotIn('ListMultipartUploads', self.actions())
        self.assertNotIn('AbortMultipartUpload', self.actions())
        self.assertNotIn('DeleteObject', self.actions())

    def test_sdk_transient_part_retry_keeps_md5_and_completes_same_upload(self):
        client = CosS3Client(self.client._conf, retry=1, session=self.session)
        item = self.item(b'A' * (1024 * 1024 + 1))
        self.server.fail_action, self.server.fail_count = 'UploadPart', 1
        mirror.CosStore(client, BUCKET).upload(item)
        self.assertEqual(self.server.objects[item['key']][0], Path(item['path']).read_bytes())
        self.assertEqual(self.actions().count('InitiateMultipartUpload'), 1)
        self.assertEqual(self.actions().count('UploadPart'), 3)
        self.assertNotIn('AbortMultipartUpload', self.actions())
        self.assertNotIn('ListMultipartUploads', self.actions())

    def test_lost_completion_response_is_read_back_and_never_overwrites_on_retry(self):
        item = self.item(b'A' * (1024 * 1024 + 1))
        self.server.lose_completion_response = True
        with self.assertRaises(CosServiceError):
            self.store.upload(item)
        self.assertTrue(mirror.same_object(self.store.head(item['key']), item['size'], item['sha256']))
        self.assertEqual(self.server.uploads, {})
        self.assertNotIn('DeleteObject', self.actions())


if __name__ == '__main__':
    unittest.main()
