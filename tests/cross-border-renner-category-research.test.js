import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function loadExports() {
  const scriptPath = path.resolve('adapters/cross-border-research/renner-kids-category-research.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const exportsBox = {}
  const locationUrl = new URL('https://www.lojasrenner.com.br/c/infantil/-/N-10xdweq')
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: {},
      __CRAWSHRIMP_SHARED__: {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
      location: locationUrl,
    },
    document: {},
    location: locationUrl,
    console,
    fetch: async () => {
      throw new Error('fetch should be mocked by collectResearchRows tests')
    },
    setTimeout: (callback) => {
      Promise.resolve().then(callback)
      return 1
    },
    clearTimeout: () => {},
    URL,
    Intl,
    Date,
    Math,
    JSON,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Set,
    Map,
  }
  context.globalThis = context
  await vm.runInNewContext(source, context, { filename: scriptPath })
  return exportsBox
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function sourcePayload() {
  return {
    contents: [
      {
        mainContent: [
          {
            contents: [
              {
                guidedNavigation: [
                  {
                    contents: [
                      {
                        navigation: [
                          {
                            nameLanguage: 'Categoria',
                            dimensionName: 'product.category',
                            refinements: [
                              {
                                label: 'Acessórios Infantis ',
                                navigationState: '/infantil/acessorios-infantis/-/N-nmykce?format=json',
                              },
                              {
                                label: 'Vestido',
                                navigationState: '/infantil/vestido/-/N-9vhpfaZwxqas2?format=json',
                              },
                              {
                                label: 'Calça',
                                navigationState: '/infantil/calca/-/N-s0hsouZwxqas2?format=json',
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
}

function productPayload(total, price) {
  return {
    contents: [
      {
        mainContent: [
          {
            contents: [
              {
                records: [
                  {
                    attributes: {
                      'prop.sku.activePrice': [String(price)],
                    },
                  },
                ],
                totalNumRecs: total,
                recsPerPage: 48,
              },
            ],
          },
        ],
      },
    ],
  }
}

test('renner helper normalizes page and navigation URLs to React JSON API URLs', async () => {
  const helpers = await loadExports()

  assert.equal(
    helpers.normalizeCategoryApiUrl('https://www.lojasrenner.com.br/c/infantil/vestidos/-/N-9vhpfa?s_icid=x'),
    'https://www.lojasrenner.com.br/react/c/infantil/vestidos/-/N-9vhpfa?s_icid=x&format=json',
  )
  assert.equal(
    helpers.normalizeCategoryApiUrl('/infantil/vestido/-/N-9vhpfaZwxqas2?format=json'),
    'https://www.lojasrenner.com.br/react/c/infantil/vestido/-/N-9vhpfaZwxqas2?format=json',
  )
  assert.match(
    helpers.buildSortedCategoryApiUrl('/infantil/vestido/-/N-9vhpfa?format=json', 'desc'),
    /Ns=dim\.product\.purchasable%7C1%7C%7Cprop\.sku\.activePrice%7C1/,
  )
})

test('renner helper defaults to shoes and apparel categories and supports explicit Chinese aliases', async () => {
  const helpers = await loadExports()
  const defaults = helpers.resolveCategoryTargets('', sourcePayload())
  assert.deepEqual(plain(defaults.map(item => item.outputName)), ['裙子', '裤子'])

  const configured = helpers.resolveCategoryTargets('连衣裙=Vestido\n长裤=Calça', sourcePayload())
  assert.deepEqual(plain(configured.map(item => item.outputName)), ['连衣裙', '长裤'])
  assert.match(configured[0].apiUrl, /\/react\/c\/infantil\/vestido\/-\/N-9vhpfaZwxqas2/)
})

test('renner helper collects category result count, scope and price band from ascending and descending category APIs', async () => {
  const helpers = await loadExports()
  const calls = []
  const fakeFetchPayload = async url => {
    calls.push(url)
    if (url.includes('/react/c/infantil/-/N-10xdweq')) return sourcePayload()
    if (url.includes('/vestido/') && url.includes('activePrice%7C0')) return productPayload(200, '19.900000')
    if (url.includes('/vestido/') && url.includes('activePrice%7C1')) return productPayload(200, '199.900000')
    if (url.includes('/calca/') && url.includes('activePrice%7C0')) return productPayload(324, '29.900000')
    if (url.includes('/calca/') && url.includes('activePrice%7C1')) return productPayload(324, '259.900000')
    throw new Error(`unexpected URL ${url}`)
  }

  const rows = await helpers.collectResearchRows({
    category_url: 'https://www.lojasrenner.com.br/c/infantil/-/N-10xdweq',
    request_delay_ms: 0,
  }, fakeFetchPayload)

  assert.ok(rows.every(row => row['统计口径'].includes('未按款色去重') && row['来源链接']))
  assert.deepEqual(plain(rows).map(({ 品类, 商品结果数, 价格带 }) => ({ 品类, 商品结果数, 价格带 })), [
    { '品类': '裙子', '商品结果数': 200, '价格带': 'R$ 19,90 - R$ 199,90' },
    { '品类': '裤子', '商品结果数': 324, '价格带': 'R$ 29,90 - R$ 259,90' },
  ])
  assert.equal(calls.length, 5)
})


test('category count ignores larger auxiliary recommendation lists and rejects ambiguous main results', async () => {
  const helpers = await loadExports()
  const payload = productPayload(229, 19.9)
  payload.recommendations = { records: [], totalNumRecs: 8831 }
  assert.equal(helpers.findProductList(payload).totalNumRecs, 229)
  payload.contents[0].mainContent.push({ records: [], totalNumRecs: 8831 })
  assert.throws(() => helpers.findProductList(payload), /口径不唯一/)
})
