import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, createVoteStore } from '../server/index.mjs'

async function start(options = {}) {
  const store = options.store || createVoteStore({ databasePath: ':memory:' })
  const server = createApp({
    store,
    trackIds: ['track-a', 'track-b', ...Array.from({ length: 12 }, (_, i) => `t${i}`)],
    rateLimit: 1000,
    writeRateLimit: 1000,
    ...options,
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  return {
    server,
    store,
    origin,
    async close() {
      await new Promise((resolve) => server.close(resolve))
      store.close()
    },
  }
}

async function client(app) {
  let cookie = ''
  return async (path, method = 'GET', options = {}) => {
    const response = await fetch(`${app.origin}${path}`, {
      method,
      ...options,
      headers: { Origin: app.origin, ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
    })
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    return { status: response.status, body: await response.json(), cookie, setCookie }
  }
}

test('signed browser identity, idempotent votes, cancellation and real shared totals', async () => {
  const app = await start()
  try {
    const first = await client(app)
    const initial = await first('/api/votes')
    assert.deepEqual(initial.body, { votedTrackIds: [] })
    assert.match(initial.setCookie, /HttpOnly; SameSite=Lax/)
    assert.deepEqual((await first('/api/votes/track-a', 'POST')).body, { votes: 1, voted: true })
    const repeats = await Promise.all(
      Array.from({ length: 5 }, () => first('/api/votes/track-a', 'POST')),
    )
    assert.ok(repeats.every((result) => result.body.votes === 1))
    assert.deepEqual((await first('/api/votes')).body, { votedTrackIds: ['track-a'] })
    const second = await client(app)
    assert.deepEqual((await second('/api/votes/track-a', 'POST')).body, { votes: 2, voted: true })
    await first('/api/votes/track-b', 'POST')
    assert.deepEqual((await first('/api/leaderboard')).body, {
      entries: [
        { trackId: 'track-a', votes: 2 },
        { trackId: 'track-b', votes: 1 },
      ],
      counts: { 'track-a': 2, 'track-b': 1 },
      totalVotes: 3,
      totalVoters: 2,
    })
    assert.deepEqual((await first('/api/votes/track-a', 'DELETE')).body, { votes: 1, voted: false })
    assert.deepEqual((await first('/api/votes/track-a', 'DELETE')).body, { votes: 1, voted: false })
    const forged = await fetch(`${app.origin}/api/votes`, {
      headers: { Cookie: `${initial.cookie.slice(0, -5)}xxxxx` },
    })
    assert.deepEqual(await forged.json(), { votedTrackIds: [] })
  } finally {
    await app.close()
  }
})

test('top ten excludes zero votes and orders by count with stable ID ties', async () => {
  const app = await start()
  try {
    const one = await client(app)
    for (let i = 0; i < 12; i++) await one(`/api/votes/t${i}`, 'POST')
    const two = await client(app)
    await two('/api/votes/t9', 'POST')
    const { body } = await one('/api/leaderboard')
    assert.equal(body.entries.length, 10)
    assert.deepEqual(body.entries[0], { trackId: 't9', votes: 2 })
    assert.deepEqual(
      body.entries.map((entry) => entry.trackId),
      ['t9', 't0', 't1', 't10', 't11', 't2', 't3', 't4', 't5', 't6'],
    )
    assert.equal(Object.keys(body.counts).length, 12)
    assert.equal(body.counts.t7, 1)
    assert.equal(body.counts.t8, 1)
    assert.equal(body.counts.t9, 2)
    assert.equal(body.counts['track-a'], undefined)
    assert.ok(body.entries.every((entry) => entry.votes > 0))
    assert.equal(body.totalVotes, 13)
    assert.equal(body.totalVoters, 2)
  } finally {
    await app.close()
  }
})

test('unknown IDs, foreign origins and oversized payloads are rejected without a vote', async () => {
  const app = await start()
  try {
    const visit = await client(app)
    assert.equal((await visit('/api/votes/fake', 'POST')).status, 404)
    assert.equal(
      (await visit('/api/votes/track-a', 'POST', { headers: { Origin: 'https://evil.example' } }))
        .status,
      403,
    )
    assert.equal(
      (await visit('/api/votes/track-a', 'POST', { body: 'x'.repeat(1025) })).status,
      413,
    )
    const missingOrigin = await fetch(`${app.origin}/api/votes/track-a`, { method: 'POST' })
    assert.equal(missingOrigin.status, 403)
    assert.equal((await visit('/api/leaderboard')).body.totalVotes, 0)
  } finally {
    await app.close()
  }
})

test('write throttling returns 429', async () => {
  const app = await start({ writeRateLimit: 1 })
  try {
    const visit = await client(app)
    assert.equal((await visit('/api/votes/track-a', 'POST')).status, 200)
    assert.equal((await visit('/api/votes/track-b', 'POST')).status, 429)
  } finally {
    await app.close()
  }
})

test('SQLite and the cookie secret survive server restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pikasonic-votes-'))
  const databasePath = join(directory, 'votes.sqlite')
  let app = await start({ store: createVoteStore({ databasePath }) })
  try {
    const visit = await client(app)
    const voted = await visit('/api/votes/track-a', 'POST')
    await app.close()
    app = await start({ store: createVoteStore({ databasePath }) })
    const restored = await fetch(`${app.origin}/api/votes`, { headers: { Cookie: voted.cookie } })
    assert.deepEqual(await restored.json(), { votedTrackIds: ['track-a'] })
    const board = await fetch(`${app.origin}/api/leaderboard`)
    assert.equal((await board.json()).totalVotes, 1)
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('production SITE_ORIGIN and static path bounds are enforced', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pikasonic-static-'))
  const distDir = join(directory, 'dist')
  mkdirSync(distDir)
  writeFileSync(join(distDir, 'index.html'), '<h1>PIKASONIC</h1>')
  writeFileSync(join(directory, 'private.txt'), 'private')
  const app = await start({ production: true, siteOrigin: 'https://music.example', distDir })
  try {
    const visit = await client(app)
    assert.equal((await visit('/api/votes/track-a', 'POST')).status, 403)
    const valid = await visit('/api/votes/track-a', 'POST', {
      headers: { Origin: 'https://music.example' },
    })
    assert.equal(valid.status, 200)
    const home = await fetch(`${app.origin}/`)
    assert.match(await home.text(), /PIKASONIC/)
    const traversal = await fetch(`${app.origin}/%2e%2e%2fprivate.txt`)
    assert.equal(traversal.status, 404)
    const windowsTraversal = await fetch(`${app.origin}/..%5cprivate.txt`)
    assert.equal(windowsTraversal.status, 400)
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
