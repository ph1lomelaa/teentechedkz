import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
const root = '/site'
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname))
    if (!file.startsWith(root + '/')) file = root + '/index.html'
    const info = await stat(file).catch(() => null)
    if (!info?.isFile()) {
      if (url.pathname.startsWith('/assets/')) { res.writeHead(404); res.end(); return }
      file = root + '/index.html'
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
    res.end(await readFile(file))
  } catch { res.writeHead(500); res.end('Preview unavailable') }
}).listen(3000, '0.0.0.0')
