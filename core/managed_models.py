"""Ephemeral loopback capability supplied by Electron; never an upstream API key.

Do not merge these providers into persisted user configuration. Distinct model
IDs keep official text calls from falling back to similarly named BYOK models.
"""
import json
import os
from urllib.parse import urlsplit
from core import runtime_paths


def session():
    path = runtime_paths.data_root() / 'managed-model-session.json'
    try:
        if path.is_symlink() or (os.name != 'nt' and path.stat().st_mode & 0o077):
            return None
        value = json.loads(path.read_text(encoding='utf-8'))
        url = urlsplit(value['baseURL'])
        if url.scheme != 'http' or url.hostname != '127.0.0.1' or not url.port or url.path or url.query or url.fragment or url.username:
            return None
        if value.get('version') != 1 or len(value.get('brokerToken', '')) < 32:
            return None
        return value
    except (OSError, ValueError, KeyError, TypeError):
        return None


def text_providers():
    current = session()
    if not current:
        return []
    result = []
    for protocol in ('openai', 'openai-responses'):
        models = [{'id': 'managed-' + m['id'], 'name': m['name'] + ' · 抓虾官方',
                   'context_window': 64000, 'max_output_tokens': 8192,
                   'input_modalities': ['text', 'image']}
                  for m in current.get('models', []) if m.get('kind') == 'text' and m.get('protocol') == protocol]
        if models:
            result.append({'id': 'crawshrimp-managed-' + protocol, 'name': '抓虾官方', 'protocol': protocol,
                           'base_url': current['baseURL'] + '/v1', 'api_key': current['brokerToken'], 'models': models})
    return result


def image_providers():
    current = session()
    if not current:
        return []
    result = []
    for protocol in ('openai', 'gemini'):
        models = [m['id'] for m in current.get('models', []) if m.get('kind') == 'image' and m.get('protocol') == protocol]
        if models:
            result.append({'id': 'custom-managed-' + protocol, 'name': '抓虾官方 · ' + ('Nano Banana' if protocol == 'gemini' else 'GPT Image'),
                           'protocol': protocol, 'base_url': current['baseURL'] + ('/v1beta' if protocol == 'gemini' else '/v1'),
                           'api_key': current['brokerToken'], 'models': models})
    return result
