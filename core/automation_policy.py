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
    "allow_external_messages": {
        "browser_eval", "browser_act", "browser_navigate", "browser_verify", "browser_capture_requests",
    },
    "allow_script_publish": {"script_publish"},
}


def automation_policy_error(policy: Mapping, *, toolset=None) -> str:
    nested = policy.get("execution_policy")
    layers = [policy, nested] if isinstance(nested, Mapping) else [policy]
    if toolset is None:
        toolset = policy.get("toolset")
        if toolset is None and isinstance(nested, Mapping):
            toolset = nested.get("toolset")
        if toolset is None:
            toolset = policy.get("allowed_capabilities")
    tools = {str(item).strip() for item in toolset or []}
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
    return ""
