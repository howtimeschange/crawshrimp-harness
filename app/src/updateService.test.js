const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createUpdateService } = require('./updateService')

function createUpdater() {
  const updater = new EventEmitter()
  updater.checkForUpdates = async () => {}
  updater.downloadUpdate = async () => {}
  updater.quitAndInstall = () => {}
  updater.setFeedURL = () => {}
  return updater
}

function createService(options = {}) {
  return createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: createUpdater(),
    platformSupport: { supported: true, reason: '' },
    ...options,
  })
}

test('available update waits for explicit download', async () => {
  const updater = createUpdater()
  updater.checkForUpdates = async () => {
    updater.emit('update-available', { version: '2.0.1', releaseNotes: '安全更新' })
  }
  let downloads = 0
  updater.downloadUpdate = async () => { downloads += 1 }

  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
  })

  await service.checkForUpdates({ manual: false })
  assert.equal(service.getStatus().status, 'available')
  assert.equal(downloads, 0)
  await service.downloadUpdate()
  assert.equal(downloads, 1)
  assert.equal(service.getStatus().status, 'downloading')
  assert.deepEqual(service.getStatus().progress, {
    percent: 0,
    transferred: 0,
    total: 0,
    bytesPerSecond: 0,
  })
})

test('available update records the time of the automatic check', async () => {
  const updater = createUpdater()
  updater.checkForUpdates = async () => {
    updater.emit('update-available', { version: '2.0.1' })
  }
  const service = createService({ autoUpdater: updater })

  await service.checkForUpdates({ manual: false })

  assert.equal(service.getStatus().status, 'available')
  assert.match(service.getStatus().lastCheckedAt, /^\d{4}-\d{2}-\d{2}T/)
})

test('a focus-triggered check preserves an offered update while the user confirms download', async () => {
  const updater = createUpdater()
  let finishCheck
  let checks = 0
  let downloads = 0
  updater.checkForUpdates = async () => {
    checks += 1
    updater.emit('checking-for-update')
    await new Promise(resolve => { finishCheck = resolve })
    updater.emit('update-available', { version: '2.0.1' })
  }
  updater.downloadUpdate = async () => { downloads += 1 }
  const service = createService({ autoUpdater: updater })
  updater.emit('update-available', { version: '2.0.1' })

  const automaticCheck = service.checkForUpdates({ manual: false })
  try {
    await assert.doesNotReject(() => service.downloadUpdate())
    assert.equal(checks, 0)
    assert.equal(downloads, 1)
    assert.equal(service.getStatus().status, 'downloading')
  } finally {
    finishCheck?.()
    await automaticCheck
    service.dispose()
  }
})

test('automatic checks preserve download progress and installation readiness', async () => {
  const updater = createUpdater()
  let checks = 0
  updater.checkForUpdates = async () => { checks += 1 }
  const service = createService({ autoUpdater: updater })
  updater.emit('update-available', { version: '2.0.1' })
  await service.downloadUpdate()
  updater.emit('download-progress', { percent: 45, transferred: 45, total: 100 })
  let previous = service.getStatus()
  await service.checkForUpdates({ manual: false })
  assert.deepEqual(service.getStatus(), previous)

  updater.emit('update-downloaded', { version: '2.0.1' })
  const transitions = [
    () => {},
    () => service.setInstallReadiness({ ready: false, blockers: [{ kind: 'task', id: 'local-wait' }] }),
    () => service.setInstallReadiness({ ready: true }),
    () => service.setInstalling(),
  ]
  for (const transition of transitions) {
    transition()
    previous = service.getStatus()
    await service.checkForUpdates({ manual: false })
    assert.deepEqual(service.getStatus(), previous)
  }
  assert.equal(checks, 0)
  service.dispose()
})

test('manual checks can refresh an offered version before downloading', async () => {
  const updater = createUpdater()
  let checks = 0
  updater.checkForUpdates = async () => {
    checks += 1
    updater.emit('update-available', { version: '2.0.2' })
  }
  const service = createService({ autoUpdater: updater })
  updater.emit('update-available', { version: '2.0.1' })
  await service.checkForUpdates({ manual: true })
  assert.equal(checks, 1)
  assert.equal(service.getStatus().latestVersion, '2.0.2')
  service.dispose()
})

