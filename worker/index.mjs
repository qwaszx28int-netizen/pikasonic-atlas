import catalog from '../public/data/catalog.json' with { type: 'json' }
import { createVoteStore, randomVisitorId } from './store.mjs'

export { createVoteStore } from './store.mjs'

const COOKIE_NAME = 'pikasonic_visitor'
const BODY_LIMIT = 1024

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      ...extraHeaders,
    },
  })
}

function cancelBody(body) {
  if (body) void body.cancel().catch(() => {})
}

async function bodyStatus(request) {
  const declared = request.headers.get('Content-Length')
  if (declared !== null && !/^\d+$/.test(declared)) {
    cancelBody(request.body)
    return 400
  }
  if (declared !== null && Number(declared) > BODY_LIMIT) {
    cancelBody(request.body)
    return 413
  }
  if (!request.body) return 200
  const reader = request.body.getReader()
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return 200
      bytes += value.byteLength
      if (bytes > BODY_LIMIT) {
        void reader.cancel().catch(() => {})
        return 413
      }
    }
  } catch {
    return 400
  } finally {
    reader.releaseLock()
  }
}

async function visitor(request, store) {
  const tokens = (request.headers.get('Cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${COOKIE_NAME}=`))
  // Ambiguous duplicate cookies and forged/invalid tokens get a fresh identity.
  const match =
    tokens.length === 1 &&
    /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(tokens[0].slice(COOKIE_NAME.length + 1))
  if (match && (await store.verifyVisitor(match[1], match[2]))) return { id: match[1] }
  const id = randomVisitorId()
  const signature = await store.signVisitor(id)
  return {
    id,
    cookie: `${COOKIE_NAME}=${id}.${signature}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=31536000`,
  }
}

export function createWorker({
  trackIds = catalog.tracks.map((track) => track.id),
  rateLimit = 120,
  writeRateLimit = 40,
  rateWindowMs = 60_000,
  maxRateBuckets = 4096,
  now = Date.now,
} = {}) {
  const validIds = new Set(trackIds)
  const buckets = new Map()
  let nextSweep = 0

  async function limited(binding, kind, ip, limit) {
    if (binding !== undefined) {
      if (!binding || typeof binding.limit !== 'function') throw new Error('Invalid rate limiter')
      const result = await binding.limit({ key: ip })
      if (typeof result?.success !== 'boolean') throw new Error('Invalid rate limiter response')
      return !result.success
    }
    // This bounded per-isolate fallback is best effort, not global anti-abuse.
    // Configure Cloudflare rate-limiting bindings for enforcement across requests.
    const time = now()
    const key = `${kind}:${ip}`
    let bucket = buckets.get(key)
    if (!bucket) {
      if (buckets.size >= maxRateBuckets && time >= nextSweep) {
        for (const [id, value] of buckets) if (value.until <= time) buckets.delete(id)
        nextSweep = time + Math.min(rateWindowMs, 1000)
      }
      // Keep active buckets instead of evicting them and allowing limit bypass.
      if (buckets.size >= maxRateBuckets) return true
      bucket = { count: 0, until: time + rateWindowMs }
      buckets.set(key, bucket)
    } else if (bucket.until <= time) {
      bucket.count = 0
      bucket.until = time + rateWindowMs
    }
    bucket.count += 1
    return bucket.count > limit
  }

  return {
    async fetch(request, env) {
      try {
        const url = new URL(request.url)
        if (url.pathname !== '/api' && !url.pathname.startsWith('/api/'))
          return await env.ASSETS.fetch(request)

        // Cloudflare overwrites this header at the edge. Never trust X-Forwarded-For.
        const edgeIp = request.headers.get('CF-Connecting-IP')
        const ip = edgeIp && edgeIp.length <= 64 ? edgeIp : 'unknown'
        if (await limited(env.READ_LIMITER, 'read', ip, rateLimit))
          return json(
            429,
            { error: '请求过于频繁，请稍后再试。' },
            { 'Retry-After': String(Math.ceil(rateWindowMs / 1000)) },
          )

        const isVotes = url.pathname === '/api/votes'
        const isBoard = url.pathname === '/api/leaderboard'
        const route = /^\/api\/votes\/([^/]+)$/.exec(url.pathname)
        if (!isVotes && !isBoard && !route) return json(404, { error: '接口不存在。' })
        const allowed = route ? ['POST', 'DELETE'] : ['GET']
        if (!allowed.includes(request.method))
          return json(405, { error: '请求方法不被允许。' }, { Allow: allowed.join(', ') })

        let trackId
        if (route) {
          const origin = request.headers.get('Origin')
          if (!origin || origin !== url.origin) return json(403, { error: '请求来源不被允许。' })
          if (await limited(env.WRITE_LIMITER, 'write', ip, writeRateLimit))
            return json(
              429,
              { error: '操作过于频繁，请稍后再试。' },
              { 'Retry-After': String(Math.ceil(rateWindowMs / 1000)) },
            )
          try {
            trackId = decodeURIComponent(route[1])
          } catch {
            return json(400, { error: '无效的歌曲 ID。' })
          }
          if (trackId.length > 200 || /[\0/\\]/.test(trackId))
            return json(400, { error: '无效的歌曲 ID。' })
          if (!validIds.has(trackId)) return json(404, { error: '目录中没有这首歌曲。' })
          const status = await bodyStatus(request)
          if (status !== 200)
            return json(status, { error: status === 413 ? '请求体过大。' : '无效的请求体。' })
        }

        const store = await createVoteStore({ database: env.DB, signingSecret: env.VISITOR_SECRET })
        if (isBoard) return json(200, await store.leaderboard())
        const identity = await visitor(request, store)
        const headers = identity.cookie ? { 'Set-Cookie': identity.cookie } : {}
        if (isVotes) return json(200, { votedTrackIds: await store.getVotes(identity.id) }, headers)
        return json(
          200,
          await store.setVote(identity.id, trackId, request.method === 'POST', now()),
          headers,
        )
      } catch {
        // Do not expose D1 diagnostics, signing material or request data.
        return json(500, { error: '服务器暂时无法处理请求。' })
      }
    },
  }
}

export default createWorker()
