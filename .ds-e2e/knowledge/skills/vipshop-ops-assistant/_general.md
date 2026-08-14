# vipshop-ops-assistant / _general

> Generated from adapter notes and probe bundles. Rebuild via `/knowledge/rebuild` or after probe runs.

## note

### 唯品会包装+主图替换 API 探查（2026-08-03） / 已验证只读接口

商品资料列表：`POST https://nov-admin.vip.com/normal/normalMerchandiseQuery`
JSON payload：`{ pageNo, pageSize, param: { msnSet: ["完整货号"] } }`
返回行包含：`merchandiseNo`, `msn`, `osn`, `vendorSpuId`, `prodSpuId`, `name`, `skuStatus`, `imageUrl`。
PDC 商品详情：`POST https://pdc-portal.vip.com/product/queryVendorProductByVpIdForVc`
form payload：`vendorProductId=<V_SPU>&vendorType=1`
注意：该老页面接口用 `application/x-www-form-urlencoded`；JSON payload 会返回 ID 非法。
返回 `result.itemSkuAttr[]`，关键字段为 `colourGSN`, `colourName`, `imageGroupIdStr`, `sizeAttr[]`, `colourImages[]`, `squareImages[]`。

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/vipshop-ops-assistant/notes/package-main-image-api-findings-2026-08-03.md`

### 唯品会包装+主图替换 API 探查（2026-08-03） / 文档流程要点

输入表需要同时保留「款号」和完整「货号/款色号」，不能只按款号宽泛匹配。
包装流程：商品资料按货号搜索 -> 取消提交审核 -> 编辑 -> 在「货号与条码」中用完整货号匹配颜色名称备注 -> 商品图片中只更新对应颜色；拼款时只更新目标商品款号对应颜色并备注。
包装图片：微详情使用 1200x1200；商品详情图使用 `images` 或 `切片` 目录切片，跳过整张预览图；`balaone` 头图应在详情首位。
主图打标流程：按完整货号搜索 -> 取消提交审核 -> 编辑 -> 商品图片上传 1200x1200 对应颜色主图并置首 -> 商品列表图上传 950x1200。

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/vipshop-ops-assistant/notes/package-main-image-api-findings-2026-08-03.md`

### 唯品会包装+主图替换 API 探查（2026-08-03） / 示例只读验证

`20132610801500311` 命中 `201326108015` 的目标颜色 `白色调`，当前 PDC 回读为「已提交审核」，需要先取消提交审核/撤回后再编辑。
`20032610810600488` 命中 `200326108106` 的目标颜色 `蓝色调`，当前 PDC 回读为「草稿/可编辑」。

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/vipshop-ops-assistant/notes/package-main-image-api-findings-2026-08-03.md`

### 唯品会包装+主图替换 API 探查（2026-08-03） / 编辑页与后续 live 端点线索

列表页编辑入口：`https://vis.vip.com/portal-iframe.php#!/app-v/pdc-vue/product/edit/{vendorSpuId}/1`
运行入口建议使用 `https://nov-admin.vip.com/admin/index.html#/normal/normalMerchandise`。外层 `vis.vip.com`/PDC 顶层页读取 `nov-admin` 商品资料接口会被浏览器 CORS 拦截；`nov-admin` 执行上下文可同时读取商品资料和 PDC 详情。
PDC 静态包暴露的上传/保存端点：
`/product/uploadMainImage`
`/product/uploadListImage`
`/product/uploadDetailImage`
`/product/saveProduct?editPreCheck&vendorType=1`
`/product/saveProduct`
`/product/publishProduct`
live 上传/保存需要继续抓取真实文件上传请求体和保存 payload，并且必须通过独立确认后再执行。

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/vipshop-ops-assistant/notes/package-main-image-api-findings-2026-08-03.md`

## page-shape

### 唯品会轻供款商品报表 API 探查记录

SOP 附件流程包含两个报表：
商品信息：`https://vis.vip.com/index.php#/app-i/nov-admin-i-simple/vendor/normal/normalMerchandise?...`
商品明细：`https://compass.vip.com/frontend/index.html#/product/details`
货品匹配表为单 sheet：`大货款号`、`类别`；本次样例共 5869 行，`轻供` 1893 行。
商品明细页当前筛选通过 `POST https://compass.vip.com/product/detail/getGoodsList` 分页读取。
已验证 payload 示例：`brandStoreSn: "all"`, `dtType: 0`, `calType: 1`, `startDt/endDt: YYYYMMDD`, `queryHll: false`, `pageNo`, `pageSize`, `dimType: 0`, `channelType: 1`。
当前页面 500 条/页可稳定返回，响应结构为 `data.goodsList` + `data.total`。
款号字段使用 `osn`，货号字段使用 `goodsNo`。
商品信息页在 `vis.vip.com` 外壳的 `nov-admin.vip.com` iframe 中，列表接口为 `POST https://nov-admin.vip.com/normal/normalMerchandiseQuery`。
已验证 payload 示例：`{ "pageNo": 1, "pageSize": 500, "param": {} }`。
响应结构为顶层 `data` 数组 + 顶层 `total`。
款号字段使用 `osn`，货号字段使用 `msn`。
浏览器 CORS 结果：
从罗盘页 `compass.vip.com` 可直接 `fetch` 供应商平台 `nov-admin.vip.com` 商品信息接口。
从供应商平台页反向调用罗盘商品明细接口会被浏览器拦截。
因此任务入口固定为罗盘商品明细页，脚本在该页一次生成双报表。

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/vipshop-ops-assistant/notes/api-findings-2026-07-02.md`
