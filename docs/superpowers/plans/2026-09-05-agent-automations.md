# Harness Agent Automations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build local-first Agent Automations that can be created and managed in an Agent conversation, execute scheduled or checkpointed loops, and only take actions selected by a tested, pure condition program and the Automation's own authorization policy.

**Architecture:** `core.automation_program` is a deterministic parser/validator/evaluator for a restricted JSON AST. `core.automation_controller.AutomationController` is the only owner of definitions, durable trigger claiming, APScheduler registration, loop rearming, Agent Turn submission and status projection; it persists its authority in new SQLite tables through `data_sink` and does not modify the existing `task_schedules` behavior. FastAPI and MCP expose the same normalized Automation view; the Electron renderer consumes the API through the established preload bridge.

**Tech Stack:** Python 3.12, SQLite, APScheduler, FastAPI/Pydantic, existing `AgentService`/MCP gateway, Electron IPC, Vue 3, `pytest`/`unittest`, Node `node:test`.

## Global Constraints

- Keep `task_schedules` and all of its routes/register functions as fixed Adapter Task compatibility only.
- Store Automation definitions/runs/checkpoints/program versions in the local product SQLite database; APScheduler is rebuildable, not authoritative.
- Use IANA timezone names and five-field cron syntax; if the local backend was offline, record `missed` and never silently catch up.
- Conditions are a validated JSON AST evaluated without `eval`, JSRunner, network, CDP, disk, process or notification access.
- A condition only selects a branch. The allowed tool set is the intersection of the Automation execution policy and that branch's allowed capabilities.
- An Automation always uses its own policy snapshot; inherited session context never grants the conversation's temporary permissions.
- One Automation is single-flight. Scheduled trigger keys, loop cycle sequence keys and manual request keys are distinct durable idempotency keys.
- Unsupported observation, missing evidence, missing authorization or a failed verification yields `needs_review`; do not queue a hidden approval request.
- Temporary scripts are run-scoped and are never published automatically.
- Follow TDD: write and run the focused failing test before production code for every task.

---

### Task 1: Persist normalized Automation definitions, Programs and runs

**Files:**
- Create: `tests/test_agent_automation_data.py`
- Modify: `core/data_sink.py:77-196` and the persistence-function section after `record_task_schedule_run`

**Interfaces:**
- Produces `data_sink.create_agent_automation(values)`, `get_agent_automation(uid)`, `list_agent_automations(...)`, `update_agent_automation(uid, **fields)`, `archive_agent_automation(uid)`.
- Produces `create_agent_automation_program(automation_uid, program)`, `get_agent_automation_program(version_uid)`, `create_agent_automation_run(automation_uid, trigger_kind, trigger_uid, ...)`, `claim_agent_automation_run(...)`, `update_agent_automation_run(run_uid, **fields)`, and `list_agent_automation_runs(automation_uid, limit)`.
- The returned public-detail row contains decoded JSON fields named `schedule`, `loop_policy`, `execution_policy`, `checkpoint`, `program`, `facts_summary`, and `checkpoint_before`/`checkpoint_after`.

- [ ] **Step 1: Write the failing persistence tests**

