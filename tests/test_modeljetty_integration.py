"""Protocol boundaries: settings -> DSH and multimodal adapter -> wire."""
from unittest.mock import patch
import pytest
from core import llm_gateway as llm
from core.agent.service import _dsh_llm_pi_ai_settings


def config():
    return {'ai': {'llm': {'custom_providers': [{
        'id': 'modeljetty-gpt', 'name': 'ModelJetty GPT',
        'protocol': 'openai-responses', 'base_url': 'https://api.modeljetty.com/v1',
        'api_key': 'test-key', 'models': [{'id': 'gpt-6-luna'}],
    }]}}}


def test_responses_survives_runtime_settings():
    cfg = config()
    profiles, env = llm.custom_providers_runtime_payload(cfg)
    assert profiles[0]['api'] == 'openai-responses'
    settings = _dsh_llm_pi_ai_settings(cfg, profiles)
    assert settings['providers']['modeljetty-gpt']['api'] == 'openai-responses'
    assert 'test-key' not in str(settings)
    assert 'test-key' in env.values()


def test_responses_wire_and_output_parsing():
    route = llm.route_for_model('gpt-6-luna', config())
    response = {'status': 'completed', 'output': [
        {'type': 'reasoning', 'summary': []},
        {'type': 'message', 'content': [{'type': 'output_text', 'text': 'OK'}]},
    ]}
    with patch.object(llm, '_post_json', return_value=response) as post:
        result = llm._generic_openai_json_request(route, 'system', 'user', ['data:image/png;base64,YQ=='])
    url, body, headers = post.call_args.args
    assert url == 'https://api.modeljetty.com/v1/responses'
    assert body['store'] is False and body['stream'] is False
    assert body['instructions'] == 'system'
    assert body['input'][0]['content'][1]['type'] == 'input_image'
    assert 'messages' not in body
    assert headers['Authorization'] == 'Bearer test-key'
    assert llm._response_text(result) == 'OK'
    with pytest.raises(llm.LlmResponseError):
        llm._response_text({**response, 'status': 'incomplete'})


def test_modeljetty_gemini_native_auth_and_inline_response():
    from core.image_providers import CompatibleImageClient
    requests = []
    def transport(method, url, **kwargs):
        requests.append((url, kwargs))
        return 200, {'candidates': [{'content': {'parts': [{'inlineData': {'mimeType': 'image/jpeg', 'data': 'YQ=='}}]}}]}
    client = CompatibleImageClient('test-key', provider='custom-modeljetty-gemini',
        model='gemini-3.1-flash-image', base_url='https://api.modeljetty.com/v1beta', protocol='gemini', transport=transport)
    result = client.create_task({'prompt': 'shrimp', 'size': '1024x1024'}, request_retries=1)
    url, request = requests[0]
    assert url.endswith('/v1beta/models/gemini-3.1-flash-image:generateContent')
    assert request['headers']['Authorization'] == 'Bearer test-key'
    assert request['headers']['User-Agent'].startswith('Crawshrimp-Harness/')
    assert 'x-goog-api-key' not in request['headers']
    assert result['data'][0]['url'] == 'data:image/jpeg;base64,YQ=='


def test_explicit_default_provider_prevents_same_model_cross_routing():
    from core.agent.cordis_config import resolve_provider_for_model
    cfg = config()
    cfg['ai']['llm'].update(default_model='gpt-6-luna', default_provider='modeljetty-gpt', overseas_openai_api_key='other-provider-key')
    route = llm.route_for_model('gpt-6-luna', cfg)
    assert route.api_key == 'test-key'
    assert route.protocol == 'openai-responses'
    assert resolve_provider_for_model('gpt-6-luna', cfg) == 'modeljetty-gpt'
