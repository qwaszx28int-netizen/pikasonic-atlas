/** Read public NetEase metadata only. Never fetch audio or lyrics. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const root = new URL('../', import.meta.url)
const ARTIST_ID = 13499634
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
const featureLabel = (value) => {
  const feature = value.match(/[([]\s*(?:feat\.?|ft\.?)\s*([^)[\]]+)/i)?.[1]
  if (!feature) return ''
  return normalize(feature)
    .replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/なこたんまる/g, 'nakotanmaru')
    .replace(/可不/g, 'kafu')
}

export function findNeteaseMatch(track, songs, hotIds = new Set()) {
  const titles = [track.title, ...(track.aliases || [])]
  const trackFeatures = new Set(titles.map(featureLabel).filter(Boolean))
  const candidates = [...songs.values()]
    .map((song) => {
      const variants = [song.name, ...(song.alias || [])]
      const songFeatures = new Set(variants.map(featureLabel).filter(Boolean))
      const compatibleFeatures =
        !trackFeatures.size ||
        !songFeatures.size ||
        [...trackFeatures].some((feature) => songFeatures.has(feature))
      const exact = titles.some((title) =>
        variants.some((variant) => normalize(title) === normalize(variant)),
      )
      const featuredMatch = titles.some((title) =>
        variants.some((variant) => {
          const a = featureLabel(title)
          const b = featureLabel(variant)
          // Explicitly different featured vocals are separate recordings.
          return (
            compatibleFeatures &&
            (!a || !b || a === b) &&
            stripFeature(title) === stripFeature(variant)
          )
        }),
      )
      const durationDifference = Math.abs((song.duration || 0) - (track.durationMs || 0))
      const match =
        (exact || featuredMatch) &&
        (!track.durationMs || !song.duration || durationDifference <= 3500)
      return { song, match, exact, durationDifference, hot: hotIds.has(song.id) }
    })
    .filter((candidate) => candidate.match)
    .sort(
      (a, b) =>
        Number(b.hot) - Number(a.hot) ||
        Number(b.exact) - Number(a.exact) ||
        a.durationDifference - b.durationDifference,
    )
  return candidates[0]
}

async function sync() {
  const catalog = JSON.parse(await readFile(new URL('public/data/catalog.json', root), 'utf8'))
  const songs = new Map()
  const hotSourceUrl = `https://music.163.com/api/artist/${ARTIST_ID}`
  const hotResponse = await fetch(hotSourceUrl, {
    headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(25000),
  })
  if (!hotResponse.ok)
    throw new Error(`NetEase artist HTTP ${hotResponse.status}; snapshot preserved`)
  const artistBody = await hotResponse.json()
  if (
    artistBody.code !== 200 ||
    artistBody.artist?.id !== ARTIST_ID ||
    normalize(artistBody.artist?.name || '') !== 'pikasonic' ||
    !Array.isArray(artistBody.hotSongs) ||
    artistBody.hotSongs.length < 10
  )
    throw new Error('NetEase artist/hot list could not be verified; snapshot preserved')
  const hotUpdatedAt = new Date().toISOString()
  const hotSongs = artistBody.hotSongs.map((song, index) => ({
    rank: index + 1,
    id: song.id,
    title: song.name,
    artist: (song.artists || []).map((artist) => artist.name).join(' / '),
    durationMs: song.duration || 0,
    popularity: song.popularity,
    score: song.score,
    url: `https://music.163.com/#/song?id=${song.id}`,
  }))
  if (hotSongs.some((song) => !Number.isSafeInteger(song.id) || song.id <= 0 || !song.title))
    throw new Error('Invalid NetEase hot-list metadata; snapshot preserved')
  const hotIds = new Set(hotSongs.map((song) => song.id))
  for (const song of artistBody.hotSongs) songs.set(song.id, song)
  const findMatch = (track) => findNeteaseMatch(track, songs, hotIds)
  console.log(
    `NetEase verified artist ${artistBody.artist.name}: ${hotSongs.length} hot songs in platform order`,
  )
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
      throw new Error(
        `NetEase search unavailable (code ${body.code}${body.message ? `: ${body.message}` : ''}); snapshot preserved`,
      )
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
      if (!response.ok || body.code !== 200 || !body.result)
        throw new Error(
          `NetEase title metadata unavailable (HTTP ${response.status}, code ${body.code})`,
        )
      for (const song of body.result?.songs || []) {
        if (
          song.artists?.some(
            (artist) => artist.id === ARTIST_ID || normalize(artist.name) === 'pikasonic',
          ) ||
          /pikasonic\s+(?:remix|vip)/i.test(song.name)
        )
          songs.set(song.id, song)
      }
    } catch (error) {
      throw new Error(
        `Title lookup unavailable for ${track.title}; snapshot preserved: ${error.message}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 350))
  }

  const matches = {}
  const hotRanks = {}
  const rankBySongId = new Map(hotSongs.map((song) => [song.id, song.rank]))
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
      const rank = rankBySongId.get(song.id)
      if (rank !== undefined) hotRanks[track.id] = rank
    }
  }
  if (songs.size < 30) throw new Error('Unexpectedly small NetEase result; snapshot preserved')
  const output = {
    updatedAt: new Date().toISOString(),
    artistId: ARTIST_ID,
    artistUrl: `https://music.163.com/#/artist?id=${ARTIST_ID}`,
    source: 'NetEase public song search metadata',
    hotUpdatedAt,
    hotSource: {
      name: 'NetEase public artist hotSongs order',
      url: hotSourceUrl,
      description:
        '热门顺序取自已核对的 PIKASONIC 艺人页 hotSongs 数组；popularity 和 score 为平台指标，不是播放次数。',
    },
    hotSongs,
    hotRanks,
    hotOrder: Object.keys(hotRanks).sort((a, b) => hotRanks[a] - hotRanks[b]),
    matching:
      'Exact title or catalog aliases + duration within 3.5 seconds; compatible featured-vocal suffixes may be omitted. Remix/VIP/Mixed/instrumental/version markers remain intact. Verified hot-list IDs take priority over duplicate reissues. No fuzzy guesses.',
    matchedCount: Object.keys(matches).length,
    unmatchedCount: catalog.tracks.length - Object.keys(matches).length,
    matches,
  }
  await mkdir(new URL('public/data/', root), { recursive: true })
  await writeFile(new URL('public/data/netease.json', root), `${JSON.stringify(output, null, 2)}\n`)
  console.log(
    `Saved ${output.matchedCount} direct NetEase matches; ${Object.keys(hotRanks).length} ranked catalogue tracks; ${output.unmatchedCount} use a clearly labelled search link.`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await sync()