```python
def test_create_automation_round_trips_policy_and_program(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    data_sink.init_db()
    created = data_sink.create_agent_automation({
        "title": "库存检查", "objective_prompt": "检查库存", "automation_kind": "loop",
        "context_mode": "isolated", "schedule": {},
        "loop_policy": {"cycle_interval_seconds": 1800, "max_cycles": 3, "failure_threshold": 2},
        "execution_policy": {"toolset": ["observe"], "timeout_seconds": 300, "max_retries": 1},
    })
    version = data_sink.create_agent_automation_program(created["automation_uid"], _restock_program())
    stored = data_sink.update_agent_automation(created["automation_uid"], active_program_version_uid=version["program_version_uid"])
    assert stored["loop_policy"]["cycle_interval_seconds"] == 1800
    assert stored["execution_policy"]["toolset"] == ["observe"]
    assert stored["active_program_version_uid"] == version["program_version_uid"]


def test_claiming_same_trigger_is_idempotent(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    data_sink.init_db()
    automation = data_sink.create_agent_automation(_scheduled_values())
    first = data_sink.claim_agent_automation_run(automation["automation_uid"], "scheduled", "2026-09-06T00:30:00+00:00")
    second = data_sink.claim_agent_automation_run(automation["automation_uid"], "scheduled", "2026-09-06T00:30:00+00:00")
    assert first["created"] is True
    assert second == {"created": False, "run": first["run"]}
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `/Users/xingyicheng/Documents/crawshrimp-harness/venv/bin/python -m pytest tests/test_agent_automation_data.py -q`

Expected: FAIL because `create_agent_automation` and `claim_agent_automation_run` do not exist.

- [ ] **Step 3: Add tables, JSON serialization and scoped data-sink functions**

```python
conn.execute("""
    CREATE TABLE IF NOT EXISTS agent_automations (
        automation_uid TEXT PRIMARY KEY, title TEXT NOT NULL, objective_prompt TEXT NOT NULL,
        automation_kind TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        archived INTEGER NOT NULL DEFAULT 0, context_mode TEXT NOT NULL,
        source_session_id TEXT NOT NULL DEFAULT '', source_runtime_session_id TEXT NOT NULL DEFAULT '',
        schedule_json TEXT NOT NULL DEFAULT '{}', loop_policy_json TEXT NOT NULL DEFAULT '{}',
        execution_policy_json TEXT NOT NULL DEFAULT '{}', active_program_version_uid TEXT NOT NULL DEFAULT '',
        checkpoint_json TEXT NOT NULL DEFAULT '{}', next_run_at TEXT NOT NULL DEFAULT '', cycle_seq INTEGER NOT NULL DEFAULT 0,
        last_run_uid TEXT NOT NULL DEFAULT '', last_status TEXT NOT NULL DEFAULT '', last_error TEXT NOT NULL DEFAULT '',
        last_triggered_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )
""")
conn.execute("""
    CREATE TABLE IF NOT EXISTS agent_automation_runs (
        run_uid TEXT PRIMARY KEY, automation_uid TEXT NOT NULL, trigger_kind TEXT NOT NULL,
        trigger_uid TEXT NOT NULL, trigger_at TEXT NOT NULL, cycle_seq INTEGER,
        status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0, program_version_uid TEXT NOT NULL DEFAULT '',
        agent_session_id TEXT NOT NULL DEFAULT '', agent_run_id TEXT NOT NULL DEFAULT '',
        execution_policy_snapshot_json TEXT NOT NULL DEFAULT '{}', checkpoint_before_json TEXT NOT NULL DEFAULT '{}',
        checkpoint_after_json TEXT NOT NULL DEFAULT '{}', facts_summary_json TEXT NOT NULL DEFAULT '{}',
        matched_branch TEXT NOT NULL DEFAULT '', result_summary_json TEXT NOT NULL DEFAULT '{}',
        error_code TEXT NOT NULL DEFAULT '', error_message TEXT NOT NULL DEFAULT '',
        notification_status TEXT NOT NULL DEFAULT '', scheduled_at TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL DEFAULT '', finished_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(automation_uid, trigger_uid)
    )
""")
conn.execute("""
    CREATE TABLE IF NOT EXISTS agent_automation_program_versions (
        program_version_uid TEXT PRIMARY KEY, automation_uid TEXT NOT NULL,
        program_json TEXT NOT NULL, created_by_session_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    )
""")
conn.execute("""
    CREATE TABLE IF NOT EXISTS agent_automation_run_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_uid TEXT NOT NULL, link_kind TEXT NOT NULL,
        link_uid TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
        UNIQUE(run_uid, link_kind, link_uid)
    )
""")
```

`claim_agent_automation_run` must use `INSERT ... ON CONFLICT(automation_uid, trigger_uid) DO NOTHING`, read the row after the insert, and return exactly `{"created": bool, "run": detail}`. `update_agent_automation` must only allow named columns and refresh `updated_at`; no caller-provided SQL fragments.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `/Users/xingyicheng/Documents/crawshrimp-harness/venv/bin/python -m pytest tests/test_agent_automation_data.py -q`

Expected: PASS.

- [ ] **Step 5: Commit the data layer**

```bash
git add core/data_sink.py tests/test_agent_automation_data.py
git commit -m "feat: persist agent automations"
```

### Task 2: Build the pure, versioned Condition Program runtime

**Files:**
- Create: `core/automation_program.py`
- Create: `tests/test_automation_program.py`

**Interfaces:**
- Produces `validate_program(program: Mapping[str, Any]) -> dict` and `evaluate_program(program, *, facts, checkpoint, now) -> dict`.
- `evaluate_program` returns `{"matched_branch": str, "reason": str, "evidence_refs": list, "checkpoint_patch": dict, "loop_decision": str}` and never performs I/O.
- AST operands are literals or paths in `config`, `facts` or `checkpoint`; accepted node operators are `all`, `any`, `not`, `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `exists`, `changed`, `consecutive_matches`, and `cooldown_elapsed`.

