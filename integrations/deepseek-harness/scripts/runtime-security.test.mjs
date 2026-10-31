import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const integrationRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = resolve(process.env.CRAWSHRIMP_SECURITY_RUNTIME_ROOT || integrationRoot)
const requireRuntime = createRequire(join(runtimeRoot, 'package.json'))
const load = (name) => import(pathToFileURL(requireRuntime.resolve(name)).href)
const axios = requireRuntime('axios')

async function serve(t, handler) {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      response.writeHead(500).end(String(error))
    })
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
  })
  return `http://127.0.0.1:${server.address().port}`
}
async function body(request) {
  let text = ''
  for await (const chunk of request) text += chunk
  return text ? JSON.parse(text) : {}
}
function json(response, data) {
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data))
}

// Real SDK HTTP transport and protocol requests, not a mocked SDK/fetch.
test('MCP 2.3 keeps initialize, tools/list and tools/call compatible', async (t) => {
  const methods = []
  const origin = await serve(t, async (request, response) => {
    if (request.method !== 'POST') return response.writeHead(405).end()
    assert.equal(request.headers['x-security-fixture'], 'synthetic')
    const message = await body(request)
    methods.push(message.method)
    if (message.id === undefined) return response.writeHead(202).end()
    const result = message.method === 'initialize'
      ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'local-fixture', version: '1' } }
      : message.method === 'tools/list'
        ? { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] }
        : { content: [{ type: 'text', text: message.params.arguments.text }] }
    json(response, { jsonrpc: '2.0', id: message.id, result })
  })
  const { Client, StreamableHTTPClientTransport } = await load('@modelcontextprotocol/client')
  const client = new Client({ name: 'security-fixture', version: '1' })
  t.after(() => client.close())
  await client.connect(new StreamableHTTPClientTransport(new URL(origin), { requestInit: { headers: { 'x-security-fixture': 'synthetic' } } }))
  assert.equal((await client.listTools()).tools[0].name, 'echo')
  assert.equal((await client.callTool({ name: 'echo', arguments: { text: 'local echo' } })).content[0].text, 'local echo')
  assert.ok(methods.includes('notifications/initialized'))
})

test('MCP rejects cross-origin 307 without disclosing synthetic headers/body', async (t) => {
  const received = []
  const target = await serve(t, async (request, response) => {
    received.push({ headers: request.headers, body: await body(request) })
    response.writeHead(400).end()
  })
  const origin = await serve(t, (_request, response) => response.writeHead(307, { location: target }).end())
  const { Client, StreamableHTTPClientTransport } = await load('@modelcontextprotocol/client')
  const client = new Client({ name: 'redirect-fixture', version: '1' })
  t.after(() => client.close())
  await assert.rejects(client.connect(new StreamableHTTPClientTransport(new URL(origin), {
    requestInit: { headers: { 'x-fixture-secret': 'not-a-real-secret' } },
  })), /redirect|fetch|origin/i)
  assert.equal(received.length, 0)
})

test('external Axios supports JSON GET/POST and same-origin redirects', async (t) => {
  const requests = []
  const origin = await serve(t, async (request, response) => {
    if (request.url === '/redirect') return response.writeHead(302, { location: '/echo' }).end()
    requests.push({ method: request.method, headers: request.headers, data: await body(request) })
    json(response, requests.at(-1))
  })
  const client = axios.create({ baseURL: origin, proxy: false, timeout: 2000 })
  assert.equal((await client.get('/redirect')).data.method, 'GET')
  assert.deepEqual((await client.post('/echo', { fixture: true }, { headers: { 'x-fixture-id': 'local' } })).data.data, { fixture: true })
  assert.equal(requests.at(-1).headers['x-fixture-id'], 'local')
})

