# 1xm Configuration

Use this reference when a banner task needs model credentials, 1xm API details, or troubleshooting.

## Credentials

Do not read project-local encrypted key stores. The user must configure a key that belongs to the environment where the skill is used.

Preferred:

```bash
export ONEXM_API_KEY="..."
export ONEXM_GROUP="..." # optional
```

Fallback config file:

```bash
mkdir -p ~/.config/banner-generation
chmod 700 ~/.config/banner-generation
cat > ~/.config/banner-generation/1xm.json <<'JSON'
{
  "apiKey": "replace-with-user-key",
  "group": "",
  "baseUrl": "https://api.1xm.ai/v1"
}
JSON
chmod 600 ~/.config/banner-generation/1xm.json
```

When writing instructions for a user, never ask them to paste keys into project files, prompts, generated HTML, or committed docs.

## Image Task API

Provider base URL defaults to:

```text
https://api.1xm.ai/v1
```

The script uses asynchronous image tasks:

1. `POST /images/tasks`
2. Poll `poll_url` when returned, otherwise poll `/images/tasks/{id}`
3. Extract a returned data URL, `b64_json`, or image URL
4. Fetch URL results and write the final local PNG

Default payload fields:

```json
{
  "model": "gpt-image-2",
  "prompt": "...",
  "n": 1,
  "output_format": "png",
  "size": "3840x1280",
  "quality": "high"
}
```

If the user's account requires a group, pass it with `--group` or `ONEXM_GROUP`.

## CLI Options

```bash
node scripts/generate_1xm_image.mjs \
  --prompt <prompt.txt> \
  --out <base.png> \
  [--reference <image.png>] \
  [--model gpt-image-2] \
  [--size 3840x1280] \
  [--quality high] \
  [--base-url https://api.1xm.ai/v1] \
  [--config ~/.config/banner-generation/1xm.json] \
  [--api-key-env ONEXM_API_KEY] \
  [--group <group>] \
  [--timeout-ms 600000]
```

Use multiple `--reference` flags to send multiple visual references.

## Troubleshooting

- Missing key: set `ONEXM_API_KEY` or create `~/.config/banner-generation/1xm.json`.
- Unsupported ratio: generate a supported base, usually `3840x1280` for a 3:1 wide image, then crop or fit it in HTML.
- Fake text in the base: regenerate with stronger `Text: render no words...` constraints.
- Timeout: retry once; large `gpt-image-2` jobs can take minutes.
- Non-image result: inspect the returned error only, not the key. Do not print Authorization headers.