- [ ] **Step 1: Write failing AST validation and evaluation tests**

```python
def test_evaluate_selects_highest_priority_branch_without_eval(monkeypatch):
    program = {
        "config": {"reorder_point": 20},
        "branches": [
            {"id": "notify", "priority": 1, "when": {"lt": [{"path": "facts.inventory.available"}, {"path": "config.reorder_point"}]}},
            {"id": "restock", "priority": 10, "when": {"all": [
                {"lt": [{"path": "facts.inventory.available"}, {"path": "config.reorder_point"}]},
                {"gt": [{"path": "facts.sales.last_7_days"}, 0]},
            ]}},
        ],
        "checkpoint": {"last_available": {"path": "facts.inventory.available"}},
    }
    monkeypatch.setattr("builtins.eval", lambda *_: (_ for _ in ()).throw(AssertionError("eval forbidden")))
    result = evaluate_program(program, facts={"inventory": {"available": 5}, "sales": {"last_7_days": 3}}, checkpoint={}, now="2026-09-05T00:00:00+00:00")
    assert result["matched_branch"] == "restock"
    assert result["checkpoint_patch"] == {"last_available": 5}


def test_validate_rejects_unknown_path_root_and_unknown_operator():
    with pytest.raises(ProgramValidationError, match="unknown operand root"):
        validate_program({"branches": [{"id": "bad", "when": {"eq": [{"path": "os.environ"}, 1]}}]})
    with pytest.raises(ProgramValidationError, match="unsupported operator"):
        validate_program({"branches": [{"id": "bad", "when": {"shell": "rm -rf"}}]})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `/Users/xingyicheng/Documents/crawshrimp-harness/venv/bin/python -m pytest tests/test_automation_program.py -q`

Expected: FAIL because `core.automation_program` does not exist.

- [ ] **Step 3: Implement recursive validation and evaluation**

```python
ALLOWED_PATH_ROOTS = {"config", "facts", "checkpoint"}
COMPARATORS = {"eq", "ne", "lt", "lte", "gt", "gte", "in"}

def _resolve(value: Any, context: Mapping[str, Any]) -> Any:
    if not isinstance(value, Mapping) or set(value) != {"path"}:
        return value
    parts = str(value["path"]).split(".")
    if not parts or parts[0] not in ALLOWED_PATH_ROOTS:
        raise ProgramValidationError("unknown operand root")
    current: Any = context
    for part in parts:
        if not isinstance(current, Mapping) or part not in current:
            return MISSING
        current = current[part]
    return current

def evaluate_program(program, *, facts, checkpoint, now):
    normalized = validate_program(program)
    context = {"config": normalized.get("config", {}), "facts": facts, "checkpoint": checkpoint, "now": now}
    matches = [branch for branch in normalized["branches"] if _truth(branch["when"], context)]
    branch = max(matches, key=lambda item: (int(item.get("priority", 0)), item["id"]), default=None)
    return {"matched_branch": branch["id"] if branch else "", "reason": "matched" if branch else "no_match", "evidence_refs": [], "checkpoint_patch": _checkpoint_patch(normalized, context), "loop_decision": "continue"}
