# 复用抓虾浏览器能力

无需复制浏览器引擎。CLI 的 `browser` 命令查找现有 `crawshrimp-skill`，无参数只报告路径，不连接浏览器。

查找顺序：显式 `--skill-dir` 或 `CRAWSHRIMP_BROWSER_SKILL_DIR`，否则同级技能、用户技能目录、Codex 插件缓存。存在多版本时建议指定准确路径。

```bash
python3 /path/to/scripts/computer_use.py browser
python3 /path/to/scripts/computer_use.py browser --skill-dir /path/to/crawshrimp-skill -- observe --cdp-url http://127.0.0.1:9222 --url-prefix https://example.com --task '读取页面' --journal ./work/web.json
```

Windows 可以设置 `$env:CRAWSHRIMP_BROWSER_SKILL_DIR='C:\skills\crawshrimp-skill'`。桥接将参数原样传给 `web_operator.py`，退出码原样返回；浏览器动作使用浏览器技能自己的 journal、授权和验证协议，不冒充桌面动作收据。当前 Python 需要该浏览器技能的依赖。

先读被选中的 SKILL.md。网页默认连接用户已有 9222 会话，优先页面自带 API/模块/请求路径，找不到可靠接口才用 DOM/CDP。明确指定目标 URL 前缀，避免选中其他登录会话。

## Electron/CEF

桌面窗口并不等于浏览器标签。先确认对应进程族和已有端口，再对已观察端口执行只读 `/json/version`、`/json/list` 检查；不要盲扫或猜固定端口。macOS 可对 `probe` 返回的 pid 使用 `lsof -nP -a -p PID -iTCP -sTCP:LISTEN`，并检查子进程；Windows `probe` 返回进程族监听端口线索。

有明确匹配页面时，可把该端口和目标 URL 传给已有浏览器执行器。原生菜单、非 web 对话框回到桌面层。若必须带 `--remote-debugging-port` 重启，先完成可做的只读工作，确认任务已有重启授权和未保存内容状态；不能把探测自动变成重启。

CDP、AX、UIA 都是可选能力；探到 Electron 不代表调试端口一定开放，探不到 AX 也不能直接推断应用架构。
