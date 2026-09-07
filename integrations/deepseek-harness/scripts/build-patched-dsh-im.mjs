import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build } from 'esbuild'

export const CRAWSHRIMP_DSH_IM_BUILT_OVERLAY_MARKER = 'crawshrimp-dsh-im-411-built-overlay-v2'

export async function buildPatchedDshImHost(runtimeRoot) {
  const buildNodeModules = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules')
  const packageRoot = resolve(runtimeRoot, 'node_modules/@xmanrui/dsh-im')
  const sourceDirectory = resolve(packageRoot, 'plugin-src/host')
  const outputPath = resolve(packageRoot, 'lib/index.js')
  const { larkSdkHandshakePatch } = await import(pathToFileURL(
    resolve(sourceDirectory, 'lark-sdk-handshake-patch.mjs'),
  ).href)
  const externalRuntimePackages = [
    '@tencent-connect/qqbot-connector',
    '@tencent-connect/qqbot-nodejs',
    '@wecom/aibot-node-sdk',
    'dingtalk-stream',
    'qrcode',
    'undici',
  ]
  const external = externalRuntimePackages.flatMap((name) => [name, `${name}/*`])

  await mkdir(resolve(packageRoot, 'lib'), { recursive: true })
  await build({
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
  return outputPath
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new TypeError('runtime root is required')
  await buildPatchedDshImHost(process.argv[2])
}
