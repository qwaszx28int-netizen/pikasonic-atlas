import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  filterTracks,
  formatDate,
  formatDuration,
  isCollaboration,
  isRemix,
  normalize,
  safeExternalUrl,
} from '../src/lib/catalog.ts'

function track(overrides = {}) {
  return {
    id: 'example',
    title: 'Sky',
    artist: 'PIKASONIC',
    album: 'Sky - Single',
    releaseDate: '2024-01-02',
    durationMs: 184000,
    genre: 'Electronic',
    artworkUrl: 'https://example.com/cover.jpg',
    sourceUrl: 'https://example.com/sky',
    ...overrides,
  }
}

const ids = (tracks) => tracks.map(({ id }) => id)

test('search normalizes case, full-width characters, and surrounding whitespace', () => {
  assert.equal(normalize('  ＰＩＫＡＳＯＮＩＣ  '), 'pikasonic')
  const songs = [track(), track({ id: 'other', artist: 'Another Artist' })]
  assert.deepEqual(ids(filterTracks(songs, { query: '  ＰＩＫＡＳＯＮＩＣ sky  ' })), ['example'])
})

test('search terms can span fields and every term must match', () => {
  const songs = [track(), track({ id: 'other', genre: 'Jazz' })]
  assert.deepEqual(ids(filterTracks(songs, { query: 'PIKASONIC Electronic' })), ['example'])
  assert.deepEqual(filterTracks(songs, { query: 'Sky missing-word' }), [])
})

test('search finds alternate titles, artist names, and release names', () => {
  const song = track({
    title: '夢重力',
    artist: 'ナナツカゼ, PIKASONIC & なこたんまる',
    album: '夢重力 - Single',
    aliases: ['Dream Gravity'],
    artistAliases: ['Nanatsukaze, PIKASONIC & nakotanmaru'],
    albumAliases: ['Alternate Collection'],
  })
  for (const query of [
    'Dream Gravity',
    'Nanatsukaze',
    'Alternate Collection',
    'gravity nakotanmaru',
  ]) {
    assert.deepEqual(
      ids(filterTracks([song], { query })),
      ['example'],
      `Missing alias search: ${query}`,
    )
  }
  assert.deepEqual(filterTracks([song], { query: 'not-an-alias' }), [])
})

test('empty queries preserve the available catalogue', () => {
  const songs = [track(), track({ id: 'other' })]
  assert.equal(filterTracks(songs, { query: ' \t\n ' }).length, songs.length)
  assert.deepEqual(filterTracks([], { query: 'PIKASONIC' }), [])
})

test('group filter includes credited group releases without including its separate production work', () => {
  const songs = [
    track({ id: 'group', artist: 'ナナツカゼ' }),
    track({ id: 'collaboration', artist: 'Nanatsukaze, PIKASONIC & nakotanmaru' }),
    track({ id: 'production', artist: '初星学園 & 秦谷美鈴', artistAliases: ['PIKASONIC'] }),
    track({ id: 'solo' }),
  ]
  assert.deepEqual(
    new Set(ids(filterTracks(songs, { category: 'nanatsukaze' }))),
    new Set(['group', 'collaboration']),
  )
})

test('collaboration classification recognizes platform separators and featured credits', () => {
  for (const artist of [
    'PIKASONIC & RoaNn',
    'PIKASONIC, iMeiden & 小花依ある',
    '電音部、PIKASONIC、nakotanmaru',
    'PIKASONIC × Another Artist',
    'PIKASONIC feat. Another Artist',
  ])
    assert.equal(isCollaboration(track({ artist })), true, artist)

  assert.equal(isCollaboration(track({ title: 'Lost My Mind (feat. nakotanmaru)' })), true)
  assert.equal(isCollaboration(track()), false)
})

test('remix classification preserves explicit version metadata and does not match word fragments', () => {
  assert.equal(isRemix(track({ title: 'Lockdown (PIKASONIC VIP)', kind: 'remix' })), true)
  assert.equal(isRemix(track({ title: 'A Song [PIKASONIC Remix]' })), true)
  assert.equal(isRemix(track({ title: 'Credit', album: 'Credit - Single' })), false)
  assert.equal(isRemix(track()), false)
})

