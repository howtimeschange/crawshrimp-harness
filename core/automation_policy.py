"""Shared, deny-first constraints for unattended tool execution.

Omitted flags preserve the exact tool/risk allowlist contract. Explicit false
is an additional restriction, never a grant. General code execution cannot
promise any of these restrictions and must not be offered under them.
"""
from collections.abc import Mapping


GENERAL_EXECUTION_TOOLS = {
    "fs_exec", "task_run", "script_run", "repo_install", "repo_update", "task_control",
    "automation_create", "automation_update", "automation_resume", "automation_run_now",
}
DENIED_TOOLS = {
    "allow_filesystem": {
        "fs_read", "fs_list", "fs_write", "attachment_read", "skill_read",
        "data_export", "image_generate", "video_generate", "repo_learn",
        "script_create_draft", "script_publish", "script_test", "skill_list", "repo_list",
        "data_preview", "data_analyze",
    },
    "allow_browser": {
        "browser_observe", "browser_eval", "browser_act", "browser_verify",
        "browser_navigate", "browser_capture_requests",
    },
    "allow_network": {
        "browser_eval", "browser_act", "browser_verify", "browser_navigate",
        "browser_capture_requests", "image_generate", "video_generate",
    },
    # Browser access is not a message destination. Message sends are checked
    # at the action/risk boundary; arbitrary execution remains denied below.
    "allow_external_messages": set(),
    "allow_script_publish": {"script_publish"},
}
NATIVE_TOOLS = {
    "read", "read_image", "glob", "grep", "skill",
    "write", "edit", "str_replace_editor",
    "bash", "pwsh",
    "web_search", "web_fetch", "crawshrimp_tool_domains", "enable_tools",
}
READ_ONLY_NATIVE_TOOLS = {
    "read", "read_image", "glob", "grep", "skill",
    "web_search", "web_fetch", "crawshrimp_tool_domains", "enable_tools",
}
NATIVE_TOOL_RISKS = {
    "read": {"read_only"},
    "read_image": {"read_only"},
    "glob": {"read_only"},
    "grep": {"read_only"},
    "skill": {"read_only"},
    "write": {"local_write"},
    "edit": {"local_write"},
    "str_replace_editor": {"local_write"},
    "bash": {"local_write", "external_write"},
    "pwsh": {"local_write", "external_write"},
    "web_search": {"read_only"},
    "web_fetch": {"read_only"},
    "crawshrimp_tool_domains": {"read_only"},
    "enable_tools": {"read_only"},
}
NATIVE_DENIED_TOOLS = {
    "allow_filesystem": {
        "read", "read_image", "glob", "grep", "skill",
        "write", "edit", "str_replace_editor", "bash", "pwsh",
    },
    "allow_network": {
        "bash", "pwsh", "web_search", "web_fetch",
    },
}
NATIVE_SHELL_TOOLS = {"bash", "pwsh"}
NATIVE_WEB_TOOLS = {"web_search", "web_fetch"}
PERMISSION_POLICY_FIELDS = {
    "toolset", "allowed_tools", "allowed_capabilities",
    "native_toolset", "allowed_risks", "risk",
    "allow_browser", "allow_filesystem", "allow_network",
    "allow_external_messages", "allow_script_publish",
    "browser_tab_id", "browser_url",
}
NON_PERMISSION_SESSION_POLICY_FIELDS = {
    "permission_mode",
    "timeout_seconds", "max_retries", "retry_backoff_seconds", "inherited_wait_seconds",
    "verification_schema",
}


def _policy_values(policy: Mapping, key: str) -> set[str]:
    raw = policy.get(key)
    if raw is None and isinstance(policy.get("execution_policy"), Mapping):
        raw = policy["execution_policy"].get(key)
    if not isinstance(raw, (list, tuple, set)):
        return set()
    return {str(item).strip() for item in raw if str(item).strip()}


def _canonical_permission_mode(value) -> str:
    mode = str(value or "").strip().lower()
    return "scoped" if mode in {"advanced", "legacy"} else mode


