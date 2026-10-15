import { createServer } from 'node:http'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, existsSync, realpathSync, statSync, createReadStream } from 'node:fs'
import { resolve, relative, extname, sep, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createVoteStore } from './store.mjs'
export { createVoteStore } from './store.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function bodyWithinLimit(request, limit) {
  return new Promise((resolve) => {
    let bytes = 0
    request.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > limit) resolve(false)
    })
    request.once('end', () => resolve(bytes <= limit))
    request.once('aborted', () => resolve(false))
    request.once('error', () => resolve(false))
  })
}

function defaultTrackIds() {
  const paths = ['public/data/catalog.json', 'public/data/supplemental.json']
  return paths.flatMap((path) => {
    const fullPath = resolve(root, path)
    return existsSync(fullPath)
      ? JSON.parse(readFileSync(fullPath, 'utf8')).tracks.map((track) => track.id)
      : []
  })
}

export function createApp({
  store,
  trackIds,
  distDir = resolve(root, 'dist'),
  siteOrigin = process.env.SITE_ORIGIN,
  production = process.env.NODE_ENV === 'production',
  rateLimit = 120,
  writeRateLimit = 40,
  rateWindowMs = 60_000,
} = {}) {
  const ownsStore = !store
  store ||= createVoteStore()
  const validIds = new Set(trackIds || defaultTrackIds())
  if (siteOrigin) siteOrigin = new URL(siteOrigin).origin
  const buckets = new Map()
  const sign = (id) => createHmac('sha256', store.secret).update(id).digest('base64url')
  const json = (response, status, body, extra = {}) => {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    })
    response.end(JSON.stringify(body))
  }
  function visitor(request, response) {
    const token = (request.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('pikasonic_visitor='))
      ?.slice(18)
    const match = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(token || '')
    if (match) {
      const expected = Buffer.from(sign(match[1]))
      const actual = Buffer.from(match[2])
      if (expected.length === actual.length && timingSafeEqual(expected, actual)) return match[1]
    }
    const id = randomBytes(32).toString('base64url')
    const secure = siteOrigin?.startsWith('https:') || request.socket.encrypted
    response.setHeader(
      'Set-Cookie',
      `pikasonic_visitor=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}`,
    )
    return id
  }
  function allowedOrigin(request) {
    const origin = request.headers.origin
    if (!origin || origin === 'null') return false
    if (siteOrigin) return origin === siteOrigin
    const host = request.headers.host
    if (origin === `http://${host}` || origin === `https://${host}`) return true
    return !production && ['http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin)
  }
  function limited(key, limit) {
    const now = Date.now()
    let bucket = buckets.get(key)
    if (!bucket || bucket.until <= now) {
      bucket = { count: 0, until: now + rateWindowMs }
      buckets.set(key, bucket)
    }
    bucket.count += 1
    if (buckets.size > 10_000)
      for (const [id, value] of buckets) if (value.until <= now) buckets.delete(id)
    return bucket.count > limit
  }
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    response.setHeader('X-Frame-Options', 'DENY')
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname
      if (pathname.startsWith('/api/')) {
        const ip = request.socket.remoteAddress || 'unknown'
        if (limited(`read:${ip}`, rateLimit))
          return json(
            response,
            429,
            { error: '请求过于频繁，请稍后再试。' },
            { 'Retry-After': '60' },
          )
        if (request.method === 'GET' && pathname === '/api/leaderboard')
          return json(response, 200, store.leaderboard())
        const visitorId = visitor(request, response)
        if (request.method === 'GET' && pathname === '/api/votes')
          return json(response, 200, { votedTrackIds: store.getVotes(visitorId) })
        const route = /^\/api\/votes\/([^/]+)$/.exec(pathname)
        if (route && ['POST', 'DELETE'].includes(request.method)) {
          if (!allowedOrigin(request)) return json(response, 403, { error: '请求来源不被允许。' })
          if (limited(`write:${ip}`, writeRateLimit))
            return json(
              response,
              429,
              { error: '操作过于频繁，请稍后再试。' },
              { 'Retry-After': '60' },
            )
          let trackId
          try {
            trackId = decodeURIComponent(route[1])
          } catch {
            return json(response, 400, { error: '无效的歌曲 ID。' })
          }
          if (!validIds.has(trackId)) return json(response, 404, { error: '目录中没有这首歌曲。' })
          const length = Number(request.headers['content-length'] || 0)
          if (length > 1024) {
            request.resume()
            return json(response, 413, { error: '请求体过大。' })
          }
          if (!(await bodyWithinLimit(request, 1024)))
            return json(response, 413, { error: '请求体过大。' })
          return json(response, 200, store.setVote(visitorId, trackId, request.method === 'POST'))
        }
        return json(response, 404, { error: '接口不存在。' })
      }
      if (!['GET', 'HEAD'].includes(request.method))
        return json(response, 405, { error: '请求方法不被允许。' }, { Allow: 'GET, HEAD' })
      let decoded
      try {
        decoded = decodeURIComponent(pathname)
      } catch {
        return json(response, 400, { error: '无效路径。' })
      }
      if (decoded.includes('\0') || decoded.includes('\\'))
        return json(response, 400, { error: '无效路径。' })
      let filePath = resolve(distDir, `.${decoded}`)
      const safe = (path) => {
        const child = relative(realpathSync(distDir), realpathSync(path))
        return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
      }
      if (!existsSync(distDir))
        return json(response, 503, { error: '网站尚未构建，请先运行 npm run build。' })
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        if (extname(decoded)) return json(response, 404, { error: '文件不存在。' })
        filePath = resolve(distDir, 'index.html')
      }
      if (!existsSync(filePath) || !safe(filePath))
        return json(response, 404, { error: '文件不存在。' })
      response.writeHead(200, {
        'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
        'Content-Length': statSync(filePath).size,
        'Cache-Control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600',
      })
      if (request.method === 'HEAD') return response.end()
      createReadStream(filePath)
        .on('error', () => response.destroy())
        .pipe(response)
    } catch (error) {
      console.error('Request failed:', error.message)
      if (!response.headersSent) json(response, 500, { error: '服务器暂时无法处理请求。' })
      else response.destroy()
    }
  })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  if (ownsStore) server.on('close', () => store.close())
  return server
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createApp()
  const port = Number(process.env.PORT || 3001)
  server.listen(port, process.env.HOST || '0.0.0.0', () =>
    console.log(`PIKASONIC server listening on port ${port}`),
  )
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      server.close(() => process.exit(0))
      server.closeIdleConnections()
    })
}
