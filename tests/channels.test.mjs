import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { neteaseLink } from '../src/lib/netease.ts'
import { youtubeLink } from '../src/lib/youtube.ts'
import { genreInfo, genreLabel } from '../src/lib/genres.ts'

const read = async (name) =>
  JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'))
const [catalog, netease, youtube] = await Promise.all(['catalog', 'netease', 'youtube'].map(read))
const trackIds = new Set(catalog.tracks.map((track) => track.id))

test('every catalogue song has usable NetEase and YouTube destinations', () => {
  for (const track of catalog.tracks) {
    const neteaseDestination = neteaseLink(track, netease)
    const youtubeDestination = youtubeLink(track, youtube)
    assert.equal(new URL(neteaseDestination.url).hostname, 'music.163.com')
    assert.equal(new URL(youtubeDestination.url).hostname, 'www.youtube.com')
    for (const destination of [neteaseDestination, youtubeDestination])
      assert.equal(new URL(destination.url).protocol, 'https:')
    assert.ok(genreLabel(track).trim(), `${track.title}: missing genre state`)
  }
})

test('channel snapshots only associate known songs with real platform IDs', () => {
  for (const [id, match] of Object.entries(netease.matches)) {
    assert.ok(trackIds.has(id), id)
    assert.match(match.url, new RegExp(`^https://music\\.163\\.com/#/song\\?id=${match.id}$`))
    assert.ok(Number.isSafeInteger(match.id) && match.id > 0)
  }
  for (const [id, match] of Object.entries(youtube.matches)) {
    assert.ok(trackIds.has(id), id)
    assert.match(match.id, /^[\w-]{11}$/)
    assert.equal(new URL(match.url).searchParams.get('v'), match.id)
  }
})

test('unmatched songs use explicitly different search destinations without inventing IDs', () => {
  const track = { id: 'unknown', title: '夢 & Sky #1', artist: 'PIKASONIC', sourceUrl: '' }
  const n = neteaseLink(track)
  const y = youtubeLink(track)
  assert.equal(n.direct, false)
  assert.equal(y.direct, false)
  assert.ok(decodeURIComponent(n.url).includes('夢 & Sky #1'))
  assert.equal(new URL(y.url).searchParams.get('search_query'), 'PIKASONIC 夢 & Sky #1')
  assert.equal(
    neteaseLink(track, { matches: { unknown: { url: 'javascript:alert(1)' } } }).direct,
    false,
  )
  assert.equal(
    youtubeLink(track, { matches: { unknown: { url: 'https://example.com/not-a-video' } } }).direct,
    false,
  )
})

test('granular artist-supplied style keeps attribution and unknown genres stay explicit', () => {
  const basic = { genre: 'Electronic', sourceUrl: 'https://music.apple.com/test' }
  const detailed = {
    ...basic,
    genreDetails: [
      {
        genre: 'Future Bass',
        sourceName: 'SoundCloud',
        sourceUrl: 'https://soundcloud.com/pika5onic/test',
      },
    ],
  }
  assert.equal(genreLabel(basic), '电子音乐')
  assert.equal(genreLabel(detailed), 'Future Bass')
  assert.equal(genreInfo(detailed).sourceName, 'SoundCloud')
  assert.equal(genreLabel({ genre: '' }), '曲风待核实')
  assert.equal(genreLabel({ genre: 'Future bounce' }), genreLabel({ genre: 'Future Bounce' }))
})