```

The runtime must reject a string expression in `when`; the quoted DSL in the design spec is display-only and must be compiled to this AST before persistence.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `/Users/xingyicheng/Documents/crawshrimp-harness/venv/bin/python -m pytest tests/test_automation_program.py -q`

Expected: PASS.

- [ ] **Step 5: Commit the Condition Program runtime**

```bash
git add core/automation_program.py tests/test_automation_program.py
git commit -m "feat: add pure automation condition runtime"
```

### Task 3: Add the Automation Controller and isolated scheduling namespace

**Files:**
- Create: `core/automation_controller.py`
- Modify: `core/scheduler.py:1-260`
- Modify: `core/data_sink.py:2310-2860`
- Modify: `core/api_server.py:9320-9390`
- Create: `tests/test_automation_controller.py`

**Interfaces:**
- Produces `AutomationController(agent_service, scheduler_module)` with `restore()`, `refresh(automation_uid)`, `run_now(automation_uid)`, `pause(uid)`, `resume(uid)`, `archive(uid)`, `record_observation(run_uid, facts, evidence_refs)`, `record_verification(run_uid, result)`, `mark_needs_review(run_uid, code, message)`, and `record_execution_failure(automation_uid, code, retryable)`.
- Adds scheduler-only `register_automation_schedule(automation, callback)`, `unregister_automation_schedule(uid)`, and `list_automation_next_runs()`; no existing `register_task_schedule` call changes.
- Adds `data_sink.has_active_agent_automation_run(automation_uid, *, exclude_run_uid="") -> bool`, where active means only `claimed`, `queued`, `running`, or `retry_scheduled`; the Controller must exclude its newly claimed run before applying the single-flight check.
- Calls an injected observer executor for every Program run, calls the injected action executor only after a branch match (or for a `scheduled` definition with no Program), and records `missed` on startup instead of calling either executor for overdue triggers. The observer executor gets a read-only policy and must call `record_observation`; a completed observer without facts is converted to `needs_review`.

- [ ] **Step 1: Write failing controller/scheduler tests**

```python
@pytest.mark.asyncio
async def test_loop_rearms_only_after_verified_checkpoint(monkeypatch, tmp_path):
    controller, automation = _controller_with_loop(monkeypatch, tmp_path)
    claimed = await controller.run_now(automation["automation_uid"])
    await controller.record_observation(claimed["run_uid"], {"inventory": {"available": 5}, "sales": {"last_7_days": 1}}, [])
    assert _action_executor.calls == [(claimed["run_uid"], "restock")]
    assert data_sink.get_agent_automation(automation["automation_uid"])["next_run_at"] == ""
    await controller.record_verification(claimed["run_uid"], {"verified": True})
    assert data_sink.get_agent_automation(automation["automation_uid"])["next_run_at"]


def test_restore_marks_overdue_schedule_missed_without_running_executor(monkeypatch, tmp_path):
    controller, automation = _controller_with_overdue_schedule(monkeypatch, tmp_path)
    controller.restore(now="2026-09-05T09:00:00+08:00")
    assert _action_executor.calls == []
    assert data_sink.list_agent_automation_runs(automation["automation_uid"], 1)[0]["status"] == "missed"
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `/Users/xingyicheng/Documents/crawshrimp-harness/venv/bin/python -m pytest tests/test_automation_controller.py -q`

Expected: FAIL because `AutomationController` does not exist.

- [ ] **Step 3: Implement controller state transitions and scheduler registration**