test('real Lark SDK sends token and IM message HTTP calls through audited Axios', async (t) => {
  const requests = []
  const origin = await serve(t, async (request, response) => {
    requests.push({ url: request.url, data: await body(request) })
    if (request.url.includes('tenant_access_token')) return json(response, { code: 0, msg: 'ok', tenant_access_token: 'synthetic-token', expire: 3600 })
    if (request.url.includes('/im/v1/messages')) return json(response, { code: 0, msg: 'ok', data: { message_id: 'fixture-message' } })
    response.writeHead(404).end()
  })
  const buildRequire = createRequire(join(integrationRoot, 'package.json'))
  const lark = buildRequire('@larksuiteoapi/node-sdk')
  const httpInstance = axios.create({ proxy: false, timeout: 2000 })
  // SDK path templates treat :port as a path placeholder; use a canonical
  // fixture domain and route its requests to this test's loopback listener.
  httpInstance.interceptors.request.use((config) => {
    assert.ok(config.url.startsWith('http://fixture.invalid/'))
    config.url = config.url.replace('http://fixture.invalid', origin)
    return config
  })
  httpInstance.interceptors.response.use((response) => response.data)
  const logger = { error() {}, warn() {}, info() {}, debug() {}, trace() {} }
  const client = new lark.Client({ appId: 'synthetic-app', appSecret: 'synthetic-secret', domain: 'http://fixture.invalid', httpInstance, disableTokenCache: true, logger })
  const token = await client.auth.tenantAccessToken.internal({ data: { app_id: 'synthetic-app', app_secret: 'synthetic-secret' } })
  assert.equal(token.tenant_access_token, 'synthetic-token')
  const result = await client.im.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: 'synthetic-chat', msg_type: 'text', content: JSON.stringify({ text: 'fixture' }) } })
  assert.equal(result.data.message_id, 'fixture-message')
  assert.ok(requests.some((request) => request.url.includes('tenant_access_token')))
  assert.ok(requests.some((request) => request.url.includes('/im/v1/messages')))
})

