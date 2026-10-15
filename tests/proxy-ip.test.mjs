import test from 'node:test'
import assert from 'node:assert/strict'
import { isIP, createServer } from 'node:net'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { authenticatedProxyIp, normalizeClientIp } from '../worker/proxy-ip.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const proxySecret = 'synthetic-proxy-authentication-test-key-'.repeat(2)

test('proxy IP parser accepts and normalizes strict IPv4 and IPv6 addresses', () => {
  const valid = [
    '0.0.0.0',
    '127.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '1::',
    '1:2:3:4:5:6:7:8',
    '2001:0DB8:0000:0000:0000:0000:0000:0007',
    '2001:db8::7',
    '::ffff:192.0.2.1',
    '0:0:0:0:0:ffff:192.0.2.1',
    'ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255',
  ]
  for (const value of valid) {
    assert.notEqual(isIP(value), 0, value)
    assert.notEqual(normalizeClientIp(value), undefined, value)
    assert.notEqual(isIP(normalizeClientIp(value)), 0, value)
  }
  assert.equal(normalizeClientIp('2001:0DB8:0:0:0:0:0:7'), normalizeClientIp('2001:db8::7'))
  assert.equal(normalizeClientIp('::ffff:192.0.2.1'), '0:0:0:0:0:ffff:c000:201')
  const invalid = [
    '',
    '192.168.01.1',
    '256.1.1.1',
    '1.2.3',
    '1.2.3.4.5',
    '1234',
    '1.2.3.4:80',
    ' 1.2.3.4',
    '1.2.3.4 ',
    '1.2.3.4\n',
    '1\n.2.3.4',
    '1.2.3.4, 2.3.4.5',
    '[::1]',
    '::1\n',
    'fe80::1%eth0',
    ':::1',
    '1::2::3',
    '1:2:3:4:5:6:7',
    '1:2:3:4:5:6:7:8:9',
    '1:2:3:4:5:6:7::8',
    '10000::',
    '::ffff:192.0.02.1',
    '::ffff:256.0.2.1',
    '1:2:3:4:5:192.0.2.1',
    '::192.0.2.1:1',
  ]
  for (const value of invalid) assert.equal(normalizeClientIp(value), undefined, value)
})

test('proxy authentication requires a valid configured secret, matching digest and one valid IP', async () => {
  const request = (ip, supplied = proxySecret) =>
    new Request('https://example.test/api/leaderboard', {
      headers: {
        'X-Pikasonic-Client-IP': ip,
        'X-Pikasonic-Proxy-Secret': supplied,
      },
    })
  assert.equal(await authenticatedProxyIp(request('192.0.2.1'), proxySecret), '192.0.2.1')
  assert.equal(await authenticatedProxyIp(request('::1'), proxySecret), '0:0:0:0:0:0:0:1')
  assert.equal(await authenticatedProxyIp(request('192.0.2.1'), undefined), undefined)
  assert.equal(await authenticatedProxyIp(request('192.0.2.1', 'short'), 'short'), undefined)
  assert.equal(
    await authenticatedProxyIp(request('192.0.2.1', `${proxySecret.slice(0, -1)}x`), proxySecret),
    undefined,
  )
  assert.equal(await authenticatedProxyIp(request('192.0.2.1', ''), proxySecret), undefined)
  assert.equal(
    await authenticatedProxyIp(
      new Request('https://example.test/api/leaderboard', {
        headers: { 'X-Pikasonic-Client-IP': '192.0.2.1' },
      }),
      proxySecret,
    ),
    undefined,
  )
  assert.equal(
    await authenticatedProxyIp(request('192.0.2.1', 'x'.repeat(4097)), proxySecret),
    undefined,
  )
  assert.equal(await authenticatedProxyIp(request('192.0.2.1, 192.0.2.2'), proxySecret), undefined)
})

async function freePort() {
  const server = createServer()
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const port = server.address().port
  await new Promise((done) => server.close(done))
  return port
}

