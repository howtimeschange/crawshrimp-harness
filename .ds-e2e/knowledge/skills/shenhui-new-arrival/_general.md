# shenhui-new-arrival / _general

> Generated from adapter notes and probe bundles. Rebuild via `/knowledge/rebuild` or after probe runs.

## endpoint

### DeepDraw Upload Page Findings / Batch Upload Entry

The visible button text is `群体批量上传图片`; its inline action is:
```text
prevCheck()
```
The sibling `批量从数字资产选择` action calls `prevCheckDam()`, but the DAM picker iframe (`dam.leycloud.com/dam/resourcePicker`) showed account setup failure in this probe, so the ZIP path is the practical route.
Opening the batch ZIP modal after selecting one row triggered only pre-upload checks:
`POST /authorized/merchant/product/ajaxBatchCheckCountAccountByPictureZip`
request body: `[{"id":6227681,"templateId":"","type":"PVRC"}]`
`POST /authorized/merchant/product/getImageUploadState`
No file upload was started.

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/shenhui-new-arrival/notes/deepdraw-upload-findings-2026-04-27.md`

### DeepDraw Upload Page Findings / Safety Boundary

The page was probed in production. Do not perform a real upload during exploration.
Allowed probe actions used:
inspect the main page and `uploadPictures` iframe DOM
search by one known style code
select one result row
open the ZIP upload modal
inject a local fake ZIP into the front-end file queue only
clear the queue and uncheck selected rows
Forbidden until the user explicitly approves a production run:
click `#uploadFilesButton`
call `uploader.start()`
call `continueUpload()`
invoke upload-to-OSS requests
call post-upload processing endpoints for a real ZIP

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/shenhui-new-arrival/notes/deepdraw-upload-findings-2026-04-27.md`

### 深绘上新助手 SOP Findings / Folder Matching

The SOP screenshots show that the style code can appear in the folder name while child image filenames may be generic, for example `balaBR...jpg`.
The script therefore:
searches Semir cloud drive by the input code
filters search results to the configured source path
detects matched style folders under that source path
attempts recursive folder listing for child images and filter-only assets
ignores direct image hits unless they are descendants returned by a matched folder listing
Folder listing uses API-first endpoint fallbacks for `/fengcloud/2/file/list` and `/fengcloud/1/file/list`. This branch still needs live confirmation against the logged-in Semir environment.

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/shenhui-new-arrival/notes/sop-findings-2026-04-27.md`

## note

### DeepDraw Upload Page Findings

Date: 2026-04-27
Adapter: `shenhui-new-arrival`
Target: `https://www.deepdraw.biz/authorized/merchant/index`
Menu: 产品素材 / 图片包上传

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/shenhui-new-arrival/notes/deepdraw-upload-findings-2026-04-27.md`

### DeepDraw Upload Page Findings / File Queue Probe

A local fake ZIP named `208226103201.zip` was injected into the hidden file input to verify plupload queue behavior without starting upload.
Observed result:
`uploader.files` contained one file named `208226103201.zip`
file size was shown in the queue
`#uploadFilesButton` became enabled
`#clearFilesButton` became enabled
upload was not clicked and `uploader.start()` was not called
After the probe, the queue was cleared and selected checkboxes were unchecked. The upload button returned to disabled.

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/shenhui-new-arrival/notes/deepdraw-upload-findings-2026-04-27.md`

### 深绘上新助手 SOP Findings

Date: 2026-04-27
Adapter: `shenhui-new-arrival`
Task: `prepare_upload_package`, `pdf_batch_screenshot`, `upload_to_deepdraw`

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/shenhui-new-arrival/notes/sop-findings-2026-04-27.md`

### 深绘上新助手 SOP Findings / PDF Cropping Feasibility

Local exploration rendered the provided SOP PDF pages successfully with a PDF renderer. Backend support is implemented as best-effort in the separate `PDF 批量截图` task:
primary renderer: PyMuPDF (`fitz`)
crop/split: Pillow whitespace crop, plus a simple two-label split heuristic
macOS fallback renderer: Quick Look `qlmanage`
failure fallback: keep the original PDF under `_PDF待裁图`
`core/requirements.txt` now includes `Pillow` and `PyMuPDF` so packaged builds can perform real PDF-to-image conversion. If those dependencies are not installed in the current dev runtime, valid PDFs can still fall back to Quick Look on macOS, but crop quality is limited.

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/shenhui-new-arrival/notes/sop-findings-2026-04-27.md`

### 深绘上新助手 SOP Findings / SOP Rules Encoded

Model package:
remove tag, wash-label, static/still, card-head, and packaging assets
remove white-background images named as `12位款号-5位颜色码` or `m(1).12位款号-5位颜色码`
ignore every file inside child folders whose folder name contains `包装`
keep normal model images
Still package:
remove `.psd`
remove card-paper tag and handwritten wash-label assets
keep normal still images
rename usable tag / wash-label images to `yq.*`
skip PDF files because the source PDF is selected locally in the separate PDF screenshot task

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/shenhui-new-arrival/notes/sop-findings-2026-04-27.md`

