import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { preserveTrackIdentities } from '../scripts/catalog-identity.mjs'

const song = (id, appleTrackId, extra = {}) => ({
  id,
  appleTrackId,
  title: 'Same title',
  artist: 'ナナツカゼ',
  releaseDate: '2025-01-01',
  aliases: [],
  artistAliases: [],
  albumAliases: [],
  releases: [{ appleTrackId, appleCollectionId: 1 }],
  ...extra,
})

test('a preferred reissue retains the published voting ID and searchable aliases', () => {
  const old = song('apple-20', 20, { aliases: ['Published alias'] })
  const fresh = song('apple-10', 10, {
    aliases: ['Fresh alias'],
    releases: [{ appleTrackId: 10 }, { appleTrackId: 20 }],
  })
  const result = preserveTrackIdentities([fresh], [old])
  assert.equal(result.tracks[0].id, 'apple-20')
  assert.equal(result.tracks[0].appleTrackId, 10)
  assert.deepEqual(new Set(result.tracks[0].aliases), new Set(['Published alias', 'Fresh alias']))
  assert.equal(result.tracks[0].releases.length, 2)
  assert.deepEqual(result.retainedTrackIds, [])
})

test('a platform removal or incomplete response cannot delete a published vote key', () => {
  const old = song('apple-20', 20)
  const result = preserveTrackIdentities([song('apple-30', 30)], [old])
  assert.deepEqual(new Set(result.tracks.map(({ id }) => id)), new Set(['apple-20', 'apple-30']))
  assert.deepEqual(result.retainedTrackIds, ['apple-20'])
})

test('previously distinct vote keys cannot be silently merged or split', () => {
  const old = [song('apple-10', 10), song('apple-20', 20)]
  assert.throws(
    () =>
      preserveTrackIdentities(
        [song('apple-10', 10, { releases: [{ appleTrackId: 10 }, { appleTrackId: 20 }] })],
        old,
      ),
    /previously distinct voting IDs/,
  )
  assert.throws(
    () => preserveTrackIdentities([song('apple-10', 10), song('new-alias', 10)], [old[0]]),
    /split an existing voting ID/,
  )
})

test('same titles and durations do not merge independent vocal, Mixed, VIP or instrumental IDs', () => {
  const tracks = [
    song('apple-10', 10),
    song('apple-20', 20, { title: 'Same title (Instrumental)', kind: 'instrumental' }),
    song('apple-30', 30, { title: 'Same title [Mixed]', kind: 'alternate' }),
    song('apple-40', 40, { title: 'Same title (VIP)', kind: 'remix' }),
  ]
  assert.equal(preserveTrackIdentities(tracks, [tracks[0]]).tracks.length, 4)
})

const catalog = JSON.parse(
  await readFile(new URL('../public/data/catalog.json', import.meta.url), 'utf8'),
)
const originalIds = JSON.parse(
  await readFile(new URL('./fixtures/original-track-ids.json', import.meta.url), 'utf8'),
)

test('expanded public catalogue preserves every original voting ID', () => {
  const ids = new Set(catalog.tracks.map(({ id }) => id))
  assert.equal(originalIds.length, 139)
  for (const id of originalIds) assert.ok(ids.has(id), `Lost published vote key: ${id}`)
})

test('all 27 verified Apple group tracks are represented, with instrumentals kept separate', () => {
  const ids = [
    1694886463, 1734972655, 1860821681, 1685653199, 1746004147, 1718004168, 1726739248, 1785164254,
    1691532222, 6795407457, 1819934506, 1774674078, 6764007034, 1754755251, 1803336625, 1791916590,
    1761025462, 1832904320, 1870778908, 1887480436, 6790694376, 1851187199, 1768495251, 1887480437,
    6795407461, 6764007035, 6790694377,
  ]
  for (const id of ids) {
    const match = catalog.tracks.find((track) =>
      [
        track.appleTrackId,
        ...(track.releases || []).map((release) => release.appleTrackId),
      ].includes(id),
    )
    assert.ok(match, `Missing verified ナナツカゼ Apple track: ${id}`)
    assert.ok(match.projects.includes('ナナツカゼ'))
    assert.ok(match.tags.includes('collaboration'))
  }
  for (const id of [1887480437, 6795407461, 6764007035, 6790694377])
    assert.equal(catalog.tracks.find((track) => track.appleTrackId === id).kind, 'instrumental')
})

test('Ocean Lullaby retains its performing artists and official composer attribution', () => {
  const vocal = catalog.tracks.find((track) => track.appleTrackId === 6812580063)
  const instrumental = catalog.tracks.find((track) => track.appleTrackId === 6812580064)
  assert.ok(vocal)
  assert.ok(instrumental)
  assert.notEqual(vocal.id, instrumental.id)
  assert.match(vocal.title, /海奏ララバイ/)
  assert.match(vocal.artist, /初星学園/)
  assert.ok(!vocal.projects?.includes('ナナツカゼ'))
  assert.ok(
    vocal.creditSources.some(
      (source) =>
        source.url === 'https://gakuen-label.idolmaster-official.jp/discography/iik-p-jujn_u',
    ),
  )
  assert.ok(vocal.artistAliases.includes('PIKASONIC'))
  assert.equal(instrumental.kind, 'instrumental')
})

test('all nine reviewed standalone group instrumentals remain separate public records', () => {
  for (const id of [
    '4zEyJ2CgIBY',
    'j_ohYSNBqZA',
    'XB0d0BXqGp8',
    '2YrkJsR83S8',
    'tMUI0UcbSvg',
    '8xOtdRu2YsU',
    '6W-IBB3Gcm8',
    'MHZxhVJXhwo',
    '8KkObcvlolI',
  ]) {
    const track = catalog.tracks.find((entry) => entry.id === `youtube-${id}`)
    assert.ok(track, `Missing verified standalone instrumental: ${id}`)
    assert.equal(track.kind, 'instrumental')
    assert.ok(track.projects.includes('ナナツカゼ'))
    assert.ok(track.aliases.every((alias) => /instrumental/i.test(alias)))
    assert.equal(new URL(track.sourceUrl).searchParams.get('v'), id)
  }
})
