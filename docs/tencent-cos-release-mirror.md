# 腾讯云 COS 正式版镜像

GitHub Release 保存原始正式版与签名包。`Build Desktop App` 完成正式发布后直接调用 `Mirror Desktop Release to Tencent COS`；不依赖 `release.published` 事件，因为默认 `GITHUB_TOKEN` 的发布操作不会触发另一个事件型工作流。普通 main/PR 构建、草稿和预发布不会上传。

## 存储与费用

- 存储桶：`crawshrimp-harness-releases-1252445586`，广州 `ap-guangzhou`，单 AZ 标准存储。
- 桶保持私有；公开只读策略仅覆盖 `harness/*` 中已公开的安装包和更新信息，不授予列目录或写入权限。
- 当前 50GB 标准存储免费额度有效至 2027-04-27。此额度不抵扣外网下载和请求费用。
- 2026-11-02 广州官方外网下行价为 0.50 元/GB；普通标准存储读、写请求各 0.01 元/万次。以实际账单和后续官方价格为准。
- 费用中心预算 `Harness-COS-monthly-50` 持续按月统计 COS，40 元和 50 元提醒。预算数据可延迟约 2 小时，提醒不自动停费。
- 不开通 CDN、全球加速、图片处理或多 AZ 等额外服务。COS 国内源站可直接下载；如另接 CDN，需另核对流量、回源及域名备案要求。

## 发布顺序

1. 回查指定版本为非草稿、非预发布的 `vX.Y.Z` 正式版。
2. 下载全部 10 个原始资产，验证完整文件清单、GitHub SHA256、更新文件 SHA512、平台与版本。
3. 上传到 `harness/releases/vX.Y.Z/<原始文件名>`。分块上传开启 MD5 校验，回读长度和 SHA256 属性，并通过公开地址核对 Range 下载内容。
   大于 1MB 的文件使用新的分块上传 ID、1MB 分块及最多 64 个并发，单次请求超时 60 秒；不复用 SDK 的历史断点续传查询，避免额外要求桶级 `ListMultipartUploads` 权限。失败仅取消本次未完成的上传，不删除已存在对象。重跑仍通过 HEAD + 长度/SHA256 复用已经完整验证的对象。
4. 所有文件成功后才更新 `harness/latest/latest.yml`、`latest-mac.yml`；两份文件引用固定版本的 COS 绝对 URL，保留 SHA512。
5. 最后发布 `harness/latest/release.json`，官网据此更新国内下载按钮。GitHub Release 说明追加国内下载链接。

6. 公开下载和元数据回读成功后，删除 COS 上更旧正式版的标准安装包/ZIP/校验文件，只保留最新正式版。失败不清理，旧版本补传直接跳过；GitHub 继续保留历史版本。

所有版本共用一个工作流并发组，不取消正在上传的版本。已存在的版本文件只允许相同字节，发生冲突直接失败，不覆盖原始安装包。失败后只回查并复用已验证文件；旧版本补传不会降低 `latest` 或重新留下旧包。

## GitHub OIDC 身份

GitHub Actions 使用 `id-token: write` 申请短期 OIDC 令牌，再通过腾讯云 STS 换取一小时临时凭证。仓库不保存腾讯云主账号或长期子账号密钥。

- 身份提供商：`github-harness-releases`
- Issuer：`https://token.actions.githubusercontent.com`
- Client ID / audience：`sts.tencentcloudapi.com`
- 公钥：GitHub OIDC discovery 的 `jwks_uri`，启用自动轮转。
- 角色：`harness-release-ci`；ARN：`qcs::cam::uin/793301325:roleName/harness-release-ci`。
- 信任条件：[角色信任策略](tencent-cos-release-trust.json)，仅该仓库 main / 版本 tag，使用 GitHub 不可变主体 `repo:howtimeschange@4083536/crawshrimp-harness@1334537867`；PR、其他仓库及回收同名账号/仓库均不匹配。
- 权限：[最小对象读写策略](tencent-cos-release-policy.json)，对象操作仅此桶 `harness/*`，DeleteObject 仅 `harness/releases/*`，用于已授权的旧安装包清理；GetBucket 使用此桶 `/*` 资源，并通过 `string_equal` 限定请求前缀必须为 `harness/releases/`。策略中的 `cos:prefix` 必须填写 URL 编码后的 `harness%2Freleases%2F`；不含管理桶、修改权限、其他资源权限。
- 公开下载：[匿名只读对象策略](tencent-cos-public-download-policy.json)，由管理员配置，CI 角色无权修改。

配置仓库 Actions Variables：

