---
name: banner-generation
description: Use when generating, remaking, or codifying promotional banners, ecommerce operation covers, product intro cards, social media headers, or Chinese/English marketing graphics that need a 1xm image-model visual base plus crisp local text overlays and exact PNG dimensions.
---

# Banner Generation

## Goal

Create polished, reusable banner assets by combining grounded content, a 1xm-generated visual base, and deterministic local HTML/PNG composition.

Use this skill for final usable image files, not prompt-only advice. Do not rely on machine-local project secrets; users must provide their own 1xm key.

## Key Configuration

Use 1xm as the model provider. Read `references/1xm-configuration.md` when setting up or troubleshooting credentials.

Preferred options:

```bash
export ONEXM_API_KEY="..."
export ONEXM_GROUP="..." # optional, only when the user's 1xm account requires it
```

Alternative config file:

```json
{
  "apiKey": "...",
  "group": "",
  "baseUrl": "https://api.1xm.ai/v1"
}
```

Save the JSON as `~/.config/banner-generation/1xm.json`. Never print, commit, or store the user's key in generated assets.

## Workflow

1. **Clarify the target only when blocked.** If no dimensions are provided, choose a practical wide card such as `1650x500` or `1920x640` and state it.
2. **Ground the banner.** Use user-provided product facts, local README/docs, brand assets, screenshots, and logos when available.
3. **Write a text-free image prompt.** Ask the model for a visual backdrop only. Explicitly forbid words, letter-like marks, watermarks, borders, and UI chrome unless requested.
4. **Generate the base image with 1xm.** Use `scripts/generate_1xm_image.mjs`. Prefer `gpt-image-2` with `size: 3840x1280` for wide banners; keep within the model's supported ratio, then crop/layout locally.
5. **Compose text locally.** Build an HTML file that places the generated base as a background and overlays real logo/icon assets, title, subtitle, badges, and callouts with CSS.
6. **Render and inspect.** Use `scripts/render_html_banner.mjs` to export PNG. Verify final dimensions, no overflow, no cropped logo, no unreadable text, and no collision between foreground and background.
7. **Return usable files.** Report final PNG path, base image path, HTML path, prompt path, and show a preview when the environment supports it.

## 1xm Base Image

Create a prompt file. Run commands from this skill directory.

```bash
node scripts/generate_1xm_image.mjs \
  --prompt tmp/my-banner/prompt.txt \
  --out tmp/my-banner/base.png \
  --reference /absolute/path/to/logo-or-reference.png \
  --model gpt-image-2 \
  --size 3840x1280 \
  --quality high
```

Omit `--reference` when no visual reference is available. Pass multiple `--reference` flags when needed.

## Prompt Pattern

Use English for the image model unless the model specifically needs another language. Keep all final text out of the model:

```text
Use case: ads-marketing
Asset type: wide promotional banner for <brand/product/category>
Primary request: Create a cinematic ultra-wide visual backdrop for <product>, a <business-facing summary>. Use Image #1 only as visual identity reference when provided.
Scene/backdrop: <workspace, product environment, dashboard, retail scene, abstract brand scene>
Subject: <right-weighted or centered focal visual>; include abstract icons only, no readable UI.
Composition/framing: keep the left <40-50%> calm and unobstructed for later typography; keep safe margins for final crop.
Lighting/mood: <commercial, restrained, premium, energetic, operational>
Color palette: <brand colors plus neutrals>
Text: render no words, no numbers, and no letter-like marks; typography will be overlaid separately.
Avoid: unreadable pseudo-text, watermark, border, UI chrome, over-busy collage, distorted logos.
```

## HTML Composition

Use fixed canvas dimensions in HTML/CSS. Keep text crisp by rendering it locally rather than in the generated image.

Render with:

```bash
node scripts/render_html_banner.mjs \
  --html tmp/my-banner/banner.html \
  --out tmp/my-banner/final.png \
  --width 1650 \
  --height 500 \
  --scale 2
```

Then verify:

```bash
sips -g pixelWidth -g pixelHeight tmp/my-banner/final.png
```

## Composition Rules

- Prefer clear commercial hierarchy: brand/logo, headline, supporting copy, and 2-4 short badges.
- Use local text overlays for Chinese and exact business copy.
- Keep text inside a safe content block; avoid negative letter spacing and viewport-scaled font sizes.
- Use real logos/icons as overlays when brand recognition matters.
- Save task artifacts under `tmp/<asset-name>/` unless the user names another destination.
- If the generated base contains fake text or visual clutter, regenerate the base instead of trying to hide it with overlays.

## Resources

- `scripts/generate_1xm_image.mjs` - standalone 1xm async image-task caller with user-supplied credentials.
- `scripts/render_html_banner.mjs` - Playwright/Chrome HTML-to-PNG renderer for fixed-size banners.
- `references/1xm-configuration.md` - key setup, CLI options, and troubleshooting notes.
