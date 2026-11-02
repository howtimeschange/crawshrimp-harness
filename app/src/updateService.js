'use strict'

const LATEST_RELEASE_URL = 'https://github.com/howtimeschange/crawshrimp-harness/releases/latest'
const GITHUB_FALLBACK_FEED = Object.freeze({
  provider: 'github',
  owner: 'howtimeschange',
  repo: 'crawshrimp-harness',
})

function createUpdateService({
  app,
  autoUpdater,
  platformSupport,
  updateFeedUrl = '',
  resolveCountry,
  getAvailableBytes,
  log = console,
  emit,
}) {
  const support = platformSupport || { supported: false, reason: '当前环境不支持桌面更新。' }
  const subscribers = new Set()
  let disposed = false
  let requiredBytes = 0
  let source = String(updateFeedUrl || '').trim() ? 'cos' : 'github'
  let sourceOrder = [source, ...(source === 'cos' ? ['github'] : [])]
  let checking = null
  let downloading = null
  let refreshingForDownload = false
  let handlingSourceOperation = false

  const state = {
    status: support.supported ? 'idle' : 'disabled',
    currentVersion: String(app?.getVersion?.() || ''),
    latestVersion: '',
    releaseNotes: '',
    progress: null,
    error: support.reason || '',
    blockers: [],
    lastCheckedAt: '',
    downloaded: false,
    manualDownloadUrl: LATEST_RELEASE_URL,
    downloadSource: source,
    country: '',
  }

  configureUpdater(autoUpdater, updateFeedUrl, log)

  function snapshot() {
    return {
      ...state,
      progress: state.progress ? { ...state.progress } : null,
      blockers: state.blockers.map(blocker => ({ ...blocker })),
    }
  }

  function publish(patch = {}) {
    if (disposed) return
    Object.assign(state, patch)
    const next = snapshot()
    if (typeof emit === 'function') emit(next)
    for (const listener of subscribers) listener(next)
  }

  function rememberUpdateInfo(info = {}) {
    state.latestVersion = String(info.version || state.latestVersion || '')
    state.releaseNotes = normalizeReleaseNotes(info.releaseNotes || state.releaseNotes || '')
    requiredBytes = largestFileSize(info)
  }

  function isConfirmedNewerVersion(version) {
    return compareVersions(version, state.currentVersion) > 0
  }

  const handlers = {
    'checking-for-update': () => {
      if (!refreshingForDownload) publish({ status: 'checking', error: '', progress: null })
    },
    'update-available': info => {
      rememberUpdateInfo(info)
      if (refreshingForDownload) return
      if (!isConfirmedNewerVersion(state.latestVersion)) {
        publish({
          status: 'up-to-date',
          error: '',
          progress: null,
          blockers: [],
          downloaded: false,
          lastCheckedAt: new Date().toISOString(),
        })
        return
      }
      publish({
        status: 'available',
        latestVersion: state.latestVersion,
        releaseNotes: state.releaseNotes,
        progress: null,
        error: '',
        blockers: [],
        downloaded: false,
      })
    },
    'update-not-available': () => !refreshingForDownload && publish({
      status: 'up-to-date',
      error: '',
      progress: null,
      lastCheckedAt: new Date().toISOString(),
    }),
    'download-progress': progress => publish({
      status: 'downloading',
      progress: normalizeProgress(progress),
      error: '',
    }),
    'update-downloaded': info => {
      rememberUpdateInfo(info)
      publish({
        status: 'downloaded',
        latestVersion: state.latestVersion,
        releaseNotes: state.releaseNotes,
        progress: null,
        error: '',
        downloaded: true,
      })
    },
    error: error => !handlingSourceOperation && publish({
      status: isNoPublishedUpdateError(error) && !state.downloaded ? 'up-to-date' : 'error',
      progress: null,
      error: isNoPublishedUpdateError(error) && !state.downloaded ? '' : readableError(error),
      lastCheckedAt: isNoPublishedUpdateError(error) && !state.downloaded
        ? new Date().toISOString()
        : state.lastCheckedAt,
    }),
  }

  for (const [eventName, handler] of Object.entries(handlers)) {
    autoUpdater?.on?.(eventName, handler)
  }

  function useSource(next) {
    if (next === source) return
    source = next
    if (next === 'cos') configureUpdater(autoUpdater, updateFeedUrl, log)
    else autoUpdater.setFeedURL(GITHUB_FALLBACK_FEED)
    publish({ downloadSource: next })
  }

  async function checkForUpdates(options = {}) {
    ensureSupported()
    if (checking) return checking
    if (downloading) return null
    checking = performCheck(options)
    try { return await checking } finally { checking = null }
  }

  async function performCheck({ manual = true } = {}) {
    // A focus check must not replace an offered download or an active install
    // flow with `checking` while the user confirms the next update action.
    if (state.downloaded || state.status === 'downloading' || state.status === 'installing' ||
        (!manual && state.status === 'available')) return null
    publish({ status: 'checking', error: '', progress: null, lastCheckedAt: new Date().toISOString() })
    if (String(updateFeedUrl || '').trim() && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(updateFeedUrl)) {
      const country = typeof resolveCountry === 'function' ? await Promise.resolve().then(resolveCountry).catch(() => '') : 'CN'
      publish({ country })
      sourceOrder = country === 'CN' ? ['cos', 'github'] : ['github', 'cos']
    }
    handlingSourceOperation = true
    try {
      let lastError
      for (const next of sourceOrder) {
        try {
          if (String(updateFeedUrl || '').trim()) useSource(next)
          return await autoUpdater.checkForUpdates()
        } catch (error) {
          lastError = error
          log?.warn?.(`Update check through ${next} failed; trying remaining source`, error)
        }
      }
      if (isNoPublishedUpdateError(lastError) && !state.downloaded) {
        publish({ status: 'up-to-date', error: '', progress: null, lastCheckedAt: new Date().toISOString() })
        return null
      }
      publish({ status: 'error', error: readableError(lastError), progress: null })
      throw lastError
    } finally {
      handlingSourceOperation = false
    }
  }

  async function downloadUpdate() {
    if (downloading) return downloading
    if (checking) await checking
    if (downloading) return downloading
    downloading = performDownload()
    try { return await downloading } finally { downloading = null }
  }

  async function performDownload() {
    if (state.status !== 'available' && !(state.status === 'error' && state.latestVersion)) {
      throw new Error('当前没有可下载的桌面更新。')
    }
    try {
      const freeBytes = typeof getAvailableBytes === 'function' ? await getAvailableBytes() : null
      if (requiredBytes > 0 && Number.isFinite(Number(freeBytes)) && Number(freeBytes) < requiredBytes) {
        throw new Error(`磁盘空间不足：更新需要 ${formatBytes(requiredBytes)}，当前可用 ${formatBytes(Number(freeBytes))}。`)
      }
      publish({ status: 'downloading', error: '', progress: normalizeProgress({ percent: 0 }) })
      handlingSourceOperation = true
      try {
        return await autoUpdater.downloadUpdate()
      } catch (primaryError) {
        const alternate = sourceOrder.find(next => next !== source)
        if (!alternate || primaryError?.code === 'ERR_UPDATER_CANCELLED') throw primaryError
        const targetVersion = state.latestVersion
        log?.warn?.(`Update download through ${source} failed; retrying through ${alternate}`, primaryError)
        useSource(alternate)
        refreshingForDownload = true
        let result
        try { result = await autoUpdater.checkForUpdates() } finally { refreshingForDownload = false }
        const alternateVersion = String(result?.updateInfo?.version || state.latestVersion)
        if (alternateVersion !== targetVersion || !isConfirmedNewerVersion(alternateVersion)) {
          throw new Error('备用源版本已变化，请重新检查更新后下载。')
        }
        publish({ status: 'downloading', error: '', progress: normalizeProgress({ percent: 0 }) })
        return await autoUpdater.downloadUpdate()
      }
    } catch (error) {
      publish({ status: 'error', error: readableError(error), progress: null })
      throw error
    } finally {
      handlingSourceOperation = false
    }
  }

  function setInstallReadiness({ ready, blockers = [], error = '' } = {}) {
    const normalizedBlockers = Array.isArray(blockers) ? blockers.map(blocker => ({ ...blocker })) : []
    if (error) {
      publish({ status: 'waiting-for-tasks', blockers: normalizedBlockers, error: String(error) })
      return
    }
    if (!state.downloaded) {
      publish({ blockers: normalizedBlockers, error: ready ? '' : state.error })
      return
    }
    publish({
      status: ready ? 'ready-to-install' : 'waiting-for-tasks',
      blockers: ready ? [] : normalizedBlockers,
      error: '',
    })
  }

  function setInstalling() {
    if (!state.downloaded || state.status !== 'ready-to-install') {
      throw new Error('尚未准备好安装桌面更新。')
    }
    publish({ status: 'installing', error: '', blockers: [] })
  }

  function quitAndInstall() {
    if (!state.downloaded || state.status !== 'installing') {
      throw new Error('尚未准备好安装桌面更新。')
    }
    return autoUpdater.quitAndInstall()
  }

  function subscribe(listener) {
    subscribers.add(listener)
    listener(snapshot())
    return () => subscribers.delete(listener)
  }

  function dispose() {
    disposed = true
    subscribers.clear()
    for (const [eventName, handler] of Object.entries(handlers)) {
      autoUpdater?.removeListener?.(eventName, handler)
    }
  }

  function ensureSupported() {
    if (support.supported) return
    throw new Error(support.reason || '当前环境不支持桌面更新。')
  }

  return {
    getStatus: snapshot,
    subscribe,
    checkForUpdates,
    downloadUpdate,
    setInstallReadiness,
    setInstalling,
    quitAndInstall,
    dispose,
  }
}

