import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { neteaseRanks } from '../src/lib/netease.ts'
import { findNeteaseMatch } from '../scripts/sync-netease.mjs'

const track = { id: 'song', title: 'Infinity', durationMs: 180000 }
const song = (id, name, duration = 180000, alias = []) => ({ id, name, duration, alias })
const pool = (...songs) => new Map(songs.map((entry) => [entry.id, entry]))

test('verified hot IDs take priority over duplicate reissues after title and duration checks', () => {
  const selected = findNeteaseMatch(
    track,
    pool(song(100, 'Infinity'), song(200, 'Infinity', 180150)),
    new Set([200]),
  )
  assert.equal(selected.song.id, 200)
  assert.equal(
    findNeteaseMatch(
      track,
      pool(song(100, 'Infinity'), song(200, 'Infinity', 195000)),
      new Set([200]),
    ).song.id,
    100,
  )
})

test('hot status never crosses remix, VIP, Mixed, instrumental or vocal-version boundaries', () => {
  for (const version of [
    'PIKASONIC Remix',
    'PIKASONIC VIP',
    'Mixed',
    'Instrumental',
    'nakotanmaru ver.',
  ]) {
    const selected = findNeteaseMatch(track, pool(song(1, `Infinity (${version})`)), new Set([1]))
    assert.equal(selected, undefined, version)
  }
  assert.equal(
    findNeteaseMatch(
      { ...track, title: 'Dream Eater (feat. KAFU)', aliases: ['Dream Eater'] },
      pool(song(1, 'Dream Eater (feat. nakotanmaru)')),
      new Set([1]),
    ),
    undefined,
  )
})

test('catalogue aliases and compatible feature suffixes still match exact recordings', () => {
  assert.equal(
    findNeteaseMatch(
      { ...track, title: '朧月夜', aliases: ['Hazy Moon Night'] },
      pool(song(1, 'Hazy Moon Night')),
    ).song.id,
    1,
  )
  assert.equal(
    findNeteaseMatch(
      { ...track, title: 'Dream Eater (feat. 可不)' },
      pool(song(1, 'Dream Eater (ft. KAFU)')),
    ).song.id,
    1,
  )
})

test('same-title group songs cannot cross-match unrelated artist recordings', () => {
  const group = { ...track, artist: 'ナナツカゼ' }
  const unrelated = { ...song(1, 'Infinity'), artists: [{ id: 999, name: 'Another Artist' }] }
  const verified = { ...song(2, 'Infinity'), artists: [{ id: 56672609, name: 'ナナツカゼ' }] }
  const pika = { ...song(3, 'Infinity'), artists: [{ id: 13499634, name: 'PIKASONIC' }] }
  assert.equal(findNeteaseMatch(group, pool(unrelated)), undefined)
  assert.equal(findNeteaseMatch(group, pool(pika)), undefined)
  assert.equal(findNeteaseMatch(group, pool(unrelated, verified, pika)).song.id, 2)
  assert.equal(findNeteaseMatch({ ...track, artist: 'PIKASONIC' }, pool(verified)), undefined)
})

test('rank lookup handles older snapshots and uses one-based platform positions', () => {
  assert.deepEqual(neteaseRanks(), {})
  assert.deepEqual(neteaseRanks({ matches: {} }), {})
  assert.deepEqual(
    neteaseRanks({
      matches: {},
      hotRanks: { song: 4, invalid: 0, fractional: 1.2, nonfinite: Infinity },
    }),
    { song: 4 },
  )
  assert.deepEqual(
    neteaseRanks({
      matches: { original: { id: 2 }, reissue: { id: 3 } },
      hotSongs: [
        { id: 2, rank: 7 },
        { id: 3, rank: 11 },
      ],
    }),
    { original: 7, reissue: 11 },
  )
})

test('saved hot-list order and catalogue ranks retain the actual platform source', async () => {
  const snapshot = JSON.parse(
    await readFile(new URL('../public/data/netease.json', import.meta.url), 'utf8'),
  )
  assert.equal(snapshot.hotSource.url, 'https://music.163.com/api/artist/13499634')
  assert.ok(Number.isFinite(Date.parse(snapshot.hotUpdatedAt)))
  assert.ok(snapshot.hotSongs.length >= 10)
  const rankById = new Map(
    snapshot.hotSongs.map((entry, index) => {
      assert.equal(entry.rank, index + 1)
      assert.ok(Number.isSafeInteger(entry.id) && entry.id > 0)
      assert.ok(entry.title)
      assert.equal(entry.playCount, undefined)
      return [entry.id, entry.rank]
    }),
  )
  for (const [trackId, rank] of Object.entries(neteaseRanks(snapshot)))
    assert.equal(rank, rankById.get(snapshot.matches[trackId].id), trackId)
  assert.deepEqual(
    snapshot.hotOrder,
    Object.keys(snapshot.hotRanks).sort((a, b) => snapshot.hotRanks[a] - snapshot.hotRanks[b]),
  )
})

test('an unavailable artist endpoint leaves the existing verified snapshot untouched', async () => {
  const snapshotUrl = new URL('../public/data/netease.json', import.meta.url)
  const before = await readFile(snapshotUrl, 'utf8')
  const scriptUrl = new URL('../scripts/sync-netease.mjs', import.meta.url)
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `globalThis.fetch = async () => ({ ok: false, status: 503 }); process.argv[1] = ${JSON.stringify(fileURLToPath(scriptUrl))}; await import(${JSON.stringify(scriptUrl.href)});`,
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /snapshot preserved/)
  assert.equal(await readFile(snapshotUrl, 'utf8'), before)
})
