from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DEFAULT_BASE_URL = "http://127.0.0.1:18765"
TOKEN_HEADER = "X-Crawshrimp-Token"


class CrawshrimpAPIError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, detail: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.detail = detail


class CrawshrimpClient:
    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        token: str = "",
        timeout_seconds: float = 20.0,
    ):
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self.token = token.strip()
        self.timeout_seconds = max(1.0, float(timeout_seconds or 20.0))

    @classmethod
    def from_env(cls) -> "CrawshrimpClient":
        timeout_raw = os.environ.get("CRAWSHRIMP_MCP_TIMEOUT_SECONDS", "20")
        try:
            timeout_seconds = float(timeout_raw)
        except ValueError:
            timeout_seconds = 20.0
        return cls(
            base_url=os.environ.get("CRAWSHRIMP_BASE_URL", DEFAULT_BASE_URL),
            token=resolve_api_token(),
            timeout_seconds=timeout_seconds,
        )

    def request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        query: dict[str, Any] | None = None,
    ) -> Any:
        method = method.upper()
        url = self._url(path, query)
        data = None
        headers: dict[str, str] = {"Accept": "application/json"}
        if self.token:
            headers[TOKEN_HEADER] = self.token
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = Request(url, data=data, headers=headers, method=method)
        try:
            with urlopen(req, timeout=self.timeout_seconds) as response:
                payload = response.read()
                return _decode_response(payload, response.headers.get("content-type", ""))
        except HTTPError as exc:
            payload = exc.read()
            detail = _decode_response(payload, exc.headers.get("content-type", "")) if payload else None
            message = _error_message(detail) or f"Crawshrimp API returned HTTP {exc.code}"
            raise CrawshrimpAPIError(message, status_code=exc.code, detail=detail) from exc
        except URLError as exc:
            raise CrawshrimpAPIError(f"Crawshrimp API is unreachable: {exc.reason}") from exc
        except TimeoutError as exc:
            raise CrawshrimpAPIError("Crawshrimp API request timed out") from exc

    def _url(self, path: str, query: dict[str, Any] | None) -> str:
        normalized_path = "/" + str(path or "").lstrip("/")
        url = f"{self.base_url}{normalized_path}"
        clean_query = _clean_query(query or {})
        if clean_query:
            url = f"{url}?{urlencode(clean_query, doseq=True)}"
        return url


def resolve_api_token() -> str:
    env_token = str(os.environ.get("CRAWSHRIMP_API_TOKEN") or "").strip()
    if env_token:
        return env_token

    explicit_file = str(os.environ.get("CRAWSHRIMP_API_TOKEN_FILE") or "").strip()
    candidates: list[Path] = []
    if explicit_file:
        candidates.append(Path(explicit_file).expanduser())

    data_root = str(os.environ.get("CRAWSHRIMP_DATA") or "").strip()
    if data_root:
        candidates.append(Path(data_root).expanduser() / "api-token")

    home = Path.home()
    if sys.platform == "darwin":
        candidates.append(home / "Library" / "Application Support" / "crawshrimp" / "api-token")
    elif sys.platform == "win32":
        local_app_data = str(os.environ.get("LOCALAPPDATA") or "").strip()
        roaming_app_data = str(os.environ.get("APPDATA") or "").strip()
        if local_app_data:
            candidates.append(Path(local_app_data).expanduser() / "crawshrimp" / "api-token")
        if roaming_app_data:
            candidates.append(Path(roaming_app_data).expanduser() / "crawshrimp" / "api-token")
    candidates.append(home / ".crawshrimp" / "api-token")

    for candidate in candidates:
        try:
            if candidate.exists():
                token = candidate.read_text(encoding="utf-8").strip()
                if token:
                    return token
        except OSError:
            continue
    return ""


def _decode_response(payload: bytes, content_type: str) -> Any:
    text = payload.decode("utf-8", errors="replace")
    if "application/json" in content_type.lower():
        return json.loads(text) if text else None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def _error_message(detail: Any) -> str:
    if isinstance(detail, dict):
        raw = detail.get("detail") or detail.get("message") or detail.get("error")
        if isinstance(raw, dict):
            return str(raw.get("message") or raw.get("code") or raw)
        if raw:
            return str(raw)
    if isinstance(detail, str) and detail.strip():
        return detail.strip()
    return ""


def _clean_query(query: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key, value in query.items():
        if value is None or value == "":
            continue
        cleaned[key] = value
    return cleaned
