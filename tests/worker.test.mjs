import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { resolve, join, relative, sep, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = resolve(root, 'artifacts')
const cli = resolve(root, 'node_modules/wrangler/bin/wrangler.js')
const tracks = JSON.parse(readFileSync(join(root, 'public/data/catalog.json'), 'utf8')).tracks
const trackId = tracks[0].id
const otherId = tracks[1].id
const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: 'false',
  CI: 'true',
}

async function freePort() {
  const probe = createServer()
  await new Promise((done) => probe.listen(0, '127.0.0.1', done))
  const port = probe.address().port
  await new Promise((done) => probe.close(done))
  return port
}

test(
  'Cloudflare workerd and real local D1 preserve shared votes, identity and aggregates',
  {
    timeout: 120_000,
  },
  async (t) => {
    mkdirSync(artifacts, { recursive: true })
    const directory = mkdtempSync(join(artifacts, 'worker-test-'))
    const assets = join(directory, 'assets')
    mkdirSync(assets)
    writeFileSync(join(assets, 'index.html'), '<h1>PIKASONIC Worker integration</h1>')
    const configPath = join(directory, 'wrangler.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        name: 'pikasonic-worker-test',
        main: resolve(root, 'worker/index.mjs'),
        compatibility_date: '2026-10-15',
        send_metrics: false,
        assets: {
          directory: assets,
          binding: 'ASSETS',
          not_found_handling: 'single-page-application',
          run_worker_first: ['/api/*'],
        },
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'test-votes',
            database_id: '00000000-0000-0000-0000-000000000001',
            migrations_dir: resolve(root, 'migrations'),
          },
        ],
      }),
    )
    const persistence = join(directory, 'state')
    const port = await freePort()
    const origin = `http://127.0.0.1:${port}`
    let processHandle
    let exitPromise
    let output = ''

    async function stop() {
      if (!processHandle || processHandle.exitCode !== null) return
      processHandle.kill('SIGTERM')
      await exitPromise
    }
    async function start() {
      output = ''
      processHandle = spawn(
        process.execPath,
        [
          cli,
          'dev',
          '--local',
          '--config',
          configPath,
          '--persist-to',
          persistence,
          '--port',
          String(port),
          '--ip',
          '127.0.0.1',
          '--show-interactive-dev-session=false',
        ],
        { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      exitPromise = new Promise((done) => processHandle.once('exit', done))
      processHandle.stdout.on('data', (data) => {
        output += data.toString()
      })
      processHandle.stderr.on('data', (data) => {
        output += data.toString()
      })
      const deadline = Date.now() + 45_000
      while (Date.now() < deadline) {
        if (processHandle.exitCode !== null) throw new Error(`Wrangler exited: ${output}`)
        try {
          const response = await fetch(`${origin}/api/leaderboard`, {
            signal: AbortSignal.timeout(500),
          })
          if (response.ok) return
        } catch {
          /* Wait for the actual runtime to listen. */
        }
        await delay(100)
      }
      throw new Error(`Wrangler did not become ready: ${output}`)
    }
    function client(initialCookie = '') {
      let cookie = initialCookie
      return async (path, method = 'GET', options = {}) => {
        const response = await fetch(`${origin}${path}`, {
          method,
          ...options,
          headers: {
            Origin: origin,
            ...(cookie ? { Cookie: cookie } : {}),
            ...options.headers,
          },
        })
        const setCookie = response.headers.get('set-cookie')
        if (setCookie) cookie = setCookie.split(';')[0]
        return {
          status: response.status,
          body: await response.json(),
          cookie,
          setCookie,
          cache: response.headers.get('cache-control'),
        }
      }
    }

    try {
      execFileSync(
        process.execPath,
        [
          cli,
          'd1',
          'migrations',
          'apply',
          'test-votes',
          '--local',
          '--config',
          configPath,
          '--persist-to',
          persistence,
        ],
        { cwd: root, env, stdio: 'pipe', timeout: 30_000 },
      )
      await start()
      const first = client()
      const second = client()
      let firstCookie

      await t.test(
        'distinct browsers share totals; duplicate votes remain idempotent',
        async () => {
          const identity = await first('/api/votes')
          firstCookie = identity.cookie
          assert.deepEqual(identity.body.votedTrackIds, [])
          assert.match(identity.setCookie, /HttpOnly; SameSite=Lax; Secure/)
          assert.equal(identity.cache, 'no-store')
          const repeats = await Promise.all(
            Array.from({ length: 5 }, () =>
              first(`/api/votes/${encodeURIComponent(trackId)}`, 'POST', { body: '{}' }),
            ),
          )
          assert.ok(repeats.every((item) => item.status === 200 && item.body.votes === 1))
          const secondVote = await second(`/api/votes/${encodeURIComponent(trackId)}`, 'POST')
          assert.deepEqual(secondVote.body, { votes: 2, voted: true })
          assert.equal(
            (await first(`/api/votes/${encodeURIComponent(otherId)}`, 'POST')).status,
            200,
          )
          const board = (await second('/api/leaderboard')).body
          assert.equal(board.totalVotes, 3)
          assert.equal(board.totalVoters, 2)
          assert.deepEqual(board.entries[0], { trackId, votes: 2 })
        },
      )

      await t.test(
        'foreign origins, methods, unknown songs and oversized streams cannot vote',
        async () => {
          const route = `/api/votes/${encodeURIComponent(trackId)}`
          assert.equal(
            (await first(route, 'POST', { headers: { Origin: 'https://evil.example' } })).status,
            403,
          )
          assert.equal((await first('/api/votes/missing', 'POST')).status, 404)
          assert.equal((await first('/api/leaderboard', 'POST')).status, 405)
          assert.equal((await first(route, 'POST', { body: 'x'.repeat(1025) })).status, 413)
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(1024))
              controller.enqueue(new Uint8Array(1))
              controller.close()
            },
          })
          // Cancelling an oversized upload closes its HTTP/1 socket. Do not reuse
          // that connection through Miniflare's local proxy for the next check.
          assert.equal(
            (
              await first(route, 'POST', {
                body: stream,
                duplex: 'half',
                headers: { Connection: 'close' },
              })
            ).status,
            413,
          )
          const missingOrigin = await fetch(`${origin}${route}`, { method: 'POST' })
          assert.equal(missingOrigin.status, 403, await missingOrigin.text())
          assert.equal((await first('/api/leaderboard')).body.totalVotes, 3)
        },
      )

      await t.test('forged identity cannot read another browser votes', async () => {
        const forged = client(`${firstCookie.slice(0, -1)}!`)
        assert.deepEqual((await forged('/api/votes')).body.votedTrackIds, [])
        assert.deepEqual(
          (await first('/api/votes')).body.votedTrackIds.sort(),
          [trackId, otherId].sort(),
        )
      })

      await t.test('top ten comes from real aggregate rows with stable ties', async () => {
        for (const track of tracks.slice(2, 13))
          assert.equal(
            (await first(`/api/votes/${encodeURIComponent(track.id)}`, 'POST')).status,
            200,
          )
        const board = (await second('/api/leaderboard')).body
        assert.equal(board.entries.length, 10)
        assert.equal(board.totalVotes, 14)
        assert.equal(board.totalVoters, 2)
        assert.equal(board.entries[0].trackId, trackId)
        const tied = tracks
          .slice(1, 13)
          .map((track) => track.id)
          .sort()
        assert.deepEqual(
          board.entries.slice(1).map((entry) => entry.trackId),
          tied.slice(0, 9),
        )
        assert.equal(Object.keys(board.counts).length, 13)
      })

      await t.test('Worker restart preserves D1 votes and the original signed cookie', async () => {
        await stop()
        await start()
        const restored = client(firstCookie)
        assert.equal((await restored('/api/votes')).body.votedTrackIds.length, 13)
        assert.equal((await restored('/api/leaderboard')).body.totalVotes, 14)
        const response = await fetch(`${origin}/api/votes`, { headers: { Cookie: firstCookie } })
        assert.equal(response.headers.get('set-cookie'), null)
      })

      await t.test('withdrawing the last vote removes a browser from the totals', async () => {
        assert.deepEqual(
          (await second(`/api/votes/${encodeURIComponent(trackId)}`, 'DELETE')).body,
          { votes: 1, voted: false },
        )
        assert.equal((await second('/api/leaderboard')).body.totalVoters, 1)
        for (const track of tracks.slice(0, 13))
          assert.equal(
            (await first(`/api/votes/${encodeURIComponent(track.id)}`, 'DELETE')).status,
            200,
          )
        assert.deepEqual((await first('/api/leaderboard')).body, {
          entries: [],
          counts: {},
          totalVotes: 0,
          totalVoters: 0,
        })
        assert.deepEqual(
          (await first(`/api/votes/${encodeURIComponent(trackId)}`, 'DELETE')).body,
          { votes: 0, voted: false },
        )
      })

      await t.test('one address serves both static HTML and the JSON API', async () => {
        const page = await fetch(`${origin}/`)
        assert.match(await page.text(), /PIKASONIC Worker integration/)
        const unknown = await fetch(`${origin}/api/not-an-endpoint`)
        assert.equal(unknown.status, 404)
        assert.match(unknown.headers.get('content-type'), /application\/json/)
      })
    } finally {
      await stop()
      const child = relative(artifacts, directory)
      if (!child || child.startsWith(`..${sep}`) || child === '..' || isAbsolute(child))
        throw new Error('Unsafe test cleanup path')
      rmSync(directory, { recursive: true, force: true })
    }
  },
)