### 深绘上新助手 SOP Findings / Scope

This adapter splits the SOP into three user-visible tasks:
`整理深绘上新图包`
`PDF 批量截图`
`上传深绘图片包`
The packaging task implements the cloud-drive collection half of the SOP:
resolve the two Semir cloud-drive source paths:
静物图 / 平拍原图
模特图 / 模拍原图
search by style code or color code to locate matching folders under the user-specified source directories
recursively download assets from matched folders, instead of treating direct image search hits as standalone targets
merge model and still assets into one style-code folder
filter unusable assets according to the SOP
download retained assets and export:
one DeepDraw-ready ZIP per style code
one full audit ZIP containing the complete style-code folder tree
an Excel summary
skip cloud-drive PDF files; PDF screenshot/cropping is handled only by the separate local `PDF 批量截图` task
The DeepDraw website upload step is implemented as a separate task, `upload_to_deepdraw`. It defaults to dry-run queue validation; switching execution mode to production upload directly calls DeepDraw upload. See `deepdraw-upload-findings-2026-04-27.md`.

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/shenhui-new-arrival/notes/sop-findings-2026-04-27.md`

## page-shape

### DeepDraw Upload Page Findings / Page Structure

The main URL is only the shell page. The useful business page is a same-origin iframe:
iframe URL: `/authorized/merchant/product/uploadPictures`
page title: `图片包上传 | 深绘 DEEPDRAW`
search input: `#searchKeyword`
search form: `#form1`, action `/authorized/merchant/product/uploadPictures`, method `POST`
search trigger: `updateSearchKeyword(); search();`
product table: `#tbodyTable`
row checkbox attributes include `data-id`, `data-code`, `data-day`, and `data-status`
Search result shape observed with style code `208226103201`:
product id: `6227681`
code: `208226103201`
day: `2026-02-07`
checkbox value: `208226103201`
checkbox `data-status`: `true`

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/shenhui-new-arrival/notes/deepdraw-upload-findings-2026-04-27.md`

### DeepDraw Upload Page Findings / Runtime Functions

Relevant functions found on the iframe window:
`prevCheck(singleObj)`: prepares ZIP batch upload, then calls `prevNewCheck`
`batchUpload(singleObj)`: builds the style-code queue and calls `doUpload(codes)`
`doUpload(codes)`: opens `#uploadBatchModal` and initializes plupload
`uploaderConfig(codes)`: configures plupload
`refreshUploadParams()`: synchronously fetches `/authorized/merchant/product/getUploadParams`
`refreshOssSTSParams()`: synchronously fetches `/authorized/merchant/authorized/sts?type=PICTURE`
`analyzeResult(file, json)`: handles server-side ZIP processing result
`ajaxRefreshArchiveHandlingStatus(file)`: polls `/authorized/merchant/product/{productId}/ajaxRefreshArchiveHandlingStatus`
`refreshUploadParams()` returns these keys:
`OSSAccessKeyId`
`signature`
`key`
`policy`
Do not persist live credential values in notes or tests.

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/shenhui-new-arrival/notes/deepdraw-upload-findings-2026-04-27.md`

### DeepDraw Upload Page Findings / Upload Modal

Modal:
id: `#uploadBatchModal`
title: `图片包上传(ZIP)`
style when open: `display: block;`
Key controls:
choose file button: `#selectFilesButton`
hidden file input: `#uploadBatchModal input[type="file"][accept=".zip"]`
clear queue button: `#clearFilesButton`
upload button: `#uploadFilesButton`
continue button: `#continueUploadFilesButton`
The hidden file input id is generated dynamically, so future code should query by modal and `input[type="file"]`, not by id.
The modal copy states these package rules:
upload ZIP only
ZIP filename must exactly match the product style code
ZIP must be no larger than 2048 MB
single image must be no larger than 30 MB
if image filenames specify colors, color names must match the product color fields

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/shenhui-new-arrival/notes/deepdraw-upload-findings-2026-04-27.md`

## phase-hint

### DeepDraw Upload Page Findings / Adapter Implementation

The adapter now exposes a separate DeepDraw task, `upload_to_deepdraw`, with its own `entry_url`:
```yaml
entry_url: https://www.deepdraw.biz/authorized/merchant/index
tab_match_prefixes:
https://www.deepdraw.biz/authorized/merchant/index
```
Implemented phases:
verify the `uploadPictures` iframe is active
search each style code with exact product-code mode
read back the rendered row and checkbox attributes
validate that the generated ZIP basename exactly matches a row style code
select matching rows
open the ZIP modal
attach locally batch-selected ZIP files to the plupload file input
stop before upload by default in `dry_run`
call `uploader.start()` when `upload_mode=upload`
Production upload is still fail-closed in dry-run mode. The default mode only validates search, selection, and file queueing, then clears the queue and leaves rows marked as `未上传`. Switching the UI execution mode to production upload is the explicit user action that submits the queued ZIPs.

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/shenhui-new-arrival/notes/deepdraw-upload-findings-2026-04-27.md`
