"""抓虾适配包的发布闸门校验。

这里的校验有意比 adapter_loader 更严格：loader 负责加载可信的已安装包，
本模块负责阻止智能体草稿绕过产品规定的 manifest + 页面 JS 合同。
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Mapping


_ASYNC_IIFE = re.compile(
    r"\(\s*async\s*(?:(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|function(?:\s+[A-Za-z_$][\w$]*)?\s*\()",
    re.MULTILINE,
)
_IIFE_CALL = re.compile(r"\}\s*\)\s*\(\s*\)\s*;?(?:\s|//[^\n]*|/\*[\s\S]*?\*/)*$")


def _mask_js_noncode(source: str) -> str:
    """把字符串/模板字面量/注释替换为空格，同时保留换行和代码位置。"""
    chars = list(source)
    masked = list(source)
    index = 0
    length = len(chars)
    while index < length:
        current = chars[index]
        next_char = chars[index + 1] if index + 1 < length else ""
        if current == "/" and next_char == "/":
            end = source.find("\n", index + 2)
            end = length if end < 0 else end
            for pos in range(index, end):
                masked[pos] = " "
            index = end
            continue
        if current == "/" and next_char == "*":
            end_marker = source.find("*/", index + 2)
            end = length if end_marker < 0 else end_marker + 2
            for pos in range(index, end):
                if masked[pos] != "\n":
                    masked[pos] = " "
            index = end
            continue
        if current in {"'", '"', "`"}:
            quote = current
            masked[index] = " "
            index += 1
            escaped = False
            while index < length:
                char = chars[index]
                if char != "\n":
                    masked[index] = " "
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == quote:
                    index += 1
                    break
                index += 1
            continue
        index += 1
    return "".join(masked)


def _outer_iife_body(source: str) -> str:
    """提取文件末尾实际执行的 async IIFE 函数体。"""
    masked = _mask_js_noncode(source)
    head = _ASYNC_IIFE.search(masked)
    tail = _IIFE_CALL.search(masked)
    if not head or not tail:
        return ""
    open_index = masked.find("{", head.end())
    close_index = tail.start()
    if open_index < 0 or open_index >= close_index:
        return ""
    depth = 0
    for index in range(open_index, close_index + 1):
        char = masked[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[open_index + 1:index] if index == close_index else ""
    return ""


def _has_top_level_contract_return(body: str) -> bool:
    """只接受外层 IIFE 自身的返回，不能用嵌套辅助函数里的 return 冒充。"""
    masked = _mask_js_noncode(body)
    for match in re.finditer(r"\breturn\s*\{", masked):
        depth = 0
        for char in masked[:match.start()]:
            if char == "{":
                depth += 1
            elif char == "}":
                depth = max(0, depth - 1)
        if depth != 0:
            continue
        open_index = masked.find("{", match.start())
        object_depth = 0
        for index in range(open_index, len(masked)):
            char = masked[index]
            if char == "{":
                object_depth += 1
            elif char == "}":
                object_depth -= 1
                if object_depth == 0:
                    keys = _top_level_object_keys(body[open_index + 1:index])
                    if {"success", "data", "meta"}.issubset(keys):
                        return True
                    break
    return False


def _top_level_object_keys(body: str) -> set[str]:
    """提取返回对象的顶层 identifier key，支持 ``key: value`` 与 shorthand。"""
    masked = _mask_js_noncode(body)
    flattened = []
    depths = {"{": 0, "[": 0, "(": 0}
    closing = {"}": "{", "]": "[", ")": "("}
    for char in masked:
        if char in depths:
            depths[char] += 1
            flattened.append(" ")
            continue
        if char in closing:
            key = closing[char]
            depths[key] = max(0, depths[key] - 1)
            flattened.append(" ")
            continue
        flattened.append(char if not any(depths.values()) else ("\n" if char == "\n" else " "))
    top = "".join(flattened)
    keys: set[str] = set()
    for segment in top.split(","):
        candidate = segment.strip()
        match = re.match(r"(?:\.\.\.)?([A-Za-z_$][\w$]*)\s*(?::|$)", candidate)
        if match:
            keys.add(match.group(1))
    return keys


def validate_page_script(source: str, filename: str = "script.js") -> None:
    """校验页面脚本是 async IIFE，且成功返回合同包含三个稳定字段。"""
    text = str(source or "")
    if not text.strip():
        raise ValueError(f"{filename} 内容为空")
    code = _mask_js_noncode(text)
    if not _ASYNC_IIFE.search(code) or not _IIFE_CALL.search(code):
        raise ValueError(f"{filename} 必须是立即执行的 async IIFE")
    iife_body = _outer_iife_body(text)
    valid_return = bool(iife_body) and _has_top_level_contract_return(iife_body)
    if not valid_return:
        raise ValueError(f"{filename} 必须返回包含 success、data、meta 的对象")


def validate_adapter_package(manifest: Mapping[str, Any], files: Mapping[str, Path]) -> None:
    """校验 manifest 的每个任务都指向包内合规的页面 JS。"""
    adapter_id = str(manifest.get("id") or "").strip()
    if not adapter_id:
        raise ValueError("manifest.yaml 缺少 id")
    tasks = manifest.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        raise ValueError("manifest.yaml 至少需要声明一个任务")
    # 复用正式 loader 的 Pydantic schema，先拦截路径型 adapter id、非法 task
    # id、缺失 entry_url/名称等；发布流程在任何快照/安装路径操作前都会调用这里。
    try:
        from core.models import AdapterManifest
        AdapterManifest(**dict(manifest))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"manifest.yaml 不符合适配包 schema: {exc}") from exc
    seen_tasks: set[str] = set()
    for index, task in enumerate(tasks, start=1):
        if not isinstance(task, Mapping):
            raise ValueError(f"manifest.yaml 第 {index} 个任务格式错误")
        task_id = str(task.get("id") or "").strip()
        if not task_id or task_id in seen_tasks:
            raise ValueError(f"manifest.yaml 第 {index} 个任务 id 缺失或重复")
        seen_tasks.add(task_id)
        raw_script = str(task.get("script") or "").strip().replace("\\", "/")
        script_path = Path(raw_script)
        if (
            not raw_script
            or script_path.is_absolute()
            or ".." in script_path.parts
            or script_path.suffix.lower() != ".js"
        ):
            raise ValueError(f"任务 {task_id} 必须声明包内 .js 页面脚本")
        source_path = files.get(raw_script)
        if source_path is None or not source_path.is_file():
            raise ValueError(f"manifest 声明的脚本文件缺失: {raw_script}")
        try:
            source = source_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise ValueError(f"读取 {raw_script} 失败: {exc}") from exc
        validate_page_script(source, raw_script)
