"""Ephemeral loopback capability supplied by Electron; never an upstream API key.

Do not merge these providers into persisted user configuration. Distinct model
IDs keep official text calls from falling back to similarly named BYOK models.
"""
import json
import os
import re
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


def _text_model_budget(model):
    # Match the official DeepSeek context budget for managed sessions too.
    # Keep output limits model-specific; context size is not an output request.
    from core.agent.cordis_config import MODEL_CAPABILITIES

    model_id = model['id']
    aliases = {'deepseek-flash': 'deepseek-official-flash',
               'deepseek-v4-pro': 'deepseek-official-v4-pro'}
    cap = MODEL_CAPABILITIES.get(aliases.get(model_id, model_id), {})
    def positive_int(value, fallback):
        return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else fallback
    context = positive_int(model.get('context_window', model.get('contextWindow')), cap.get('context_window', 128_000))
    output = positive_int(model.get('max_output_tokens', model.get('maxTokens')), cap.get('max_output_tokens', 8192))
    return {'context_window': context,
            'max_output_tokens': min(output, context)}


def reasoning_capability(model_id):
    """Capabilities of the account routes, checked against provider docs 2026-10-23."""
    if model_id in ('deepseek-flash', 'deepseek-v4-pro'):
        return {'reasoning_protocol': 'deepseek', 'reasoning_efforts': ['off', 'low', 'high', 'max']}
    if re.fullmatch(r'gpt-(?:6(?:\.1)?|5\.6)-(?:sol|astra|luna|terra)', model_id):
        return {'reasoning_protocol': 'openai', 'reasoning_efforts': ['low', 'medium', 'high', 'xhigh', 'max']}
    if re.fullmatch(r'gemini-(?:3(?:\.\d+)?|2\.5)-flash(?:-lite)?', model_id):
        return {'reasoning_protocol': 'openai', 'reasoning_efforts': ['low', 'medium', 'high']}
    return {}


def text_catalog(models):
    # Retain original IDs for stored conversations. The picker hides aliases;
    # only synthesize a base entry for a family actually offered by this account.
    result = [dict(m) for m in models if m.get('kind') == 'text' and m.get('available') is True]
    ids = {m['id'] for m in result}
    for model in list(result):
        match = re.fullmatch(r'(gemini-3\.8-flash)-(low|medium|high|tiered)', model['id'])
        if match and match[1] not in ids:
            base = match[1]
            efforts = [e for e in ('low', 'medium', 'high') if base + '-' + e in ids]
            result.append({**model, 'id': base, 'name': 'Gemini 3.8 Flash',
                           'reasoning_protocol': 'openai', 'reasoning_efforts': efforts})
            ids.add(base)
    return [{**m, **(reasoning_capability(m['id']) if 'reasoning_efforts' not in m else {})} for m in result]


def text_providers():
    current = session()
    if not current:
        return []
    result = []
    for protocol in ('openai', 'openai-responses'):
        models = [{'id': 'managed-' + m['id'], 'name': m['name'],
                   **_text_model_budget(m),
                   'input_modalities': ['text', 'image'],
                   **{k: m[k] for k in ('reasoning_protocol', 'reasoning_efforts') if k in m}}
                  for m in text_catalog(current.get('models', [])) if m.get('protocol') == protocol]
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
        models = [m['id'] for m in current.get('models', []) if m.get('kind') == 'image' and m.get('protocol') == protocol and m.get('available') is True]
        if models:
            result.append({'id': 'custom-managed-' + protocol, 'name': '抓虾官方 · ' + ('Nano Banana' if protocol == 'gemini' else 'GPT Image'),
                           'protocol': protocol, 'base_url': current['baseURL'] + ('/v1beta' if protocol == 'gemini' else '/v1'),
                           'api_key': current['brokerToken'], 'models': models})
    return result