```python
async def _claim_and_start(self, automation_uid: str, trigger_kind: str, trigger_uid: str, trigger_at: str) -> dict:
    claimed = data_sink.claim_agent_automation_run(automation_uid, trigger_kind, trigger_uid, trigger_at=trigger_at)
    run = claimed["run"]
    if not claimed["created"]:
        return run
    if data_sink.has_active_agent_automation_run(automation_uid, exclude_run_uid=run["run_uid"]):
        return data_sink.update_agent_automation_run(run["run_uid"], status="skipped_overlap", finished_at=_now_iso())
    return await self._start_run(run)

def _branch_toolset(self, automation: dict, branch: Mapping[str, Any]) -> list[str]:
    allowed = set((automation["execution_policy"] or {}).get("toolset") or [])
    branch_allowed = set(branch.get("allowed_capabilities") or allowed)
    return sorted(allowed & branch_allowed)
```

For IANA zones use `zoneinfo.ZoneInfo`; `at` uses `DateTrigger`, `every` uses the persisted anchor to calculate the next non-past boundary, and cron uses `CronTrigger.from_crontab(value, timezone=ZoneInfo(zone))`. A loop registers exactly one `DateTrigger` for `next_run_at`; registration is removed while the run is pending verification.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `/Users/xingyicheng/Documents/crawshrimp-harness/venv/bin/python -m pytest tests/test_automation_controller.py tests/test_task_schedules_scheduler.py -q`

Expected: PASS; the fixed Task Schedule tests demonstrate compatibility was preserved.

- [ ] **Step 5: Commit the controller**

```bash
git add core/automation_controller.py core/scheduler.py core/data_sink.py core/api_server.py tests/test_automation_controller.py
git commit -m "feat: schedule agent automations"
```

### Task 4: Connect Agent Turns and expose Automation MCP tools

**Files:**
- Modify: `core/agent/service.py:1276-1530`
- Modify: `core/agent/mcp_gateway.py:120-220, 500-580, and 2100-2180`
- Modify: `core/api_server.py:9360-9390`
- Create: `tests/test_agent_automation_mcp.py`

**Interfaces:**
- Extends `AgentService.submit_turn(..., automation_policy: Optional[dict] = None, automation_run_uid: str = "")`; only a Controller call supplies these fields, and `_run_one` projects them into the request-scoped MCP context.
- Adds `AgentService.submit_automation_turn(automation, run, prompt, toolset) -> dict`; isolated mode creates a session titled `自动化：<title>`, inherited mode serializes via the existing service queue and uses its stored source session. The queue item carries an immutable `automation_policy` and `automation_run_uid`.
- Adds MCP tools `automation_list`, `automation_get`, `automation_create`, `automation_update`, `automation_pause`, `automation_resume`, `automation_archive`, `automation_run_now`, `automation_runs`, `automation_program_test`, `automation_record_observation`, and `automation_record_verification`.
- The Controller is injected into MCP context; tools never manipulate APScheduler or SQLite directly. The MCP approval helpers auto-approve only a policy-matched risk/tool capability and report every mismatch to the Controller as `needs_review`; they keep normal interactive approval behavior unchanged.

- [ ] **Step 1: Write failing Agent/MCP tests**

```python
@pytest.mark.asyncio
async def test_submit_automation_turn_uses_isolated_session_and_policy_toolset(monkeypatch):
    service = AgentService()
    _seed_agent_db(monkeypatch)
    queued = await service.submit_automation_turn(
        {"automation_uid": "a1", "title": "库存", "context_mode": "isolated", "execution_policy": {"toolset": ["observe", "verify"]}},
        {"run_uid": "ar1"}, "执行 restock", ["observe"],
    )
    assert queued["session_id"].startswith("automation:a1:ar1")
    queued_item = service.queue.get_nowait()
    assert queued_item["grant_prefs"] == {"toolset": ["observe"]}
    assert queued_item["automation_policy"]["toolset"] == ["observe"]


def test_automation_program_test_returns_branch_and_checkpoint(monkeypatch):
    _bind_automation_controller(monkeypatch)
    result = mcp_gateway.tool_automation_program_test(_restock_program(), {"inventory": {"available": 2}, "sales": {"last_7_days": 1}}, {})
    assert result["ok"] is True
    assert result["data"]["matched_branch"] == "restock"
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `/Users/xingyicheng/Documents/crawshrimp-harness/venv/bin/python -m pytest tests/test_agent_automation_mcp.py -q`

Expected: FAIL because the Automation-specific Agent service and MCP functions do not exist.

- [ ] **Step 3: Implement the run-scoped Agent bridge and tools**

```python
async def submit_automation_turn(self, automation: dict, run: dict, prompt: str, toolset: list[str]) -> dict:
    if automation["context_mode"] == "inherited":
        session_id = str(automation["source_session_id"])
    else:
        session_id = f"automation:{automation['automation_uid']}:{run['run_uid']}"
        if not db.get_session(session_id):
            db.create_session(session_id, f"dsh-{uuid.uuid4().hex}", f"自动化：{automation['title']}")
    queued = await self.submit_turn(
        session_id, prompt, grant_prefs={"toolset": list(toolset)},
        automation_policy={"toolset": list(toolset), "execution_policy": automation["execution_policy"]},
        automation_run_uid=run["run_uid"],
    )
    return {**queued, "session_id": session_id}
