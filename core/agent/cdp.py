"""智能体浏览器层:CDP WebSocket 客户端(9222)。

为 MCP 浏览器工具提供 observe / eval / act / verify / capture_requests。
所有页面内容视为不可信数据,结果一律裁剪后返回。
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Optional

import websockets

OBSERVE_JS = r"""
(() => {
  const cap = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) : s; };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const q = (sel) => Array.from(document.querySelectorAll(sel)).filter(visible);
  return {
    url: location.href,
    title: cap(document.title, 120),
    bodyText: cap(document.body ? document.body.innerText : '', 4000),
    links: q('a').slice(0, 60).map(a => ({ text: cap(a.innerText || a.textContent, 60), href: cap(a.href, 200) })),
    buttons: q('button, input[type=button], input[type=submit], [role=button]').slice(0, 60).map(b => ({ text: cap(b.innerText || b.textContent || b.value || b.getAttribute('aria-label'), 60) })),
    inputs: q('input, textarea, select').slice(0, 60).map(i => ({ tag: i.tagName.toLowerCase(), type: i.type || '', name: cap(i.name, 40), id: cap(i.id, 40), placeholder: cap(i.placeholder, 40), value: cap(i.value, 40) })),
  };
})()
"""

ACT_CLICK_JS = r"""
(() => {
  const selector = %s;
  const text = %s;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  let el = null;
  if (selector) {
    el = Array.from(document.querySelectorAll(selector)).find(visible) || null;
  } else if (text) {
    const t = String(text).trim().toLowerCase();
    const candidates = Array.from(document.querySelectorAll('a, button, input[type=button], input[type=submit], li, span, div, [role=button], label'));
    el = candidates.find((e) => visible(e) && (e.innerText || e.textContent || e.value || '').trim().toLowerCase() === t)
      || candidates.find((e) => visible(e) && (e.innerText || e.textContent || e.value || '').trim().toLowerCase().includes(t)) || null;
  }
  if (!el) return { clicked: false, error: '未找到目标元素' };
  el.scrollIntoView({ block: 'center' });
  el.click();
  return { clicked: true, tag: el.tagName.toLowerCase(), text: (el.innerText || el.textContent || el.value || '').trim().slice(0, 80) };
})()
"""

ACT_TYPE_JS = r"""
(() => {
  const selector = %s;
  const text = %s;
  const el = selector ? document.querySelector(selector) : document.activeElement;
  if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    return { typed: false, error: '目标不是可输入元素,请先提供 selector 或先聚焦输入框' };
  }
  el.focus();
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { typed: true, selector: selector || '(focused)', length: text.length };
})()
"""

ACT_SCROLL_JS = "window.scrollBy({ top: %s, behavior: 'smooth' }); 'scrolled'"

CAPTURE_HEADER_KEYS = ["content-type", "content-length"]


class CdpError(Exception):
    pass


class CdpClient:
    """单个 tab 的 CDP 会话(每工具调用短连接)。"""

    def __init__(self, ws_url: str, timeout: float = 20.0):
        self.ws_url = ws_url
        self.timeout = timeout
        self._ws: Any = None
        self._next_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._listeners: list[asyncio.Queue] = []

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, *exc):
        await self.close()

    async def connect(self) -> None:
        try:
            self._ws = await asyncio.wait_for(websockets.connect(self.ws_url, max_size=8 * 1024 * 1024), timeout=10)
        except Exception as exc:  # noqa: BLE001
            raise CdpError(f"CDP 连接失败: {exc}") from exc
        self._reader = asyncio.create_task(self._read_loop())

    async def _read_loop(self) -> None:
        try:
            async for raw in self._ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if isinstance(msg, dict) and msg.get("id") in self._pending:
                    fut = self._pending.pop(msg["id"])
                    if "error" in msg:
                        fut.set_exception(CdpError(msg["error"].get("message", "CDP error")))
                    else:
                        fut.set_result(msg.get("result", {}))
                else:
                    for queue in self._listeners:
                        queue.put_nowait(msg)
        except Exception:  # noqa: BLE001
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(CdpError("CDP 连接已断开"))
            self._pending.clear()

    async def close(self) -> None:
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:  # noqa: BLE001
                pass
            self._ws = None

    async def send(self, method: str, params: Optional[dict] = None) -> dict:
        if self._ws is None:
            raise CdpError("CDP 未连接")
        self._next_id += 1
        msg_id = self._next_id
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[msg_id] = fut
        await self._ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        return await asyncio.wait_for(fut, timeout=self.timeout)

    async def evaluate(self, expression: str, user_gesture: bool = False) -> dict:
        result = await self.send("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "userGesture": user_gesture,
            "awaitPromise": True,
        })
        if result.get("exceptionDetails"):
            text = result["exceptionDetails"].get("text", "JS 异常")
            detail = result["exceptionDetails"].get("exception", {}).get("description", "")
            raise CdpError(f"JS 异常: {text} {detail}"[:200])
        return result.get("result", {}).get("value")

    async def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._listeners.append(queue)
        return queue

    async def observe(self) -> dict:
        return await self.evaluate(OBSERVE_JS)

    async def act(self, action: str, payload: dict) -> dict:
        if action == "click":
            expr = ACT_CLICK_JS % (_js_literal(payload.get("selector")), _js_literal(payload.get("text")))
            return await self.evaluate(expr)
        if action == "type":
            expr = ACT_TYPE_JS % (_js_literal(payload.get("selector")), _js_literal(payload.get("text", "")))
            return await self.evaluate(expr)
        if action == "scroll":
            return {"result": await self.evaluate(ACT_SCROLL_JS % (float(payload.get("delta_y") or 0),))}
        if action == "wait":
            await asyncio.sleep(min(float(payload.get("ms") or 0), 10000) / 1000)
            return {"waited_ms": payload.get("ms")}
        raise CdpError(f"未知动作: {action}")

    async def navigate(self, url: str) -> dict:
        await self.send("Page.navigate", {"url": url})
        return {"navigated": True, "url": url}

    async def verify(self, expression: str) -> dict:
        value = await self.evaluate(f"!!({expression})")
        return {"ok": bool(value), "value": bool(value)}

    async def capture_requests(self, duration_ms: int = 3000) -> list[dict]:
        await self.send("Network.enable")
        queue = await self.subscribe()
        collected: list[dict] = []
        end_at = asyncio.get_event_loop().time() + min(duration_ms, 10000) / 1000
        try:
            while asyncio.get_event_loop().time() < end_at:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                method = msg.get("method", "")
                if method == "Network.requestWillBeSent":
                    req = (msg.get("params") or {}).get("request") or {}
                    headers = req.get("headers") or {}
                    collected.append({
                        "url": str(req.get("url", ""))[:300],
                        "method": req.get("method", ""),
                        "post_data": str(req.get("postData", ""))[:500],
                        "content_type": str(headers.get("content-type", headers.get("Content-Type", "")))[:100],
                    })
                if len(collected) >= 100:
                    break
        finally:
            self._listeners.remove(queue)
            try:
                await self.send("Network.disable")
            except Exception:  # noqa: BLE001
                pass
        return collected


def _js_literal(value: Any) -> str:
    if value is None or value == "":
        return "null"
    return json.dumps(str(value), ensure_ascii=False)


def url_prefix_matches(url: str, prefix: str) -> bool:
    if not prefix:
        return True
    return url.startswith(prefix)
