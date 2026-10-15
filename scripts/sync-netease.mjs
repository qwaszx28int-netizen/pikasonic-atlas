/** Read public NetEase metadata only. Never fetch audio or lyrics. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
const root = new URL('../', import.meta.url)
const catalog = JSON.parse(await readFile(new URL('public/data/catalog.json', root), 'utf8'))
const ARTIST_ID = 13499634
const songs = new Map()
const normalize = (value) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)\s*/g, ')')
    .replace(/\s+/g, ' ')
    .replace(/[！]/g, '!')
    .trim()
const stripFeature = (value) =>
  normalize(value)
    .replace(/\s*[([](?:feat\.?|ft\.?).*?[)\]]/gi, '')
    .trim()
let total = Infinity
for (let offset = 0; offset < Math.min(total, 1000); offset += 100) {
  const url = new URL('https://music.163.com/api/search/get/web')
  for (const [key, value] of Object.entries({
    s: 'PIKASONIC',
    type: 1,
    offset,
    total: true,
    limit: 100,
  }))
    url.searchParams.set(key, String(value))
  const response = await fetch(url, {
    headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(25000),
  })
  if (!response.ok) throw new Error(`NetEase HTTP ${response.status}; snapshot preserved`)
  const body = await response.json()
  if (body.code !== 200 || !body.result?.songs)
    throw new Error('NetEase search unavailable; snapshot preserved')
  total = body.result.songCount || body.result.songs.length
  for (const song of body.result.songs) {
    if (
      song.artists?.some(
        (artist) => artist.id === ARTIST_ID || normalize(artist.name) === 'pikasonic',
      ) ||
      /pikasonic\s+(?:remix|vip)/i.test(song.name)
    )
      songs.set(song.id, song)
  }
  console.log(
    `NetEase: ${offset + body.result.songs.length}/${total} search results; ${songs.size} relevant records`,
  )
  if (body.result.songs.length < 100) break
  await new Promise((resolve) => setTimeout(resolve, 500))
}
function findMatch(track) {
  const titles = [track.title, ...(track.aliases || [])]
  const candidates = [...songs.values()]
    .map((song) => {
      const variants = [song.name, ...(song.alias || [])]
      const exact = titles.some((title) =>
        variants.some((variant) => normalize(title) === normalize(variant)),
      )
      const featuredMatch = titles.some((title) =>
        variants.some((variant) => stripFeature(title) === stripFeature(variant)),
      )
      const durationDifference = Math.abs((song.duration || 0) - (track.durationMs || 0))
      // Variant markers remain intact. Only featured-vocal credits may be stripped.
      const match =
        (exact || featuredMatch) &&
        (!track.durationMs || !song.duration || durationDifference <= 3500)
      return { song, match, exact, durationDifference }
    })
    .filter((candidate) => candidate.match)
    .sort(
      (a, b) => Number(b.exact) - Number(a.exact) || a.durationDifference - b.durationDifference,
    )
  return candidates[0]
}

// A broad artist search can omit older or collaborator-owned releases. Retry
// only missing titles, retaining the exact-title/version/duration checks.
for (const track of catalog.tracks.filter((track) => !findMatch(track))) {
  const url = new URL('https://music.163.com/api/search/get/web')
  const title =
    (track.aliases || []).find((title) => !/[\u3040-\u30ff\u3400-\u9fff]/.test(title)) ||
    track.title
  for (const [key, value] of Object.entries({
    s: `${title} PIKASONIC`,
    type: 1,
    offset: 0,
    limit: 40,
  }))
    url.searchParams.set(key, String(value))
  try {
    const response = await fetch(url, {
      headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(12000),
    })
    const body = await response.json()
    for (const song of body.result?.songs || []) {
      if (
        song.artists?.some(
          (artist) => artist.id === ARTIST_ID || normalize(artist.name) === 'pikasonic',
        ) ||
        /pikasonic\s+(?:remix|vip)/i.test(song.name)
      )
        songs.set(song.id, song)
    }
  } catch {
    console.warn(`Title lookup unavailable: ${track.title}; using a search link if unmatched.`)
  }
  await new Promise((resolve) => setTimeout(resolve, 350))
}

const matches = {}
for (const track of catalog.tracks) {
  const candidate = findMatch(track)
  if (candidate) {
    const { song, exact } = candidate
    matches[track.id] = {
      id: song.id,
      title: song.name,
      artist: song.artists.map((artist) => artist.name).join(' / '),
      url: `https://music.163.com/#/song?id=${song.id}`,
      matchType: exact ? 'title-and-duration' : 'featured-title-and-duration',
    }
  }
}
if (songs.size < 30) throw new Error('Unexpectedly small NetEase result; snapshot preserved')
const output = {
  updatedAt: new Date().toISOString(),
  artistId: ARTIST_ID,
  artistUrl: `https://music.163.com/#/artist?id=${ARTIST_ID}`,
  source: 'NetEase public song search metadata',
  matching:
    'Exact title or catalog aliases + duration within 3.5 seconds; featured-vocal title suffix may be ignored. No fuzzy guesses.',
  matchedCount: Object.keys(matches).length,
  unmatchedCount: catalog.tracks.length - Object.keys(matches).length,
  matches,
}
await mkdir(new URL('public/data/', root), { recursive: true })
await writeFile(new URL('public/data/netease.json', root), `${JSON.stringify(output, null, 2)}\n`)
console.log(
  `Saved ${output.matchedCount} direct NetEase matches; ${output.unmatchedCount} use a clearly labelled search link.`,
)