test('rebuilt IM host loads with external Axios and retains approval/session controls', async () => {
  const file = join(runtimeRoot, 'node_modules/@xmanrui/dsh-im/lib/index.js')
  const bundle = await readFile(file, 'utf8')
  assert.match(bundle, /crawshrimp-dsh-im-external-axios-v1: axios 1\.20\.0/)
  assert.match(bundle, /(?:from|require\()["']axios["']/)
  assert.doesNotMatch(bundle, /["']1\.19\.0["']/)
  assert.doesNotMatch(bundle, /this\.name=["']AxiosError["']/)
  for (const marker of ['getSessionPermission', 'setSessionPermission', 'crawshrimp-approval-display-arguments-v4']) assert.ok(bundle.includes(marker))
  const host = await import(pathToFileURL(file).href)
  assert.ok(host.default || host.apply)
})

function documentZip(fflate) {
  const encode = fflate.strToU8
  return fflate.zipSync({
    '[Content_Types].xml': encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': encode('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': encode('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>C50 local security fixture</w:t></w:r></w:p></w:body></w:document>'),
  })
}
function malformedZip64(bytes) {
  const copy = Buffer.from(bytes)
  const central = copy.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  assert.ok(central >= 0)
  assert.equal(copy.readUInt16LE(central + 30), 0, 'fixture has no ZIP64 extra field')
  copy.writeUInt32LE(0xffffffff, central + 20)
  const end = copy.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const zip64End = Buffer.alloc(56)
  zip64End.writeUInt32LE(0x06064b50, 0)
  zip64End.writeBigUInt64LE(44n, 4)
  zip64End.writeUInt16LE(45, 12)
  zip64End.writeUInt16LE(45, 14)
  zip64End.writeBigUInt64LE(BigInt(copy.readUInt16LE(end + 8)), 24)
  zip64End.writeBigUInt64LE(BigInt(copy.readUInt16LE(end + 10)), 32)
  zip64End.writeBigUInt64LE(BigInt(copy.readUInt32LE(end + 12)), 40)
  zip64End.writeBigUInt64LE(BigInt(copy.readUInt32LE(end + 16)), 48)
  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(0x07064b50, 0)
  locator.writeBigUInt64LE(BigInt(end), 8)
  locator.writeUInt32LE(1, 16)
  return Buffer.concat([copy.subarray(0, end), zip64End, locator, copy.subarray(end)])
}

test('Office ZIP parser rejects malformed ZIP64 and native converter renders a generated document', { timeout: 30000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'c50-security-office-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const officeRequire = createRequire(requireRuntime.resolve('@deepseek-ai/libreoffice-kit/package.json'))
  const fflate = officeRequire('fflate')
  const valid = documentZip(fflate)
  assert.ok(fflate.unzipSync(valid)['word/document.xml'])
  const malformed = malformedZip64(valid)
  assert.throws(() => fflate.unzipSync(malformed), /zip|invalid|extra/i)
  const office = await load('@deepseek-ai/libreoffice-kit')
  const converter = await office.createConverter({ fontMetadataCacheDirectory: false, fontDirectories: [], fontFallbacks: [], initialFontFamilies: [], timeoutMs: 10000 })
  t.after(() => converter.dispose())
  const inputPath = join(directory, 'fixture.docx'), outputPath = join(directory, 'fixture.pdf')
  await writeFile(inputPath, valid)
  await converter.render({ inputPath, outputPath })
  assert.equal((await readFile(outputPath)).subarray(0, 5).toString(), '%PDF-')
  const invalidInput = join(directory, 'malformed.docx')
  await writeFile(invalidInput, malformed)
  await assert.rejects(converter.render({ inputPath: invalidInput, outputPath: join(directory, 'invalid.pdf') }), /invalid|bounded|ZIP|document/i)
})

const { resolveBuiltinCliRoot } = createRequire(import.meta.url)(join(integrationRoot, 'worker/builtin-runtime.cjs'))
// CI tests the explicitly built source CLI; packaged-runtime checks retain the
// bundled closure by default. Never depend on a developer's old staging tree.
const bmallRoot = join(resolve(process.env.CRAWSHRIMP_SECURITY_CLI_ROOT || resolveBuiltinCliRoot(runtimeRoot)), 'bmall-cli')
test('Bmall Zod4 retains configuration records, defaults and strict order validation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'c50-security-bmall-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { ConfigManager } = await import(pathToFileURL(join(bmallRoot, 'dist/core/config.js')).href)
  const manager = new ConfigManager(directory)
  await manager.updateProfile('synthetic', { env: 'local', baseUrl: 'http://127.0.0.1:12345', loginUrl: 'http://127.0.0.1:12346', groupId: 'fixture-group' })
  const profile = await manager.resolve({ profile: 'synthetic' })
  assert.equal(profile.baseUrl, 'http://127.0.0.1:12345')
  assert.equal(profile.profileConfig.groupId, 'fixture-group')
  const { OrderDraftSchema } = await import(pathToFileURL(join(bmallRoot, 'dist/schemas/order.js')).href)
  const valid = { companyId: 'fixture-company', items: [{ skuCode: 'fixture-sku', quantity: 2 }] }
  const order = OrderDraftSchema.parse(valid)
  assert.equal(order.orderType, 'replenishment')
  assert.deepEqual(order.couponIds, [])
  assert.equal(OrderDraftSchema.safeParse({ ...valid, unrecognized: true }).success, false)
  assert.equal(OrderDraftSchema.safeParse({ ...valid, items: [{ skuCode: '', quantity: -1 }] }).success, false)
  const bmallRequire = createRequire(join(bmallRoot, 'package.json'))
  const { z } = bmallRequire('zod')
  const bounded = z.array(z.string()).max(10).safeParse(Array(1000).fill(42))
  assert.equal(bounded.success, false)
  assert.equal(bounded.error.issues.length, 1, 'reject oversize collection before allocating per-element issues')
})

test('ExcelJS CommonJS UUID consumer and XLSX roundtrip remain compatible with scoped uuid11', async () => {
  const bmallRequire = createRequire(join(bmallRoot, 'package.json'))
  const ExcelJS = bmallRequire('exceljs')
  const CfRuleExtXform = bmallRequire('exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js')
  const rule = { type: 'iconSet', iconSet: '3Triangles' }
  new CfRuleExtXform().prepare(rule)
  assert.match(rule.x14Id, /^\{[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}$/)
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('fixture')
  sheet.addRow(['sku', 'quantity'])
  sheet.addRow(['synthetic-sku', 2])
  const bytes = await workbook.xlsx.writeBuffer()
  const reloaded = new ExcelJS.Workbook()
  await reloaded.xlsx.load(bytes)
  assert.equal(reloaded.getWorksheet('fixture').getCell('A2').value, 'synthetic-sku')
  assert.equal(reloaded.getWorksheet('fixture').getCell('B2').value, 2)
})
