from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Callable

from . import __version__
from .crawshrimp import CrawshrimpAPIError, CrawshrimpClient

JSON = dict[str, Any]
ToolHandler = Callable[[JSON, CrawshrimpClient], Any]


def _schema(properties: JSON, required: list[str] | None = None) -> JSON:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": False,
    }


def _output_schema(properties: JSON, required: list[str] | None = None) -> JSON:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": True,
    }


TOOL_DEFINITIONS: list[JSON] = [
    {
        "name": "crawshrimp_health",
        "description": "只读检查抓虾本地服务、Chrome 连接、适配器数量和调度器状态。",
        "inputSchema": _schema(
            {"probe": {"type": "boolean", "description": "只返回轻量运行时信息。"}}
        ),
        "outputSchema": _output_schema(
            {
                "status": {"type": "string"},
                "chrome": {"type": "boolean"},
                "adapter_count": {"type": "integer"},
            }
        ),
    },
    {
        "name": "crawshrimp_list_tasks",
        "description": "只读列出抓虾已安装适配器任务，可按 adapter_id/task_id 过滤。",
        "inputSchema": _schema(
            {
                "adapter_id": {"type": "string"},
                "task_id": {"type": "string"},
                "include_disabled": {"type": "boolean", "default": False},
                "include_params": {"type": "boolean", "default": True},
            }
        ),
        "outputSchema": _output_schema(
            {
                "count": {"type": "integer"},
                "tasks": {"type": "array", "items": {"type": "object", "additionalProperties": True}},
            },
            ["count", "tasks"],
        ),
    },
    {
        "name": "crawshrimp_start_task",
        "description": (
            "受控启动抓虾 adapter 任务。默认 dry_run，不会产生外部影响；"
            "真实启动需 confirmed=true 且本机环境显式允许。"
        ),
        "inputSchema": _schema(
            {
                "adapter_id": {"type": "string"},
                "task_id": {"type": "string"},
                "params": {"type": "object", "additionalProperties": True},
                "current_tab_id": {"type": "string"},
                "dry_run": {"type": "boolean", "default": True},
                "confirmed": {"type": "boolean", "default": False},
            },
            ["adapter_id", "task_id"],
        ),
        "outputSchema": _output_schema(
            {
                "ok": {"type": "boolean"},
                "mode": {"type": "string", "enum": ["dry_run", "started"]},
                "adapter_id": {"type": "string"},
                "task_id": {"type": "string"},
                "start": {"type": "object", "additionalProperties": True},
            },
            ["ok", "mode", "adapter_id", "task_id"],
        ),
    },
    {
        "name": "crawshrimp_get_task_status",
        "description": "读取抓虾任务运行状态。支持 adapter_id/task_id 或 task instance uid。",
        "inputSchema": _schema(
            {
                "adapter_id": {"type": "string"},
                "task_id": {"type": "string"},
                "instance_uid": {"type": "string"},
            }
        ),
        "outputSchema": _output_schema(
            {
                "adapter_id": {"type": "string"},
                "task_id": {"type": "string"},
                "live": {"type": "object", "additionalProperties": True},
                "last_run": {"type": "object", "additionalProperties": True},
            }
        ),
    },
]


def tools_list() -> list[JSON]:
    return [dict(item) for item in TOOL_DEFINITIONS]


def call_tool(name: str, arguments: JSON | None, client: CrawshrimpClient | None = None) -> Any:
    handler = _HANDLERS.get(name)
    if handler is None:
        raise ValueError(f"Unknown tool: {name}")
    return handler(dict(arguments or {}), client or CrawshrimpClient.from_env())


def _health(args: JSON, client: CrawshrimpClient) -> Any:
    return client.request("GET", "/health", query={"probe": bool(args.get("probe", False))})


def _list_tasks(args: JSON, client: CrawshrimpClient) -> Any:
    tasks = client.request("GET", "/tasks")
    if not isinstance(tasks, list):
        return {"tasks": [], "raw": tasks}
    adapter_id = _text(args.get("adapter_id"))
    task_id = _text(args.get("task_id"))
    include_disabled = bool(args.get("include_disabled", False))
    include_params = args.get("include_params", True) is not False
    filtered = []
    for task in tasks:
        if not isinstance(task, dict):
            continue
        if adapter_id and task.get("adapter_id") != adapter_id:
            continue
        if task_id and task.get("task_id") != task_id:
            continue
        if not include_disabled and task.get("enabled") is False:
            continue
        item = dict(task)
        if not include_params:
            item.pop("params", None)
        filtered.append(item)
    return {"count": len(filtered), "tasks": filtered}