test('year, category, query, and saved-song filters combine without broadening results', () => {
  const songs = [
    track({ id: 'wanted', artist: 'PIKASONIC & RoaNn' }),
    track({ id: 'not-saved', artist: 'PIKASONIC & RoaNn' }),
    track({ id: 'wrong-year', artist: 'PIKASONIC & RoaNn', releaseDate: '2023-01-02' }),
    track({ id: 'solo' }),
  ]
  assert.deepEqual(
    ids(
      filterTracks(songs, {
        query: 'sky',
        category: 'collab',
        year: '2024',
        favorites: new Set(['wanted', 'wrong-year', 'solo']),
      }),
    ),
    ['wanted'],
  )
  assert.deepEqual(ids(filterTracks(songs, { category: 'solo' })), ['solo'])
  assert.deepEqual(filterTracks(songs, { favorites: new Set() }), [])
})

test('remix filtering includes VIP records', () => {
  const songs = [track(), track({ id: 'vip', title: 'Lockdown (PIKASONIC VIP)', kind: 'remix' })]
  assert.deepEqual(ids(filterTracks(songs, { category: 'remix' })), ['vip'])
})

test('sorting respects chronology and never mutates the supplied array', () => {
  const songs = Object.freeze([
    track({ id: 'old', title: 'Track 2', releaseDate: '2020-01-01' }),
    track({ id: 'new', title: 'Track 10', releaseDate: '2025-01-01' }),
  ])
  assert.deepEqual(ids(filterTracks(songs)), ['new', 'old'])
  assert.deepEqual(ids(filterTracks(songs, { sort: 'oldest' })), ['old', 'new'])
  assert.deepEqual(ids(filterTracks(songs, { sort: 'title' })), ['old', 'new'])
  assert.deepEqual(ids(songs), ['old', 'new'])
})

test('records with unknown release dates remain browsable but do not match a known year', () => {
  const unknown = track({ id: 'unknown', releaseDate: '' })
  const songs = [unknown, track()]
  assert.deepEqual(new Set(ids(filterTracks(songs))), new Set(['unknown', 'example']))
  assert.deepEqual(ids(filterTracks(songs, { year: '2024' })), ['example'])
  assert.equal(formatDate(unknown.releaseDate), '日期待核实')
})

test('NetEase ordering respects platform ranks and preserves filters and other sorts', () => {
  const songs = Object.freeze([
    track({ id: 'new-unranked', title: 'A', releaseDate: '2026-01-01' }),
    track({ id: 'second', title: 'B', releaseDate: '2024-01-01' }),
    track({ id: 'first', title: 'C', releaseDate: '2023-01-01' }),
    track({ id: 'old-unranked', title: 'D', releaseDate: '2020-01-01' }),
  ])
  const hotRanks = { first: 1, second: 2 }
  assert.deepEqual(ids(filterTracks(songs, { sort: 'netease', hotRanks })), [
    'first',
    'second',
    'new-unranked',
    'old-unranked',
  ])
  assert.deepEqual(ids(filterTracks(songs, { sort: 'netease', hotRanks, year: '2024' })), [
    'second',
  ])
  assert.deepEqual(ids(filterTracks(songs, { sort: 'newest', hotRanks })), ids(songs))
  assert.deepEqual(ids(filterTracks(songs, { sort: 'title', hotRanks })), ids(songs))
  assert.deepEqual(ids(filterTracks(songs, { sort: 'netease' })), ids(songs))
  assert.deepEqual(ids(songs), ['new-unranked', 'second', 'first', 'old-unranked'])
})

test('duration formatting keeps minute boundaries and handles missing durations', () => {
  assert.equal(formatDuration(59999), '0:59')
  assert.equal(formatDuration(60000), '1:00')
  assert.equal(formatDuration(184999), '3:04')
  assert.equal(formatDuration(0), '—')
  assert.equal(formatDuration(-1), '—')
})

test('date formatting preserves source dates and marks unverified dates', () => {
  assert.equal(formatDate('2024-01-02'), '2024.01.02')
  assert.equal(formatDate('2024-01-02T00:00:00Z'), '2024.01.02')
  assert.equal(formatDate(''), '日期待核实')
})

test('external links allow HTTPS and reject executable, insecure, and malformed URLs', () => {
  assert.equal(
    safeExternalUrl('https://music.apple.com/jp/album/sky/123?i=456'),
    'https://music.apple.com/jp/album/sky/123?i=456',
  )
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,test',
    'http://example.com',
    '//example.com',
    'invalid',
    '',
  ]) {
    assert.equal(safeExternalUrl(url), undefined, url)
  }
})

