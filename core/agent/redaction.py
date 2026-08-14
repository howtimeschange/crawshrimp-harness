"""智能体审计与 UI 事件使用的结构化秘密脱敏。"""
from __future__ import annotations

import re
from typing import Any


REDACTED = "[REDACTED]"

_SENSITIVE_KEY = re.compile(
    r"(?:^|[_\-.])(?:password|passwd|pwd|token|secret|cookie|authorization|"
    r"api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|session[_-]?key)"
    r"(?:$|[_\-.])",
    re.IGNORECASE,
)

_TEXT_PATTERNS = (
    (re.compile(r"(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}", re.IGNORECASE), r"\1[REDACTED]"),
    (re.compile(r"\bsk-[A-Za-z0-9._-]{8,}\b", re.IGNORECASE), "sk-[REDACTED]"),
    (
        re.compile(
            r"((?:api[_-]?key|access[_-]?key|token|secret|password|passwd|pwd|cookie|"
            r"authorization)[\"']?\s*[:=]\s*[\"']?)[^\"'\s,;]{8,}",
            re.IGNORECASE,
        ),
        r"\1[REDACTED]",
    ),
)


def is_sensitive_key(key: Any) -> bool:
    normalized = str(key or "").strip()
    if not normalized:
        return False
    if _SENSITIVE_KEY.search(normalized):
        return True
    # 同时覆盖 apiKey/accessToken/clientSecret 等 camelCase 键。
    compact = re.sub(r"[^a-z0-9]", "", normalized.lower())
    return any(fragment in compact for fragment in (
        "password", "passwd", "apikey", "accesstoken", "refreshtoken", "authtoken",
        "secret", "cookie", "authorization", "accesskey", "privatekey", "sessionkey",
    )) or compact in {"pwd", "token"}


def redact_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    for pattern, replacement in _TEXT_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def redact_value(value: Any, *, parent_key: str = "") -> Any:
    """递归保留对象结构，只移除敏感键的值与字符串内常见凭证。"""
    if is_sensitive_key(parent_key):
        return REDACTED
    if isinstance(value, dict):
        return {
            key: REDACTED if is_sensitive_key(key) else redact_value(item, parent_key=str(key))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    if isinstance(value, tuple):
        return [redact_value(item) for item in value]
    if isinstance(value, str):
        return redact_text(value)
    return value


def contains_redaction(value: Any) -> bool:
    # 文本模式会把 Bearer/token 等替换成字符串片段，例如
    # ``"Bearer [REDACTED]"``；不能只判断整个值是否恰好等于占位符，
    # 否则执行计划会把脱敏后的假参数交给真实任务。
    if isinstance(value, str) and REDACTED in value:
        return True
    if isinstance(value, dict):
        return any(contains_redaction(item) for item in value.values())
    if isinstance(value, (list, tuple)):
        return any(contains_redaction(item) for item in value)
    return False
