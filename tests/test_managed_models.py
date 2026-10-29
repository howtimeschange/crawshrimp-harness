import json
import pytest

@pytest.fixture(autouse=True)
def desktop_epoch(monkeypatch):
    monkeypatch.setenv('CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH', 'fixture-epoch')

from core import managed_models
from core.config import save_config, load_config
from core.llm_gateway import custom_llm_providers, route_for_model
from core.image_providers import provider_settings

def test_managed_routing_is_ephemeral_and_provider_qualified(tmp_path, monkeypatch):
    monkeypatch.setattr(managed_models.runtime_paths, 'data_root', lambda: tmp_path)
    file = tmp_path / 'managed-model-session.json'
    file.write_text(json.dumps({'version': 1, 'desktopRuntimeEpoch': 'fixture-epoch', 'accountId': 'test', 'baseURL': 'http://127.0.0.1:45678', 'brokerToken': 'x' * 40,
                               'models': [{'id': 'deepseek-flash', 'name': 'DeepSeek', 'kind': 'text', 'protocol': 'openai', 'available': True},
                                          {'id': 'gemini-3.1-flash-image', 'name': 'Nano', 'kind': 'image', 'protocol': 'gemini', 'available': True}]}))
    file.chmod(0o600)
    providers = custom_llm_providers({}, include_secrets=False)
    assert providers[0]['models'][0]['id'] == 'managed-deepseek-flash'
    assert 'api_key' not in providers[0]
    route = route_for_model('managed-deepseek-flash', config={})
    assert route.base_url == 'http://127.0.0.1:45678/v1'
    settings = provider_settings({}, {})
    assert settings['ai.image.custom_providers'][0]['id'] == 'custom-managed-gemini'
    save_config({'managed_text_providers': providers, 'ai': {'llm': {'custom_providers': managed_models.text_providers()}}})
    assert 'brokerToken' not in (tmp_path/'config.json').read_text()
    assert 'x'*40 not in (tmp_path/'config.json').read_text()
    assert load_config()['ai']['llm']['custom_providers'] == []
    file.unlink()
    assert custom_llm_providers({}) == []

def test_non_loopback_or_world_readable_broker_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(managed_models.runtime_paths, 'data_root', lambda: tmp_path)
    file=tmp_path/'managed-model-session.json'
    for origin in ['https://evil.test', 'http://127.0.0.1:5555/route', 'http://user@127.0.0.1:5555']:
        file.write_text(json.dumps({'version':1,'baseURL':origin,'brokerToken':'x'*40}));file.chmod(0o600)
        assert managed_models.session() is None


def test_managed_default_route_never_retries_transport_or_invalid_output(monkeypatch):
    import pytest
    from core import llm_gateway as gateway
    route = gateway.LlmRoute('managed-deepseek-flash', 'openai', 'http://127.0.0.1:45678/v1', 'fake-capability')
    monkeypatch.setattr(gateway, 'route_for_model', lambda *a, **k: route)
    calls = []
    def fail(*a, **k):
        calls.append(1)
        raise gateway.LlmGatewayError('HTTP 502 server error')
    for fn in (gateway.generate_multimodal_json, gateway.generate_multimodal_text):
        calls.clear()
        with pytest.raises(gateway.LlmGatewayError):
            fn(system_prompt='s', user_prompt='u', image_inputs=['https://example.test/a.png'], request_openai=fail)
        assert len(calls) == 1
    for invalid in (False, True):
        calls.clear()
        def video(*a, **k):
            if not invalid:
                return fail()
            calls.append(1)
            return {'choices': [{'message': {'content': 'invalid output'}}]}
        with pytest.raises(gateway.LlmGatewayError):
            gateway.generate_video_copies(product_title='test', image_urls=['https://example.test/a.png'], request_openai=video, retry_sleep=lambda _: None)
        assert len(calls) == 1