test('listening guides expose catalogue facts and keep unknown dates explicit', async () => {
  const { getGuide } = await import('../src/lib/guides.ts')
  const guide = getGuide(track({ title: 'Rebirth' }))
  assert.match(guide.intro, /PIKASONIC/)
  assert.match(guide.intro, /Sky - Single/)
  assert.match(guide.intro, /2024\.01\.02/)
  assert.match(guide.titleNote, /重生/)
  assert.ok(guide.questions.length > 0)
  assert.ok(guide.questions.every((question) => typeof question === 'string' && question.trim()))
  const unknownGuide = getGuide(track({ releaseDate: '' }))
  assert.match(unknownGuide.intro, /日期待核实|尚未核实.*日期/)
  assert.doesNotMatch(unknownGuide.intro, /1970|undefined|NaN/)
})

const catalogue = JSON.parse(
  await readFile(new URL('../public/data/catalog.json', import.meta.url), 'utf8'),
)

test('committed catalogue has unique stable IDs and reconciled summary counts', () => {
  assert.ok(catalogue.tracks.length > 0)
  const trackIds = catalogue.tracks.map(({ id }) => id)
  assert.equal(new Set(trackIds).size, trackIds.length)
  assert.ok(trackIds.every((id) => typeof id === 'string' && id.trim()))
  assert.equal(catalogue.stats.trackCount, catalogue.tracks.length)
  assert.ok(Number.isFinite(Date.parse(catalogue.updatedAt)))
  assert.ok(catalogue.coverage.limitations.length > 0)
})

test('committed catalogue contains usable core metadata and valid optional dates', () => {
  for (const song of catalogue.tracks) {
    for (const key of ['title', 'artist', 'album']) {
      assert.ok(typeof song[key] === 'string' && song[key].trim(), `${song.id}: missing ${key}`)
    }
    assert.ok(
      Number.isFinite(song.durationMs) && song.durationMs >= 0,
      `${song.id}: invalid duration`,
    )
    if (song.releaseDate) {
      assert.match(song.releaseDate, /^\d{4}-\d{2}-\d{2}$/, song.id)
      const parsed = new Date(song.releaseDate)
      assert.ok(Number.isFinite(parsed.valueOf()), `${song.id}: invalid date`)
      assert.equal(
        parsed.toISOString().slice(0, 10),
        song.releaseDate,
        `${song.id}: invalid calendar date`,
      )
    }
    for (const key of ['aliases', 'artistAliases', 'albumAliases']) {
      if (song[key] !== undefined)
        assert.ok(
          Array.isArray(song[key]) &&
            song[key].every((alias) => typeof alias === 'string' && alias.trim()),
          `${song.id}: invalid ${key}`,
        )
    }
  }
})

test('sources and remote artwork use HTTPS, with source attribution matching the linked service', () => {
  for (const source of catalogue.sources) {
    assert.ok(typeof source.name === 'string' && source.name.trim())
    assert.equal(new URL(source.url).protocol, 'https:', source.name)
  }
  for (const song of catalogue.tracks) {
    const source = new URL(song.sourceUrl)
    assert.equal(source.protocol, 'https:', `${song.id}: source`)
    if (song.artworkUrl)
      assert.equal(new URL(song.artworkUrl).protocol, 'https:', `${song.id}: cover`)

    if (song.appleTrackId) {
      assert.equal(source.hostname, 'music.apple.com', `${song.id}: Apple source mismatch`)
      assert.equal(
        source.searchParams.get('i'),
        String(song.appleTrackId),
        `${song.id}: Apple track ID mismatch`,
      )
    } else {
      assert.ok(
        typeof song.sourceName === 'string' && song.sourceName.trim(),
        `${song.id}: third-party source needs attribution`,
      )
      if (/soundcloud/i.test(song.sourceName))
        assert.ok(
          /(^|\.)soundcloud\.com$/.test(source.hostname),
          `${song.id}: SoundCloud source mismatch`,
        )
    }
  }
})

test('real catalogue alternate titles remain discoverable', () => {
  for (const song of catalogue.tracks) {
    for (const alias of song.aliases || []) {
      assert.ok(
        filterTracks([song], { query: alias }).length === 1,
        `${song.id}: title alias ${alias}`,
      )
    }
  }
})
