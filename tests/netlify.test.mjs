import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp, createVoteStore } from '../server/index.mjs'
import { config, createVotingProxy, VOTING_UPSTREAM_ORIGIN } from '../netlify/functions/votes.mjs'

const SITE_ORIGIN = 'https://pikasonic-atlas-example.netlify.app'
const request = (path, method = 'GET', options = {}) =>
  new Request(`${SITE_ORIGIN}${path}`, {
    method,
    ...options,
    headers: { ...(method !== 'GET' ? { Origin: SITE_ORIGIN } : {}), ...options.headers },
  })
const success = (body = { votedTrackIds: [] }, headers = {}) => Response.json(body, { headers })

test('Netlify native route is used, and unrecognized or unsupported routes never fetch', async () => {
  assert.deepEqual(config, { path: ['/api/*'], preferStatic: false })
  let calls = 0
  const proxy = createVotingProxy({ fetch: async () => (calls++, success()) })
  for (const path of ['/api', '/api/other', '/api/votes/a/b', '/.netlify/functions/votes']) {
    const response = await proxy(
      request(path, 'GET', { headers: { 'X-Original-URL': '/api/votes' } }),
    )
    assert.equal(response.status, 404, path)
  }
  for (const [path, method, allow] of [
    ['/api/votes', 'POST', 'GET'],
    ['/api/leaderboard', 'HEAD', 'GET'],
    ['/api/votes/track-a', 'GET', 'POST, DELETE'],
    ['/api/votes/track-a', 'PATCH', 'POST, DELETE'],
    ['/api/votes/track-a', 'OPTIONS', 'POST, DELETE'],
  ]) {
    const response = await proxy(request(path, method))
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('Allow'), allow)
  }
  assert.equal(calls, 0)
})

test('only same-origin writes and valid encoded track IDs can reach the fixed upstream', async () => {
  const calls = []
  const proxy = createVotingProxy({ fetch: async (...args) => (calls.push(args), success()) })
  for (const headers of [{ Origin: '' }, { Origin: 'null' }, { Origin: 'https://evil.example' }])
    assert.equal((await proxy(request('/api/votes/track-a', 'POST', { headers }))).status, 403)
  const missing = new Request(`${SITE_ORIGIN}/api/votes/track-a`, { method: 'DELETE' })
  assert.equal((await proxy(missing)).status, 403)
  assert.equal(
    (await proxy(request('/api/votes', 'GET', { headers: { Origin: 'https://evil.example' } })))
      .status,
    403,
  )
  for (const id of ['%FF', '%', '%00', '%2F', '%5C', 'a'.repeat(201)])
    assert.equal((await proxy(request(`/api/votes/${id}`, 'POST'))).status, 400, id)
  assert.equal(calls.length, 0)
  await proxy(request('/api/votes/track-a?target=https://evil.example', 'POST'))
  assert.equal(calls[0][0].href, `${VOTING_UPSTREAM_ORIGIN}/api/votes/track-a`)
})

test('request and response headers are allowlisted and all responses forbid CDN caching', async () => {
  const cookies = [
    'pikasonic_visitor=signed.identity; Path=/; HttpOnly; SameSite=Lax; Secure',
    'other=value; Path=/; Secure',
  ]
  let observed
  const upstreamHeaders = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=31536000',
    'Netlify-CDN-Cache-Control': 'public, max-age=31536000',
    Authorization: 'internal-secret',
    'Access-Control-Allow-Origin': '*',
  })
  cookies.forEach((cookie) => upstreamHeaders.append('Set-Cookie', cookie))
  const proxy = createVotingProxy({
    fetch: async (url, init) => {
      observed = { url, init }
      return success({ votes: 1, voted: true }, upstreamHeaders)
    },
  })
  const cookie = 'pikasonic_visitor=one.two; unrelated=untouched'
  const response = await proxy(
    request('/api/votes/track-a', 'POST', {
      body: '{}',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        Authorization: 'Bearer client-secret',
        'CF-Connecting-IP': '1.2.3.4',
        'X-Forwarded-For': '1.2.3.4',
        'X-Real-IP': '1.2.3.4',
        'X-Netlify-Original-Path': '/elsewhere',
      },
    }),
  )
  assert.deepEqual(Object.fromEntries(observed.init.headers), {
    accept: 'application/json',
    'content-type': 'application/json',
    cookie,
    origin: VOTING_UPSTREAM_ORIGIN,
  })
  assert.equal(observed.init.redirect, 'error')
  assert.equal(observed.init.cache, 'no-store')
  assert.equal(new TextDecoder().decode(observed.init.body), '{}')
  assert.deepEqual(response.headers.getSetCookie(), cookies)
  assert.equal(response.headers.get('Authorization'), null)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(response.headers.get('CDN-Cache-Control'), 'no-store')
  assert.equal(response.headers.get('Netlify-CDN-Cache-Control'), 'no-store')
  assert.equal(response.headers.get('Vary'), 'Cookie, Origin')
  const rejected = await proxy(request('/api/unknown'))
  assert.equal(rejected.headers.get('Netlify-CDN-Cache-Control'), 'no-store')
})

