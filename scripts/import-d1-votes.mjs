import { DatabaseSync, constants } from 'node:sqlite'
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_EXPORT_BYTES = 128 * 1024 * 1024
const C = constants
const dumpActions = new Set([
  C.SQLITE_CREATE_TABLE,
  C.SQLITE_CREATE_INDEX,
  C.SQLITE_CREATE_TRIGGER,
  C.SQLITE_INSERT,
  C.SQLITE_UPDATE,
  C.SQLITE_DELETE,
  C.SQLITE_READ,
  C.SQLITE_SELECT,
  C.SQLITE_TRANSACTION,
  C.SQLITE_SAVEPOINT,
])
const dumpPragmas = new Set(['defer_foreign_keys', 'foreign_keys'])

class MigrationError extends Error {}

function fail(message) {
  throw new MigrationError(message)
}

function assertMissing(path) {
  try {
    lstatSync(path)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  fail(
    'Target already exists. Stop the app and choose a new database path; nothing was overwritten.',
  )
}

function assertSchema(database, table, columns) {
  const entry = database.prepare('SELECT type FROM sqlite_schema WHERE name = ?').get(table)
  if (entry?.type !== 'table') fail('Export must contain the original meta and votes tables.')
  const actual = database.prepare(`PRAGMA table_info("${table}")`).all()
  if (
    actual.length !== columns.length ||
    actual.some(
      (column, i) =>
        column.name !== columns[i][0] ||
        column.type.toUpperCase() !== columns[i][1] ||
        column.pk !== columns[i][2] ||
        ((table === 'votes' || i > 0) && column.notnull !== 1),
    )
  )
    fail('Export table schema does not match this application. No database was published.')
}

function totals(database) {
  return {
    totalVotes: database.prepare('SELECT COUNT(*) AS n FROM votes').get().n,
    totalVoters: database.prepare('SELECT COUNT(DISTINCT visitor_id) AS n FROM votes').get().n,
    votedTracks: database.prepare('SELECT COUNT(DISTINCT track_id) AS n FROM votes').get().n,
  }
}

/**
 * Import a complete, trusted Wrangler SQL export made from this application's D1.
 * Dump SQL runs only in memory, with file access/extension/virtual table operations
 * denied. Only validated rows are copied into a separately constructed database.
 */
export function importD1Votes({ inputPath, databasePath } = {}) {
  if (!inputPath || !databasePath) fail('Both inputPath and databasePath are required.')
  const input = resolve(inputPath)
  const output = resolve(databasePath)
  let source
  let destination
  let temporaryDirectory
  try {
    assertMissing(output)
    if (typeof DatabaseSync.prototype.setAuthorizer !== 'function')
      fail(
        'This offline importer requires node:sqlite setAuthorizer. Use Node.js 24.21 or a newer supported release. No database was published.',
      )
    const info = statSync(input)
    if (!info.isFile() || info.size === 0 || info.size > MAX_EXPORT_BYTES)
      fail('Input must be a nonempty SQL file no larger than 128 MiB.')
    const bytes = readFileSync(input)
    if (bytes.length > MAX_EXPORT_BYTES || bytes.includes(0))
      fail('Input is not a supported SQL text export.')
    let sql
    try {
      sql = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      fail('Input must be a valid UTF-8 SQL text export.')
    }

    source = new DatabaseSync(':memory:', { allowExtension: false })
    source.exec('PRAGMA temp_store = MEMORY; PRAGMA journal_mode = MEMORY;')
    source.setAuthorizer((action, argument) => {
      if (action === C.SQLITE_PRAGMA)
        return dumpPragmas.has(argument?.toLowerCase()) ? C.SQLITE_OK : C.SQLITE_DENY
      return dumpActions.has(action) ? C.SQLITE_OK : C.SQLITE_DENY
    })
    try {
      source.exec(sql)
    } catch {
      // SQLite diagnostics can quote SQL containing visitor IDs or signing keys.
      fail('D1 SQL could not be safely loaded. Use a complete, unmodified export from this app.')
    }
    if (source.isTransaction)
      fail('Export ends with an unfinished transaction. Use a complete export.')
    source.setAuthorizer(null)
    assertSchema(source, 'meta', [
      ['key', 'TEXT', 1],
      ['value', 'TEXT', 0],
    ])
    assertSchema(source, 'votes', [
      ['visitor_id', 'TEXT', 1],
      ['track_id', 'TEXT', 2],
      ['created_at', 'INTEGER', 0],
    ])
    const secret = source
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('visitor_secret')?.value
    if (typeof secret !== 'string' || secret.length < 32 || secret.length > 4096)
      fail('Export has no valid persisted visitor signing key. Do not migrate without that key.')
    const expected = totals(source)

    mkdirSync(dirname(output), { recursive: true })
    temporaryDirectory = mkdtempSync(join(dirname(output), '.vote-import-'))
    const temporaryDatabase = join(temporaryDirectory, 'votes.sqlite')
    destination = new DatabaseSync(temporaryDatabase)
    chmodSync(temporaryDatabase, 0o600)
    destination.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE votes (
        visitor_id TEXT NOT NULL, track_id TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (visitor_id, track_id)
      );
      CREATE INDEX votes_track_id ON votes(track_id);
      BEGIN IMMEDIATE;
    `)
    destination.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('visitor_secret', secret)
    const insert = destination.prepare(
      'INSERT INTO votes (visitor_id, track_id, created_at) VALUES (?, ?, ?)',
    )
    const votes = source.prepare('SELECT visitor_id, track_id, created_at FROM votes')
    votes.setReadBigInts(true)
    for (const row of votes.iterate()) {
      if (
        typeof row.visitor_id !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(row.visitor_id) ||
        Buffer.from(row.visitor_id, 'base64url').toString('base64url') !== row.visitor_id ||
        typeof row.track_id !== 'string' ||
        row.track_id.length === 0 ||
        row.track_id.length > 200 ||
        /[\0/\\]/.test(row.track_id) ||
        typeof row.created_at !== 'bigint' ||
        row.created_at < 0n ||
        row.created_at > BigInt(Number.MAX_SAFE_INTEGER)
      )
        fail('Export contains an invalid vote row. No database was published.')
      insert.run(row.visitor_id, row.track_id, row.created_at)
    }
    const actual = totals(destination)
    if (Object.keys(expected).some((key) => actual[key] !== expected[key]))
      fail('Imported vote totals did not match the export. No database was published.')
    destination.exec('COMMIT;')
    if (destination.prepare('PRAGMA quick_check').get().quick_check !== 'ok')
      fail('Imported database failed its integrity check. No database was published.')
    destination.close()
    destination = undefined

    // A same-filesystem hard link publishes the complete file atomically and
    // fails if another process created the target after our initial check.
    try {
      linkSync(temporaryDatabase, output)
    } catch (error) {
      if (error.code === 'EEXIST')
        fail('Target appeared during import. Nothing was overwritten; choose a new path.')
      fail(
        'Could not atomically publish the database. Use a local filesystem supporting hard links.',
      )
    }
    return actual
  } catch (error) {
    if (error instanceof MigrationError) throw error
    fail('Migration failed. The target was not replaced; check input and filesystem permissions.')
  } finally {
    try {
      destination?.close()
    } finally {
      source?.close()
      if (temporaryDirectory) {
        try {
          rmSync(temporaryDirectory, { recursive: true, force: true })
        } catch {
          // A cleanup failure must not report a committed import as failed.
          // The private temporary directory can be removed manually afterward.
        }
      }
    }
  }
}

function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(
      'Usage: node scripts/import-d1-votes.mjs --input <d1-export.sql> --output <new-votes.sqlite>',
    )
    return
  }
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = { '--input': 'inputPath', '--output': 'databasePath' }[args[i]]
    if (!key || options[key] || !args[i + 1] || args[i + 1].startsWith('--'))
      fail('Use --input <d1-export.sql> --output <new-votes.sqlite>; see --help.')
    options[key] = args[i + 1]
  }
  const result = importD1Votes(options)
  console.log(
    `Import complete: ${result.totalVotes} votes, ${result.totalVoters} voters, ${result.votedTracks} voted tracks.`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
