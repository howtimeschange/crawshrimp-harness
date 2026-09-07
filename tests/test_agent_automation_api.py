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
            "allowed_tools": ["automation_record_verification"],
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

    program = _restock_program()
    tested = _request("POST", "/automations/program-test", json={
        "program": program,
        "facts": {"inventory": {"available": 5}},
        "checkpoint": {},
    })
    assert tested.status_code == 200
    proof = tested.json()["result"]["program_test_proof"]
    response = _request("POST", "/automations", json={
        "title": "库存闭环",
        "objective_prompt": "检查库存",
        "automation_kind": "loop",
        "context_mode": "isolated",
        "loop_policy": {"cycle_interval_seconds": 1800, "max_cycles": 0, "failure_threshold": 3},
        "execution_policy": {"toolset": ["automation_record_observation", "automation_record_verification"], "timeout_seconds": 300, "max_retries": 1},
        "program": program,
        "program_test_proof": proof,
    })

    assert response.status_code == 201
    body = response.json()
    assert body["automation"]["automation_kind"] == "loop"
    assert body["automation"]["program"]["branches"][0]["id"] == "restock"
    assert body["automation"]["next_run_at"]
    assert body["automation"]["enabled"] is True


def test_automation_run_serializer_keeps_run_evidence_without_definition_fields():
    serializer = getattr(api_server, "_serialize_automation_run", None)
    assert callable(serializer)
    data = serializer({
        "run_uid": "run-1",
        "automation_uid": "automation-1",
        "execution_policy_snapshot": {"toolset": ["read_file"]},
        "definition_snapshot": {"title": "original"},
        "checkpoint_before": {"v": 1},
        "facts_summary": {"available": 2},
        "result_summary": {"verified": True},
        "links": {"agent_run_id": "agent-1"},
        "enabled": 1,
        "archived": 0,
        "next_run_at": "2026-09-07T10:00:00+08:00",
    })
    assert data["execution_policy_snapshot"] == {"toolset": ["read_file"]}
    assert data["definition_snapshot"] == {"title": "original"}
    assert data["links"] == {"agent_run_id": "agent-1"}
    assert "enabled" not in data
    assert "archived" not in data
    assert "next_run" not in data


def test_program_mutation_requires_a_fresh_matching_test_proof(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    monkeypatch.setattr(api_server, "get_automation_controller", lambda: controller)
    program = _restock_program()
    payload = {
        "title": "未经测试的闭环",
        "objective_prompt": "检查库存",
        "automation_kind": "loop",
        "context_mode": "isolated",
        "loop_policy": {"cycle_interval_seconds": 1800},
        "execution_policy": {"toolset": ["automation_record_observation", "automation_record_verification"]},
        "program": program,
    }

    rejected = _request("POST", "/automations", json=payload)

    assert rejected.status_code == 422
    assert "program-test" in rejected.json()["detail"]
    tested = _request("POST", "/automations/program-test", json={"program": program, "facts": {}, "checkpoint": {}})
    proof = tested.json()["result"]["program_test_proof"]
    payload["program_test_proof"] = proof
    payload["program"] = {**program, "config": {"reorder_point": 99}}

    mismatched = _request("POST", "/automations", json=payload)

    assert mismatched.status_code == 422
    assert "program-test" in mismatched.json()["detail"]


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
        "execution_policy": {"toolset": ["automation_record_verification"]},
    })

    assert response.status_code == 422
    assert "source_session_id" in response.json()["detail"]