test('request body byte limit applies to declarations and streamed content', async () => {
  let calls = 0
  const proxy = createVotingProxy({ fetch: async () => (calls++, success()) })
  assert.equal(
    (await proxy(request('/api/votes/a', 'POST', { headers: { 'Content-Length': 'oops' } })))
      .status,
    400,
  )
  assert.equal(
    (await proxy(request('/api/votes/a', 'POST', { headers: { 'Content-Length': '1025' } })))
      .status,
    413,
  )
  assert.equal(
    (await proxy(request('/api/votes/a', 'POST', { body: '界'.repeat(342) }))).status,
    413,
  )
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(512))
      controller.enqueue(new Uint8Array(513))
      controller.close()
    },
  })
  assert.equal(
    (await proxy(request('/api/votes/a', 'DELETE', { body: stream, duplex: 'half' }))).status,
    413,
  )
  assert.equal(calls, 0)
  assert.equal(
    (await proxy(request('/api/votes/a', 'POST', { body: 'a'.repeat(1024) }))).status,
    200,
  )
  assert.equal(calls, 1)
})

test('only a server-side shared secret and Netlify context IP enable trusted forwarding', async () => {
  const secret = 'server-configured-test-secret-1234567890'
  const observed = []
  const fetchUpstream = async (_url, init) => {
    observed.push(init.headers)
    return success()
  }
  const forged = {
    'X-Pikasonic-Proxy-Secret': secret,
    'X-Pikasonic-Client-IP': '203.0.113.99',
    'X-Forwarded-For': '203.0.113.99',
  }
  const trusted = createVotingProxy({ fetch: fetchUpstream, proxySecret: secret })
  for (const ip of ['198.51.100.7', '2001:db8::7']) {
    await trusted(request('/api/votes', 'GET', { headers: forged }), { ip })
    const headers = observed.at(-1)
    assert.equal(headers.get('X-Pikasonic-Proxy-Secret'), secret)
    assert.equal(headers.get('X-Pikasonic-Client-IP'), ip)
    assert.equal(headers.get('X-Forwarded-For'), null)
  }
  for (const options of [
    { proxySecret: '', context: { ip: '198.51.100.7' } },
    { proxySecret: 'short', context: { ip: '198.51.100.7' } },
    { proxySecret: `${secret}\r\ninvalid`, context: { ip: '198.51.100.7' } },
    { proxySecret: secret, context: {} },
    { proxySecret: secret, context: { ip: 'attacker.example' } },
    { proxySecret: secret, context: { ip: '198.51.100.7, 203.0.113.99' } },
    { proxySecret: secret, context: { ip: 'https://198.51.100.7' } },
  ]) {
    const proxy = createVotingProxy({ fetch: fetchUpstream, proxySecret: options.proxySecret })
    await proxy(request('/api/votes', 'GET', { headers: forged }), options.context)
    assert.equal(observed.at(-1).get('X-Pikasonic-Proxy-Secret'), null)
    assert.equal(observed.at(-1).get('X-Pikasonic-Client-IP'), null)
  }
  const previous = process.env.VOTING_PROXY_SECRET
  try {
    process.env.VOTING_PROXY_SECRET = secret
    const configured = createVotingProxy({ fetch: fetchUpstream })
    await configured(request('/api/votes'), { ip: '198.51.100.8' })
    assert.equal(observed.at(-1).get('X-Pikasonic-Proxy-Secret'), secret)
    assert.equal(observed.at(-1).get('X-Pikasonic-Client-IP'), '198.51.100.8')
  } finally {
    if (previous === undefined) delete process.env.VOTING_PROXY_SECRET
    else process.env.VOTING_PROXY_SECRET = previous
  }
})

