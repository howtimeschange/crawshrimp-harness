# 响应丢失与初始断连复现调查 — 2026-11-03

可以复现原错误的机制；尚不能唯一还原历史网络最初由谁断开。所有新探针只访问 loopback 合成服务，零付费调用，原请求未重发，生产配置与应用安装未改变。

## 客户端完整传输链路复现

使用实际已安装应用的原生可执行文件，以 RunAsNode 模式运行隔离脚本，直接加载安装包 asar 内的原 `managedAccount`、`managedFetch` 和 undici，避免本地依赖与安装包版本不同。运行时：Electron44.7.0 / Node24.21.0 / undici7.30.1；fixture账号、临时目录、5,543,083字节合成正文。

链路：loopback 调用方 → 真实本地broker → 真实Undici ProxyAgent → loopback CONNECT故障代理 → loopback账号服务夹具。主动断链是实验输入，并非观察到历史Clash就是断链者。

| 场景 | 实测结果 | 能证明什么 |
| --- | --- | --- |
| 直连/代理正常对照 | 均HTTP200，完整接收5.54MB | 夹具和传输本身可用 |
| 完整上传、首响应头前代理断开 | `UND_ERR_SOCKET`，broker返回409“官方请求结果未知”；夹具原请求随后完成 | 原错误不需要模型拒绝即可出现；409本身不能判断是否已受理 |
| 上传只传1KB后代理断开 | `EPIPE`，broker同样409；服务端未准入、没有完整请求记录 | 同一客户端错误也可发生在服务尚未受理时；不能以request:null认定某个历史请求未计费 |

每个场景均恰好一次dispatch。`EPIPE`在当前白名单诊断中被显示为UNKNOWN，原始transport异常只输出到console，提示现有可观测性存在缺口。详细结果见 [安装版传输实验](transport-repro-native-installed.json)。

## 当前真实本机Clash的90秒对照

使用同一已安装原生栈，5.54MB完整请求上传后，loopback服务等90秒才发出响应；同一轮并发执行直连和系统当前HTTP代理端口127.0.0.1:7897。

- DIRECT：HTTP200，90065ms。
- Clash HTTP代理：HTTP200，90069ms。

见 [90秒实验](transport-repro-native-90s-current-proxy.json)。这证明当前本机代理处理该loopback场景时没有统一80/90秒截断，**没有测试Clash到ModelJetty的公网出站路线，也不能排除历史瞬态断连、特定节点或目标规则的差异**。

本地源码依赖（undici7.28.0）曾先行通过相同场景；最终证据使用安装包undici7.30.1与Electron44.7.0，上述版本差异不混作完全相同运行时。

## 接近原事件时序的服务端实验

ModelJetty协查用实际生产镜像导出的service源码与loopback服务重现长时序：5,543,290字节合成请求在43.002秒传完，43.045秒开始原上游派发；实验主动在80.013秒断链；96.014秒才放行上游响应头。旧生产路径最终unknown、保留计费身份，夹具上游恰一次POST。

此实验的43/80/96秒是按原事件构造的**注入参数**，不证明找到了一个自然发生的80秒超时。实验没有运行实际Clash/Cloudflare/Nginx。其运行时Node22.23.1/undici6.27.0与客户端原生实验不同，二者分别证明服务端和客户端机制，不能合并宣称整个公网链路已原样复现。结果文件为ModelJetty `work/gemini-managed409-20261103/slow-upload-disconnect80.json`。

## 历史本机证据

- 系统代理当前配置HTTP/HTTPS127.0.0.1:7897。
- Clash保留的应用日志在18:02:15–18:02:16有DNS配置切换，18:04–18:06没有连接级断链日志。时间接近不能证明因果。
- 本机当前启动于21:29:31，当前Harness stdout/stderr均指向/dev/null；现有desktop.log与用户导出session日志没有原故障的undici cause/code。因此无法追溯读取当时究竟是EPIPE、ECONNRESET、UND_ERR_SOCKET还是其他异常。当前stdio状态本身也不能证明历史进程当时完全相同。
- 当前用户侧Clash controller socket不存在，服务侧runtime目录无读取权限；未修改代理配置或取得特权。

## 服务端证据边界

继续复用ModelJetty协查会话。本轮只读核对确认 `/account/*` 的proxy_read_timeout为660秒；combined access日志缺少request_time/request_length/上游耗时/CF-Ray/请求UUID，相关时间窗error日志无匹配记录。Nginx1.24.0源码显示读取请求体提前EOF可返回400，并在INFO级记录；body timeout走408分支。现网默认error级别会过滤INFO。因此400与上传提前结束机制一致，但不能从现有日志唯一确定原因，更不能按时间将400绑定到第二个UUID。

OIDC原窗口10:04:54–10:06:26 UTC没有源站 `/oidc/token` POST，未找到该账号desktop client在窗口中新签发token；10:05:00有一条相同IP+UA哈希的 `/account/models` 200。它们不支持“源站接收刷新请求后拒绝”这一解释，但不能排除刷新在到达源站前已失败；IP+UA只作弱关联。

原请求第一条已结算只能证明收费事实；没有保留下来的完整模型响应，不能把上游HTTP200单独当作客户端已取得完整结果的证明。最初触发断连的进程/网络节点仍待证据。

## 重跑方式

在本worktree的app目录执行；所有目的地均为loopback，脚本不会访问ModelJetty推理接口：

```sh
ELECTRON_RUN_AS_NODE=1 '/Applications/抓虾 Harness.app/Contents/MacOS/抓虾 Harness' scripts/managed-transport-repro.cjs --native-installed
ELECTRON_RUN_AS_NODE=1 '/Applications/抓虾 Harness.app/Contents/MacOS/抓虾 Harness' scripts/managed-transport-repro.cjs --native-installed --live-local-proxy
```

第二条需要当前本机HTTP代理端口7897，约90秒。脚本会使用自有临时fixture状态，不读用户账号密钥。

## 下一次故障所需证据

为唯一定位初始断链，需要持久化脱敏的本地传输错误码、catalog/auth/body-read/dispatch/response-headers分段时间、实际代理路由，以及Nginx请求UUID、request_time、request_length、上游耗时和CF-Ray。原先的console输出及combined日志不够完成这一步。本轮没有擅自修改生产日志级别或采集模型正文、Authorization、Cookie。

服务端完整来源、日志字段/默认值、时钟测量、OIDC窗口与长时序夹具见[服务端传输调查](/Users/xingyicheng/Documents/ChatGPT/中转/docs/verification/gemini-managed409-2026-11-03/TRANSPORT-DIAGNOSIS.md)。当前服务器时钟偏移测量不能追溯校正事故时本机时钟；原5,543,290 bytes来自转换后的Gemini上游请求，不能冒充历史客户端HTTP Content-Length。
