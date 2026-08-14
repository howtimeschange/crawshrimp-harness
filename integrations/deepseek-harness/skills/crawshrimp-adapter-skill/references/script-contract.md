# Crawshrimp Adapter Script Contract (Minimum)

Use this note whenever you write or repair a crawshrimp adapter from scratch. It is the
minimum contract; for full details read `sdk/ADAPTER_GUIDE.md` in the main repo.

## 1. Adapter package shape

A crawshrimp adapter is a directory containing at least:

```
<adapter_id>/
  manifest.yaml      # adapter meta + tasks declaration (the contract)
  <task-script>.js   # one JS file per task
```

A task script is NOT a standalone Python/Node script. It is injected into the target
web page by the crawshrimp runner and executes in page context.

## 2. manifest.yaml minimum

```yaml
id: my-adapter            # unique id, lowercase + hyphens
name: 示例适配包
version: 1.0.0
author: yourname
description: "what this adapter does"
entry_url: https://example.com   # used to match/open the browser tab

tasks:
  - id: scrape_table              # stable task id
    name: 抓取表格                 # shown in UI
    script: scrape.js             # file in this adapter dir
    trigger:
      type: manual
    params:                       # optional task form fields
      - id: keyword
        type: text
        label: 关键词
        required: true
    output:                       # optional artifacts
      - type: excel
        filename: "结果_{date}.xlsx"
```

Param types include `text`, `textarea`, `select` (with `options`), `checkbox`, `number`,
`date`, `file`. Keep task ids and param ids stable once anything depends on them.

## 3. Task script contract

Every task script MUST be an async IIFE and MUST return an object:

```js
;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}   // form params from manifest
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main' // multi-phase state machine
  // ... gather rows in page context ...
  return {
    success: true,
    data,                          // array of FLAT objects; keys become Excel column names
    meta: { has_more: false }      // has_more: true triggers auto next-page/next-row
  }
})()
```

Failure:

```js
;(async () => {
  return { success: false, error: 'human-readable failure reason' }
})()
```

Hard rules:

- async IIFE is mandatory (the runner `await Runtime.evaluate()`s it).
- `data` must be an array of flat objects (no nested objects as cell values).
- Do not mutate page state for read-only tasks.
- Do not rely on module-level variables persisting between injections (each injection is a
  fresh evaluate); carry state via `window.__CRAWSHRIMP_SHARED__` / `meta.shared`.

## 4. Multi-phase state machine (interaction tasks)

For tasks that fill forms, switch stores/dates, or click through steps, split into business
phases (`ensure_auth`, `open_form`, `fill_form`, `submit`, `post_submit`). The runner
re-injects the same script with `window.__CRAWSHRIMP_PHASE__` set. Drive transitions with
`meta.action`:

- `next_phase` + `meta.next_phase`
- `cdp_clicks` + `meta.clicks` (real CDP mouse clicks at coordinates) + `meta.sleep_ms`
- `inject_files` / `file_chooser_upload`
- `capture_click_requests` / `capture_url_requests`
- `download_urls` / `download_clicks`
- `capture_screenshot`
- `reload_page`
- `complete`

Example:

```js
return { success: true, data: [], meta: { action: 'next_phase', next_phase: 'fill_form' } }
```

Do NOT make a separate phase per field/button click; prefer business-level phases.