| 变量 | 值 |
| --- | --- |
| `COS_RELEASE_ENABLED` | 验证完成后设 `true` |
| `COS_RELEASE_BUCKET` | `crawshrimp-harness-releases-1252445586` |
| `COS_RELEASE_REGION` | `ap-guangzhou` |
| `COS_RELEASE_BASE_URL` | `https://crawshrimp-harness-releases-1252445586.cos.ap-guangzhou.myqcloud.com` |
| `COS_OIDC_PROVIDER` | `github-harness-releases` |
| `COS_ROLE_ARN` | `qcs::cam::uin/793301325:roleName/harness-release-ci` |

配置联邦身份和角色授权属于新的 CI 云资源访问授权，应在管理员确认具体权限后执行。

## 补传与验证

先运行只读权限检查。它仅发出 MaxKeys=1 的列目录请求：发布目录必须成功，未指定前缀、`harness/`、`harness/latest/`、缺少尾斜杠和相似目录前缀必须返回 403 AccessDenied。检查不上传、不修改元数据、不删除对象，也不输出对象名称。完整镜像同样在上传之前运行此检查，权限不足或越界时立即停止。

```bash
gh workflow run mirror-release-to-cos.yml --ref main -f verify_access_only=true
```

在 main 的 Actions 页面手动运行 `Mirror Desktop Release to Tencent COS`，tag 输入 `v0.4.10`（留空使用当前最新正式版）。仅同步已发布文件，不重新构建、不重签、不重发版本。

如本次验收未授权删除旧对象，必须设置 `skip_cleanup=true`；它映射为镜像脚本的 `--skip-cleanup`，仍验证安装包和公开元数据，但跳过整个旧包列举/删除步骤。默认 `false` 保持日常发布的已有保留策略。

```bash
gh workflow run mirror-release-to-cos.yml --ref main -f tag=v0.4.10 -f skip_cleanup=true
```

检查原运行的 `mirror-result.json`、COS 更新元数据和下载清单；实际下载至少一个安装包并重算 SHA256。官网按钮必须读回相同版本与对应 COS 地址。首次接入不会改变旧客户端包内配置；下一次正常正式版构建才带国内更新源，旧客户端先通过原 GitHub 更新到该版本。

### 先在本地验证

```bash
python3 -m pip install -r app/scripts/cos-release-requirements.txt
python3 -m unittest discover -s app/scripts -p 'test_cos_*.py'
node --test app/scripts/validate-update-artifacts.test.js app/src/updateService.test.js tests/desktop-auto-update.test.js
```

COS 契约测试使用固定版本的真实 SDK 和仅监听 `127.0.0.1` 的内存 HTTP 服务，凭据为无效测试值。它复现 `upload_file` 的隐式 `ListMultipartUploads` 拒绝，检查实际 prefix 编码、对象权限范围、MD5/分片顺序、故障重试及重跑复用；完整 CLI 测试同时执行真实 Node 产物验证器，覆盖更新元数据、完整文件哈希、不删除旧包和默认清理的兼容性。main CI 与镜像工作流都运行全部测试；镜像中的测试和正式资产 dry-run 均在获取腾讯临时凭据之前执行。

本地权限模型只解释仓库策略中的相关语句，不能证明腾讯云实际 IAM 求值、网络和服务端行为。硬中断进程后，未完成分片可能保留；重跑新建上传 ID，不枚举或清理之前的未完成上传，也不修改已经完成的同版本对象。正常可捕获的上传失败会尝试取消本次上传，取消失败时保留原始错误，不扩大权限。

因此正式镜像在本地门禁、正式资产校验和只读权限边界检查通过后，先以 `--upload-probe-only` 用最小的正式 `.blockmap` 文件执行一次单分片上传及公开下载校验。它只写入本来就要镜像的固定版本对象，不写 `latest`、不清理旧包；成功后完整发布复用该文件。若对象已存在，只验证完全匹配并复用，结果会标明未重新行使分片权限。首次 v0.4.10 对象为 454106 字节的 Windows blockmap；无额外测试目录或云端权限。

网络预检另从原始大文件发送一个完整的 1MiB 分片，验证服务器 ETag 与分片 MD5 一致后，仅取消本次新建的临时上传，不完成对象、不更新元数据。预检或取消失败均阻止后续完整发布。分片 Body 使用文件式流，避免把整个分片字节缓冲交给一次 socket sendall；保留并行修复中的 1MiB、4 并发、60 秒请求超时，凭据仍为原有一小时。2026-11-02 的 `41456221032` 和后续 1MiB/60 秒运行 `41458007522` 已通过权限和小文件预检，但大缓冲上传均发生 socket 写超时；慢速本机 HTTP 接收端可复现整块字节与流式发送的差异。日志会记录资产开始、验证完成及每 8 个分片的进度，不输出凭据。

