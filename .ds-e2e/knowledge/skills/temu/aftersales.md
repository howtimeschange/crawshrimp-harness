# temu / aftersales

> Generated from adapter notes and probe bundles. Rebuild via `/knowledge/rebuild` or after probe runs.

## note

### Temu Aftersales DOM Findings

Date: 2026-04-07
Page: `https://agentseller.temu.com/main/aftersales/information`
Context: live seller aftersales page inspected through crawshrimp CDP flow

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/temu/notes/aftersales-dom-findings-2026-04-07.md`

## page-shape

### Temu Aftersales DOM Findings / Page snapshot

Page title: `售后管理`
Table rows were already present in the current page
Region tabs were visible above the table: `全球 / 美国 / 欧区`

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/temu/notes/aftersales-dom-findings-2026-04-07.md`

## selector

### Temu Aftersales DOM Findings / Root cause of the timeout

The script was hardcoding old CSS module class names:
old region item selector: `a.index-module__drItem___3eLtO`
old active selector: `index-module__active___2QJPF`
The live page now renders different hashed suffixes:
current region item example: `index-module__drItem___kEdZY`
current active example: `index-module__active___2XA0I`
Because of that, `waitForRegions()` always returned empty even though the tabs were on screen.

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/temu/notes/aftersales-dom-findings-2026-04-07.md`

### Temu Aftersales DOM Findings / Stable extraction rule

Match region tabs by prefix selector:
`a[class*="index-module__drItem___"]`
Detect active tab by:
`a[class*="index-module__drItem___"][class*="index-module__active___"]`
Ignore disabled tabs by checking whether class text contains `index-module__disabled___`

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/temu/notes/aftersales-dom-findings-2026-04-07.md`