```

`submit_turn` places copies of both new values into its queue item rather than using the queue's private storage. Before registering the runtime context in `_run_one`, copy these two queue fields into `mcp_gateway.bind_tool_context`. Add `ToolContext.automation_policy` and `ToolContext.automation_run_uid`; both default to `None`/empty for interactive runs. `_await_approval_blocking` and `_await_approval_async` first call `_automation_approval_decision(plan, summary)`: it returns `"approved"` only if the exact MCP tool name and risk capability are in that immutable policy, `"rejected"` after `controller.mark_needs_review(...)` for an Automation mismatch, and `None` for an ordinary interactive run. `automation_record_observation` and `automation_record_verification` must require `_require_run()`, require that the linked `agent_run_id` equals `ctx.active_run["run_id"]`, and pass only JSON-object facts/evidence to the Controller. The MCP registration names use the exact snake_case names above.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `/Users/xingyicheng/Documents/crawshrimp-harness/venv/bin/python -m pytest tests/test_agent_automation_mcp.py tests/test_agent_runtime_hardening.py -q`

Expected: PASS.

- [ ] **Step 5: Commit the Agent/MCP bridge**

```bash
git add core/agent/service.py core/agent/mcp_gateway.py core/api_server.py tests/test_agent_automation_mcp.py
git commit -m "feat: expose agent automation tools"
```

### Task 5: Add normalized FastAPI routes and lifecycle wiring

**Files:**
- Modify: `core/api_server.py:40-75, 9300-9400, 12480-13020`
- Create: `tests/test_agent_automation_api.py`

**Interfaces:**
- Adds `GET/POST /automations`, `GET/PATCH/DELETE /automations/{automation_uid}`, `POST /automations/{uid}/run-now`, `POST /automations/{uid}/pause`, `POST /automations/{uid}/resume`, `GET /automations/{uid}/runs`, and `POST /automations/program-test`.
- Request payloads accept JSON `schedule`, `loop_policy`, `execution_policy`, and `program`; API responses always serialize decoded JSON and normalized booleans.
- Lifespan creates a single Controller after `AgentService` starts, injects it into MCP gateway, and calls `restore()` only when this process owns the backend lock.

- [ ] **Step 1: Write failing API tests**

```python
def test_create_loop_returns_program_and_next_cycle(client, monkeypatch):
    response = client.post("/automations", json={
        "title": "库存闭环", "objective_prompt": "检查库存", "automation_kind": "loop",
        "context_mode": "isolated", "loop_policy": {"cycle_interval_seconds": 1800, "max_cycles": 0, "failure_threshold": 3},
        "execution_policy": {"toolset": ["observe"], "timeout_seconds": 300, "max_retries": 1},
        "program": _restock_program(),
    })
    assert response.status_code == 201
    body = response.json()
    assert body["automation"]["automation_kind"] == "loop"
    assert body["automation"]["program"]["branches"][0]["id"] == "restock"


