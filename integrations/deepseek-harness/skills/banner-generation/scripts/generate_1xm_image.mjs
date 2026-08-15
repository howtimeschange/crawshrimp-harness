#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const DEFAULT_BASE_URL = 'https://api.1xm.ai/v1'
const DEFAULT_MODEL = 'gpt-image-2'
const DEFAULT_SIZE = '3840x1280'
const DEFAULT_QUALITY = 'high'
const DEFAULT_TIMEOUT_MS = 600_000
const DEFAULT_POLL_MS = 5_000
const SUCCESS_STATUSES = new Set(['succeeded', 'completed', 'success', 'done'])
const FAILED_STATUSES = new Set(['failed', 'error', 'canceled', 'cancelled'])

function fatal(error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Error: ${message}\n`)
  process.exit(1)
}

process.on('uncaughtException', fatal)
process.on('unhandledRejection', fatal)

function usage() {
  return `Usage:
  node generate_1xm_image.mjs --prompt <prompt.txt> --out <base.png> [options]

Options:
  --reference <image>       Optional visual reference. Repeat for multiple images.
  --model <name>            Default: ${DEFAULT_MODEL}
  --size <widthxheight>     Default: ${DEFAULT_SIZE}
  --quality <quality>       Default: ${DEFAULT_QUALITY}
  --base-url <url>          Default: ${DEFAULT_BASE_URL}
  --group <group>           Optional 1xm group.
  --config <json>           Default: ~/.config/banner-generation/1xm.json
  --api-key-env <name>      Default: ONEXM_API_KEY, fallback GPT_IMAGE_API_KEY
  --timeout-ms <ms>         Default: ${DEFAULT_TIMEOUT_MS}
`
}

function parseArgs(argv) {
  const args = { reference: [] }
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i]
    if (key === '--help' || key === '-h') {
      args.help = true
      continue
    }
    if (!key.startsWith('--')) continue
    const name = key.slice(2)
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '1'
    if (name === 'reference') args.reference.push(value)
    else args[name] = value
  }
  return args
}

function readConfig(configPath) {
  const resolved = expandHome(configPath || '~/.config/banner-generation/1xm.json')
  if (!fs.existsSync(resolved)) return {}
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'))
  } catch (error) {
    throw new Error(`Could not parse config JSON at ${resolved}: ${error.message}`)
  }
}

function expandHome(value) {
  if (!value) return value
  return value === '~' || value.startsWith('~/')
    ? path.join(os.homedir(), value.slice(2))
    : value
}

function resolveCredentials(args) {
  const config = readConfig(args.config)
  const keyEnv = args['api-key-env'] || 'ONEXM_API_KEY'
  const apiKey = process.env[keyEnv] || process.env.GPT_IMAGE_API_KEY || config.apiKey || ''
  if (!apiKey) {
    throw new Error(
      `Missing 1xm API key. Set ${keyEnv} or create ~/.config/banner-generation/1xm.json with {"apiKey":"..."}.`,
    )
  }
  return {
    apiKey,
    baseUrl: String(args['base-url'] || config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    group: String(args.group || process.env.ONEXM_GROUP || config.group || '').trim(),
  }
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

function readReference(filePath) {
  const resolved = path.resolve(filePath)
  return `data:${mimeFromPath(resolved)};base64,${fs.readFileSync(resolved).toString('base64')}`
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function readJsonResponse(res) {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function formatError(data) {
  return String(data?.error?.message || data?.error || data?.message || data?.raw || JSON.stringify(data || {})).slice(0, 500)
}

async function postTask({ baseUrl, apiKey, payload, timeoutMs }) {
  const res = await fetchWithTimeout(`${baseUrl}/images/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  }, Math.min(timeoutMs, 30_000))
  const data = await readJsonResponse(res)
  if (!res.ok && res.status !== 202) {
    throw new Error(`1xm task create failed (${res.status}): ${formatError(data)}`)
  }
  return data
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase()
}

function pollAfterMs(task) {
  const numeric = Number(task?.poll_after ?? task?.pollAfter)
  if (!Number.isFinite(numeric) || numeric < 0) return DEFAULT_POLL_MS
  if (numeric === 0) return 0
  return Math.max(1_000, Math.min(60_000, numeric * 1_000))
}

