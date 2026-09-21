import yaml
from core.llm_gateway import custom_llm_providers, custom_providers_runtime_payload, DOMESTIC_OPENAI_BASE_URL
from core.agent.service import _sync_dsh_default_model_settings, _dsh_llm_pi_ai_settings


def custom_config(protocol=None):
    model = {"id": "deepseek-v4-pro"}
    if protocol:
        model.update(reasoning_protocol=protocol, reasoning_efforts=["off", "low", "high", "max"])
    return {"ai": {"llm": {"custom_providers": [{
        "id": "custom-test", "name": "Test", "protocol": "openai",
        "base_url": "https://example.invalid/v1", "api_key": "test-only-key", "models": [model],
    }]}}}


def test_custom_reasoning_survives_normalization_and_runtime_generation():
    cfg = custom_config("deepseek")
    assert custom_llm_providers(cfg)[0]["models"][0]["reasoning_efforts"] == ["off", "low", "high", "max"]
    profiles, _ = custom_providers_runtime_payload(cfg)
    model = profiles[0]["models"][0]
    assert model["reasoningEfforts"] == {level: level for level in ["off", "low", "high", "max"]}
    assert model["compat"]["thinkingFormat"] == "deepseek"
    assert model["compat"]["requiresReasoningContentOnAssistantMessages"] is True
    defaults, _ = custom_providers_runtime_payload(custom_config())
    assert defaults[0]["models"][0]["reasoningEfforts"] is False
    generic, _ = custom_providers_runtime_payload(custom_config("openai"))
    assert "off" not in generic[0]["models"][0]["reasoningEfforts"]


def test_switch_provider_and_restart_old_custom_default_clear_high(tmp_path):
    path = tmp_path / "dsh-home/settings.yaml"
    path.parent.mkdir(parents=True)
    for previous_provider in ["crawshrimp-deepseek-official", "custom-test"]:
        path.write_text(yaml.safe_dump({"agent-default-model": {
            "provider": previous_provider, "model": "deepseek-v4-pro", "reasoningEffort": "high",
        }, "unrelated": {"keep": True}}))
        cfg = custom_config()
        profiles, _ = custom_providers_runtime_payload(cfg)
        _sync_dsh_default_model_settings(tmp_path, "custom-test", "deepseek-v4-pro", cfg, profiles)
        saved = yaml.safe_load(path.read_text())
        assert saved["agent-default-model"] == {"provider": "custom-test", "model": "deepseek-v4-pro"}
        assert saved["unrelated"] == {"keep": True}
        assert "test-only-key" not in path.read_text()


def test_same_route_preserves_valid_custom_effort(tmp_path):
    path = tmp_path / "dsh-home/settings.yaml"
    path.parent.mkdir(parents=True)
    cfg = custom_config("deepseek")
    profiles, _ = custom_providers_runtime_payload(cfg)
    for effort in ["off", "high", "invalid"]:
        path.write_text(yaml.safe_dump({"agent-default-model": {
            "provider": "custom-test", "model": "deepseek-v4-pro", "reasoningEffort": effort,
        }}))
        _sync_dsh_default_model_settings(tmp_path, "custom-test", "deepseek-v4-pro", cfg, profiles)
        selection = yaml.safe_load(path.read_text())["agent-default-model"]
        assert selection.get("reasoningEffort") == (effort if effort != "invalid" else None)


def test_semir_capabilities_only_for_verified_url_and_models():
    for url in [DOMESTIC_OPENAI_BASE_URL, DOMESTIC_OPENAI_BASE_URL + "/", "https://ai-aigw.semir.com/bigdata/v1"]:
        profiles = _dsh_llm_pi_ai_settings({"ai": {"llm": {"domestic_base_url": url}}}, [], {})["providers"]
        for model in profiles["crawshrimp-domestic-openai"]["models"]:
            if url.rstrip("/") == DOMESTIC_OPENAI_BASE_URL and model["id"] in {"deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4.1-flash"}:
                assert model["reasoningEfforts"] == dict(off="off", low="low", high="high", max="max")
            else:
                assert "reasoningEfforts" not in model


def test_explicit_official_default_survives_restart(tmp_path):
    path = tmp_path / "dsh-home/settings.yaml"
    path.parent.mkdir(parents=True)
    selected = {"provider": "crawshrimp-deepseek-official", "model": "deepseek-flash"}
    path.write_text(yaml.safe_dump({"agent-default-model": selected}))
    _sync_dsh_default_model_settings(tmp_path, selected["provider"], selected["model"], {}, [])
    assert yaml.safe_load(path.read_text())["agent-default-model"] == selected
