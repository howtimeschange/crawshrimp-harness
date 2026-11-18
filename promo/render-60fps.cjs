// Render four samples per 60 fps frame across a 180-degree shutter.
const { chromium } = require('playwright')
const { mkdir, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const FPS = 60
const SAMPLES = 4
const SHUTTER = 0.5

async function main(args) {
  const eventsOnly = args[0] === '--events-only'
  const [partArg = '0', partsArg = '1', directory = path.join(__dirname, '.v3-build')] =
    eventsOnly ? ['0', '1', args[1]] : args
  const [part, parts] = [Number(partArg), Number(partsArg)]
  if (!Number.isSafeInteger(part) || !Number.isSafeInteger(parts) || part < 0 || part >= parts) {
    throw new Error('Usage: node render-60fps.cjs [part parts [build-directory]] | --events-only [build-directory]')
  }
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
    const filmUrl = pathToFileURL(path.join(__dirname, 'film-v3.html'))
    filmUrl.searchParams.set('render', '1')
    await page.goto(filmUrl.href)
    await page.waitForFunction(() => typeof window.seek === 'function' && Array.isArray(window.EVENTS))
    await page.evaluate(() => document.fonts.ready)
    const timeline = await page.evaluate(() => ({ duration: window.DUR, events: window.EVENTS }))
    if (!Number.isFinite(timeline.duration) || timeline.duration <= 0 || !timeline.events.length) {
      throw new Error('The film did not provide a valid timeline')
    }
    if (part === 0) {
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, 'events.json'), JSON.stringify(timeline, null, 2) + '\n')
    }
    if (eventsOnly) return

    const samplesDir = path.join(directory, 'sub')
    await mkdir(samplesDir, { recursive: true })
    for (let frame = part; frame < Math.round(timeline.duration * FPS); frame += parts) {
      for (let sample = 0; sample < SAMPLES; sample++) {
        const time = Math.max(0, (frame + ((sample + 0.5) / SAMPLES - 0.5) * SHUTTER) / FPS)
        await page.evaluate(seconds => window.seek(seconds), time)
        const index = String(frame * SAMPLES + sample).padStart(6, '0')
        await page.screenshot({ path: path.join(samplesDir, `s${index}.jpg`), quality: 92 })
      }
    }
    console.log(`Rendered shard ${part + 1}/${parts}`)
  } finally {
    await browser.close()
  }
}

main(process.argv.slice(2)).catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
