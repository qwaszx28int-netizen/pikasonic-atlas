const stores = new WeakMap()
const encoder = new TextEncoder()

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function randomVisitorId() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

function rows(result) {
  if (!result || result.success === false || !Array.isArray(result.results))
    throw new Error('Invalid D1 result')
  return result.results
}

async function initialize(database, signingSecret) {
  let secret = signingSecret
  if (secret === undefined) {
    const candidate = base64url(crypto.getRandomValues(new Uint8Array(48)))
    const result = await database.batch([
      database
        .prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)')
        .bind('visitor_secret', candidate),
      database.prepare('SELECT value FROM meta WHERE key = ?').bind('visitor_secret'),
    ])
    // Another isolate may win initialization. Always read the committed winner.
    rows(result[0])
    secret = rows(result[1])[0]?.value
  }
  if (typeof secret !== 'string' || secret.length < 32)
    throw new Error('VISITOR_SECRET must contain at least 32 characters')
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
  return {
    async signVisitor(id) {
      return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(id))))
    },
    async verifyVisitor(id, signature) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false
      try {
        const decoded = Uint8Array.from(
          atob(signature.replaceAll('-', '+').replaceAll('_', '/') + '='),
          (character) => character.charCodeAt(0),
        )
        if (decoded.length !== 32 || base64url(decoded) !== signature) return false
        return await crypto.subtle.verify('HMAC', key, decoded, encoder.encode(id))
      } catch {
        return false
      }
    },
    async getVotes(visitorId) {
      const result = await database
        .prepare('SELECT track_id FROM votes WHERE visitor_id = ? ORDER BY track_id')
        .bind(visitorId)
        .all()
      return rows(result).map((row) => row.track_id)
    },
    async setVote(visitorId, trackId, voted, createdAt = Date.now()) {
      const mutation = voted
        ? database
            .prepare(
              'INSERT OR IGNORE INTO votes (visitor_id, track_id, created_at) VALUES (?, ?, ?)',
            )
            .bind(visitorId, trackId, createdAt)
        : database
            .prepare('DELETE FROM votes WHERE visitor_id = ? AND track_id = ?')
            .bind(visitorId, trackId)
      // D1 batch is a transaction: return the state of this mutation, not a
      // later independent read that another request can interleave with.
      const result = await database.batch([
        mutation,
        database
          .prepare(
            `SELECT
            COALESCE((SELECT votes FROM track_counts WHERE track_id = ?), 0) AS votes,
            EXISTS(SELECT 1 FROM votes WHERE visitor_id = ? AND track_id = ?) AS voted`,
          )
          .bind(trackId, visitorId, trackId),
      ])
      rows(result[0])
      const state = rows(result[1])[0]
      if (!state) throw new Error('Missing D1 vote state')
      return { votes: Number(state.votes), voted: Boolean(state.voted) }
    },
    async leaderboard() {
      // Read at most one small aggregate row per voted catalog track, never
      // scan the votes or visitor_counts tables to build a leaderboard.
      const result = await database.batch([
        database.prepare(
          'SELECT track_id AS trackId, votes FROM track_counts WHERE votes > 0 ORDER BY votes DESC, track_id ASC',
        ),
        database.prepare(
          'SELECT total_votes AS totalVotes, total_voters AS totalVoters FROM site_totals WHERE id = 1',
        ),
      ])
      const counts = rows(result[0]).map((row) => ({
        trackId: row.trackId,
        votes: Number(row.votes),
      }))
      const totals = rows(result[1])[0]
      if (!totals) throw new Error('Missing D1 totals; apply migrations first')
      return {
        entries: counts.slice(0, 10),
        counts: Object.fromEntries(counts.map((row) => [row.trackId, row.votes])),
        totalVotes: Number(totals.totalVotes),
        totalVoters: Number(totals.totalVoters),
      }
    },
  }
}

export function createVoteStore({ database, signingSecret } = {}) {
  if (!database || typeof database.prepare !== 'function' || typeof database.batch !== 'function')
    return Promise.reject(new Error('A D1 DB binding is required'))
  const existing = stores.get(database)
  if (existing && existing.signingSecret === signingSecret) return existing.promise
  const entry = { signingSecret, promise: undefined }
  // Cache before awaiting initialization so simultaneous first requests share
  // the same key import and INSERT/SELECT. Failed initialization can be retried.
  entry.promise = initialize(database, signingSecret).catch((error) => {
    if (stores.get(database) === entry) stores.delete(database)
    throw error
  })
  stores.set(database, entry)
  return entry.promise
}
