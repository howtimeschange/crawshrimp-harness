"""Editable built-in model lists remain bound to their original routes."""
import json
from unittest.mock import patch

import pytest
import yaml
from fastapi import HTTPException

from core import api_server, config, llm_gateway, model_catalog
from core.agent import api as agent_api, service
from core.agent.cordis_config import agent_capable_model_ids, model_capabilities, resolve_session_model_selection


PROVIDER = "crawshrimp-overseas-openai"


@pytest.mark.parametrize("nested", [False, True])
def test_saved_builtin_additions_reach_selection_and_runtime_without_copying_key(tmp_path, monkeypatch, nested):
    monkeypatch.setattr(config, "_config_path", lambda: tmp_path / "config.json")
    monkeypatch.setattr(api_server, "reset_bridge", lambda: None)
    monkeypatch.setattr("core.product_analytics.emit", lambda *_args, **_kwargs: None)
    reloads = []
    monkeypatch.setattr(api_server, "_reload_agent_runtime_after_llm_settings", lambda: reloads.append(True) or {"agent_runtime_reload": "restarted"})
    config.save_config({"ai": {"llm": {
        "overseas_openai_api_key": "existing-provider-secret",
        "overseas_openai_base_url": "https://codex.example/v1",
        "default_model": "future-gpt",
    }}})
    models = {PROVIDER: [{
        "id": "future-gpt", "label": "Future GPT", "context_window": 512000,
        "max_output_tokens": 48000, "input_modalities": ["text", "image"],
        "reasoning_protocol": "openai", "reasoning_efforts": ["low", "high"],
        "api_key": "must-not-be-stored",
    }]}
    payload = {"ai": {"llm": {"builtin_provider_models": models}}} if nested else {"ai.llm.builtin_provider_models": models}
    with patch.dict("os.environ", {}, clear=True):
        result = api_server.patch_settings(payload)
        saved = config.load_config()
        public = api_server.get_settings()["ai"]["llm"]
        route = llm_gateway.route_for_model("future-gpt", saved)
        assert route.api_key == "existing-provider-secret"
        assert route.base_url == "https://codex.example/v1"
        assert route.model_id == "future-gpt"
        assert llm_gateway.select_default_model(saved) == "future-gpt"
        assert resolve_session_model_selection(PROVIDER, "future-gpt", saved) == ("future-gpt", PROVIDER)
        with pytest.raises(ValueError):
            resolve_session_model_selection("crawshrimp-domestic-openai", "future-gpt", saved)
        rows = agent_api.list_agent_models()["models"]
        assert next(row for row in rows if row["model_id"] == "future-gpt")["route"] == PROVIDER
        catalog = model_catalog._llm_models(saved)
        assert next(row for row in catalog if row["id"] == "future-gpt")["label"] == "Future GPT"
    assert result["agent_runtime_reload"] == "restarted"
    assert reloads == [True]
    assert public["builtin_provider_models"][PROVIDER][0]["id"] == "future-gpt"
    assert "existing-provider-secret" not in json.dumps(public)
    assert "must-not-be-stored" not in json.dumps(saved)
    assert model_capabilities("future-gpt", saved)["context_window"] == 512000
    service._sync_dsh_default_model_settings(tmp_path / "agent", PROVIDER, "future-gpt", saved, [])
    text = (tmp_path / "agent/dsh-home/settings.yaml").read_text()
    provider = yaml.safe_load(text)["llm-pi-ai"]["providers"][PROVIDER]
    descriptor = next(model for model in provider["models"] if model["id"] == "future-gpt")
    assert descriptor["contextWindow"] == 512000
    assert descriptor["maxTokens"] == 48000
    assert descriptor["input"] == ["text", "image"]
    assert descriptor["reasoningEfforts"] == {"low": "low", "high": "high"}
    assert provider["apiKeyEnv"] == "CRAWSHRIMP_OVERSEAS_OPENAI_API_KEY"
    assert "existing-provider-secret" not in text
    assert "gpt-5.6-terra" not in {model["id"] for model in provider["models"]}
    assert "gpt-5.6-terra" not in agent_capable_model_ids(saved)


def test_existing_model_parameters_can_be_overridden_then_restored():
    cfg = {"ai": {"llm": {"builtin_provider_models": {PROVIDER: [{
        "id": "gpt-5.6-terra", "context_window": 512000, "max_output_tokens": 48000,
        "supports_tools": False, "input_modalities": ["text"],
    }]}}}}
    assert model_capabilities("gpt-5.6-terra", cfg, PROVIDER)["context_window"] == 512000
    provider = llm_gateway.builtin_llm_providers(cfg)[0]
    assert provider["models"].count("gpt-5.6-terra") == 1
    from core.agent.cordis_config import agent_capable_model_ids
    assert "gpt-5.6-terra" in agent_capable_model_ids(cfg)
    assert model_capabilities("gpt-5.6-terra", cfg)["input_modalities"] == ["text", "image"]
    cfg["ai"]["llm"]["builtin_provider_models"][PROVIDER] = []
    assert "gpt-5.6-terra" not in agent_capable_model_ids(cfg)
    assert next(item for item in llm_gateway.builtin_llm_providers(cfg) if item["id"] == PROVIDER)["models"] == ()
    cfg["ai"]["llm"]["builtin_provider_models"][PROVIDER] = llm_gateway.builtin_provider_default_models()[PROVIDER]
    assert model_capabilities("gpt-5.6-terra", cfg)["context_window"] == 256000
    assert "gpt-5.6-terra" in agent_capable_model_ids(cfg)