const GITHUB_RELEASE_API = 'https://api.github.com/repos/howtimeschange/crawshrimp-harness/releases/latest'
// GitHub 镜像(网络受限环境回退;可按部署替换为 Cloudflare 镜像站)
const GITHUB_RELEASE_API_MIRROR = String(process.env.CRAWSHRIMP_UPDATE_NOTES_MIRROR || '').trim()
const GITHUB_RELEASE_PAGE = 'https://github.com/howtimeschange/crawshrimp-harness/releases/latest'

/** 抓取最新 release 的更新日志(GitHub API → 镜像回退)。 */
async function fetchLatestReleaseNotes() {
  const attempts = [
    GITHUB_RELEASE_API,
    ...(GITHUB_RELEASE_API_MIRROR ? [GITHUB_RELEASE_API_MIRROR] : []),
  ]
  let lastError = ''
  for (const url of attempts) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'crawshrimp-updater' },
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const release = await response.json()
      const name = String(release?.name || release?.tag_name || '')
      const body = String(release?.body || '')
      return {
        ok: true,
        version: name.replace(/^v(?=\d)/, ''),
        body,
        publishedAt: String(release?.published_at || ''),
        url: String(release?.html_url || GITHUB_RELEASE_PAGE),
      }
    } catch (error) {
      lastError = String(error?.message || error)
    }
  }
  return { ok: false, error: lastError, url: GITHUB_RELEASE_PAGE }
}