function pollUrl(baseUrl, task) {
  const target = String(task?.poll_url || task?.pollUrl || task?.id || task?.task_id || task?.taskId || '').trim()
  if (!target) return ''
  if (/^https?:\/\//i.test(target)) return target
  return `${baseUrl}/images/tasks/${encodeURIComponent(target)}`
}

async function waitForTask({ baseUrl, apiKey, task, timeoutMs }) {
  const startedAt = Date.now()
  let current = task
  for (;;) {
    const imageSource = extractImageSource(current)
    if (imageSource) return imageSource

    const status = normalizeStatus(current?.status)
    if (SUCCESS_STATUSES.has(status)) {
      throw new Error('1xm task succeeded but returned no image.')
    }
    if (FAILED_STATUSES.has(status)) {
      throw new Error(`1xm task ${status}: ${formatError(current)}`)
    }

    const url = pollUrl(baseUrl, current)
    if (!url) throw new Error('1xm task response did not include poll_url or task id.')

    const remaining = timeoutMs - (Date.now() - startedAt)
    if (remaining <= 0) throw new Error(`1xm image task timed out after ${timeoutMs}ms.`)
    await sleep(Math.min(pollAfterMs(current), remaining))

    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    }, Math.min(30_000, Math.max(1_000, timeoutMs - (Date.now() - startedAt))))
    const data = await readJsonResponse(res)
    if (!res.ok) throw new Error(`1xm task poll failed (${res.status}): ${formatError(data)}`)
    current = data
  }
}

function extractImageSource(data) {
  const sources = []
  const add = (value) => {
    if (value && typeof value === 'string' && !sources.includes(value)) sources.push(value)
  }
  const addBase64 = (value, mime = 'image/png') => {
    if (value && typeof value === 'string') add(`data:${mime};base64,${value}`)
  }
  const walk = (node) => {
    if (!node) return
    if (typeof node === 'string') {
      for (const match of node.matchAll(/!\[[^\]]*\]\((data:image\/[^\s)]+|https?:\/\/[^\s)]+)\)/gi)) add(match[1])
      for (const match of node.matchAll(/(data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+)/gi)) add(match[1])
      for (const match of node.matchAll(/https?:\/\/[^\s)\]>"']+/gi)) add(match[0])
      return
    }
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (typeof node !== 'object') return
    add(node.image_url)
    add(node.imageUrl)
    add(node.output_url)
    add(node.outputUrl)
    add(node.url)
    add(node.image_url?.url)
    add(node.imageUrl?.url)
    add(node.output_url?.url)
    add(node.outputUrl?.url)
    addBase64(node.b64_json || node.b64Json)
    addBase64(node.inlineData?.data, node.inlineData?.mimeType || 'image/png')
    addBase64(node.inline_data?.data, node.inline_data?.mime_type || 'image/png')
    walk(node.choices?.[0]?.message?.content)
    walk(node.data)
    walk(node.result)
    walk(node.output)
    walk(node.outputs)
    walk(node.candidates?.[0]?.content?.parts)
    walk(node.content)
    walk(node.parts)
    walk(node.text)
  }
  walk(data)
  return sources[0] || ''
}

async function writeImageSource(source, outPath, timeoutMs) {
  const resolved = path.resolve(outPath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  if (source.startsWith('data:')) {
    const match = source.match(/^data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)$/i)
    if (!match) throw new Error('Model returned an invalid image data URL.')
    fs.writeFileSync(resolved, Buffer.from(match[1], 'base64'))
    return resolved
  }
  if (!/^https?:\/\//i.test(source)) throw new Error(`Unsupported image source: ${source.slice(0, 120)}`)
  const res = await fetchWithTimeout(source, {}, timeoutMs)
  if (!res.ok) throw new Error(`Image result fetch failed (${res.status}).`)
  const contentType = res.headers.get('content-type') || ''
  if (contentType && !contentType.toLowerCase().startsWith('image/')) {
    throw new Error(`Image result returned non-image content-type: ${contentType}`)
  }
  fs.writeFileSync(resolved, Buffer.from(await res.arrayBuffer()))
  return resolved
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const args = parseArgs(process.argv)
if (args.help) {
  process.stdout.write(usage())
  process.exit(0)
}
if (!args.prompt || !args.out) {
  process.stderr.write(usage())
  process.exit(2)
}

const timeoutMs = Math.max(1_000, Number(args['timeout-ms'] || DEFAULT_TIMEOUT_MS))
const { apiKey, baseUrl, group } = resolveCredentials(args)
const prompt = fs.readFileSync(path.resolve(args.prompt), 'utf8')
const payload = {
  model: args.model || DEFAULT_MODEL,
  prompt,
  n: 1,
  output_format: 'png',
  size: args.size || DEFAULT_SIZE,
  quality: args.quality || DEFAULT_QUALITY,
}
if (group) payload.group = group
if (args.reference.length > 0) payload.image = args.reference.map(readReference)

const task = await postTask({ baseUrl, apiKey, payload, timeoutMs })
const source = await waitForTask({ baseUrl, apiKey, task, timeoutMs })
const out = await writeImageSource(source, args.out, Math.min(timeoutMs, 60_000))
process.stdout.write(JSON.stringify({ out, model: payload.model, size: payload.size, quality: payload.quality }, null, 2) + '\n')
