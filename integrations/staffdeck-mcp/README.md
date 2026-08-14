# Crawshrimp StaffDeck MCP

StaffDeck 通过这个 sidecar 调用抓虾本地 API，把抓虾的本地自动化能力挂成数字员工工具。它不修改 StaffDeck 主体，也不直接执行 adapter 代码；真实执行仍在抓虾桌面端和本地 Python API 中完成。

## 能力边界

当前 POC 只暴露四个 MCP 工具：

- `crawshrimp_health`：检查抓虾服务、Chrome、adapter 和调度状态。
- `crawshrimp_list_tasks`：读取已安装 adapter/task 和参数声明。
- `crawshrimp_start_task`：受控启动抓虾后台任务，默认 dry-run。
- `crawshrimp_get_task_status`：读取任务状态。

SOP 和数字员工模板暂不放在这个目录里。先确认 StaffDeck 能发现并同步工具，再补目标员工的 SOP 图和模板。

## 配置

不要把抓虾 token 写入 StaffDeck 数据库或模板文件。推荐让 sidecar 自己读取本机 token：

```bash
export CRAWSHRIMP_BASE_URL="http://127.0.0.1:18765"
export CRAWSHRIMP_API_TOKEN_FILE="$HOME/Library/Application Support/crawshrimp/api-token"
```

如果抓虾通过 `CRAWSHRIMP_DATA` 指定数据目录，sidecar 会自动尝试读取：

```text
$CRAWSHRIMP_DATA/api-token
```

真实启动任务默认关闭。只有同时满足以下条件，`crawshrimp_start_task` 才会调用抓虾 `/run` 接口：

- 工具参数 `dry_run=false`
- 工具参数 `confirmed=true`
- sidecar 进程环境变量 `CRAWSHRIMP_STAFFDECK_ALLOW_START=1`

否则返回 `mode=dry_run` 和 `would_call`，不会访问抓虾启动接口。

## 本地运行

```bash
cd /Users/xingyicheng/Documents/crawshrimp/integrations/staffdeck-mcp
python3 -m staffdeck_mcp.server
```

StaffDeck MCP server 配置建议：

```json
{
  "transport": "stdio",
  "command": "python3",
  "args": ["-m", "staffdeck_mcp.server"],
  "cwd": "/Users/xingyicheng/Documents/crawshrimp/integrations/staffdeck-mcp",
  "env": {
    "CRAWSHRIMP_BASE_URL": "http://127.0.0.1:18765"
  }
}
```

在 StaffDeck 中新增 MCP Server 后，执行 Discover，再 Sync 需要的工具到目标数字员工。StaffDeck 当前接口路径是：

- 探测未保存连接：`POST /api/enterprise/mcp-servers/discover`
- 保存后探测：`POST /api/enterprise/mcp-servers/{server_id}/discover`
- 同步工具：`POST /api/enterprise/mcp-servers/{server_id}/sync`

## 操作原则

`crawshrimp_start_task` 会启动真实本地任务。数字员工 SOP 应在调用前完成：

1. `crawshrimp_health`
2. `crawshrimp_list_tasks`
3. 向用户确认 adapter、task、参数、导出目录和外部影响
4. `crawshrimp_start_task` 先 dry-run，让用户确认 `would_call`
5. 确认后用 `dry_run=false`、`confirmed=true` 启动
6. 周期性 `crawshrimp_get_task_status`

TEMU 洗水唛、深绘鞋品、AI 图/视频等任务都应保留抓虾原有的 dry-run、显式保存、人工审核和本地文件边界。
