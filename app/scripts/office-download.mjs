import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex')

/** Promote only hash-verified bytes, regardless of the download source. */
export async function downloadOfficeAsset(entry, { cacheDirectory, filename, warn = console.warn }) {
  mkdirSync(cacheDirectory, { recursive: true })
  const path = join(cacheDirectory, filename || basename(new URL(entry.url).pathname))
  if (existsSync(path) && sha(path) === entry.sha256) return path

  const partial = path + '.partial'
  const failures = []
  for (const url of [...new Set([entry.url, ...(entry.fallbackUrls || [])])]) {
    rmSync(partial, { force: true })
    try {
      await execFileAsync('curl', [
        '--fail', '--location', '--silent', '--show-error',
        '--retry', '2', '--retry-all-errors', '--retry-delay', '2', '--retry-max-time', '120',
        '--connect-timeout', '20', '--max-time', '600', '-o', partial, url,
      ])
      if (sha(partial) !== entry.sha256) throw new Error('Office asset checksum mismatch: ' + basename(path))
      renameSync(partial, path)
      return path
    } catch (error) {
      rmSync(partial, { force: true })
      const message = url + ': ' + error.message
      failures.push(message)
      warn('[office] download failed, trying remaining sources: ' + message)
    }
  }
  throw new Error('Unable to download verified Office asset ' + basename(path) + '\n' + failures.join('\n'))
}