test('downloaded update becomes waiting or ready only through readiness input', () => {
  const updater = createUpdater()
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
  })

  updater.emit('update-downloaded', { version: '2.0.1' })
  service.setInstallReadiness({
    ready: false,
    blockers: [{ kind: 'task', id: 'tmall::export', label: '导出任务', status: 'running' }],
  })
  assert.equal(service.getStatus().status, 'waiting-for-tasks')

  service.setInstallReadiness({ ready: true, blockers: [] })
  assert.equal(service.getStatus().status, 'ready-to-install')
})

test('unsupported development builds are disabled and do not check for updates', async () => {
  const updater = createUpdater()
  let checks = 0
  updater.checkForUpdates = async () => { checks += 1 }
  const service = createUpdateService({
    app: { isPackaged: false, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: false, reason: '开发模式不会检查桌面更新。' },
  })

  assert.equal(service.getStatus().status, 'disabled')
  await assert.rejects(() => service.checkForUpdates({ manual: true }), /开发模式不会检查桌面更新/)
  assert.equal(checks, 0)
})

test('subscription cleanup stops status notifications and dispose removes updater listeners', async () => {
  const updater = createUpdater()
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
  })
  const statuses = []
  const unsubscribe = service.subscribe(status => statuses.push(status.status))

  updater.emit('checking-for-update')
  unsubscribe()
  updater.emit('update-not-available')
  assert.deepEqual(statuses, ['idle', 'checking'])

  service.dispose()
  assert.equal(updater.listenerCount('checking-for-update'), 0)
  updater.emit('checking-for-update')
  assert.equal(service.getStatus().status, 'up-to-date')
})

test('no available update publishes the declared up-to-date status', () => {
  const updater = createUpdater()
  const service = createService({ autoUpdater: updater })

  updater.emit('update-not-available')

  assert.equal(service.getStatus().status, 'up-to-date')
})

test('same-version update-available event is treated as up-to-date', async () => {
  const updater = createUpdater()
  updater.checkForUpdates = async () => {
    updater.emit('update-available', { version: '2.0.0', releaseNotes: 'current release' })
  }
  const service = createService({ autoUpdater: updater })

  await service.checkForUpdates({ manual: false })

  assert.equal(service.getStatus().status, 'up-to-date')
  assert.equal(service.getStatus().latestVersion, '2.0.0')
  assert.equal(service.getStatus().downloaded, false)
})

test('missing GitHub release metadata is not surfaced as a retryable update', async () => {
  const updater = createUpdater()
  updater.checkForUpdates = async () => {
    throw new Error('404 latest release not found')
  }
  const service = createService({ autoUpdater: updater })

  await assert.doesNotReject(() => service.checkForUpdates({ manual: false }))

  assert.equal(service.getStatus().status, 'up-to-date')
  assert.equal(service.getStatus().error, '')
})

test('download progress is normalized to a stable percent and byte shape', () => {
  const updater = createUpdater()
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
  })

  updater.emit('download-progress', {
    percent: 34.567,
    transferred: 34567,
    total: 100000,
    bytesPerSecond: 1234,
  })

  assert.deepEqual(service.getStatus().progress, {
    percent: 34.57,
    transferred: 34567,
    total: 100000,
    bytesPerSecond: 1234,
  })
})

test('SHA and download errors keep a newer version eligible for retry', async () => {
  const updater = createUpdater()
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
  })

  updater.emit('update-available', { version: '2.0.1' })
  updater.emit('error', new Error('sha512 checksum mismatch'))
  assert.equal(service.getStatus().status, 'error')
  assert.match(service.getStatus().error, /sha512 checksum mismatch/)
  await assert.doesNotReject(() => service.downloadUpdate())
})