module.exports = { createUpdateService, fetchLatestReleaseNotes, GITHUB_RELEASE_PAGE }

function configureUpdater(autoUpdater, updateFeedUrl, log) {
  if (!autoUpdater) throw new Error('autoUpdater is required')
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  const feedUrl = String(updateFeedUrl || '').trim()
  if (feedUrl) {
    try {
      autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
    } catch (error) {
      log?.warn?.('Failed to configure desktop update feed', error)
      throw error
    }
  }
}

function normalizeReleaseNotes(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item?.note || item || '')).filter(Boolean).join('\n')
  }
  return String(value || '')
}

function normalizeProgress(progress = {}) {
  return {
    percent: roundPercent(progress.percent),
    transferred: normalizeNumber(progress.transferred),
    total: normalizeNumber(progress.total),
    bytesPerSecond: normalizeNumber(progress.bytesPerSecond),
  }
}

function roundPercent(value) {
  const numeric = normalizeNumber(value)
  return Math.max(0, Math.min(100, Math.round(numeric * 100) / 100))
}

function normalizeNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0
}

function largestFileSize(info = {}) {
  const files = Array.isArray(info.files) ? info.files : []
  return files.reduce((largest, file) => {
    const size = Number(file?.size)
    return Number.isFinite(size) && size > largest ? size : largest
  }, 0)
}

function readableError(error) {
  return String(error?.message || error || '桌面更新失败。')
}

function isNoPublishedUpdateError(error) {
  const message = readableError(error)
  return /(?:404|not found|No published versions|Cannot find .*latest.*\.ya?ml|latest release)/i.test(message)
}

function normalizeVersionForCompare(value) {
  return String(value || '').trim().replace(/^v(?=\d)/i, '')
}

function compareVersions(left, right) {
  const a = normalizeVersionForCompare(left)
  const b = normalizeVersionForCompare(right)
  if (!a || !b) return a && a !== b ? 1 : 0
  if (a === b) return 0
  const aParts = a.split(/[.-]/).map(part => Number(part))
  const bParts = b.split(/[.-]/).map(part => Number(part))
  if (aParts.some(part => !Number.isFinite(part)) || bParts.some(part => !Number.isFinite(part))) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  }
  const length = Math.max(aParts.length, bParts.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (aParts[index] || 0) - (bParts[index] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0)
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = bytes / 1024
  let index = 0
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024
    index += 1
  }
  return `${Math.round(amount * 10) / 10} ${units[index]}`
}
