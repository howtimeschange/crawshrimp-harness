#!/usr/bin/env python3
"""web host 启动探测 + 禁用行二分。

用法:
  python3 scripts/bisect-web.py check            # 全量配置启动探测
  python3 scripts/bisect-web.py disable id1,id2  # 禁用指定行后探测
"""
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE_YML = ROOT / "web-cordis.yml"


def disable_rows(yml_text: str, ids: list[str]) -> str:
    """在目标行的 name 之后插入 disabled: true;已有则跳过(前瞻下一行)。"""
    lines = yml_text.splitlines()
    out: list[str] = []
    skip_next = False
    for i, line in enumerate(lines):
        m = re.match(r"^    - id: (\S+)$", line)
        if m:
            skip_next = m.group(1) in ids
            out.append(line)
            continue
        if skip_next and re.match(r"^      name: ", line):
            out.append(line)
            nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
            if nxt != "disabled: true":
                out.append("      disabled: true")
            skip_next = False
            continue
        out.append(line)
    return "\n".join(out)


def boot(disable_ids: list[str], timeout_s: int = 35) -> tuple[bool, str]:
    yml = disable_rows(BASE_YML.read_text(encoding="utf-8"), disable_ids)
    tmp = ROOT / f".bisect-{int(time.time())}.yml"
    tmp.write_text(yml, encoding="utf-8")
    script = f"""
const {{ spawn }} = require('node:child_process')
const path = require('node:path')
const root = process.cwd()
const c = spawn('../../app/node_modules/.bin/electron', ['node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js'], {{
  env: {{...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_CORDIS_CONFIG: {str(tmp)!r},
    CRAWSHRIMP_SESSION_ROOT: path.resolve(root, '.bisect-sessions'), CRAWSHRIMP_STORAGE_ROOT: path.resolve(root, '.bisect-storages'),
    CRAWSHRIMP_WORKSPACE_ROOT: path.resolve(root, 'workspace'), CRAWSHRIMP_WEB_PORT: '3090'}},
  stdio: ['pipe', 'pipe', 'pipe'],
}})
let err = ''
c.stderr.on('data', d => {{ err = (err + String(d)).slice(-3000) }})
c.stdin.write(JSON.stringify({{jsonrpc:'2.0',id:1,method:'initialize',params:{{cwd:path.resolve(root,'workspace'),provider:'crawshrimp-overseas-openai',model:'gpt-5.6-terra',maxTokens:8000}}}}) + '\\n')
c.stdout.on('data', d => {{
  const t = String(d)
  if (t.includes('"serverInfo"')) {{ console.log('RESULT OK'); process.exit(0) }}
}})
setTimeout(() => {{ console.log('RESULT CRASH'); process.exit(0) }}, {timeout_s * 1000})
"""
    try:
        result = subprocess.run(["node", "-e", script], cwd=str(ROOT), capture_output=True,
                                text=True, timeout=timeout_s + 20)
        output = result.stdout.strip()
        if "RESULT OK" in output:
            return True, "boot ok"
        return False, output.split("RESULT ")[-1].strip()[:120] if "RESULT " in output else "no-result"
    finally:
        try:
            tmp.unlink()
        except OSError:
            pass


SUSPECTS = [
    "timer", "hmr", "typert", "typert-loader", "typert-gateway", "session",
    "session-title", "session-title-llm", "user-questions", "agent", "jobs", "llm-retry",
    "settings", "credentials", "attachment-local", "session-query-sqlite", "session-projection",
    "sandbox", "sandbox-policy", "approval", "permission", "fs-observation-policy",
    "skill", "skill-badge", "commands", "command-feedback", "goal", "goal-round-driver",
    "command-goal", "plan-mode", "command-compact", "timeout-policy", "spill-local",
    "spill-policy", "tool-result-pruner", "repeat-tool-reminder", "agent-loop",
    "fs-sandbox", "llm-deepseek", "session-log-download", "workspace", "directory-picker",
    "api-gateway", "session-stats", "message-feedback", "storage", "storage-json",
    "storage-domain", "code-runtime", "session-projection-cache", "plugin-inventory",
    "api-remotes", "cordis-host-runner", "client-runtime", "cordis-client-runner",
    "webserver", "web-runtime", "connection", "modules", "client-hmr", "locale",
    "ui-theme", "ui-layout", "ui-sidebar", "ui-settings", "ui-settings-general",
    "ui-conversation", "ui-tool", "ui-input-trigger", "ui-commands", "ui-skill",
    "ui-subagent", "ui-jobs", "ui-goal", "ui-message-feedback", "ui-model-selection",
    "ui-permission", "ui-agent-preset", "ui-plan", "ui-user-questions", "ui-trajectory",
    "ui-settings-models", "ui-settings-plugin-inventory", "ui-settings-plugins",
    "ui-cordis", "ui-workflow-run", "ui-deliverables", "ui-workspace",
]


