'use strict'

const REGION_URL = 'https://harness.crawshrimp.com/api/download-region'

async function resolveDownloadCountry(fetcher = fetch) {
  try {
    const response = await fetcher(REGION_URL, { signal: AbortSignal.timeout(4000), cache: 'no-store' })
    if (!response.ok) return ''
    const value = (await response.json())?.country
    return /^[A-Z]{2}$/.test(value) ? value : ''
  } catch {
    return ''
  }
}

module.exports = { resolveDownloadCountry }