test('timeout covers upstream response bodies and aborts the network operation', async () => {
  let signal
  const proxy = createVotingProxy({
    timeoutMs: 15,
    fetch: async (_url, init) => {
      signal = init.signal
      return new Response(new ReadableStream({ start() {} }), {
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })
  const response = await proxy(request('/api/votes'))
  assert.equal(response.status, 504)
  assert.equal(signal.aborted, true)
  assert.deepEqual(await response.json(), { error: '投票服务响应超时，请稍后再试。' })
})

test('redirects, network diagnostics, bad payloads and upstream failures remain generic JSON', async () => {
  for (const result of [
    () => Response.redirect('https://evil.example/secret'),
    () => {
      throw new Error('database-password=secret')
    },
    () => new Response('Internal SQL and secret', { status: 500 }),
    () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('invalid JSON secret', { headers: { 'Content-Type': 'application/json' } }),
    () =>
      new Response('a'.repeat(256 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    const proxy = createVotingProxy({ fetch: async () => result() })
    const response = await proxy(request('/api/votes'))
    assert.equal(response.status, 502)
    assert.equal(response.headers.get('Location'), null)
    assert.match(response.headers.get('Content-Type'), /application\/json/)
    assert.doesNotMatch(JSON.stringify(await response.json()), /secret|password|SQL|evil/)
  }
  const limited = createVotingProxy({
    fetch: async () =>
      new Response('internal reason', {
        status: 429,
        headers: { 'Retry-After': '60', 'Set-Cookie': 'pikasonic_visitor=one.two; Secure' },
      }),
  })
  const response = await limited(request('/api/leaderboard'))
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('Retry-After'), '60')
  assert.equal(response.headers.get('Set-Cookie'), 'pikasonic_visitor=one.two; Secure')
  assert.deepEqual(await response.json(), { error: '请求过于频繁，请稍后再试。' })
})

test('proxy preserves signed identities and shared totals through a real HTTP SQLite backend', async () => {
  const store = createVoteStore({ databasePath: ':memory:' })
  const server = createApp({
    store,
    trackIds: ['track-a', 'track-b'],
    siteOrigin: VOTING_UPSTREAM_ORIGIN,
    production: true,
    rateLimit: 1000,
    writeRateLimit: 1000,
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const backend = `http://127.0.0.1:${server.address().port}`
  const proxy = createVotingProxy({
    fetch: async (url, init) => {
      assert.equal(url.origin, VOTING_UPSTREAM_ORIGIN)
      // Only the transport is redirected to the real local backend in this test.
      return fetch(new URL(url.pathname, backend), init)
    },
  })
  const browser = () => {
    let cookie = ''
    return async (path, method = 'GET') => {
      const response = await proxy(
        request(path, method, { headers: cookie ? { Cookie: cookie } : {} }),
      )
      assert.equal(response.status, 200)
      const setCookie = response.headers.get('Set-Cookie')
      if (setCookie) cookie = setCookie.split(';')[0]
      return { body: await response.json(), cookie, setCookie }
    }
  }
  try {
    const one = browser()
    const two = browser()
    const initial = await one('/api/votes')
    assert.deepEqual(initial.body, { votedTrackIds: [] })
    assert.match(initial.setCookie, /HttpOnly; SameSite=Lax/)
    assert.deepEqual((await one('/api/votes/track-a', 'POST')).body, { votes: 1, voted: true })
    assert.deepEqual((await one('/api/votes/track-a', 'POST')).body, { votes: 1, voted: true })
    assert.deepEqual((await one('/api/votes')).body, { votedTrackIds: ['track-a'] })
    assert.equal((await one('/api/votes')).cookie, initial.cookie)
    assert.deepEqual((await two('/api/votes/track-a', 'POST')).body, { votes: 2, voted: true })
    assert.equal((await two('/api/leaderboard')).body.totalVotes, 2)
    assert.deepEqual((await one('/api/votes/track-a', 'DELETE')).body, { votes: 1, voted: false })
    assert.deepEqual((await one('/api/votes')).body, { votedTrackIds: [] })
    assert.deepEqual((await two('/api/votes')).body, { votedTrackIds: ['track-a'] })
    const board = (await two('/api/leaderboard')).body
    assert.equal(board.totalVotes, 1)
    assert.equal(board.totalVoters, 1)
    assert.deepEqual(board.entries, [{ trackId: 'track-a', votes: 1 }])
  } finally {
    await new Promise((resolve) => server.close(resolve))
    store.close()
  }
})
