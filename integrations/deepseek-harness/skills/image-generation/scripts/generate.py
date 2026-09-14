#!/usr/bin/env python3
"""Generate through the running Harness backend; credentials stay in settings."""
import argparse
import json
import os
from pathlib import Path
import shutil
import time
import urllib.request
import urllib.error


def request(method, route, payload=None):
    port = int(os.environ.get('CRAWSHRIMP_PORT', '18765'))
    token = os.environ.get('CRAWSHRIMP_API_TOKEN', '')
    if not token:
        raise RuntimeError('请在运行中的 Harness 内使用此脚本（需要本地 API 身份验证）')
    req = urllib.request.Request(f'http://127.0.0.1:{port}{route}',
        data=None if payload is None else json.dumps(payload).encode(), method=method,
        headers={'Content-Type': 'application/json', 'x-crawshrimp-token': token})
    # A lost POST response must never be automatically resubmitted.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=1200) as response:
        return json.load(response)


def generate(prompt, model, references=None, size='1024x1024', quality='auto', out=None):
    params = {'size': size, 'quality': quality, 'reference_image_paths': [str(Path(p).expanduser().resolve()) for p in references or []], 'surface': 'skill-image-generation'}
    if size.upper() in {'1K', '2K', '4K'}:
        params.update(size={'1K': '1024x1024', '2K': '2048x2048', '4K': '2880x2880'}[size.upper()], resolution=size.upper(), ratio='1:1')
    job = request('POST', '/ai-image/jobs', {'title': '技能生图', 'model_key': model, 'prompt': prompt, 'params': params})
    job = job.get('job', job)
    uid = job['job_uid']
    try:
        request('POST', f'/ai-image/jobs/{uid}/batch-run', {'prompts': [{'prompt': prompt, 'count': 1}]})
    except urllib.error.HTTPError as exc:
        if 400 <= exc.code < 500:
            raise RuntimeError(f'生图提交被拒绝（HTTP {exc.code}），请检查模型配置与参数；任务 {uid}') from exc
        # Server errors can occur after acceptance; inspect this job, never resubmit.
    except (OSError, TimeoutError):
        # Read the existing job after a lost local response; never submit twice.
        pass
    deadline = time.monotonic() + 1200
    while True:
        job = request('GET', f'/ai-image/jobs/{uid}')
        job = job.get('job', job)
        runs = job.get('summary', {}).get('runs', [])
        if runs and all(r.get('status') in {'completed', 'failed'} for r in runs): break
        if time.monotonic() >= deadline: raise RuntimeError(f'生成等待超时，请查看已有任务 {uid}，不要重复提交')
        time.sleep(3)
    urls = job.get('summary', {}).get('image_urls', [])
    if not urls: raise RuntimeError('; '.join(r.get('error', '生成失败') for r in runs))
    cached = request('POST', f'/ai-image/jobs/{uid}/materialize', {'url': urls[0]})['path']
    target = Path(out).expanduser().resolve() if out else Path(cached)
    if out:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(cached, target)
    return {'out': str(target), 'model': model, 'job_uid': uid}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--list-models', action='store_true')
    parser.add_argument('--prompt')
    parser.add_argument('--model', default='gpt-image-2')
    parser.add_argument('--reference', action='append', default=[])
    parser.add_argument('--size', default='1024x1024')
    parser.add_argument('--quality', default='auto')
    parser.add_argument('--out')
    args = parser.parse_args()
    if args.list_models: result = request('GET', '/ai-image/models')
    else:
        if not args.prompt: parser.error('--prompt is required')
        result = generate(Path(args.prompt).read_text(), args.model, args.reference, args.size, args.quality, args.out)
    print(json.dumps(result, ensure_ascii=False))
