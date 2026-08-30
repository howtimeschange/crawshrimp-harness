"""Read-only Crawshrimp model catalog for deterministic IM responses."""
from __future__ import annotations

from typing import Any, Mapping

from core import ai_video_generation_service
from core.agent.cordis_config import (
    agent_capable_model_ids,
    model_capabilities,
    resolve_provider_for_model,
)
from core.ai_image_service import (
    GEMINI_FLASH_CONFIG_ID,
    GEMINI_PRO_CONFIG_ID,
    GPT_2K_CONFIG_ID,
    GPT_4K_CONFIG_ID,
)
from core.config import load_config
from core.llm_gateway import (
    BUILTIN_LLM_PROVIDERS,
    custom_llm_providers,
    model_has_configured_key,
    official_real_model,
    select_default_model,
)


def _compact(value: Any) -> str:
    return str(value or "").strip()


def _config_value(config: Mapping[str, Any], dotted_key: str) -> Any:
    if not isinstance(config, Mapping):
        return None
    if dotted_key in config:
        return config.get(dotted_key)
    current: Any = config
    for part in dotted_key.split("."):
        if not isinstance(current, Mapping):
            return None
        current = current.get(part)
    return current


def _configured(config: Mapping[str, Any], dotted_key: str) -> bool:
    return bool(_compact(_config_value(config, dotted_key)))


AI_IMAGE_MODEL_SPECS = (
    {
        "id": "gpt-image-2k",
        "model": "gpt-image-2",
        "label": "GPT Image 2K",
        "provider": "1xm",
        "provider_label": "1XM",
        "config_id": GPT_2K_CONFIG_ID,
        "defaults": {"size": "1024x1024", "quality": "high", "format": "png"},
    },
    {
        "id": "gpt-image-4k",
        "model": "gpt-image-2",
        "label": "GPT Image 4K",
        "provider": "1xm",
        "provider_label": "1XM",
        "config_id": GPT_4K_CONFIG_ID,
        "defaults": {"size": "2880x2880", "quality": "high", "format": "png"},
    },
    {
        "id": "gemini-3.1-flash-image-preview",
        "model": "gemini-3.1-flash-image-preview",
        "label": "Gemini 3.1 Flash Image Preview",
        "provider": "1xm",
        "provider_label": "1XM / Nano Banana",
        "config_id": GEMINI_FLASH_CONFIG_ID,
        "defaults": {"size": "1K"},
    },
    {
        "id": "gemini-3-pro-image-preview",
        "model": "gemini-3-pro-image-preview",
        "label": "Gemini 3 Pro Image Preview",
        "provider": "1xm",
        "provider_label": "1XM / Nano Banana",
        "config_id": GEMINI_PRO_CONFIG_ID,
        "defaults": {"size": "2K"},
    },
)


def _llm_provider_maps(config: Mapping[str, Any]) -> tuple[dict[str, dict], dict[str, str]]:
    providers_by_model: dict[str, dict] = {}
    labels_by_model: dict[str, str] = {}
    for provider in BUILTIN_LLM_PROVIDERS:
        for model_id in provider.get("models") or ():
            providers_by_model.setdefault(str(model_id), provider)
            labels_by_model.setdefault(str(model_id), str(model_id))
    for provider in custom_llm_providers(dict(config), include_secrets=False):
        for model in provider.get("models") or []:
            model_id = _compact(model.get("id"))
            if not model_id:
                continue
            providers_by_model.setdefault(model_id, provider)
            labels_by_model[model_id] = _compact(model.get("label") or model.get("name")) or model_id
    return providers_by_model, labels_by_model


def _llm_models(config: Mapping[str, Any]) -> list[dict]:
    providers_by_model, labels_by_model = _llm_provider_maps(config)
    default_model = select_default_model(dict(config))
    models = []
    for model_id in agent_capable_model_ids():
        cap = model_capabilities(model_id)
        provider = providers_by_model.get(model_id) or {}
        provider_id = _compact(provider.get("id")) or resolve_provider_for_model(model_id, dict(config))
        models.append({
            "id": model_id,
            "label": labels_by_model.get(model_id, model_id),
            "type": "llm",
            "provider": provider_id,
            "provider_label": _compact(provider.get("display_name") or provider.get("name")) or provider_id,
            "route": resolve_provider_for_model(model_id, dict(config)),
            "runtime_model": official_real_model(model_id),
            "configured": model_has_configured_key(model_id, dict(config)),
            "default": model_id == default_model,
            "supports_switch": True,
            "context_window": cap.get("context_window"),
            "max_output_tokens": cap.get("max_output_tokens"),
            "input_modalities": list(cap.get("input_modalities") or ["text"]),
        })
    return models


def _image_models(config: Mapping[str, Any]) -> list[dict]:
    return [
        {
            **spec,
            "type": "ai-image",
            "configured": _configured(config, str(spec["config_id"])),
            "supports_switch": False,
        }
        for spec in AI_IMAGE_MODEL_SPECS
    ]


def _video_models() -> list[dict]:
    config = ai_video_generation_service.get_config().get("data") or {}
    provider_labels = {
        "seedance": "火山方舟 Seedance",
        "happyhorse": "百炼 / 快乐马",
    }
    models = []
    for item in config.get("models") or []:
        if not isinstance(item, Mapping):
            continue
        provider = _compact(item.get("provider"))
        model_id = _compact(item.get("id") or item.get("model"))
        if not provider or not model_id:
            continue
        models.append({
            "id": model_id,
            "label": _compact(item.get("label")) or model_id,
            "type": "ai-video",
            "provider": provider,
            "provider_label": provider_labels.get(provider, provider),
            "model": _compact(item.get("model")) or model_id,
            "configured": bool(item.get("configured")),
            "supports_switch": False,
            "defaults": dict(item.get("defaults") or {}),
        })
    return models


def _group(group_id: str, name: str, models: list[dict]) -> dict:
    return {
        "id": group_id,
        "name": name,
        "models": models,
        "configured_count": sum(1 for item in models if item.get("configured") is True),
        "total_count": len(models),
    }


def crawshrimp_model_catalog() -> dict:
    """Return all supported model families and their current configured state."""
    config = load_config()
    groups = [
        _group("llm", "LLM 对话模型", _llm_models(config)),
        _group("ai-image", "AI 生图模型", _image_models(config)),
        _group("ai-video", "AI 生视频模型", _video_models()),
    ]
    return {
        "ok": True,
        "groups": groups,
        "configured_count": sum(group["configured_count"] for group in groups),
        "total_count": sum(group["total_count"] for group in groups),
    }