2026-11-02 的重建运行 `41441738831` 已完成 GitHub 正式发布，但其旧上传实现因 SDK 1.9.44 `upload_file` 在上传前调用桶级 `ListMultipartUploads` 而失败。修复改用对象级 InitiateMultipartUpload → UploadPart → CompleteMultipartUpload；无需添加桶级分片列举权限。本地测试通过并不等于真实 COS 镜像验收完成。

### 排查 OIDC 成功但列目录 AccessDenied

2026-11-02 的运行 `41438561505` attempt 2 在获取临时凭据后，`list_objects(Prefix='harness/releases/', MaxKeys=1)` 返回 AccessDenied。角色关联的策略条件是未编码的 `harness/releases/*`，不符合腾讯云对 `cos:prefix` 请求参数条件的编码要求；桶的 `/` 资源写法也与当前 CAM 操作表及目录授权示例中的 `/*` 不一致。修复仅调整独立的 GetBucket 语句：此桶 `/*` 资源 + 编码后的精确前缀，不扩大对象读写或匿名下载权限。

官方依据：[cos:prefix 条件键示例](https://cloud.tencent.com/document/product/436/71307)、[生效条件与请求参数编码](https://cloud.tencent.com/document/product/436/71306)、[CAM 中的 COS 操作资源格式](https://intl.cloud.tencent.com/document/product/598/57092)。

本次排查期间，线上策略在 12:01:03 UTC 已由其他正在进行的操作切换到版本 2，内容与上述修复一致；本任务只读回查，未重复修改。随后同一工作流 attempt 3 的 job `125264443189` 于 12:03:31 UTC 输出 `OIDC and scoped COS list verified; no objects modified`，mirror job 跳过。版本 1 仍保留，可用于策略回滚。这证明正向列目录访问恢复；新增的反向边界检查和完整镜像仍需运行，不能视为安装包上传成功。

## 地域与双源回退

官网与客户端使用官网边缘节点看到的请求出口国家（Cloudflare `request.cf.country`）。`CN` 优先 COS，其余国家或判断超时优先 GitHub；不使用界面语言或时区代替 IP。开启海外代理时按照代理出口判断。客户端检查和下载失败均尝试另一个源；切换下载源前重新获取更新元数据，必须保持相同版本并继续校验 SHA512。官网按出口国家选择下载源，源站检查失败自动切换，并提供直接备用下载链接。

实际联调注意事项：GitHub 仓库启用了不可变 OIDC subject（可用仓库 OIDC customization REST API 回读）；CAM 条件不能沿用旧的无 ID 主体。COS GetBucket 使用桶资源 `/*`，并以 URL 编码后的精确 prefix 条件约束列目录，上传和清理权限仍保持对象前缀限制。

2026-11-02 的完整镜像运行 `41456221032` 在 8MB 分块的跨境写入阶段超时，小 blockmap 的真实上传和公开下载已通过。上传分块调整到 1MB，保持 4 并发、MD5、固定版本对象及校验后提升元数据的顺序不变；SDK 请求显式设置 60 秒超时。

真实运行 `41460464629` 的完整 1MiB 探针成功，耗时 83.728 秒；完整安装包约 4 分 43 秒只传到第 16 个 1MiB 分片，推算整批文件超出 45 分钟 CI 和一小时凭据时限。SDK 上传端改用官方 `EnableOldDomain=False` 的 `tencentcos.cn` 入口，保留流式分块、校验、权限及公开下载地址，不启用收费上传加速。

镜像任务使用与正式 macOS 构建相同的 `macos-14` 托管运行器，以更换 Ubuntu 托管运行器到广州 COS 的跨境出口。原运行器的 1MiB 实测耗时不满足整批安装包的 CI 时限；镜像仍先验证真实完整分片，权限、原始资产和保留规则不变。本地 macOS 已通过全部 55 项 COS 契约回归。

`EnableOldDomain=False` 必须同时设置 `EnableInternalDomain=False`，否则 SDK 1.9.44 默认选择外部 CI 无法访问的 `cos-internal` 地址。CLI 契约测试使用真实 `CosConfig` 断言最终 HTTPS 公网对象地址，防止再次把内网地址当成公网传输失败。

macOS 运行器 `41464102669` 的公网完整 1MiB 上传探针为 25.865 秒，4 并发下约 3 分 40 秒仍只推进到第 16 个分片。为验证并行连接能否改善总吞吐，镜像改为 64 个有界上传工作线程及匹配连接池；每个活动分片为 1MiB，发布前仍需完整上传、哈希与公开下载验证。