def test_program_test_rejects_unsafe_ast(client):
    response = client.post("/automations/program-test", json={"program": {"branches": [{"id": "x", "when": {"eval": "1"}}]}, "facts": {}, "checkpoint": {}})
    assert response.status_code == 422
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `/Users/xingyicheng/Documents/crawshrimp-harness/venv/bin/python -m pytest tests/test_agent_automation_api.py -q`

Expected: FAIL with 404 because `/automations` is not registered.

- [ ] **Step 3: Implement Pydantic models, serializers and endpoints**

```python
class AutomationCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    objective_prompt: str = Field(min_length=1, max_length=20_000)
    automation_kind: str
    context_mode: str = "isolated"
    schedule: dict = Field(default_factory=dict)
    loop_policy: dict = Field(default_factory=dict)
    execution_policy: dict = Field(default_factory=dict)
    program: Optional[dict] = None

@app.post("/automations", status_code=201)
async def create_automation_endpoint(req: AutomationCreateRequest):
    automation = get_automation_controller().create(req.model_dump())
    return {"automation": _serialize_automation(automation)}
```

Validate `automation_kind` (`scheduled|loop`), `context_mode` (`isolated|inherited`), all schedule forms and the Program before any row is saved. Reject an inherited request without a known source session. Route delete archives and unregisters; it does not delete history.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `/Users/xingyicheng/Documents/crawshrimp-harness/venv/bin/python -m pytest tests/test_agent_automation_api.py tests/test_api_task_lifecycle.py -q`

Expected: PASS.

- [ ] **Step 5: Commit the API**

```bash
git add core/api_server.py tests/test_agent_automation_api.py
git commit -m "feat: add automation api"
```

### Task 6: Expose Automation management in Electron and the task center

**Files:**
- Create: `app/src/renderer/views/AutomationCenter.vue`
- Modify: `app/src/renderer/App.vue:160-180 and 330-350`
- Modify: `app/src/main.js:2947-2965`
- Modify: `app/src/preload.js:551-565`
- Modify: `app/src/renderer/utils/devCsBridge.js:422-431`
- Create: `app/src/renderer/utils/automationCenter.test.js`

**Interfaces:**
- Adds `window.cs.listAutomations`, `createAutomation`, `getAutomation`, `updateAutomation`, `archiveAutomation`, `pauseAutomation`, `resumeAutomation`, `runAutomationNow`, `listAutomationRuns`, and `testAutomationProgram`.
- `AutomationCenter` is reachable under the Task Center as an `自动化` tab and shows type, next run/next cycle, context mode, last status, Program version, checkpoint and run evidence.
- UI creates a draft, always calls `testAutomationProgram` before enabling a Program, and only displays `needs_review` with the saved reason; it never bypasses authorization.

- [ ] **Step 1: Write failing renderer contract tests**

```javascript
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

test('preload exposes the full automation management bridge', () => {
  const source = readFileSync(path.join(__dirname, '..', '..', 'preload.js'), 'utf8')
  for (const name of ['listAutomations', 'createAutomation', 'pauseAutomation', 'testAutomationProgram']) {
    assert.match(source, new RegExp(`${name}:`))
  }
})

test('automation center requires a successful program test before save', () => {
  const source = readFileSync(path.join(__dirname, '..', 'views', 'AutomationCenter.vue'), 'utf8')
  assert.match(source, /await window\.cs\.testAutomationProgram/)
  assert.match(source, /programTest\.value\.matched_branch/)
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `cd app && node --test src/renderer/utils/automationCenter.test.js`

Expected: FAIL because the bridge and `AutomationCenter.vue` do not exist.

- [ ] **Step 3: Add IPC/preload/dev bridge methods and the Vue management view**

```javascript
testAutomationProgram: (payload) => invokeWithApiFallback('automation-program-test', [payload || {}],
  () => apiCall('POST', '/automations/program-test', payload || {})),
runAutomationNow: (uid) => invokeWithApiFallback('run-automation-now', [uid],
  () => apiCall('POST', `/automations/${encodePathPart(uid)}/run-now`, {})),
