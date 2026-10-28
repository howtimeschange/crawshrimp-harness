import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build } from 'esbuild'

export const CRAWSHRIMP_DSH_IM_BUILT_OVERLAY_MARKER = 'crawshrimp-dsh-im-411-built-overlay-v2'

export const CRAWSHRIMP_DSH_IM_SECURITY_MARKER = 'crawshrimp-dsh-im-external-axios-v1'

export async function buildPatchedDshImHost(runtimeRoot) {
  const buildNodeModules = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules')
  const packageRoot = resolve(runtimeRoot, 'node_modules/@xmanrui/dsh-im')
  // The Lark SDK embeds Axios unless it is externalized. Resolve from the
  // actual runtime closure so a build-time SDK cannot silently freeze an old copy.
  const runtimeRequire = createRequire(resolve(packageRoot, 'package.json'))
  const axiosManifest = JSON.parse(await readFile(runtimeRequire.resolve('axios/package.json'), 'utf8'))
  if (axiosManifest.version !== '1.20.0') throw new Error('dsh-im requires the audited axios 1.20.0 runtime closure')
  const sourceDirectory = resolve(packageRoot, 'plugin-src/host')
  const outputPath = resolve(packageRoot, 'lib/index.js')
  const { larkSdkHandshakePatch } = await import(pathToFileURL(
    resolve(sourceDirectory, 'lark-sdk-handshake-patch.mjs'),
  ).href)
  const externalRuntimePackages = [
    'axios',
    '@tencent-connect/qqbot-connector',
    '@tencent-connect/qqbot-nodejs',
    '@wecom/aibot-node-sdk',
    'dingtalk-stream',
    'qrcode',
    'undici',
  ]
  const external = externalRuntimePackages.flatMap((name) => [name, `${name}/*`])

  await mkdir(resolve(packageRoot, 'lib'), { recursive: true })
  const result = await build({
    metafile: true,
    entryPoints: [resolve(sourceDirectory, 'index.mjs')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node22'],
    mainFields: ['module', 'main'],
    nodePaths: [buildNodeModules],
    external,
    plugins: [larkSdkHandshakePatch],
    outfile: outputPath,
    banner: {
      js: [
        `/* ${CRAWSHRIMP_DSH_IM_BUILT_OVERLAY_MARKER} */`,
        `/* ${CRAWSHRIMP_DSH_IM_SECURITY_MARKER}: axios ${axiosManifest.version} */`,
        "import { createRequire as __dshCreateRequire } from 'node:module';",
        "import { dirname as __dshDirname } from 'node:path';",
        "import { fileURLToPath as __dshFileURLToPath } from 'node:url';",
        'const require = __dshCreateRequire(import.meta.url);',
        'const __filename = __dshFileURLToPath(import.meta.url);',
        'const __dirname = __dshDirname(__filename);',
      ].join('\n'),
    },
    sourcemap: false,
    minify: true,
    legalComments: 'eof',
  })
  if (Object.keys(result.metafile.inputs).some((input) => /(?:^|[/\\])node_modules[/\\]axios[/\\]/.test(input))) {
    throw new Error('dsh-im must resolve Axios from the audited runtime, never embed a build-time copy')
  }
  if (!Object.values(result.metafile.outputs).some((output) => output.imports.some((entry) => entry.external && entry.path === 'axios'))) {
    throw new Error('dsh-im host build lost its explicit external Axios dependency')
  }
  return outputPath
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new TypeError('runtime root is required')
  await buildPatchedDshImHost(process.argv[2])
}