@pytest.mark.parametrize("provider", llm_gateway.BUILTIN_LLM_PROVIDERS, ids=lambda provider: provider["id"])
def test_all_builtin_providers_support_full_model_lists_and_restore(provider):
    provider_id = provider["id"]
    default_models = llm_gateway.builtin_provider_default_models()[provider_id]
    added_id = f"new-{provider_id}"
    models = [dict(model) for model in default_models] + [{"id": added_id, "context_window": 512000, "max_output_tokens": 48000}]
    models[0]["label"] = "Edited model"
    models[0]["context_window"] = 2000000
    deleted_id = models.pop(1)["id"]
    cfg = {"ai": {"llm": {provider["api_key_key"]: "original-key", "builtin_provider_models": {provider_id: models}}}}
    with patch.dict("os.environ", {}, clear=True):
        assert llm_gateway.route_for_model(added_id, cfg).api_key == "original-key"
        assert llm_gateway.route_for_model(added_id, cfg).protocol == provider["protocol"]
        assert resolve_session_model_selection(provider_id, added_id, cfg) == (added_id, provider_id)
    effective = next(item for item in llm_gateway.builtin_llm_providers(cfg) if item["id"] == provider_id)
    assert deleted_id not in effective["models"]
    assert deleted_id not in agent_capable_model_ids(cfg)
    assert model_capabilities(models[0]["id"], cfg, provider_id)["context_window"] == 2000000
    runtime = service._dsh_llm_pi_ai_settings(cfg, [])["providers"][provider_id]
    assert llm_gateway.official_real_model(deleted_id) not in [model["id"] for model in runtime["models"]]
    assert next(model for model in runtime["models"] if model["id"] == llm_gateway.official_real_model(models[0]["id"]))["name"] == "Edited model"
    cfg["ai"]["llm"]["builtin_provider_models"][provider_id] = []
    assert provider_id not in service._dsh_llm_pi_ai_settings(cfg, [])["providers"]
    cfg["ai"]["llm"]["builtin_provider_models"][provider_id] = default_models
    assert next(item for item in llm_gateway.builtin_llm_providers(cfg) if item["id"] == provider_id)["models"] == provider["models"]


def test_editing_deepseek_preserves_reasoning_unless_explicitly_changed():
    provider_id = "crawshrimp-deepseek-official"
    models = llm_gateway.builtin_provider_default_models()[provider_id]
    cfg = {"ai": {"llm": {"builtin_provider_models": {provider_id: models}}}}
    model = service._dsh_llm_pi_ai_settings(cfg, [])["providers"][provider_id]["models"][0]
    assert model["compat"]["thinkingFormat"] == "deepseek"
    models[0]["reasoning_protocol"] = "default"
    models[0]["reasoning_efforts"] = []
    model = service._dsh_llm_pi_ai_settings(cfg, [])["providers"][provider_id]["models"][0]
    assert model["reasoningEfforts"] is False
    assert "compat" not in model


@pytest.mark.parametrize("custom", [False, True])
def test_legacy_capability_flags_do_not_hide_models_or_strip_images(tmp_path, monkeypatch, custom):
    provider_id = "legacy-custom" if custom else PROVIDER
    model_id = "legacy-flags-model"
    model = {"id": model_id, "supports_tools": False, "input_modalities": ["text"],
             "context_window": 512000, "max_output_tokens": 48000}
    llm = {"overseas_openai_api_key": "test-key"}
    if custom:
        llm["custom_providers"] = [{"id": provider_id, "base_url": "https://api.example/v1",
                                     "api_key": "test-key", "models": [model]}]
    else:
        llm["builtin_provider_models"] = {provider_id: [model]}
    cfg = {"ai": {"llm": llm}}
    assert model_id in agent_capable_model_ids(cfg)
    assert resolve_session_model_selection(provider_id, model_id, cfg) == (model_id, provider_id)
    assert service._resolve_configured_generation_model(cfg, provider_id, model_id) == (model_id, provider_id)
    custom_profiles, _ = llm_gateway.custom_providers_runtime_payload(cfg)
    service._sync_dsh_default_model_settings(tmp_path, provider_id, model_id, cfg, custom_profiles)
    runtime = yaml.safe_load((tmp_path / "dsh-home/settings.yaml").read_text())["llm-pi-ai"]
    descriptor = next(item for item in runtime["providers"][provider_id]["models"] if item["id"] == model_id)
    assert descriptor["input"] == ["text", "image"]
    assert descriptor["contextWindow"] == 512000
    monkeypatch.setattr(config, "load_config", lambda: cfg)
    monkeypatch.setattr(agent_api.db, "get_session", lambda _sid: {"session_id": "test"})
    updated = []
    monkeypatch.setattr(agent_api.db, "update_session", lambda sid, **fields: updated.append(fields))
    class NoopService:
        def note_model_changed(self, *_args):
            pass
    monkeypatch.setattr(agent_api, "get_agent_service", lambda: NoopService())
    assert agent_api.set_session_model("test", agent_api.SessionModelRequest(model_id=model_id))["ok"]
    assert updated == [{"model_id": model_id}]
    with pytest.raises(HTTPException) as exc:
        agent_api.set_session_model("test", agent_api.SessionModelRequest(model_id="not-added"))
    assert exc.value.status_code == 422


@pytest.mark.parametrize("models", [[], {PROVIDER: [{"id": "bad", "context_window": 100, "max_output_tokens": 200}]},
                                      {PROVIDER: [{"id": "bad", "context_window": "invalid"}]},
                                      {PROVIDER: [{"id": "bad", "max_output_tokens": 0}]},
                                      {PROVIDER: [{"id": "bad", "max_output_tokens": 1.5}]}])
def test_settings_reject_invalid_builtin_model_configuration(models):
    with pytest.raises(HTTPException) as exc:
        api_server._normalize_builtin_provider_models_setting(models)
    assert exc.value.status_code == 422
