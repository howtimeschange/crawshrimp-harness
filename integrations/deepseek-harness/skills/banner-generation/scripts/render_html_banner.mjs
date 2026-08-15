#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i]
    if (!key.startsWith('--')) continue
    const name = key.slice(2)
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '1'
    args[name] = value
  }
  return args
}

function loadPlaywright() {
  const roots = [
    process.env.PLAYWRIGHT_NODE_MODULES,
    process.env.CODEX_NODE_MODULES,
    process.env.CRAWSHRIMP_NODE_MODULES_DIR,
    ...String(process.env.NODE_REPL_NODE_MODULE_DIRS || '').split(':'),
    path.join(process.cwd(), 'node_modules'),
  ].filter(Boolean)

  for (const root of roots) {
    try {
      const requireFromRoot = createRequire(path.join(root, 'package.json'))
      return requireFromRoot('playwright')
    } catch {
      // Try next root.
    }
  }
  throw new Error('Cannot load playwright. Set PLAYWRIGHT_NODE_MODULES to a node_modules directory containing playwright.')
}

function defaultChromePath() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROME_EXECUTABLE,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean)
  return candidates.find((candidate) => fs.existsSync(candidate)) || ''
}

const args = parseArgs(process.argv)
const html = args.html
const out = args.out
const width = Number(args.width || 1650)
const height = Number(args.height || 500)
const scale = Number(args.scale || 2)

if (!html || !out) {
  console.error('Usage: render_html_banner.mjs --html <file-or-url> --out <png> [--width 1650] [--height 500] [--scale 2]')
  process.exit(2)
}

const { chromium } = loadPlaywright()
const executablePath = defaultChromePath()
const launchOptions = executablePath ? { headless: true, executablePath } : { headless: true }
const browser = await chromium.launch(launchOptions)
try {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: scale,
    colorScheme: 'dark',
  })
  const target = /^https?:|^file:/i.test(html) ? html : pathToFileURL(path.resolve(html)).href
  await page.goto(target, { waitUntil: 'networkidle' })
  const layout = await page.evaluate((expected) => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
    overflow: document.documentElement.scrollWidth > expected.width || document.documentElement.scrollHeight > expected.height,
  }), { width, height })
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  await page.screenshot({ path: out, fullPage: true })
  console.log(JSON.stringify({ out: path.resolve(out), layout }))
} finally {
  await browser.close()
}
