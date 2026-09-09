import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

export async function buildImageGenerationEffect() {
  await build({
    entryPoints: [fileURLToPath(new URL('../crawshrimp-slots/src/image-generation-effect.js', import.meta.url))],
    outfile: fileURLToPath(new URL('../crawshrimp-slots/lib/image-generation-effect.js', import.meta.url)),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  })
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildImageGenerationEffect()
