"""HTTP contracts for Agent Automation management."""
from __future__ import annotations

from fastapi.testclient import TestClient

from core import data_sink, runtime_paths
from core import scheduler as sched_module
from core import api_server
from core.automation_controller import AutomationController
from core.agent import db as agent_db


def _use_temp_product_db(monkeypatch, tmp_path):
    monkeypatch.setenv("CRAWSHRIMP_DATA", str(tmp_path))
    monkeypatch.setenv("CRAWSHRIMP_API_TOKEN", "test-token")
    monkeypatch.setattr(runtime_paths, "_runtime_data_root", None, raising=False)
    monkeypatch.setattr(runtime_paths, "_runtime_data_key", None, raising=False)
    runtime_paths.reset_runtime_data_root_cache()
    data_sink.init_db()
    agent_db.init_agent_db()


def _restock_program():
    return {
        "config": {"reorder_point": 20},
        "branches": [{
            "id": "restock",
            "priority": 10,
            "when": {"lt": [{"path": "facts.inventory.available"}, {"path": "config.reorder_point"}]},
            "allowed_capabilities": ["observe"],
        }],
        "checkpoint": {"last_available": {"path": "facts.inventory.available"}},
    }


def _request(method: str, path: str, **kwargs):
    client = TestClient(api_server.app)
    headers = dict(kwargs.pop("headers", {}))
    headers[api_server.API_TOKEN_HEADER] = "test-token"
    return client.request(method, path, headers=headers, **kwargs)


def test_create_loop_returns_program_and_next_cycle(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    monkeypatch.setattr(api_server, "get_automation_controller", lambda: controller)

    response = _request("POST", "/automations", json={
        "title": "库存闭环",
        "objective_prompt": "检查库存",
        "automation_kind": "loop",
        "context_mode": "isolated",
        "loop_policy": {"cycle_interval_seconds": 1800, "max_cycles": 0, "failure_threshold": 3},
        "execution_policy": {"toolset": ["observe"], "timeout_seconds": 300, "max_retries": 1},
        "program": _restock_program(),
    })

    assert response.status_code == 201
    body = response.json()
    assert body["automation"]["automation_kind"] == "loop"
    assert body["automation"]["program"]["branches"][0]["id"] == "restock"
    assert body["automation"]["next_run_at"]
    assert body["automation"]["enabled"] is True


def test_program_test_rejects_unsafe_ast(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    monkeypatch.setattr(api_server, "get_automation_controller", lambda: AutomationController(None, sched_module))

    response = _request("POST", "/automations/program-test", json={
        "program": {"branches": [{"id": "x", "when": {"eval": "1"}}]},
        "facts": {},
        "checkpoint": {},
    })

    assert response.status_code == 422
    assert response.json()["detail"]


def test_automation_routes_include_lifecycle_operations():
    paths = {
        (route.path, tuple(sorted(route.methods or [])))
        for route in api_server.app.routes
        if hasattr(route, "path")
    }
    assert ("/automations", ("GET",)) in paths
    assert ("/automations", ("POST",)) in paths
    assert ("/automations/{automation_uid}", ("DELETE",)) in paths
    assert ("/automations/{automation_uid}/run-now", ("POST",)) in paths
    assert ("/automations/{automation_uid}/pause", ("POST",)) in paths
    assert ("/automations/{automation_uid}/resume", ("POST",)) in paths
    assert ("/automations/{automation_uid}/runs", ("GET",)) in paths


def test_inherited_automation_requires_existing_source_session(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    monkeypatch.setattr(api_server, "get_automation_controller", lambda: controller)

    response = _request("POST", "/automations", json={
        "title": "继承上下文",
        "objective_prompt": "检查库存",
        "automation_kind": "scheduled",
        "context_mode": "inherited",
        "source_session_id": "missing",
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["observe"]},
    })

    assert response.status_code == 422
    assert "source_session_id" in response.json()["detail"]