```

The view has separate `scheduled` and `loop` form sections. It renders a Program preview/result before enable, treats `next_run_at` as server data, and offers only `运行一次`, `暂停/恢复`, `编辑`, and `归档` controls. It must not offer an automatic script-publish button.

- [ ] **Step 4: Run the focused test and build**

Run: `cd app && node --test src/renderer/utils/automationCenter.test.js && npm test && npm run vite:build`

Expected: PASS; Vite build exits 0.

- [ ] **Step 5: Commit the desktop UI**

```bash
git add app/src/main.js app/src/preload.js app/src/renderer/App.vue app/src/renderer/utils/devCsBridge.js app/src/renderer/views/AutomationCenter.vue app/src/renderer/utils/automationCenter.test.js
git commit -m "feat: add automation center"
```

### Task 7: Verify restart, safety gates and end-to-end contracts

**Files:**
- Modify: `tests/test_automation_controller.py`
- Modify: `tests/test_agent_automation_api.py`
- Modify: `docs/crawshrimp-harness/02-delivery.md`

**Interfaces:**
- Covers restart reconstruction, no-catch-up `missed`, single-flight behavior, loop circuit breaking, `needs_review` on insufficient policy, run-to-Agent/Task/artifact links and cancellation propagation.
- Documents the exact local validation command and remaining non-goals: cloud scheduling, remote workers, webhooks and automatic script publication.

- [ ] **Step 1: Write failing failure-mode tests**

```python
@pytest.mark.asyncio
async def test_ungranted_branch_moves_run_to_needs_review_without_agent_action(monkeypatch, tmp_path):
    controller, automation = _controller_with_loop(monkeypatch, tmp_path, toolset=["observe"])
    run = await controller.run_now(automation["automation_uid"])
    await controller.record_observation(run["run_uid"], {"inventory": {"available": 1}, "sales": {"last_7_days": 1}}, [])
    stored = data_sink.get_agent_automation_run(run["run_uid"])
    assert stored["status"] == "needs_review"
    assert _action_executor.calls == []


@pytest.mark.asyncio
async def test_repeated_retryable_loop_failure_pauses_and_records_circuit_breaker(monkeypatch, tmp_path):
    controller, automation = _controller_with_loop(monkeypatch, tmp_path, failure_threshold=2)
    await controller.record_execution_failure(automation["automation_uid"], "NETWORK", retryable=True)
    await controller.record_execution_failure(automation["automation_uid"], "NETWORK", retryable=True)
    assert data_sink.get_agent_automation(automation["automation_uid"])["enabled"] == 0
    assert data_sink.get_agent_automation(automation["automation_uid"])["last_status"] == "paused_circuit_breaker"
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `/Users/xingyicheng/Documents/crawshrimp-harness/venv/bin/python -m pytest tests/test_automation_controller.py tests/test_agent_automation_api.py -q`

Expected: FAIL until the safety transitions are implemented.

- [ ] **Step 3: Implement only the required final safety transitions and update delivery evidence**

```python
if not requested_toolset.issubset(set(automation["execution_policy"]["toolset"])):
    return data_sink.update_agent_automation_run(run_uid, status="needs_review", error_code="POLICY_DENIED", finished_at=_now_iso())
if failures >= int(loop_policy.get("failure_threshold", 3)):
    data_sink.update_agent_automation(automation_uid, enabled=False, last_status="paused_circuit_breaker")
    scheduler.unregister_automation_schedule(automation_uid)
```

In `02-delivery.md`, record commands/results only after they have actually run; do not represent a local test as desktop UI proof.

- [ ] **Step 4: Run all verification gates**

Run: `/Users/xingyicheng/Documents/crawshrimp-harness/venv/bin/python -m pytest tests/ -q`

Run: `cd app && npm test && npm run vite:build`

Run: `git diff --check main...HEAD`

Expected: all tests pass, renderer build exits 0, and diff check prints no output.

- [ ] **Step 5: Commit verification and documentation**

```bash
git add tests/test_automation_controller.py tests/test_agent_automation_api.py docs/crawshrimp-harness/02-delivery.md
git commit -m "test: cover automation safety boundaries"
```
