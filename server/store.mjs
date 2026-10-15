import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

export function createVoteStore({
  databasePath = process.env.DATABASE_PATH || 'data/votes.sqlite',
  signingSecret = process.env.VISITOR_SECRET,
} = {}) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath)
  database.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS votes (
      visitor_id TEXT NOT NULL, track_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (visitor_id, track_id)
    );
    CREATE INDEX IF NOT EXISTS votes_track_id ON votes(track_id);`)
  database
    .prepare('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)')
    .run('visitor_secret', randomBytes(48).toString('base64url'))
  const secret =
    signingSecret ||
    database.prepare('SELECT value FROM meta WHERE key = ?').get('visitor_secret').value
  if (typeof secret !== 'string' || secret.length < 32)
    throw new Error('VISITOR_SECRET must contain at least 32 characters')
  const add = database.prepare(
    'INSERT OR IGNORE INTO votes(visitor_id, track_id, created_at) VALUES (?, ?, ?)',
  )
  const remove = database.prepare('DELETE FROM votes WHERE visitor_id = ? AND track_id = ?')
  const count = database.prepare('SELECT COUNT(*) AS votes FROM votes WHERE track_id = ?')
  const has = database.prepare('SELECT 1 FROM votes WHERE visitor_id = ? AND track_id = ?')
  return {
    secret,
    setVote(visitorId, trackId, voted) {
      if (voted) add.run(visitorId, trackId, Date.now())
      else remove.run(visitorId, trackId)
      return { votes: count.get(trackId).votes, voted: Boolean(has.get(visitorId, trackId)) }
    },
    getVotes(visitorId) {
      return database
        .prepare('SELECT track_id FROM votes WHERE visitor_id = ? ORDER BY track_id')
        .all(visitorId)
        .map((row) => row.track_id)
    },
    leaderboard() {
      return {
        entries: database
          .prepare(
            'SELECT track_id AS trackId, COUNT(*) AS votes FROM votes GROUP BY track_id ORDER BY votes DESC, track_id ASC LIMIT 10',
          )
          .all(),
        counts: Object.fromEntries(
          database
            .prepare('SELECT track_id AS trackId, COUNT(*) AS votes FROM votes GROUP BY track_id')
            .all()
            .map((row) => [row.trackId, row.votes]),
        ),
        totalVotes: database.prepare('SELECT COUNT(*) AS total FROM votes').get().total,
        totalVoters: database.prepare('SELECT COUNT(DISTINCT visitor_id) AS total FROM votes').get()
          .total,
      }
    },
    close() {
      database.close()
    },
  }
}