def test_isolated_automation_cannot_choose_its_own_source_receipt_session(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    monkeypatch.setattr(api_server, "get_automation_controller", lambda: controller)
    agent_db.create_session("another-session", "dsh-another", "不应接收回执的会话")

    response = _request("POST", "/automations", json={
        "title": "隔离任务不能指定回执去向",
        "objective_prompt": "只做本地确认",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "source_session_id": "another-session",
        "source_runtime_session_id": "dsh-another",
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_verification"]},
    })

    assert response.status_code == 422
    assert "bound by its creating conversation" in response.json()["detail"]


def test_management_http_api_cannot_set_an_arbitrary_browser_tab_binding(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    monkeypatch.setattr(api_server, "get_automation_controller", lambda: controller)

    response = _request("POST", "/automations", json={
        "title": "HTTP 不能注入浏览器页面",
        "objective_prompt": "只读取创建会话已授权的页面",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {
            "toolset": ["browser_observe"],
            "browser_tab_id": "untrusted-http-tab",
        },
    })

    assert response.status_code == 422
    assert "browser_tab_id" in response.json()["detail"]


def test_patch_scheduled_automation_without_program_does_not_validate_empty_readback(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    monkeypatch.setattr(api_server, "get_automation_controller", lambda: controller)
    created = controller.create({
        "title": "原始标题",
        "objective_prompt": "检查库存",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_verification"]},
        "enabled": False,
    })

    response = _request("PATCH", f"/automations/{created['automation_uid']}", json={
        "title": "已更新标题",
        "execution_policy": {"toolset": ["automation_record_verification"], "timeout_seconds": 90},
    })

    assert response.status_code == 200
    automation = response.json()["automation"]
    assert automation["title"] == "已更新标题"
    assert automation["program"] == {}
    assert automation["execution_policy"]["timeout_seconds"] == 90


def test_patch_cannot_redirect_an_automation_source_conversation(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    monkeypatch.setattr(api_server, "get_automation_controller", lambda: controller)
    agent_db.create_session("original-source", "dsh-original", "原始会话")
    agent_db.create_session("other-source", "dsh-other", "其他会话")
    created = controller.create({
        "title": "来源不可重定向",
        "objective_prompt": "完成后只回到创建会话",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "source_session_id": "original-source",
        "source_runtime_session_id": "dsh-original",
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_verification"]},
        "enabled": False,
    })

    response = _request("PATCH", f"/automations/{created['automation_uid']}", json={
        "source_session_id": "other-source",
        "source_runtime_session_id": "dsh-other",
    })

    assert response.status_code == 422
    assert "immutable" in response.json()["detail"]
    stored = data_sink.get_agent_automation(created["automation_uid"])
    assert stored["source_session_id"] == "original-source"
    assert stored["source_runtime_session_id"] == "dsh-original"


def test_patch_cannot_change_automation_context_mode(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    monkeypatch.setattr(api_server, "get_automation_controller", lambda: controller)
    created = controller.create({
        "title": "隔离语义不可变",
        "objective_prompt": "不继承交互会话权限",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {
            "kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai",
        },
        "execution_policy": {"toolset": ["automation_record_verification"]},
        "enabled": False,
    })

    response = _request("PATCH", f"/automations/{created['automation_uid']}", json={
        "context_mode": "inherited",
    })

    assert response.status_code == 422
    assert "context_mode is immutable" in response.json()["detail"]
    assert data_sink.get_agent_automation(created["automation_uid"])["context_mode"] == "isolated"


def test_execution_policy_rejects_an_unbounded_or_fractional_timeout(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    monkeypatch.setattr(api_server, "get_automation_controller", lambda: controller)
    payload = {
        "title": "超时边界",
        "objective_prompt": "只允许受限时间内执行",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_verification"], "timeout_seconds": 0},
        "enabled": False,
    }
    first = _request("POST", "/automations", json=payload)
    assert first.status_code == 422
    assert "timeout_seconds" in first.json()["detail"]

    payload["execution_policy"]["timeout_seconds"] = 7.5
    second = _request("POST", "/automations", json=payload)
    assert second.status_code == 422
    assert "timeout_seconds" in second.json()["detail"]

    payload["execution_policy"] = {
        "toolset": ["automation_record_verification"],
        "inherited_wait_seconds": 0,
    }
    third = _request("POST", "/automations", json=payload)
    assert third.status_code == 422
    assert "inherited_wait_seconds" in third.json()["detail"]


def test_patch_can_remove_a_scheduled_condition_program_but_not_a_loop(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    monkeypatch.setattr(api_server, "get_automation_controller", lambda: controller)
    scheduled = controller.create({
        "title": "每晚核对库存",
        "objective_prompt": "核对库存后给出验证结果",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_observation", "automation_record_verification"]},
        "program": _restock_program(),
        "enabled": False,
    })
    response = _request("PATCH", f"/automations/{scheduled['automation_uid']}", json={"program": None})
    assert response.status_code == 200
    assert response.json()["automation"]["program"] == {}
    assert response.json()["automation"]["active_program_version_uid"] == ""

    loop = controller.create({
        "title": "库存持续观察",
        "objective_prompt": "每小时观察库存并按条件处理",
        "automation_kind": "loop",
        "context_mode": "isolated",
        "loop_policy": {"cycle_interval_seconds": 3600},
        "execution_policy": {"toolset": ["automation_record_observation", "automation_record_verification"]},
        "program": _restock_program(),
        "enabled": False,
    })
    response = _request("PATCH", f"/automations/{loop['automation_uid']}", json={"program": None})
    assert response.status_code == 422
    assert "requires a Program" in response.json()["detail"]


def test_automation_readback_projects_its_own_scheduler_next_run(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    monkeypatch.setattr(api_server, "get_automation_controller", lambda: controller)
    created = controller.create({
        "title": "调度投影",
        "objective_prompt": "检查库存",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_verification"]},
        "enabled": False,
    })

    controller.resume(created["automation_uid"])
    response = _request("GET", f"/automations/{created['automation_uid']}")

    assert response.status_code == 200
    assert response.json()["automation"]["next_run"].startswith("2099-01-01T00:00:00")


def test_automation_runs_expose_persisted_resource_links(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    monkeypatch.setattr(api_server, "get_automation_controller", lambda: controller)
    automation = controller.create({
        "title": "链接回读",
        "objective_prompt": "检查结果",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_verification"]},
    })
    run = data_sink.create_agent_automation_run(
        automation["automation_uid"], "manual", "manual:linked", agent_run_id="agent-run-1"
    )
    data_sink.link_agent_automation_run(run["run_uid"], "agent_run", "agent-run-1")
    data_sink.link_agent_automation_run(run["run_uid"], "artifact", "artifact-1")

    response = _request("GET", f"/automations/{automation['automation_uid']}/runs")

    assert response.status_code == 200
    links = response.json()["items"][0]["links"]
    assert {(link["link_kind"], link["link_uid"]) for link in links} == {
        ("agent_run", "agent-run-1"),
        ("artifact", "artifact-1"),
    }
