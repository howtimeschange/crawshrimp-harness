"""Discovery previews do not overwrite model settings or expose credentials."""
from copy import deepcopy
import json
from urllib.error import HTTPError

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from core import api_server, llm_gateway, llm_model_discovery as discovery


@pytest.mark.parametrize("provider_id,key_field,wire_ids,product_ids", [
    ("crawshrimp-deepseek-official", "deepseek_api_key", ["deepseek-flash", "deepseek-v5-pro"],
     ["deepseek-official-flash", "deepseek-official-v5-pro"]),
    ("crawshrimp-glm-official", "glm_api_key", ["glm-5.3", "glm-6-future"],
     ["glm-official-5.3", "glm-official-6-future"]),
])
def test_discovery_endpoint_previews_models_with_original_credentials_without_writes(monkeypatch, provider_id, key_field, wire_ids, product_ids):
    cfg = {"ai": {"llm": {key_field: "saved-test-secret"}}}
    before = deepcopy(cfg)
    monkeypatch.setattr(api_server, "load_config", lambda: cfg)
    requests = []
    def read(url, key=""):
        requests.append((url, key))
        return json.dumps({"data": [{"id": model} for model in [*wire_ids, wire_ids[0]]]})
    monkeypatch.setattr(discovery, "_read_url", read)
    isolated_app = FastAPI()
    isolated_app.router.routes.append(next(route for route in api_server.app.routes if getattr(route, "path", "") == "/agent/providers/{provider_id}/discover-models"))
    with TestClient(isolated_app) as client:
        response = client.post(f"/agent/providers/{provider_id}/discover-models", json={})
    assert response.status_code == 200
    result = response.json()
    assert result["source"] == "api"
    assert [model["id"] for model in result["models"]] == product_ids
    assert requests[0][1] == "saved-test-secret"
    assert "saved-test-secret" not in response.text
    assert cfg == before
    assert result["models"][1]["supports_tools"] is True
    # After explicit import, the new product ID still calls the original wire ID.
    cfg["ai"]["llm"]["builtin_provider_models"] = {provider_id: result["models"]}
    assert llm_gateway.route_for_model(product_ids[1], cfg).model_id == wire_ids[1]


def test_draft_key_and_url_are_used_without_saving(monkeypatch):
    requests = []
    monkeypatch.setattr(discovery, "_read_url", lambda url, key="": requests.append((url, key)) or '{"data":[{"id":"glm-5.3"}]}')
    cfg = {"ai": {"llm": {"glm_api_key": "previous"}}}
    discovery.discover_builtin_provider_models("crawshrimp-glm-official", cfg, base_url="https://draft.example/v4/", api_key="draft-secret")
    assert requests == [("https://draft.example/v4/models", "draft-secret")]
    assert cfg["ai"]["llm"]["glm_api_key"] == "previous"


def test_discovered_glm_flash_variants_default_to_documented_image_and_tool_support(monkeypatch):
    monkeypatch.setattr(discovery, "_read_url", lambda *_args: json.dumps({"data": [
        {"id": "glm-5.3-flash"}, {"id": "glm-5.3-flashx"}, {"id": "glm-5.3"},
    ]}))
    models = discovery.discover_builtin_provider_models("crawshrimp-glm-official", {}, api_key="test-secret")["models"]
    for model in models[:2]:
        assert model["input_modalities"] == ["text", "image"]
        assert model["supports_tools"] is True
        assert model["context_window"] > model["max_output_tokens"] > 0
    assert models[1]["id"] == "glm-official-5.3-flashx"
    assert models[2]["input_modalities"] == ["text", "image"]


@pytest.mark.parametrize("status", [404, 405, 501])
def test_glm_unsupported_endpoint_falls_back_to_official_chat_model_directory(monkeypatch, status):
    requests = []
    def read(url, key=""):
        requests.append((url, key))
        if key:
            raise HTTPError(url, status, "unsupported", {}, None)
        return '\n'.join([
            '- [GLM-5.3-Flash/FlashX](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash.md)',
            '- [GLM-5.3](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3.md)',
            '- [GLM-OCR](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-ocr.md)',
            '- [GLM-Image](https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image.md)',
        ])
    monkeypatch.setattr(discovery, "_read_url", read)
    result = discovery.discover_builtin_provider_models("crawshrimp-glm-official", {}, api_key="draft-secret")
    assert result["source"] == "official_docs"
    assert [model["id"] for model in result["models"]] == ["glm-official-5.3-flash", "glm-official-5.3-flashx", "glm-official-5.3"]
    assert result["models"][1]["input_modalities"] == ["text", "image"]
    assert requests[-1] == (discovery.GLM_DOCS_INDEX, "")


@pytest.mark.parametrize("status", [401, 403, 429, 500, 302])
def test_auth_and_service_errors_are_reported_without_hiding_behind_docs(monkeypatch, status):
    def read(url, key=""):
        raise HTTPError(url, status, "request contains a secret", {}, None)
    monkeypatch.setattr(discovery, "_read_url", read)
    with pytest.raises(discovery.ModelDiscoveryError) as exc:
        discovery.discover_builtin_provider_models("crawshrimp-glm-official", {}, api_key="secret")
    assert str(status) in str(exc.value)
    assert "secret" not in str(exc.value)


@pytest.mark.parametrize("url", ["garbage", "file:///tmp/data", "https://user:pass@example.com", "https://example.com?key=secret", "https://[broken", "https://example.com:99999"])
def test_invalid_url_is_rejected_before_any_request(monkeypatch, url):
    monkeypatch.setattr(discovery, "_read_url", lambda *_args: pytest.fail("unexpected network request"))
    with pytest.raises(discovery.ModelDiscoveryError):
        discovery.discover_builtin_provider_models("crawshrimp-glm-official", {}, base_url=url, api_key="secret")
