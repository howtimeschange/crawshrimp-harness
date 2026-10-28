# Approved Crawshrimp logo

The user finally selected **C1 · 短须识别**: orange/gold character, dark purple-black background, large left claw, small right claw, two short rounded antennae. This replaces B2 and the earlier antenna-free artwork. Do not use the unrelated `logo-ip-series/C1.png`.

`crawshrimp-logo-final-C1-short-antennae.png` is the complete, unchanged 1254 × 1254 source. SHA256:

`ae09393d9aa47cf11c32cf4052875f3fdd7cdeb93c98e24799eae39fb7749352`

Original delivery: `/Users/xingyicheng/Documents/Codex/2026-10-25/harness-logo-github-https-github-com/outputs/final-selected-logo/crawshrimp-logo-final-C1-short-antennae.png`, originally `logo-selected-exploration/C1.png`. Selection and asset integration handoff were received on 2026-10-26, Asia/Shanghai.

Re-export on macOS from the repository root:

```sh
venv/bin/python3 app/scripts/export-brand-icons.py
```

- `../icon.png`: 1024 × 1024 RGBA, full composition for the existing UI imports.
- `../icon.icns`: all ten standard 16–512 pt/1×–2× representations (16–1024 px). The complete artwork occupies 824 × 824 px on a 1024 px transparent canvas, centered with 100 px outer safety space. No corner mask or additional crop is applied.
- `../icon.ico`: 16, 20, 24, 32, 40, 48, 64, 96, 128, 256 px RGBA representations, full composition.

Only format, size, and external safety space change. No recoloring, redrawing, new text, or changes to the character's face, claws, antennae, or composition are permitted. The existing `app/build.yml` and renderer imports consume these assets. Exporting does not package, sign, install, commit, push, or release the application.

## Transparent in-app mark

The original design chat supplied the approved C1 half-body avatar for small in-app surfaces. `crawshrimp-avatar-C1-source.png` preserves that 1254 × 1254 RGBA delivery unchanged; SHA256 `d4e6c47c3e8a63c4e56af3eb83ce78d3c247685669c432e91f8f4a81b2dde57c`. Its source and derivation are recorded in `inline-avatar-source.json`.

`crawshrimp-avatar-C1.png` contains the complete image resized to 240 px, centered on a transparent 256 px canvas with 8 px outer space. `CrawshrimpBrandMark.vue` displays it with `object-fit: contain`, no corner mask, and decorative accessibility attributes. The DSH sidebar and hero share a single optimized 128 px inline PNG so they work offline without external asset URLs. Re-export with `venv/bin/python3 app/scripts/export-inline-brand.py`.

The user rejected the full-body greeting pose and the retired AgentHome preview. Product UI uses the half-body mark; retired-page code is left at its pre-task state. Plus and Pro membership identities use separate tier badges rather than this general brand mark.

## Membership identity badges

The original design chat delivered two distinct C1 membership designs for review: Plus uses an open circular frame and a rounded plus sign; Pro uses a rounded gold shield and a four-point star. These badge designs have been integrated and visually checked; they have not yet received separate user design approval.

`crawshrimp-membership-{plus,pro}-source.png` preserve the original 1254 × 1254 transparent deliveries. Their corresponding display PNGs contain the complete source resized to 240 px on a transparent 256 px canvas with 8 px outer space. No crop, corner mask, recoloring, or character redraw is applied. Exact source paths and SHA256 values are in `membership-source.json`.

`CrawshrimpMembershipMark.vue` selects the matching graphic from the existing account or subscription plan. AccountPanel uses 20 px; UsagePanel uses 44 px. Free and unknown plans use the neutral half-body brand mark. The component only changes presentation and does not grant or infer paid access.
