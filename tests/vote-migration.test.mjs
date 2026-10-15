import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { importD1Votes } from '../scripts/import-d1-votes.mjs'
import { createApp, createVoteStore } from '../server/index.mjs'
import { createVoteStore as createD1Store } from '../worker/store.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const cli = join(root, 'scripts/import-d1-votes.mjs')
const visitorA = Buffer.alloc(32, 1).toString('base64url')
const visitorB = Buffer.alloc(32, 2).toString('base64url')
const secret = 'synthetic-migration-test-signing-key-'.repeat(2)
const quote = (value) => `'${value.replaceAll("'", "''")}'`
const migration = readFileSync(join(root, 'migrations/0001_votes.sql'), 'utf8')
const seed = `
  INSERT INTO meta VALUES ('visitor_secret', ${quote(secret)});
  INSERT INTO votes VALUES (${quote(visitorA)}, 'apple-1643679008', 1700000000000);
  INSERT INTO votes VALUES (${quote(visitorA)}, 'legacy-track', 1700000000123);
  INSERT INTO votes VALUES (${quote(visitorB)}, 'apple-1643679008', 1700000000999);
`
const dump = `PRAGMA defer_foreign_keys=TRUE; BEGIN TRANSACTION; ${migration} ${seed} COMMIT;`

function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), 'pikasonic-migration-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const inputPath = join(directory, 'd1.sql')
  const databasePath = join(directory, 'votes.sqlite')
  writeFileSync(inputPath, dump)
  return { directory, inputPath, databasePath }
}

test('only vote rows and the persisted key migrate; timestamps and historical IDs survive', (t) => {
  const paths = workspace(t)
  writeFileSync(
    paths.inputPath,
    `${dump}
     CREATE TABLE unrelated (value TEXT);
     INSERT INTO unrelated VALUES ('ignore me');
     UPDATE track_counts SET votes = 999;
     UPDATE site_totals SET total_votes = 999, total_voters = 999;`,
  )
  assert.deepEqual(importD1Votes(paths), { totalVotes: 3, totalVoters: 2, votedTracks: 2 })
  const database = new DatabaseSync(paths.databasePath)
  try {
    assert.deepEqual(
      database
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
        .all()
        .map((row) => row.name),
      ['meta', 'votes'],
    )
    assert.equal(database.prepare('SELECT value FROM meta').get().value, secret)
    assert.deepEqual(
      database
        .prepare('SELECT created_at FROM votes ORDER BY created_at')
        .all()
        .map((row) => row.created_at),
      [1700000000000, 1700000000123, 1700000000999],
    )
  } finally {
    database.close()
  }
  assert.ok(!readdirSync(paths.directory).some((name) => name.startsWith('.vote-import-')))
})

test('existing target contents are never replaced, including an existing empty file', (t) => {
  const paths = workspace(t)
  for (const contents of ['existing votes must survive', '']) {
    writeFileSync(paths.databasePath, contents)
    assert.throws(() => importD1Votes(paths), /Target already exists/)
    assert.equal(readFileSync(paths.databasePath, 'utf8'), contents)
  }
})

test('invalid schemas or row values fail before publishing and leave no temporary database', (t) => {
  const paths = workspace(t)
  const invalidDumps = [
    dump.replace('key TEXT PRIMARY KEY', 'key BLOB PRIMARY KEY'),
    dump.replace(quote(secret), "'too short'"),
    dump.replace('1700000000999', "'invalid time'"),
    dump.replace('1700000000999', '9007199254740992'),
    dump.replace('1700000000999', '-1'),
    dump.replace(quote(visitorB), "'invalid visitor'"),
    dump.replace(quote(visitorB), quote(visitorA)),
    dump.replace("'legacy-track'", "'bad/track'"),
    dump.replace("'legacy-track'", "''"),
    dump.replace('COMMIT;', ''),
  ]
  for (const invalid of invalidDumps) {
    writeFileSync(paths.inputPath, invalid)
    assert.throws(() => importD1Votes(paths))
    assert.equal(existsSync(paths.databasePath), false)
    assert.ok(!readdirSync(paths.directory).some((name) => name.startsWith('.vote-import-')))
  }
  writeFileSync(paths.inputPath, Buffer.from([0xff, 0xfe, 0xfd]))
  assert.throws(() => importD1Votes(paths), /valid UTF-8/)
  assert.equal(existsSync(paths.databasePath), false)
})

test('SQL dump file access, dangerous pragmas and extension functions cannot run', (t) => {
  const paths = workspace(t)
  const external = join(paths.directory, 'external.sqlite')
  for (const statement of [
    `ATTACH DATABASE ${quote(external)} AS external;`,
    `VACUUM INTO ${quote(external)};`,
    'PRAGMA writable_schema = ON;',
    `PRAGMA temp_store_directory = ${quote(paths.directory)};`,
    `SELECT load_extension(${quote(secret)});`,
    'CREATE VIRTUAL TABLE unwanted USING fts5(content);',
  ]) {
    writeFileSync(paths.inputPath, `${dump}\n${statement}`)
    assert.throws(() => importD1Votes(paths), /could not be safely loaded/)
    assert.equal(existsSync(external), false)
    assert.equal(existsSync(paths.databasePath), false)
  }
})