def test_managed_budgets_reach_runtime_without_64k_fallback(monkeypatch):
    from core.agent.cordis_config import MODEL_CAPABILITIES, model_capabilities
    from core.agent.service import _dsh_llm_pi_ai_settings
    from core.llm_gateway import custom_providers_runtime_payload

    monkeypatch.setattr(managed_models, 'session', lambda: {
        'baseURL': 'http://127.0.0.1:45678', 'brokerToken': 'x' * 40,
        'models': [{'id': 'deepseek-flash', 'name': 'DeepSeek', 'kind': 'text', 'protocol': 'openai', 'available': True},
                   {'id': 'catalog-model', 'name': 'Catalog', 'kind': 'text', 'protocol': 'openai-responses', 'available': True,
                    'contextWindow': 2_000_000, 'maxTokens': 32768}]})
    official = MODEL_CAPABILITIES['deepseek-official-flash']
    cap = model_capabilities('managed-deepseek-flash', {}, 'crawshrimp-managed-openai')
    assert cap['context_window'] == official['context_window']
    assert cap['max_output_tokens'] == official['max_output_tokens']
    profiles, _ = custom_providers_runtime_payload({})
    runtime = _dsh_llm_pi_ai_settings({}, profiles)['providers']
    model = runtime['crawshrimp-managed-openai']['models'][0]
    assert model['contextWindow'] == 1_000_000
    assert model['maxTokens'] == 393216
    catalog = runtime['crawshrimp-managed-openai-responses']['models'][0]
    assert catalog['contextWindow'] == 2_000_000
    assert catalog['maxTokens'] == 32768


def test_managed_budget_respects_catalog_and_invalid_metadata():
    for value in (None, False, -1, '1000000'):
        budget = managed_models._text_model_budget({'id': 'unknown', 'contextWindow': value, 'maxTokens': False})
        assert budget == {'context_window': 128_000, 'max_output_tokens': 8192}
    assert managed_models._text_model_budget({'id': 'unknown', 'contextWindow': 64000, 'maxTokens': 100000}) == {'context_window': 64000, 'max_output_tokens': 64000}


def test_account_reasoning_reaches_runtime_and_preserves_legacy_ids(tmp_path, monkeypatch):
    from core.llm_gateway import custom_providers_runtime_payload
    monkeypatch.setattr(managed_models.runtime_paths, 'data_root', lambda: tmp_path)
    models = [{'id': 'gemini-3.8-flash-' + level, 'name': 'Gemini ' + level, 'kind': 'text', 'protocol': 'openai', 'available': True} for level in ('low', 'medium', 'high', 'tiered')]
    models += [{'id': 'deepseek-flash', 'name': 'DeepSeek Flash', 'kind': 'text', 'protocol': 'openai', 'available': True},
               {'id': 'gpt-6.1-sol', 'name': 'GPT-6.1 Sol', 'kind': 'text', 'protocol': 'openai-responses', 'available': True}]
    file = tmp_path / 'managed-model-session.json'
    file.write_text(json.dumps({'version': 1, 'desktopRuntimeEpoch': 'fixture-epoch', 'baseURL': 'http://127.0.0.1:45678', 'brokerToken': 'x'*40, 'models': models}))
    file.chmod(0o600)
    payload, _ = custom_providers_runtime_payload({})
    entries = {m['id']: m for p in payload for m in p['models']}
    assert entries['managed-gemini-3.8-flash']['reasoningEfforts'] == {'low':'low','medium':'medium','high':'high'}
    assert entries['managed-gemini-3.8-flash-low']['reasoningEfforts'] is False
    assert entries['managed-deepseek-flash']['compat']['thinkingFormat'] == 'deepseek'
    assert entries['managed-deepseek-flash']['compat']['supportsDeveloperRole'] is False
    assert entries['managed-gpt-6.1-sol']['reasoningEfforts']['max'] == 'max'
    assert 'compat' not in entries['managed-gpt-6.1-sol']
    assert entries['managed-gpt-6.1-sol']['name'] == 'GPT-6.1 Sol'
    assert len(entries) == 7


def test_locked_member_models_do_not_enter_text_or_image_runtime_catalog(tmp_path, monkeypatch):
    monkeypatch.setattr(managed_models.runtime_paths, 'data_root', lambda: tmp_path)
    file = tmp_path / 'managed-model-session.json'
    file.write_text(json.dumps({'version': 1, 'desktopRuntimeEpoch': 'fixture-epoch', 'accountId': 'free', 'baseURL': 'http://127.0.0.1:45678', 'brokerToken': 'x' * 40,
        'models': [{'id': 'gpt-6.1-sol', 'name': 'GPT', 'kind': 'text', 'protocol': 'openai-responses', 'available': False},
                   {'id': 'deepseek-flash', 'name': 'DeepSeek', 'kind': 'text', 'protocol': 'openai', 'available': False},
                   {'id': 'gemini-3.8-flash-high', 'name': 'Gemini', 'kind': 'text', 'protocol': 'openai', 'available': True},
                   {'id': 'gpt-image-2.5-flare', 'name': 'GPT Image', 'kind': 'image', 'protocol': 'openai', 'available': False},
                   {'id': 'gemini-3.1-flash-image', 'name': 'Nano', 'kind': 'image', 'protocol': 'gemini', 'available': True}]}))
    file.chmod(0o600)
    assert all(m['id'].startswith('managed-gemini-') for p in managed_models.text_providers() for m in p['models'])
    assert [p['protocol'] for p in managed_models.image_providers()] == ['gemini']


