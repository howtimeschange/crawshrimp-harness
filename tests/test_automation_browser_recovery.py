import asyncio
from types import SimpleNamespace

from core.agent import db, mcp_gateway


def _seed_agent_db(monkeypatch, tmp_path):
    monkeypatch.setattr("core.runtime_paths.data_root", lambda: tmp_path)
    db.init_agent_db()


def test_browser_automation_create_accepts_authorized_url_with_navigate(monkeypatch, tmp_path):
    class Controller:
        def __init__(self):
            self.payload = None

        def create(self, payload):
            self.payload = dict(payload)
            return self.payload

    _seed_agent_db(monkeypatch, tmp_path)
    db.create_session("source-session", "dsh-source", "创建自动化")
    controller = Controller()
    previous = mcp_gateway.ctx.automation_controller
    mcp_gateway.set_automation_controller(controller)
    token = mcp_gateway.bind_tool_context({
        "active_run": {"run_id": "agent-create", "session_id": "source-session"},
        "grant": None,
        "current_tool_call_id": "",
    })
    try:
        result = mcp_gateway.tool_automation_create({
            "title": "巡检 X 主页",
            "execution_policy": {
                "toolset": ["browser_navigate", "browser_observe", "automation_record_verification"],
                "browser_url": "https://x.com/thsottiaux",
                "allow_network": True,
            },
        })
    finally:
        mcp_gateway.reset_tool_context(token)
        mcp_gateway.set_automation_controller(previous)

    assert result["ok"] is True
    assert controller.payload["execution_policy"]["browser_url"] == "https://x.com/thsottiaux"
    assert "browser_tab_id" not in controller.payload["execution_policy"]


def test_browser_navigate_recovers_closed_automation_tab_from_authorized_url(monkeypatch, tmp_path):
    _seed_agent_db(monkeypatch, tmp_path)
    db.create_session("automation-session", "dsh-automation", "自动化运行")
    created = []

    async def new_tab(url):
        tab = {
            "id": f"tab-{len(created)}",
            "type": "page",
            "url": url,
            "webSocketDebuggerUrl": "ws://fixture",
        }
        created.append(tab)
        return tab

    bridge = SimpleNamespace(new_tab_async=new_tab, get_tabs=lambda timeout=0: [])
    monkeypatch.setattr("core.cdp_bridge.get_bridge", lambda: bridge)
    token = mcp_gateway.bind_tool_context({
        "active_run": {"run_id": "agent-run", "session_id": "automation-session"},
        "grant": {"tab_id": "closed-tab"},
        "automation_policy": {
            "toolset": ["browser_navigate"],
            "execution_policy": {
                "toolset": ["browser_navigate"],
                "browser_url": "https://x.com/thsottiaux",
            },
        },
    })
    try:
        result = asyncio.run(mcp_gateway.tool_browser_navigate("https://x.com/thsottiaux"))
        grant = mcp_gateway.ctx.grant
    finally:
        mcp_gateway.reset_tool_context(token)

    assert result["ok"] is True
    assert result["data"]["new_tab"] is True
    assert created[0]["url"] == "https://x.com/thsottiaux"
    assert grant["tab_id"] == "tab-0"
    assert db.get_session("automation-session")["browser_tab_id"] == "tab-0"


def test_browser_navigate_keeps_legacy_live_bound_tab_without_browser_url(monkeypatch, tmp_path):
    _seed_agent_db(monkeypatch, tmp_path)
    db.create_session("automation-session", "dsh-automation", "自动化运行")
    navigated = []

    class FakeClient:
        def __init__(self, _ws_url):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def navigate(self, target):
            navigated.append(target)

    bridge = SimpleNamespace(
        get_tabs=lambda timeout=0: [{
            "id": "legacy-tab",
            "type": "page",
            "url": "https://x.com/thsottiaux",
            "webSocketDebuggerUrl": "ws://legacy",
        }],
    )
    monkeypatch.setattr("core.cdp_bridge.get_bridge", lambda: bridge)
    monkeypatch.setattr(mcp_gateway, "CdpClient", FakeClient)
    token = mcp_gateway.bind_tool_context({
        "active_run": {"run_id": "agent-run", "session_id": "automation-session"},
        "grant": {"tab_id": "legacy-tab"},
        "automation_policy": {
            "toolset": ["browser_navigate"],
            "execution_policy": {"toolset": ["browser_navigate"]},
        },
    })
    try:
        result = asyncio.run(mcp_gateway.tool_browser_navigate("https://example.com/legacy"))
    finally:
        mcp_gateway.reset_tool_context(token)

    assert result["ok"] is True
    assert navigated == ["https://example.com/legacy"]


def test_browser_navigate_rejects_automation_cross_origin_recovery(monkeypatch, tmp_path):
    _seed_agent_db(monkeypatch, tmp_path)
    db.create_session("automation-session", "dsh-automation", "自动化运行")
    created = []
    bridge = SimpleNamespace(
        new_tab_async=lambda url: created.append(url),
        get_tabs=lambda timeout=0: [],
    )
    monkeypatch.setattr("core.cdp_bridge.get_bridge", lambda: bridge)
    token = mcp_gateway.bind_tool_context({
        "active_run": {"run_id": "agent-run", "session_id": "automation-session"},
        "grant": None,
        "automation_policy": {
            "toolset": ["browser_navigate"],
            "execution_policy": {
                "toolset": ["browser_navigate"],
                "browser_url": "https://x.com/thsottiaux",
            },
        },
    })
    try:
        result = asyncio.run(mcp_gateway.tool_browser_navigate("https://example.com/"))
    finally:
        mcp_gateway.reset_tool_context(token)

    assert result["ok"] is False
    assert result["error"]["code"] == "AUTOMATION_BROWSER_URL_DENIED"
    assert created == []