test(
  'real workerd isolates authenticated proxy visitors while forged headers keep the edge limit',
  { timeout: 120_000 },
  async (t) => {
    const artifacts = join(root, 'artifacts')
    mkdirSync(artifacts, { recursive: true })
    const directory = mkdtempSync(join(artifacts, 'proxy-ip-test-'))
    const assets = join(directory, 'assets')
    mkdirSync(assets)
    writeFileSync(join(assets, 'index.html'), '<h1>Proxy integration test</h1>')
    const entry = join(directory, 'worker.mjs')
    writeFileSync(
      entry,
      `import { createWorker } from ${JSON.stringify(resolve(root, 'worker/index.mjs').replaceAll('\\', '/'))};
       export default createWorker({ trackIds: ['track-a', 'track-b'], rateLimit: 2,
         writeRateLimit: 1, rateWindowMs: 600000 });`,
    )
    const config = join(directory, 'wrangler.json')
    const persistence = join(directory, 'state')
    const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js')
    const environment = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' }
    const configuration = {
      name: 'proxy-ip-integration-test',
      main: entry,
      compatibility_date: '2026-10-15',
      send_metrics: false,
      assets: { directory: assets, binding: 'ASSETS' },
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'test-proxy-ip-votes',
          database_id: '00000000-0000-0000-0000-000000000003',
          migrations_dir: resolve(root, 'migrations'),
        },
      ],
    }
    writeFileSync(config, JSON.stringify(configuration))
    execFileSync(
      process.execPath,
      [
        wrangler,
        'd1',
        'migrations',
        'apply',
        'test-proxy-ip-votes',
        '--local',
        '--config',
        config,
        '--persist-to',
        persistence,
      ],
      { cwd: root, env: environment, stdio: 'pipe', timeout: 30_000 },
    )
    const port = await freePort()
    const origin = `http://127.0.0.1:${port}`
    let child
    let exited
    async function stop() {
      if (!child || child.exitCode !== null) return
      child.kill('SIGTERM')
      await exited
    }
    async function start(secret) {
      writeFileSync(
        config,
        JSON.stringify({
          ...configuration,
          ...(secret === undefined ? {} : { vars: { VOTING_PROXY_SECRET: secret } }),
        }),
      )
      child = spawn(
        process.execPath,
        [
          wrangler,
          'dev',
          '--local',
          '--config',
          config,
          '--persist-to',
          persistence,
          '--port',
          String(port),
          '--ip',
          '127.0.0.1',
          '--show-interactive-dev-session=false',
        ],
        { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      exited = new Promise((done) => child.once('exit', done))
      let output = ''
      child.stdout.on('data', (chunk) => (output += chunk.toString()))
      child.stderr.on('data', (chunk) => (output += chunk.toString()))
      const deadline = Date.now() + 45_000
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`Test workerd exited: ${output}`)
        try {
          const response = await fetch(origin, { signal: AbortSignal.timeout(500) })
          if (response.ok) return
        } catch {
          // Wait for Wrangler's real workerd runtime to start.
        }
        await delay(100)
      }
      throw new Error(`Test workerd did not start: ${output}`)
    }
    const request = (ip, secret = proxySecret, method = 'GET', trackId = 'track-a') =>
      fetch(`${origin}${method === 'GET' ? '/api/leaderboard' : `/api/votes/${trackId}`}`, {
        method,
        headers: {
          Origin: origin,
          'X-Pikasonic-Client-IP': ip,
          ...(secret === null ? {} : { 'X-Pikasonic-Proxy-Secret': secret }),
        },
      })
    try {
      await start(proxySecret)
      await t.test(
        'read limits are per verified visitor and normalize IPv6 spellings',
        async () => {
          assert.equal((await request('192.0.2.1')).status, 200)
          assert.equal((await request('192.0.2.1')).status, 200)
          assert.equal((await request('192.0.2.1')).status, 429)
          assert.equal((await request('192.0.2.2')).status, 200)
          assert.equal((await request('2001:0DB8:0:0:0:0:0:7')).status, 200)
          assert.equal((await request('2001:db8::7')).status, 200)
          assert.equal((await request('2001:db8::7')).status, 429)
        },
      )
      await t.test('write limits are per verified visitor', async () => {
        assert.equal((await request('192.0.2.10', proxySecret, 'POST')).status, 200)
        const limited = await request('192.0.2.10', proxySecret, 'POST', 'track-b')
        assert.equal(limited.status, 429)
        assert.match((await limited.json()).error, /操作/)
        assert.equal((await request('192.0.2.11', proxySecret, 'POST')).status, 200)
      })
      await t.test('invalid IP, forged secret and absent secret share the edge limit', async () => {
        assert.equal((await request('not-an-address')).status, 200)
        assert.equal((await request('192.0.2.21', 'x'.repeat(proxySecret.length))).status, 200)
        assert.equal((await request('192.0.2.22', null)).status, 429)
      })
      await stop()
      await start(undefined)
      await t.test(
        'without configured secret even matching-looking headers are ignored',
        async () => {
          assert.equal((await request('192.0.2.31')).status, 200)
          assert.equal((await request('192.0.2.32')).status, 200)
          assert.equal((await request('192.0.2.33')).status, 429)
        },
      )
    } finally {
      await stop()
      rmSync(directory, { recursive: true, force: true })
    }
  },
)
