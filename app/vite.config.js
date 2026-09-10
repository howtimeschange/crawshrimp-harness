import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { cpSync, mkdirSync } from 'node:fs'

export default defineConfig({
  plugins: [vue(), {
    name: 'local-pdf-resources',
    buildStart() {
      const target = path.resolve(__dirname, 'src/renderer/public/pdfjs')
      mkdirSync(target, { recursive: true })
      for (const name of ['cmaps', 'standard_fonts', 'wasm', 'LICENSE']) cpSync(path.resolve(__dirname, 'node_modules/pdfjs-dist', name), path.join(target, name), { recursive: true })
    },
  }],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: '127.0.0.1',  // 强制 IPv4，避免 macOS 上 Vite 绑到 IPv6 导致 Electron ERR_CONNECTION_REFUSED
  },
})