test('CLI reports aggregate totals and errors without visitor IDs or signing material', (t) => {
  const paths = workspace(t)
  const success = spawnSync(
    process.execPath,
    [cli, '--input', paths.inputPath, '--output', paths.databasePath],
    { encoding: 'utf8' },
  )
  assert.equal(success.status, 0)
  assert.match(success.stdout, /3 votes, 2 voters, 2 voted tracks/)
  assert.ok(!`${success.stdout}${success.stderr}`.includes(secret))
  assert.ok(!`${success.stdout}${success.stderr}`.includes(visitorA))
  const rejectedPath = join(paths.directory, 'rejected.sqlite')
  writeFileSync(paths.inputPath, `${dump}\nINVALID ${quote(secret)} ${quote(visitorA)};`)
  const failure = spawnSync(
    process.execPath,
    [cli, '--input', paths.inputPath, '--output', rejectedPath],
    { encoding: 'utf8' },
  )
  assert.equal(failure.status, 1)
  assert.ok(!`${failure.stdout}${failure.stderr}`.includes(secret))
  assert.ok(!`${failure.stdout}${failure.stderr}`.includes(visitorA))
  assert.equal(existsSync(rejectedPath), false)
})

test(
  'real local Wrangler D1 export imports with compatible HMAC identity and shared totals',
  {
    timeout: 90_000,
  },
  async (t) => {
    const paths = workspace(t)
    const config = join(paths.directory, 'wrangler.json')
    const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js')
    const name = 'migration-test-votes'
    writeFileSync(
      config,
      JSON.stringify({
        name: 'migration-test',
        compatibility_date: '2026-10-15',
        d1_databases: [
          {
            binding: 'DB',
            database_name: name,
            database_id: '00000000-0000-0000-0000-000000000002',
            migrations_dir: resolve(root, 'migrations'),
          },
        ],
      }),
    )
    const environment = {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      CI: 'true',
    }
    const run = (args) =>
      execFileSync(process.execPath, [wrangler, ...args, '--local', '--config', config], {
        cwd: dirname(config),
        env: environment,
        stdio: 'pipe',
        timeout: 30_000,
      })
    run(['d1', 'migrations', 'apply', name])
    writeFileSync(paths.inputPath, seed)
    run(['d1', 'execute', name, '--file', paths.inputPath])
    run(['d1', 'export', name, '--output', paths.inputPath])
    assert.match(readFileSync(paths.inputPath, 'utf8'), /CREATE TABLE.*votes/i)
    assert.deepEqual(importD1Votes(paths), { totalVotes: 3, totalVoters: 2, votedTracks: 2 })

    const store = createVoteStore({ databasePath: paths.databasePath })
    const database = new DatabaseSync(paths.databasePath)
    const adapter = {
      prepare(sql) {
        let values = []
        return {
          bind(...bound) {
            values = bound
            return this
          },
          async all() {
            return { success: true, results: database.prepare(sql).all(...values) }
          },
        }
      },
      async batch(statements) {
        return Promise.all(statements.map((statement) => statement.all()))
      },
    }
    const d1Store = await createD1Store({ database: adapter })
    const signature = await d1Store.signVisitor(visitorA)
    const cookie = `pikasonic_visitor=${visitorA}.${signature}`
    assert.equal(await d1Store.verifyVisitor(visitorA, signature), true)
    database.close()
    const app = createApp({
      store,
      trackIds: ['apple-1643679008', 'legacy-track'],
      rateLimit: 1000,
      writeRateLimit: 1000,
    })
    await new Promise((done) => app.listen(0, '127.0.0.1', done))
    const origin = `http://127.0.0.1:${app.address().port}`
    try {
      const response = await fetch(`${origin}/api/votes`, { headers: { Cookie: cookie } })
      assert.equal(response.headers.get('set-cookie'), null)
      assert.deepEqual(await response.json(), {
        votedTrackIds: ['apple-1643679008', 'legacy-track'],
      })
      const repeat = await fetch(`${origin}/api/votes/apple-1643679008`, {
        method: 'POST',
        headers: { Cookie: cookie, Origin: origin },
      })
      assert.deepEqual(await repeat.json(), { votes: 2, voted: true })
      const leaderboard = await fetch(`${origin}/api/leaderboard`)
      assert.equal((await leaderboard.json()).totalVotes, 3)
    } finally {
      await new Promise((done) => app.close(done))
      store.close()
    }
  },
)