test('insufficient disk space prevents download with a user-facing error', async () => {
  const updater = createUpdater()
  updater.checkForUpdates = async () => {
    updater.emit('update-available', { version: '2.0.1', files: [{ size: 200 }] })
  }
  let downloads = 0
  updater.downloadUpdate = async () => { downloads += 1 }
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
    getAvailableBytes: () => 100,
  })

  await service.checkForUpdates({ manual: true })
  await assert.rejects(() => service.downloadUpdate(), /磁盘空间不足/)
  assert.equal(downloads, 0)
  assert.match(service.getStatus().error, /磁盘空间不足/)
  assert.match(service.getStatus().error, /200 B/)
  assert.match(service.getStatus().error, /100 B/)
})

test('disk probe failure publishes an update error and skips download', async () => {
  const updater = createUpdater()
  updater.checkForUpdates = async () => {
    updater.emit('update-available', { version: '2.0.1', files: [{ size: 200 }] })
  }
  let downloads = 0
  updater.downloadUpdate = async () => { downloads += 1 }
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '2.0.0' },
    autoUpdater: updater,
    platformSupport: { supported: true, reason: '' },
    getAvailableBytes: () => {
      throw new Error('statfs failed')
    },
  })

  await service.checkForUpdates({ manual: true })
  await assert.rejects(() => service.downloadUpdate(), /statfs failed/)

  assert.equal(downloads, 0)
  assert.equal(service.getStatus().status, 'error')
  assert.match(service.getStatus().error, /statfs failed/)
})

test('quitAndInstall rejects until a downloaded update is explicitly installing', () => {
  const updater = createUpdater()
  let installs = 0
  updater.quitAndInstall = () => { installs += 1 }
  const service = createService({ autoUpdater: updater })

  assert.throws(() => service.quitAndInstall(), /尚未准备好安装/)
  updater.emit('update-downloaded', { version: '2.0.1' })
  assert.throws(() => service.quitAndInstall(), /尚未准备好安装/)
  assert.throws(() => service.setInstalling(), /尚未准备好安装/)
  service.setInstallReadiness({ ready: true, blockers: [] })
  service.setInstalling()
  service.quitAndInstall()
  assert.equal(installs, 1)
})

test('configured feed URL uses the generic updater provider', () => {
  const updater = createUpdater()
  const feeds = []
  updater.setFeedURL = options => feeds.push(options)
  createService({
    autoUpdater: updater,
    updateFeedUrl: 'https://updates.crawshrimp.com/',
  })

  assert.deepEqual(feeds, [{ provider: 'generic', url: 'https://updates.crawshrimp.com/' }])
})

test('Cloudflare update check falls back to GitHub when the primary feed is unavailable', async () => {
  const updater = createUpdater()
  const feeds = []
  let checks = 0
  updater.setFeedURL = options => feeds.push(options)
  updater.checkForUpdates = async () => {
    checks += 1
    if (checks === 1) throw new Error('Cloudflare update feed unavailable')
    updater.emit('update-available', { version: '2.1.3' })
  }

  const service = createService({
    autoUpdater: updater,
    updateFeedUrl: 'https://updates.crawshrimp.com/',
    log: { warn: () => {} },
  })

  await assert.doesNotReject(() => service.checkForUpdates())

  assert.equal(service.getStatus().status, 'available')
  assert.deepEqual(feeds, [
    { provider: 'generic', url: 'https://updates.crawshrimp.com/' },
    { provider: 'github', owner: 'howtimeschange', repo: 'crawshrimp-harness' },
  ])
})

test('configured feed with missing GitHub fallback metadata is treated as up-to-date', async () => {
  const updater = createUpdater()
  let checks = 0
  updater.checkForUpdates = async () => {
    checks += 1
    if (checks === 1) throw new Error('Cloudflare update feed unavailable')
    throw new Error('404 latest release not found')
  }

  const service = createService({
    autoUpdater: updater,
    updateFeedUrl: 'https://updates.crawshrimp.com/',
    log: { warn: () => {} },
  })

  await assert.doesNotReject(() => service.checkForUpdates())

  assert.equal(service.getStatus().status, 'up-to-date')
  assert.equal(service.getStatus().error, '')
})

