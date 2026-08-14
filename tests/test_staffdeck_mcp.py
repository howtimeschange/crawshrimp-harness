import json
import os
import subprocess
import sys
import unittest
from contextlib import suppress
from pathlib import Path


MCP_ROOT = Path(__file__).resolve().parents[1] / "integrations" / "staffdeck-mcp"
sys.path.insert(0, str(MCP_ROOT))

from staffdeck_mcp.crawshrimp import CrawshrimpClient  # noqa: E402
from staffdeck_mcp.server import call_tool, handle_json_rpc, tools_list  # noqa: E402


class FakeCrawshrimpClient(CrawshrimpClient):
    def __init__(self):
        super().__init__(base_url="http://fake.local", token="test-token")
        self.calls = []
        self.responses = {}

    def request(self, method, path, *, body=None, query=None):
        key = (method.upper(), path)
        self.calls.append({"method": method.upper(), "path": path, "body": body, "query": query or {}})
        if key not in self.responses:
            raise AssertionError(f"unexpected request: {key}")
        value = self.responses[key]
        return value() if callable(value) else value


class StaffDeckMCPTests(unittest.TestCase):
    def test_tools_list_contains_staffdeck_discoverable_schemas(self):
        tools = tools_list()
        names = {item["name"] for item in tools}

        self.assertEqual(
            names,
            {
                "crawshrimp_health",
                "crawshrimp_list_tasks",
                "crawshrimp_start_task",
                "crawshrimp_get_task_status",
            },
        )
        for tool in tools:
            self.assertEqual(tool["inputSchema"]["type"], "object")
            self.assertEqual(tool["outputSchema"]["type"], "object")
            self.assertIn("description", tool)

    def test_health_calls_public_crawshrimp_health_endpoint(self):
        client = FakeCrawshrimpClient()
        client.responses[("GET", "/health")] = {"status": "ok", "chrome": True}

        result = call_tool("crawshrimp_health", {"probe": False}, client)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(client.calls[0]["query"], {"probe": False})

    def test_list_tasks_filters_and_can_omit_large_params(self):
        client = FakeCrawshrimpClient()
        client.responses[("GET", "/tasks")] = [
            {
                "adapter_id": "temu",
                "task_id": "reviews",
                "enabled": True,
                "params": [{"id": "mode"}],
            },
            {
                "adapter_id": "temu",
                "task_id": "disabled",
                "enabled": False,
                "params": [{"id": "mode"}],
            },
            {"adapter_id": "shein", "task_id": "quality", "enabled": True, "params": []},
        ]

        result = call_tool(
            "crawshrimp_list_tasks",
            {"adapter_id": "temu", "include_params": False},
            client,
        )

        self.assertEqual(result["count"], 1)
        self.assertEqual(result["tasks"][0]["task_id"], "reviews")
        self.assertNotIn("params", result["tasks"][0])

    def test_start_task_defaults_to_dry_run_without_calling_crawshrimp(self):
        client = FakeCrawshrimpClient()

        result = call_tool(
            "crawshrimp_start_task",
            {
                "adapter_id": "temu",
                "task_id": "reviews",
                "params": {"mode": "new"},
                "current_tab_id": "tab-1",
            },
            client,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["mode"], "dry_run")
        self.assertEqual(result["would_call"]["path"], "/tasks/temu/reviews/run")
        self.assertEqual(client.calls, [])

    def test_start_task_posts_background_run_request_when_explicitly_enabled(self):
        client = FakeCrawshrimpClient()
        client.responses[("POST", "/tasks/temu/reviews/run")] = {
            "ok": True,
            "message": "Task started in background",
        }
        previous = os.environ.get("CRAWSHRIMP_STAFFDECK_ALLOW_START")
        os.environ["CRAWSHRIMP_STAFFDECK_ALLOW_START"] = "1"
        self.addCleanup(_restore_env, "CRAWSHRIMP_STAFFDECK_ALLOW_START", previous)

        result = call_tool(
            "crawshrimp_start_task",
            {
                "adapter_id": "temu",
                "task_id": "reviews",
                "params": {"mode": "new"},
                "current_tab_id": "tab-1",
                "dry_run": False,
                "confirmed": True,
            },
            client,
        )

        self.assertEqual(result["mode"], "started")
        self.assertTrue(result["start"]["ok"])
        self.assertEqual(
            client.calls[0]["body"],
            {"params": {"mode": "new"}, "current_tab_id": "tab-1"},
        )

    def test_status_supports_task_instance_uid(self):
        client = FakeCrawshrimpClient()
        client.responses[("GET", "/task-instances/inst_1/run-status")] = {"live": {"status": "running"}}

        status = call_tool("crawshrimp_get_task_status", {"instance_uid": "inst_1"}, client)

        self.assertEqual(status["live"]["status"], "running")

    def test_status_supports_adapter_task(self):
        client = FakeCrawshrimpClient()
        client.responses[("GET", "/tasks/temu/reviews/status")] = {"live": {"status": "idle"}}

        status = call_tool("crawshrimp_get_task_status", {"adapter_id": "temu", "task_id": "reviews"}, client)

        self.assertEqual(status["live"]["status"], "idle")

    def test_json_rpc_tools_call_returns_staffdeck_parseable_text_json(self):
        client = FakeCrawshrimpClient()
        client.responses[("GET", "/health")] = {"status": "ok"}

        response = handle_json_rpc(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "crawshrimp_health", "arguments": {}},
            },
            client,
        )

        self.assertEqual(response["id"], 1)
        text = response["result"]["content"][0]["text"]
        self.assertEqual(json.loads(text), {"status": "ok"})

    def test_stdio_server_initializes_and_lists_tools_without_crawshrimp_api(self):
        proc = subprocess.Popen(
            [sys.executable, "-m", "staffdeck_mcp.server"],
            cwd=str(MCP_ROOT),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            assert proc.stdin is not None
            assert proc.stdout is not None
            proc.stdin.write(
                json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
                + "\n"
            )
            proc.stdin.write(
                json.dumps(
                    {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}
                )
                + "\n"
            )
            proc.stdin.write(
                json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
                + "\n"
            )
            proc.stdin.flush()

            initialize = json.loads(proc.stdout.readline())
            listed = json.loads(proc.stdout.readline())
        finally:
            with suppress(Exception):
                proc.stdin.close()
            with suppress(Exception):
                proc.stdout.close()
            with suppress(Exception):
                proc.stderr.close()
            proc.kill()
            proc.wait(timeout=5)

        self.assertEqual(initialize["result"]["serverInfo"]["name"], "crawshrimp-staffdeck-mcp")
        names = {tool["name"] for tool in listed["result"]["tools"]}
        self.assertIn("crawshrimp_start_task", names)


def _restore_env(key, value):
    if value is None:
        os.environ.pop(key, None)
    else:
        os.environ[key] = value


if __name__ == "__main__":
    unittest.main()
