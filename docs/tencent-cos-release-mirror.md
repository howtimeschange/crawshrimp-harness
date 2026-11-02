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
python3 -m unittest discover -s app/scripts -p 'test_cos_release_mirror.py'
```

检查原运行的 `mirror-result.json`、COS 更新元数据和下载清单；实际下载至少一个安装包并重算 SHA256。官网按钮必须读回相同版本与对应 COS 地址。首次接入不会改变旧客户端包内配置；下一次正常正式版构建才带国内更新源，旧客户端先通过原 GitHub 更新到该版本。

### 排查 OIDC 成功但列目录 AccessDenied

2026-11-02 的运行 `41438561505` attempt 2 在获取临时凭据后，`list_objects(Prefix='harness/releases/', MaxKeys=1)` 返回 AccessDenied。角色关联的策略条件是未编码的 `harness/releases/*`，不符合腾讯云对 `cos:prefix` 请求参数条件的编码要求；桶的 `/` 资源写法也与当前 CAM 操作表及目录授权示例中的 `/*` 不一致。修复仅调整独立的 GetBucket 语句：此桶 `/*` 资源 + 编码后的精确前缀，不扩大对象读写或匿名下载权限。

官方依据：[cos:prefix 条件键示例](https://cloud.tencent.com/document/product/436/71307)、[生效条件与请求参数编码](https://cloud.tencent.com/document/product/436/71306)、[CAM 中的 COS 操作资源格式](https://intl.cloud.tencent.com/document/product/598/57092)。

本次排查期间，线上策略在 12:01:03 UTC 已由其他正在进行的操作切换到版本 2，内容与上述修复一致；本任务只读回查，未重复修改。随后同一工作流 attempt 3 的 job `125264443189` 于 12:03:31 UTC 输出 `OIDC and scoped COS list verified; no objects modified`，mirror job 跳过。版本 1 仍保留，可用于策略回滚。这证明正向列目录访问恢复；新增的反向边界检查和完整镜像仍需运行，不能视为安装包上传成功。

## 地域与双源回退

官网与客户端使用官网边缘节点看到的请求出口国家（Cloudflare `request.cf.country`）。`CN` 优先 COS，其余国家或判断超时优先 GitHub；不使用界面语言或时区代替 IP。开启海外代理时按照代理出口判断。客户端检查和下载失败均尝试另一个源；切换下载源前重新获取更新元数据，必须保持相同版本并继续校验 SHA512。官网按出口国家选择下载源，源站检查失败自动切换，并提供直接备用下载链接。

实际联调注意事项：GitHub 仓库启用了不可变 OIDC subject（可用仓库 OIDC customization REST API 回读）；CAM 条件不能沿用旧的无 ID 主体。COS GetBucket 使用桶资源 `/*`，并以 URL 编码后的精确 prefix 条件约束列目录，上传和清理权限仍保持对象前缀限制。