for (const [country, expected] of [['CN', 'generic'], ['US', 'github'], ['', 'github']]) {
  test(`IP country ${country || 'unknown'} chooses ${expected} first`, async () => {
    const updater = createUpdater(), feeds = []
    updater.setFeedURL = value => feeds.push(value)
    const service = createService({ autoUpdater: updater, updateFeedUrl: 'https://downloads.example.com/', resolveCountry: async () => country })
    let checked
    updater.checkForUpdates = async () => { checked = feeds.at(-1).provider }
    await service.checkForUpdates()
    assert.equal(checked, expected)
    assert.equal(service.getStatus().country, country)
  })
}

for (const country of ['CN', 'US']) {
  test(`${country} retries a failed download through the other source`, async () => {
    const updater = createUpdater(), feeds = [], downloads = []
    updater.setFeedURL = value => feeds.push(value)
    updater.checkForUpdates = async () => {
      updater.emit('checking-for-update')
      updater.emit('update-available', { version: '2.0.1' })
      return { updateInfo: { version: '2.0.1' } }
    }
    updater.downloadUpdate = async () => {
      downloads.push(feeds.at(-1).provider)
      if (downloads.length === 1) { updater.emit('error', new Error('connection reset')); throw new Error('connection reset') }
      updater.emit('update-downloaded', { version: '2.0.1' })
      return ['verified-file']
    }
    const service = createService({ autoUpdater: updater, updateFeedUrl: 'https://downloads.example.com/', resolveCountry: async () => country })
    await service.checkForUpdates()
    assert.deepEqual(await service.downloadUpdate(), ['verified-file'])
    assert.deepEqual(downloads, country === 'CN' ? ['generic', 'github'] : ['github', 'generic'])
    assert.equal(service.getStatus().status, 'downloaded')
  })
}

test('fallback refuses a different version and leaves download retryable', async () => {
  const updater = createUpdater()
  let checks = 0, downloads = 0
  updater.checkForUpdates = async () => {
    const info = { version: ++checks === 1 ? '2.0.1' : '2.0.2' }
    updater.emit('update-available', info)
    return { updateInfo: info }
  }
  updater.downloadUpdate = async () => { downloads++; throw new Error('offline') }
  const service = createService({ autoUpdater: updater, updateFeedUrl: 'https://downloads.example.com/' })
  await service.checkForUpdates()
  await assert.rejects(service.downloadUpdate(), /备用源版本已变化/)
  assert.equal(downloads, 1)
  assert.equal(service.getStatus().status, 'error')
})

test('concurrent manual checks and download cannot race update metadata', async () => {
  const updater = createUpdater()
  let finish, checks = 0, downloads = 0
  updater.checkForUpdates = async () => {
    checks++
    await new Promise(resolve => { finish = resolve })
    updater.emit('update-available', { version: '2.0.1' })
  }
  updater.downloadUpdate = async () => { downloads++ }
  const service = createService({ autoUpdater: updater })
  const first = service.checkForUpdates()
  const second = service.checkForUpdates()
  const download = service.downloadUpdate()
  assert.equal(downloads, 0)
  finish()
  await Promise.all([first, second, download])
  assert.equal(checks, 1)
  assert.equal(downloads, 1)
})

for (const country of ['CN', 'US']) {
  test(`${country} retries metadata failure through backup`, async () => {
    const updater = createUpdater(), checked = [], feeds = []
    updater.setFeedURL = value => feeds.push(value)
    updater.checkForUpdates = async () => {
      checked.push(feeds.at(-1).provider)
      if (checked.length === 1) throw new Error('503 source unavailable')
      updater.emit('update-available', {version:'2.0.1'})
    }
    const service = createService({autoUpdater:updater,updateFeedUrl:'https://downloads.example.com/',resolveCountry:async()=>country})
    await service.checkForUpdates()
    assert.deepEqual(checked, country === 'CN' ? ['generic','github'] : ['github','generic'])
    assert.equal(service.getStatus().status,'available')
  })
}
test('region lookup validates countries and fails closed to default routing', async () => {
  const { resolveDownloadCountry } = require('./updateRegion')
  assert.equal(await resolveDownloadCountry(async()=>({ok:true,json:async()=>({country:'CN'})})), 'CN')
  assert.equal(await resolveDownloadCountry(async()=>({ok:true,json:async()=>({country:'evil'})})), '')
  assert.equal(await resolveDownloadCountry(async()=>{ throw new Error('timeout') }), '')
})
