"""Read upstream model IDs without storing credentials or changing settings."""
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from core import llm_gateway


GLM_DOCS_INDEX = "https://docs.bigmodel.cn/llms.txt"
DISCOVERY_PROVIDERS = frozenset({"crawshrimp-deepseek-official", "crawshrimp-glm-official"})


class ModelDiscoveryError(ValueError):
    pass


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _read_url(url, api_key=""):
    headers = {"Accept": "application/json" if api_key else "text/plain"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    with build_opener(_NoRedirect()).open(Request(url, headers=headers), timeout=15) as response:
        content = response.read(2 * 1024 * 1024 + 1)
    if len(content) > 2 * 1024 * 1024:
        raise ModelDiscoveryError("模型列表响应过大，请手动添加模型。")
    return content.decode("utf-8")


def _model_specs(provider, wire_ids):
    defaults = llm_gateway.builtin_provider_default_models()[provider["id"]]
    by_wire_id = {llm_gateway.official_real_model(model["id"]): model for model in defaults}
    # Official GLM documentation covers Flash and FlashX as vision models.
    # Use the same conservative local budgets without adding FlashX to the preset list.
    if provider.get("official_glm") and "glm-5.3-flash" in by_wire_id:
        by_wire_id["glm-5.3-flashx"] = {
            **by_wire_id["glm-5.3-flash"],
            "id": "glm-official-5.3-flashx", "label": "GLM-5.3-FlashX",
        }
    specs = []
    seen = set()
    prefix = "deepseek" if provider.get("official_deepseek") else "glm"
    for value in wire_ids:
        wire_id = str(value or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}", wire_id) or wire_id in seen:
            continue
        seen.add(wire_id)
        known = by_wire_id.get(wire_id)
        product_id = wire_id.replace(f"{prefix}-", f"{prefix}-official-", 1) if wire_id.startswith(f"{prefix}-") else wire_id
        specs.append(dict(known) if known else {
            "id": product_id, "label": wire_id,
            "context_window": 256000, "max_output_tokens": 32768,
            "input_modalities": ["text", "image"], "supports_tools": True,
        })
    return specs


def _glm_documented_models(provider):
    try:
        index = _read_url(GLM_DOCS_INDEX)
    except (HTTPError, URLError, TimeoutError, OSError, UnicodeError) as exc:
        raise ModelDiscoveryError("GLM 模型接口不可用，官方文档目录也暂时无法读取；可手动添加模型。") from exc
    ids = []
    for title, slug in re.findall(
        r"^- \[([^\]]+)\]\(https://docs\.bigmodel\.cn/cn/guide/models/(?:text|vlm)/([a-zA-Z0-9.-]+)\.md\)",
        index, re.MULTILINE,
    ):
        if not re.fullmatch(r"glm-\d[a-zA-Z0-9.-]*", slug, re.IGNORECASE):
            continue
        ids.append(slug.lower())
        # Shared Flash/FlashX documentation covers two distinct API IDs.
        for variant in re.findall(r"/(FlashX?)\b", title, re.IGNORECASE):
            if slug.lower().endswith("-flash"):
                ids.append(slug[:-len("flash")] + variant.lower())
    models = _model_specs(provider, ids)
    if not models:
        raise ModelDiscoveryError("官方文档目录中未找到对话模型；可手动添加模型。")
    return {"models": models, "source": "official_docs", "source_url": GLM_DOCS_INDEX,
            "notice": "来自 GLM 官方文档目录，尚未验证当前 Key 的调用权限。新型号的上下文和输出额度请核对后设置。"}


def discover_builtin_provider_models(provider_id, config, *, base_url="", api_key=""):
    if provider_id not in DISCOVERY_PROVIDERS:
        raise ModelDiscoveryError("目前仅支持获取 DeepSeek 和 GLM 官方模型列表。")
    provider = next(item for item in llm_gateway.BUILTIN_LLM_PROVIDERS if item["id"] == provider_id)
    llm = (config.get("ai") or {}).get("llm") or {}
    base_url = str(base_url or llm_gateway._base_url_for_builtin_provider(provider, llm)).strip().rstrip("/")
    try:
        parsed = urlparse(base_url)
        valid_url = (parsed.scheme in {"http", "https"} and parsed.hostname and parsed.port != 0
                     and not (parsed.username or parsed.password or parsed.query or parsed.fragment))
    except ValueError:
        valid_url = False
    if not valid_url:
        raise ModelDiscoveryError("Base URL 必须是有效的 HTTP(S) 地址，且不能包含用户名、密码、查询参数或片段。")
    api_key = str(api_key or "").strip()
    if not api_key or "••••" in api_key:
        api_key = llm_gateway._key_for_builtin_provider(provider, llm)
    if not api_key:
        if provider.get("official_glm"):
            return _glm_documented_models(provider)
        raise ModelDiscoveryError("请先配置或输入此 Provider 的 API Key。")
    endpoint = llm_gateway._endpoint(base_url, "/models")
    try:
        data = json.loads(_read_url(endpoint, api_key))
    except HTTPError as exc:
        if provider.get("official_glm") and exc.code in {404, 405, 501}:
            return _glm_documented_models(provider)
        if exc.code in {401, 403}:
            raise ModelDiscoveryError(f"模型列表鉴权失败（HTTP {exc.code}），请检查此 Provider 的 Key 和权限。") from exc
        raise ModelDiscoveryError(f"获取模型列表失败（HTTP {exc.code}），请检查地址或稍后重试。") from exc
    except (json.JSONDecodeError, UnicodeError) as exc:
        if provider.get("official_glm"):
            return _glm_documented_models(provider)
        raise ModelDiscoveryError("模型列表接口没有返回有效的 JSON。") from exc
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        raise ModelDiscoveryError("无法连接模型列表接口，请检查 Base URL 和网络后重试。") from exc
    rows = data.get("data") if isinstance(data, dict) else None
    models = _model_specs(provider, [item.get("id") for item in rows if isinstance(item, dict)]) if isinstance(rows, list) else []
    if not models:
        if provider.get("official_glm"):
            return _glm_documented_models(provider)
        raise ModelDiscoveryError("接口未返回可用的模型列表；可手动添加模型。")
    return {"models": models, "source": "api", "source_url": endpoint,
            "notice": "来自当前 Provider 的 /models 接口。列表不保证调用权限；新型号的上下文和输出额度请核对后设置。"}