def test_free_paid_model_catalog_reaches_text_and_image_without_upgrading_plan(tmp_path, monkeypatch):
    monkeypatch.setattr(managed_models.runtime_paths, 'data_root', lambda: tmp_path)
    file = tmp_path / 'managed-model-session.json'
    catalog = [{'id': 'gpt-6.1-sol', 'name': 'GPT', 'kind': 'text', 'protocol': 'openai-responses', 'available': True},
               {'id': 'deepseek-flash', 'name': 'DeepSeek', 'kind': 'text', 'protocol': 'openai', 'available': True},
               {'id': 'gpt-image-2.5-flare', 'name': 'GPT Image', 'kind': 'image', 'protocol': 'openai', 'available': True}]
    state = {'version': 1, 'desktopRuntimeEpoch': 'fixture-epoch', 'accountId': 'free-paid', 'plan': 'free', 'paidModelAccess': True,
             'baseURL': 'http://127.0.0.1:45678', 'brokerToken': 'x' * 40, 'models': catalog}
    for remaining in [10, 3.25, 0]:
        file.write_text(json.dumps({**state, 'permanentRemaining': remaining}))
        file.chmod(0o600)
        assert {m['id'] for p in managed_models.text_providers() for m in p['models']} == {'managed-gpt-6.1-sol', 'managed-deepseek-flash'}
        assert managed_models.image_providers()[0]['models'] == ['gpt-image-2.5-flare']
    state['paidModelAccess'] = False
    state['models'] = [{**m, 'available': False} for m in catalog]
    file.write_text(json.dumps(state))
    assert managed_models.text_providers() == []
    assert managed_models.image_providers() == []


def test_runtime_uses_explicit_catalog_boolean_for_future_and_disabled_models(tmp_path, monkeypatch):
    monkeypatch.setattr(managed_models.runtime_paths, 'data_root', lambda: tmp_path)
    file = tmp_path / 'managed-model-session.json'
    models = [{'id': 'future-provider-v9', 'name': 'Future', 'kind': 'text', 'protocol': 'openai', 'available': True},
              {'id': 'future-image-v9', 'name': 'Future Image', 'kind': 'image', 'protocol': 'openai', 'available': True}]
    for value in [False, None, 1, 'true']:
        models.extend([{'id': 'gemini-disabled-' + str(value), 'name': 'Denied', 'kind': kind, 'protocol': 'openai', 'available': value} for kind in ['text', 'image']])
    models.extend([{'id': 'missing-' + kind, 'name': 'Unknown', 'kind': kind, 'protocol': 'openai'} for kind in ['text', 'image']])
    file.write_text(json.dumps({'version': 1, 'desktopRuntimeEpoch': 'fixture-epoch', 'accountId': 'server-authority', 'plan': 'pro', 'paidModelAccess': True,
                               'baseURL': 'http://127.0.0.1:45678', 'brokerToken': 'x' * 40, 'models': models}))
    file.chmod(0o600)
    assert {m['id'] for p in managed_models.text_providers() for m in p['models']} == {'managed-future-provider-v9'}
    assert [m for p in managed_models.image_providers() for m in p['models']] == ['future-image-v9']


def test_desktop_runtime_epoch_rejects_stale_capability(tmp_path, monkeypatch):
    monkeypatch.setattr(managed_models.runtime_paths, 'data_root', lambda: tmp_path)
    monkeypatch.setenv('CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH', 'current-desktop')
    file = tmp_path / 'managed-model-session.json'
    value = {'version': 1, 'baseURL': 'http://127.0.0.1:45678', 'brokerToken': 'x' * 40,
             'desktopRuntimeEpoch': 'previous-desktop', 'models': []}
    file.write_text(json.dumps(value)); file.chmod(0o600)
    assert managed_models.session() is None
    value['desktopRuntimeEpoch'] = 'current-desktop'
    file.write_text(json.dumps(value)); file.chmod(0o600)
    assert managed_models.session()['desktopRuntimeEpoch'] == 'current-desktop'
    monkeypatch.delenv('CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH')
    assert managed_models.session() is None