def infer_automation_permission_mode(
    policy: Mapping | None,
    *,
    automation_kind: str = "scheduled",
    has_program: bool = False,
) -> str:
    """Infer session-vs-scoped semantics without changing old allow-list rows.

    Ordinary scheduled Automations default to session authority when their
    execution policy is empty or contains only non-permission controls such as
    timeouts/retry/schema.  Any legacy permission field, even an empty
    ``toolset: []`` from older persisted definitions, keeps scoped semantics.
    """
    source = policy if isinstance(policy, Mapping) else {}
    nested = source.get("execution_policy") if isinstance(source.get("execution_policy"), Mapping) else None
    explicit = source.get("permission_mode")
    if explicit is None and nested is not None:
        explicit = nested.get("permission_mode")
    if explicit is not None and str(explicit).strip():
        mode = _canonical_permission_mode(explicit)
        return mode if mode in {"session", "scoped"} else mode
    kind = str(automation_kind or "").strip().lower()
    if kind != "scheduled" or has_program:
        return "scoped"
    layers = [source] + ([nested] if nested is not None else [])
    for layer in layers:
        for key in layer.keys():
            if key == "execution_policy":
                continue
            if key in PERMISSION_POLICY_FIELDS:
                return "scoped"
            if key not in NON_PERMISSION_SESSION_POLICY_FIELDS:
                return "scoped"
    return "session"


def _permission_mode(policy: Mapping) -> str:
    return infer_automation_permission_mode(policy)


def automation_policy_error(policy: Mapping, *, toolset=None) -> str:
    nested = policy.get("execution_policy")
    layers = [policy, nested] if isinstance(nested, Mapping) else [policy]
    permission_mode = _permission_mode(policy)
    if permission_mode not in {"scoped", "session"}:
        return "execution_policy.permission_mode must be session or scoped"
    if permission_mode == "session":
        permission_fields = (
            "toolset", "allowed_tools", "allowed_capabilities", "native_toolset", "allowed_risks",
            "allow_browser", "allow_filesystem", "allow_network",
            "allow_external_messages", "allow_script_publish",
            "browser_tab_id", "browser_url",
        )
        for layer in layers:
            for key in permission_fields:
                if key in layer:
                    return f"execution_policy.{key} cannot be set when permission_mode=session"
        return ""
    if toolset is None:
        toolset = policy.get("toolset")
        if toolset is None and isinstance(nested, Mapping):
            toolset = nested.get("toolset")
        if toolset is None:
            toolset = policy.get("allowed_capabilities")
    tools = {str(item).strip() for item in toolset or []}
    native_tools = _policy_values(policy, "native_toolset")
    unknown_native = sorted(native_tools - NATIVE_TOOLS)
    if unknown_native:
        return f"execution_policy.native_toolset contains unknown native tools: {', '.join(unknown_native)}"
    for flag, denied in DENIED_TOOLS.items():
        for layer in layers:
            if flag not in layer:
                continue
            value = layer[flag]
            if not isinstance(value, bool):
                return f"execution_policy.{flag} must be a boolean"
            conflicts = tools & (denied | GENERAL_EXECUTION_TOOLS)
            if value is False and conflicts:
                return f"execution_policy.{flag}=false conflicts with tools: {', '.join(sorted(conflicts))}"
            shell_conflicts = native_tools & NATIVE_SHELL_TOOLS
            if value is False and shell_conflicts:
                return f"execution_policy.{flag}=false conflicts with native shell tools: {', '.join(sorted(shell_conflicts))}"
    for flag, denied in NATIVE_DENIED_TOOLS.items():
        for layer in layers:
            if flag not in layer:
                continue
            value = layer[flag]
            if not isinstance(value, bool):
                return f"execution_policy.{flag} must be a boolean"
            conflicts = native_tools & denied
            if value is False and conflicts:
                return f"execution_policy.{flag}=false conflicts with native tools: {', '.join(sorted(conflicts))}"
    for flag in ("allow_filesystem", "allow_network"):
        for layer in layers:
            if flag not in layer:
                continue
            if not isinstance(layer[flag], bool):
                return f"execution_policy.{flag} must be a boolean"
    if native_tools & NATIVE_SHELL_TOOLS:
        for flag in ("allow_filesystem", "allow_network"):
            if not any(layer.get(flag) is True for layer in layers):
                return f"execution_policy.{flag}=true is required for native shell tools"
    if native_tools & NATIVE_WEB_TOOLS and not any(layer.get("allow_network") is True for layer in layers):
        return "execution_policy.allow_network=true is required for native web tools"
    allowed_risks = _policy_values(policy, "allowed_risks")
    if "browser_act" in tools and "local_write" not in allowed_risks:
        return (
            "execution_policy.allowed_risks must include local_write when browser_act is in toolset "
            "(query, input, select, scroll, and other page actions need local page-action authority; "
            "this does not authorize external messaging)"
        )
    missing_risks = sorted({
        risk
        for item in native_tools
        for risk in NATIVE_TOOL_RISKS[item]
        if risk not in allowed_risks
    })
    if missing_risks:
        return "execution_policy.allowed_risks must authorize native tool risks: " + ", ".join(missing_risks)
    return ""