def _start_task(args: JSON, client: CrawshrimpClient) -> Any:
    adapter_id, task_id = _require_adapter_task(args)
    body = {
        "params": _object(args.get("params")),
        "current_tab_id": _text(args.get("current_tab_id")),
    }
    dry_run = args.get("dry_run", True) is not False
    confirmed = args.get("confirmed") is True
    allow_start = _allow_start()
    if dry_run or not confirmed or not allow_start:
        blocked_reasons = []
        if dry_run:
            blocked_reasons.append("dry_run=true")
        if not confirmed:
            blocked_reasons.append("confirmed is not true")
        if not allow_start:
            blocked_reasons.append("CRAWSHRIMP_STAFFDECK_ALLOW_START is not enabled")
        return {
            "ok": True,
            "mode": "dry_run",
            "adapter_id": adapter_id,
            "task_id": task_id,
            "would_call": {
                "method": "POST",
                "path": f"/tasks/{adapter_id}/{task_id}/run",
                "body": body,
            },
            "blocked_reasons": blocked_reasons,
            "message": (
                "No task was started. Set dry_run=false, confirmed=true, "
                "and CRAWSHRIMP_STAFFDECK_ALLOW_START=1 to run."
            ),
        }
    result = client.request(
        "POST",
        f"/tasks/{adapter_id}/{task_id}/run",
        body=body,
    )
    return {
        "ok": True,
        "mode": "started",
        "adapter_id": adapter_id,
        "task_id": task_id,
        "start": result,
    }


def _get_task_status(args: JSON, client: CrawshrimpClient) -> Any:
    instance_uid = _text(args.get("instance_uid"))
    if instance_uid:
        return client.request("GET", f"/task-instances/{instance_uid}/run-status")
    adapter_id, task_id = _require_adapter_task(args)
    return client.request("GET", f"/tasks/{adapter_id}/{task_id}/status")


_HANDLERS: dict[str, ToolHandler] = {
    "crawshrimp_health": _health,
    "crawshrimp_list_tasks": _list_tasks,
    "crawshrimp_start_task": _start_task,
    "crawshrimp_get_task_status": _get_task_status,
}


def handle_json_rpc(message: JSON, client: CrawshrimpClient | None = None) -> JSON | None:
    request_id = message.get("id")
    method = str(message.get("method") or "")
    if request_id is None:
        return None
    try:
        if method == "initialize":
            result = {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "crawshrimp-staffdeck-mcp", "version": __version__},
            }
        elif method == "tools/list":
            result = {"tools": tools_list()}
        elif method == "tools/call":
            params = message.get("params") if isinstance(message.get("params"), dict) else {}
            name = str(params.get("name") or "")
            arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
            result = _content_result(call_tool(name, arguments, client=client))
        else:
            return _json_rpc_error(request_id, -32601, f"Method not found: {method}")
        return {"jsonrpc": "2.0", "id": request_id, "result": result}
    except (CrawshrimpAPIError, ValueError) as exc:
        return {"jsonrpc": "2.0", "id": request_id, "result": _content_error(str(exc))}
    except Exception as exc:  # noqa: BLE001 - isolate MCP server from host process
        return _json_rpc_error(request_id, -32603, f"Internal error: {exc}")


def run_stdio(client: CrawshrimpClient | None = None) -> int:
    client = client or CrawshrimpClient.from_env()
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(message, dict):
            continue
        response = handle_json_rpc(message, client=client)
        if response is None:
            continue
        sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Crawshrimp StaffDeck MCP stdio server")
    parser.add_argument("--version", action="store_true", help="print version and exit")
    args = parser.parse_args(argv)
    if args.version:
        print(__version__)
        return 0
    return run_stdio()


def _content_result(data: Any) -> JSON:
    return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}


def _content_error(message: str) -> JSON:
    return {"isError": True, "content": [{"type": "text", "text": message}]}


def _json_rpc_error(request_id: Any, code: int, message: str) -> JSON:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _require_adapter_task(args: JSON) -> tuple[str, str]:
    adapter_id = _text(args.get("adapter_id"))
    task_id = _text(args.get("task_id"))
    if not adapter_id or not task_id:
        raise ValueError("adapter_id and task_id are required")
    return adapter_id, task_id


def _text(value: Any) -> str:
    return str(value or "").strip()


def _object(value: Any) -> JSON:
    return dict(value) if isinstance(value, dict) else {}


def _allow_start() -> bool:
    return str(os.environ.get("CRAWSHRIMP_STAFFDECK_ALLOW_START") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


if __name__ == "__main__":
    raise SystemExit(main())
