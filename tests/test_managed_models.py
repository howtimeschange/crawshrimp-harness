import json
from core import managed_models
from core.config import save_config, load_config
from core.llm_gateway import custom_llm_providers, route_for_model
from core.image_providers import provider_settings

def test_managed_routing_is_ephemeral_and_provider_qualified(tmp_path, monkeypatch):
    monkeypatch.setattr(managed_models.runtime_paths, 'data_root', lambda: tmp_path)
    file = tmp_path / 'managed-model-session.json'
    file.write_text(json.dumps({'version': 1, 'accountId': 'test', 'baseURL': 'http://127.0.0.1:45678', 'brokerToken': 'x' * 40,
                               'models': [{'id': 'deepseek-flash', 'name': 'DeepSeek', 'kind': 'text', 'protocol': 'openai'},
                                          {'id': 'gemini-3.1-flash-image', 'name': 'Nano', 'kind': 'image', 'protocol': 'gemini'}]}))
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