def all_row_ids() -> list[str]:
    return re.findall(r"^    - id: (\S+)$", BASE_YML.read_text(encoding="utf-8"), re.M)


ALWAYS_ON = {
    "launcher", "sdk-jsonrpc-server", "llm", "system-prompt", "agent-default-model",
    "mcp-crawshrimp", "session-persistence-jsonl", "session-checkpoint-policy",
    "token-meter", "compaction-basic",
}


def hunt():
    """多缺陷追猎:逐个找出所有导致启动失败的元凶行(基建行永不禁用)。"""
    ids = [i for i in all_row_ids() if i not in ALWAYS_ON]
    culprits: list[str] = []
    ok_all, _ = boot(ids, timeout_s=30)
    print(f"[hunt] 全禁 {len(ids)} 候选行 → {_}", flush=True)
    if not ok_all:
        print("[hunt] 全禁仍失败:元凶在 insert 机制本身或必留行", flush=True)
        return culprits

    for iteration in range(1, 9):
        ok_base, _ = boot(culprits, timeout_s=30)
        if ok_base:
            print(f"[hunt] 收敛: {len(culprits)} 个元凶: {culprits}", flush=True)
            return culprits
        remaining = [i for i in ids if i not in culprits]
        lo, hi = 0, len(remaining)
        while hi - lo > 1:
            mid = (lo + hi) // 2
            tested = culprits + remaining[lo:mid]
            ok, msg = boot(tested, timeout_s=30)
            print(f"  iter{iteration} [{lo}:{mid}:{hi}] disable {len(tested)} → {msg}", flush=True)
            if ok:
                hi = mid  # 元凶在 remaining[lo:mid]
            else:
                lo = mid  # 元凶在 remaining[mid:hi]
        culprit = remaining[lo]
        print(f"[hunt] 第 {iteration} 个元凶: {culprit}", flush=True)
        culprits.append(culprit)
    print(f"[hunt] 超过迭代上限,已找到: {culprits}", flush=True)
    return culprits


def bisect():
    suspects = list(SUSPECTS)
    round_no = 0
    while len(suspects) > 1 and round_no < 8:
        round_no += 1
        half = len(suspects) // 2
        first = suspects[:half]
        ok, msg = boot(first)
        print(f"[bisect r{round_no}] disable {len(first)} rows {first[:6]}{'...' if len(first) > 6 else ''} → {msg}", flush=True)
        if ok:
            # 禁用这批后正常 → 元凶在这批里
            suspects = first
        else:
            suspects = suspects[half:]
    print(f"[bisect] 收敛: {suspects}", flush=True)
    return suspects


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "check":
        ok, msg = boot([])
        print(f"[check] {msg}")
    elif len(sys.argv) > 1 and sys.argv[1] == "disable":
        ids = sys.argv[2].split(",")
        ok, msg = boot(ids)
        print(f"[disable {len(ids)}] {msg}")
    elif len(sys.argv) > 1 and sys.argv[1] == "all":
        ok, msg = boot(SUSPECTS)
        print(f"[disable ALL {len(SUSPECTS)}] {msg}")
    elif len(sys.argv) > 1 and sys.argv[1] == "hunt":
        hunt()
    else:
        bisect()
