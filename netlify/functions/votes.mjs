import { isIP } from 'node:net'

export const VOTING_UPSTREAM_ORIGIN = 'https://pikasonic-atlas.pikasonic-atlas.workers.dev'

const BODY_LIMIT = 1024
const RESPONSE_LIMIT = 256 * 1024
const DEFAULT_TIMEOUT_MS = 10_000

function responseHeaders(extra = {}) {
  return new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'CDN-Cache-Control': 'no-store',
    'Netlify-CDN-Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    Vary: 'Cookie, Origin',
    ...extra,
  })
}

function json(status, error, extra) {
  return new Response(JSON.stringify({ error }), { status, headers: responseHeaders(extra) })
}

function cancelBody(body) {
  if (body) void body.cancel().catch(() => {})
}

async function readBody(body, limit) {
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) {
        void reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function upstreamError(status, headers) {
  const errors = {
    400: '无效的投票请求。',
    403: '请求来源不被允许。',
    404: '目录中没有这首歌曲。',
    405: '请求方法不被允许。',
    413: '请求体过大。',
    429: '请求过于频繁，请稍后再试。',
  }
  const extra = {}
  // No upstream diagnostics, authentication headers or CORS policy reach the browser.
  const retryAfter = headers.get('Retry-After')
  if (status === 429 && retryAfter && /^\d{1,6}$/.test(retryAfter))
    extra['Retry-After'] = retryAfter
  const response = errors[status]
    ? json(status, errors[status], extra)
    : json(502, '投票服务暂时不可用，请稍后再试。')
  if (status >= 400)
    for (const cookie of headers.getSetCookie()) response.headers.append('Set-Cookie', cookie)
  return response
}

export function createVotingProxy({
  fetch: fetchUpstream = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  proxySecret = process.env.VOTING_PROXY_SECRET,
} = {}) {
  if (typeof fetchUpstream !== 'function') throw new TypeError('A fetch implementation is required')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new RangeError('Invalid upstream timeout')

  const hasProxySecret =
    typeof proxySecret === 'string' &&
    proxySecret.length >= 32 &&
    /^[\x21-\x7e]+$/.test(proxySecret)

  return async function votingProxy(request, context = {}) {
    let url
    try {
      url = new URL(request.url)
    } catch {
      return json(400, '无效的请求地址。')
    }

    // config.path preserves /api/... in Request.url. Do not trust client-supplied
    // rewrite headers or expose the default /.netlify/functions/votes endpoint.
    const isRead = ['/api/votes', '/api/leaderboard'].includes(url.pathname)
    const route = /^\/api\/votes\/([^/]+)$/.exec(url.pathname)
    if (!isRead && !route) return json(404, '接口不存在。')
    const methods = route ? ['POST', 'DELETE'] : ['GET']
    if (!methods.includes(request.method))
      return json(405, '请求方法不被允许。', { Allow: methods.join(', ') })

    const origin = request.headers.get('Origin')
    if ((origin && origin !== url.origin) || (route && !origin))
      return json(403, '请求来源不被允许。')

    let pathname = url.pathname
    let body
    if (route) {
      let trackId
      try {
        trackId = decodeURIComponent(route[1])
      } catch {
        return json(400, '无效的歌曲 ID。')
      }
      if (!trackId || trackId.length > 200 || /[\0/\\]/.test(trackId))
        return json(400, '无效的歌曲 ID。')
      pathname = `/api/votes/${encodeURIComponent(trackId)}`
      const length = request.headers.get('Content-Length')
      if (length !== null && !/^\d+$/.test(length)) {
        cancelBody(request.body)
        return json(400, '无效的请求体。')
      }
      if (length !== null && Number(length) > BODY_LIMIT) {
        cancelBody(request.body)
        return json(413, '请求体过大。')
      }
      try {
        body = await readBody(request.body, BODY_LIMIT)
      } catch {
        return json(400, '无效的请求体。')
      }
      if (body === null) return json(413, '请求体过大。')
    }

    const headers = new Headers({ Accept: 'application/json', Origin: VOTING_UPSTREAM_ORIGIN })
    for (const name of ['Cookie', 'Content-Type']) {
      const value = request.headers.get(name)
      if (value !== null) headers.set(name, value)
    }
    // Netlify supplies context.ip. Never derive this value from a browser header.
    // The Worker must verify the shared secret before trusting the forwarded IP.
    if (hasProxySecret && typeof context.ip === 'string' && isIP(context.ip)) {
      headers.set('X-Pikasonic-Proxy-Secret', proxySecret)
      headers.set('X-Pikasonic-Client-IP', context.ip)
    }
    const controller = new AbortController()
    let timer
    let timedOut = false
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        timedOut = true
        controller.abort()
        resolve(json(504, '投票服务响应超时，请稍后再试。'))
      }, timeoutMs)
    })

    const forward = async () => {
      // Neither query parameters nor incoming headers can select another host.
      const upstream = await fetchUpstream(new URL(pathname, VOTING_UPSTREAM_ORIGIN), {
        method: request.method,
        headers,
        ...(route ? { body } : {}),
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!upstream.ok) {
        cancelBody(upstream.body)
        return upstreamError(upstream.status, upstream.headers)
      }
      if (!/^application\/json(?:;|$)/i.test(upstream.headers.get('Content-Type') || '')) {
        cancelBody(upstream.body)
        return json(502, '投票服务返回了无效响应，请稍后再试。')
      }
      const bytes = await readBody(upstream.body, RESPONSE_LIMIT)
      if (bytes === null) return json(502, '投票服务返回了无效响应，请稍后再试。')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      JSON.parse(text)
      const outgoing = responseHeaders()
      for (const cookie of upstream.headers.getSetCookie()) outgoing.append('Set-Cookie', cookie)
      return new Response(text, { status: upstream.status, headers: outgoing })
    }

    try {
      return await Promise.race([forward(), timeout])
    } catch {
      return json(
        timedOut ? 504 : 502,
        timedOut ? '投票服务响应超时，请稍后再试。' : '投票服务暂时不可用，请稍后再试。',
      )
    } finally {
      clearTimeout(timer)
    }
  }
}

export default createVotingProxy()

// Native Netlify routing keeps API requests ahead of the site's SPA fallback.
export const config = { path: ['/api/*'], preferStatic: false }
