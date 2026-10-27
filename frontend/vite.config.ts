import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

/** Fuentes estándar y mapas de caracteres de pdf.js: se sirven desde /pdfjs/ (en dev) y se copian a dist/pdfjs (en build). */
function pdfjsAssets(): Plugin {
  const base = resolve('node_modules/pdfjs-dist')
  const dirs = ['standard_fonts', 'cmaps']
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const file = resolve(base, '.' + decodeURIComponent((req.url ?? '').split('?')[0]!))
        if (!dirs.some((d) => file.startsWith(resolve(base, d))) || !existsSync(file) || !statSync(file).isFile()) return next()
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      for (const d of dirs) cpSync(resolve(base, d), resolve('dist/pdfjs', d), { recursive: true })
    },
  }
}

/** Fuentes de la pizarra (Excalidraw): se sirven desde /excalidraw-assets/ (en dev) y se copian a dist (en build). Así funciona sin Internet. */
function excalidrawAssets(): Plugin {
  const base = resolve('node_modules/@excalidraw/excalidraw/dist/prod')
  return {
    name: 'excalidraw-assets',
    configureServer(server) {
      server.middlewares.use('/excalidraw-assets', (req, res, next) => {
        const file = resolve(base, '.' + decodeURIComponent((req.url ?? '').split('?')[0]!))
        if (!file.startsWith(resolve(base, 'fonts')) || !existsSync(file) || !statSync(file).isFile()) return next()
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      cpSync(resolve(base, 'fonts'), resolve('dist/excalidraw-assets/fonts'), { recursive: true })
    },
  }
}

// En desarrollo (npm run dev) el proxy imita al gateway de Docker.
export default defineConfig({
  plugins: [react(), pdfjsAssets(), excalidrawAssets()],
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
  build: {
    rollupOptions: {
      output: {
        // nginx no conoce la extensión .mjs y serviría el worker de pdf.js como binario: se emite como .js
        assetFileNames: (info) => (info.names?.some((n) => n.endsWith('.mjs')) ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        // Como el gateway: el navegador y la API se ven como el mismo origen, así que no hay CORS.
        configure: (proxy) => proxy.on('proxyReq', (req) => req.removeHeader('origin')),
      },
      '/ws': { target: 'http://localhost:8080', ws: true },
    },
  },
})
