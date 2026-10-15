/**
 * Refresh the PIKASONIC catalogue from Apple's public iTunes Search API.
 * Run: node scripts/sync-catalog.mjs
 * No audio, lyrics or artwork files are downloaded. Artwork remains a remote URL.
 * API reference: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const OUTPUT = path.join(ROOT, 'public', 'data', 'catalog.json')
if (process.argv.includes('--merge-independent')) {
  const catalog = JSON.parse(await readFile(OUTPUT, 'utf8'))
  const supplemental = JSON.parse(
    await readFile(path.join(ROOT, 'public/data/supplemental.json'), 'utf8'),
  )
  const merged = mergeIndependent(
    catalog.tracks.filter((track) => track.appleTrackId),
    supplemental,
  )
  catalog.tracks = merged.tracks
  catalog.updatedAt = new Date().toISOString()
  Object.assign(catalog.stats, {
    trackCount: merged.tracks.length,
    independentAdded: merged.added,
    independentMatched: merged.matched,
    earliestRelease: merged.tracks.filter((track) => track.releaseDate).at(-1)?.releaseDate,
    latestRelease: merged.tracks[0]?.releaseDate,
  })
  catalog.coverage.independentUpdatedAt = supplemental.updatedAt
  catalog.coverage.independentProblems = supplemental.problems
  catalog.coverage.scope =
    'Apple 公开署名发行、合作曲和混音版本，并补充官方 SoundCloud 与 YouTube 可核对的独立作品及不同版本。'
  catalog.sources = [
    ...catalog.sources.filter((source) => !['SoundCloud', 'YouTube'].includes(source.name)),
    ...supplemental.sources.map((source) => ({
      name: source.name,
      url: source.url,
      description: source.access,
    })),
  ]
  await writeFile(OUTPUT, `${JSON.stringify(catalog, null, 2)}\n`)
  console.log(
    `Merged independent metadata: ${merged.tracks.length} tracks; ${merged.added} added, ${merged.matched} matched.`,
  )
  process.exit(0)
}
const ARTIST_ID = 1450218337
// Apple lists the Chinese-language collaboration on a separate namesake artist
// page. Keep that identity explicit rather than silently treating it as the main ID.
const ALTERNATE_ARTIST_ID = 1738111555
const STORES = ['us', 'jp']
const REQUEST_GAP_MS = Number(process.env.CATALOG_REQUEST_GAP_MS || 3100)
const requests = []
const failures = []
let lastRequestAt = 0
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function query(params) {
  const url = new URL(
    params.term ? 'https://itunes.apple.com/search' : 'https://itunes.apple.com/lookup',
  )
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await delay(Math.max(0, REQUEST_GAP_MS - (Date.now() - lastRequestAt)))
    lastRequestAt = Date.now()
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30000),
        headers: { 'User-Agent': 'PikasonicArchive/1.0 (noncommercial metadata catalogue)' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      if (!Array.isArray(body.results)) throw new Error('Unexpected API response')
      requests.push({ url: url.href, resultCount: body.resultCount })
      console.log(
        `${params.country}: ${params.entity} ${params.id || params.term} → ${body.resultCount}`,
      )
      return body.results
    } catch (error) {
      if (attempt === 3) {
        failures.push({ url: url.href, message: error.message })
        throw new Error(
          `Catalogue sync stopped to preserve the existing snapshot: ${url.href}: ${error.message}`,
        )
      }
      await delay((attempt + 1) * 4000)
    }
  }
}

const observations = new Map()
const collections = new Map()
const artistLookupTrackIds = new Set()

function addResults(results, store, fromArtistLookup = false) {
  for (const row of results) {
    if (row.wrapperType === 'collection') {
      const key = `${store}:${row.collectionId}`
      collections.set(key, row)
    }
    if (row.wrapperType === 'track' && row.kind === 'song' && row.trackId) {
      if (fromArtistLookup) artistLookupTrackIds.add(row.trackId)
      observations.set(`${store}:${row.trackId}`, { ...row, store })
    }
  }
}

for (const store of STORES) {
  for (const id of [ARTIST_ID, ALTERNATE_ARTIST_ID]) {
    addResults(await query({ id, entity: 'song', limit: 200, country: store }), store, true)
    addResults(await query({ id, entity: 'album', limit: 200, country: store }), store)
  }
  // Search discovers compilation appearances and remixes credited under another artist.
  for (const term of ['PIKASONIC', 'PIKASONIC Remix']) {
    addResults(await query({ term, entity: 'song', limit: 200, country: store }), store)
  }
}

function isRelevant(row) {
  if (artistLookupTrackIds.has(row.trackId)) return true
  if (/\bpikasonic\b/i.test(row.artistName || '')) return true
  // Do not accept an unrelated song merely because its title contains "PikaSonic".
  return /(?:feat\.?[^)]*\bpikasonic\b|\bpikasonic\s+(?:remix|vip))/i.test(row.trackName || '')
}

// Search results can expose albums that the artist's album endpoint omits.
for (const row of observations.values()) {
  if (isRelevant(row) && row.collectionId && !collections.has(`${row.store}:${row.collectionId}`)) {
    collections.set(`${row.store}:${row.collectionId}`, {
      collectionId: row.collectionId,
      store: row.store,
    })
  }
}

// One store suffices to expand a release's full track list; JP is preferred for
// Japanese titles. Existing US observations are kept as searchable aliases.
const releaseStores = new Map()
for (const [key, collection] of collections) {
  const store = key.split(':')[0]
  if (!releaseStores.has(collection.collectionId) || store === 'jp')
    releaseStores.set(collection.collectionId, store)
}
for (const store of STORES) {
  const ids = [...releaseStores].filter(([, region]) => region === store).map(([id]) => id)
  // Five album IDs per request stays below the API's 200-item response cap for
  // the current releases while avoiding a request for every single.
  for (let i = 0; i < ids.length; i += 5) {
    const batch = ids.slice(i, i + 5)
    const rows = await query({ id: batch.join(','), entity: 'song', limit: 200, country: store })
    addResults(rows, store)
    // If a large compilation reaches the cap, request each release separately.
    if (rows.length >= 200 && batch.length > 1) {
      for (const id of batch)
        addResults(await query({ id, entity: 'song', limit: 200, country: store }), store)
    }
  }
}

const byAppleId = new Map()
for (const row of observations.values()) {
  if (!isRelevant(row)) continue
  if (!byAppleId.has(row.trackId)) byAppleId.set(row.trackId, [])
  byAppleId.get(row.trackId).push(row)
}

const normalize = (text) =>
  String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
const artistKey = (text) =>
  normalize(text)
    .split(/\s*(?:&|、|,|\band\b)\s*/)
    .sort()
    .join('|')
const artwork = (url) =>
  (url || '').replace(/\/\d+x\d+bb(?:-\d+)?\.(?:jpg|png)(?:\?.*)?$/, '/600x600bb.jpg')
const records = []
for (const [appleTrackId, rows] of byAppleId) {
  const preferred = rows.find((row) => row.store === 'jp') || rows[0]
  const english = rows.find((row) => row.store === 'us') || preferred
  const collection = collections.get(`${preferred.store}:${preferred.collectionId}`) || {}
  const aliases = [...new Set(rows.map((row) => row.trackName))]
  const release = {
    appleTrackId,
    appleCollectionId: preferred.collectionId,
    title: preferred.collectionName,
    releaseDate: preferred.releaseDate?.slice(0, 10) || null,
    sourceUrl: preferred.trackViewUrl || preferred.collectionViewUrl,
    artworkUrl: artwork(preferred.artworkUrl100 || collection.artworkUrl100),
    copyright: collection.copyright || null,
  }
  records.push({
    appleTrackId,
    title: preferred.trackName,
    artist: preferred.artistName,
    album: preferred.collectionName,
    releaseDate: preferred.releaseDate?.slice(0, 10) || null,
    durationMs: preferred.trackTimeMillis || 0,
    genre: english.primaryGenreName || preferred.primaryGenreName || 'Electronic',
    artworkUrl: release.artworkUrl,
    sourceUrl: release.sourceUrl,
    appleCollectionId: preferred.collectionId,
    aliases,
    artistAliases: [...new Set(rows.map((row) => row.artistName))],
    albumAliases: [...new Set(rows.map((row) => row.collectionName))],
    stores: [...new Set(rows.map((row) => row.store))],
    alternateArtistPage: rows.some((row) => row.artistId === ALTERNATE_ARTIST_ID),
    releases: [release],
    comparisonTitle: normalize(english.trackName),
    comparisonArtist: artistKey(english.artistName),
  })
}

// Merge duplicate release appearances only when their English metadata and
// artist credits agree and their running times differ by at most one second.
// Remixes, VIPs, instrumentals and materially different durations remain separate.
records.sort(
  (a, b) =>
    (a.releaseDate || '').localeCompare(b.releaseDate || '') || a.appleTrackId - b.appleTrackId,
)
const tracks = []
for (const record of records) {
  const duplicate = tracks.find(
    (track) =>
      track.comparisonTitle === record.comparisonTitle &&
      track.comparisonArtist === record.comparisonArtist &&
      Math.abs(track.durationMs - record.durationMs) <= 1000,
  )
  if (duplicate) {
    duplicate.releases.push(...record.releases)
    for (const key of ['aliases', 'artistAliases', 'albumAliases', 'stores'])
      duplicate[key] = [...new Set([...duplicate[key], ...record[key]])]
  } else tracks.push(record)
}

for (const track of tracks) {
  track.id = `apple-${track.appleTrackId}`
  const versionText = `${track.title} ${track.aliases.join(' ')}`
  track.kind = /remix|vip/i.test(versionText)
    ? 'remix'
    : /instrumental/i.test(versionText)
      ? 'instrumental'
      : /version|edition|acappella|mixed/i.test(versionText)
        ? 'alternate'
        : 'original'
  track.tags = [track.genre]
  if (track.kind !== 'original') track.tags.push(track.kind)
  if (/&|、|,/.test(track.artist) || /feat\./i.test(track.title)) track.tags.push('collaboration')
  delete track.comparisonTitle
  delete track.comparisonArtist
}
tracks.sort(
  (a, b) =>
    (b.releaseDate || '').localeCompare(a.releaseDate || '') ||
    a.title.localeCompare(b.title, 'ja'),
)

let independentSnapshot = null
try {
  independentSnapshot = JSON.parse(
    await readFile(path.join(ROOT, 'public/data/supplemental.json'), 'utf8'),
  )
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
function mergeIndependent(baseTracks, snapshot) {
  const result = [...baseTracks]
  let added = 0
  let matched = 0
  const exactTitle = (title) =>
    String(title || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/【[^】]*】|\[(?:megarex release|official[^\]]*)\]/gi, '')
      .replace(/ft\.?/g, 'feat')
      .replace(/[^\p{L}\p{N}]/gu, '')
  const coreTitle = (title) =>
    exactTitle(
      String(title || '')
        .replace(/(?:\(|\[)?(?:feat\.?|ft\.?|w\/)\s*[^)\]]*(?:\)|\])?/gi, '')
        .replace(/\(hatsune miku\)/gi, ''),
    )
  for (const track of result) {
    track.sourceName ||= 'Apple Music'
    track.externalSources = (track.externalSources || []).filter(
      (source) => !['SoundCloud', 'YouTube'].includes(source.name),
    )
    track.genreDetails = track.genre
      ? [{ genre: track.genre, sourceName: 'Apple Music', sourceUrl: track.sourceUrl }]
      : []
  }
  for (const independent of snapshot?.tracks || []) {
    const titles = [independent.title, ...(independent.aliases || [])]
    const exactNames = titles.map(exactTitle)
    const coreNames = titles.map(coreTitle)
    const eligible = result.filter(
      (track) => Math.abs(track.durationMs - independent.durationMs) <= 2500,
    )
    let candidates = eligible.filter((track) =>
      [track.title, ...(track.aliases || [])].some((title) =>
        exactNames.includes(exactTitle(title)),
      ),
    )
    if (!candidates.length)
      candidates = eligible.filter((track) =>
        [track.title, ...(track.aliases || [])].some((title) =>
          coreNames.includes(coreTitle(title)),
        ),
      )
    candidates.sort(
      (a, b) =>
        Math.abs(a.durationMs - independent.durationMs) -
        Math.abs(b.durationMs - independent.durationMs),
    )
    const nearestIsDistinct =
      candidates.length > 1 &&
      Math.abs(candidates[0].durationMs - independent.durationMs) < 500 &&
      Math.abs(candidates[1].durationMs - independent.durationMs) > 1500
    const match = candidates.length === 1 || nearestIsDistinct ? candidates[0] : null
    if (match) {
      match.externalSources ||= []
      match.externalSources.push({
        name: independent.sourceName,
        url: independent.sourceUrl,
        title: independent.title,
        uploadDate: independent.releaseDate,
      })
      match.aliases = [...new Set([...match.aliases, independent.title, ...independent.aliases])]
      if (independent.genre)
        match.genreDetails.push({
          genre: independent.genre,
          sourceName: independent.sourceName,
          sourceUrl: independent.sourceUrl,
        })
      matched += 1
    } else {
      result.push({
        ...independent,
        genreDetails: independent.genre
          ? [
              {
                genre: independent.genre,
                sourceName: independent.sourceName,
                sourceUrl: independent.sourceUrl,
              },
            ]
          : [],
      })
      added += 1
    }
  }
  result.sort(
    (a, b) =>
      (b.releaseDate || '').localeCompare(a.releaseDate || '') ||
      a.title.localeCompare(b.title, 'ja'),
  )
  return { tracks: result, added, matched }
}
const independentMerge = mergeIndependent(tracks, independentSnapshot)
tracks.splice(0, tracks.length, ...independentMerge.tracks)
const independentAdded = independentMerge.added
const independentMatched = independentMerge.matched

if (tracks.length < 100)
  throw new Error(
    `Refusing to overwrite snapshot with unexpectedly small catalogue (${tracks.length} tracks).`,
  )
if (tracks.some((track) => !track.title || !track.artist || !track.sourceUrl || !track.artworkUrl))
  throw new Error('A track is missing required attribution metadata.')

const catalog = {
  schemaVersion: 1,
  updatedAt: new Date().toISOString(),
  artist: {
    name: 'PIKASONIC',
    appleArtistId: ARTIST_ID,
    appleArtistUrl: `https://music.apple.com/jp/artist/pikasonic/${ARTIST_ID}`,
    alternateAppleArtistId: ALTERNATE_ARTIST_ID,
    musicBrainzId: '81ce14d7-f806-4015-ab6c-84d081991c3f',
    links: {
      youtube: 'https://www.youtube.com/channel/UC2ne9XqtBWKJKLfIAKtmjAg',
      soundcloud: 'https://soundcloud.com/pika5onic',
      bandcamp: 'https://pikasonicofc.bandcamp.com/',
      spotify: 'https://open.spotify.com/artist/2hfoi6OmVRrLmZG1huaD1e',
    },
  },
  sources: [
    {
      name: 'Apple iTunes Search API / Apple Music',
      url: `https://music.apple.com/jp/artist/pikasonic/${ARTIST_ID}`,
      description: '曲名、艺人、发行日期、时长、流派、封面 URL 与发行页链接。',
    },
    {
      name: 'iTunes Search API documentation',
      url: 'https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/',
      description: '同步接口和展示规范参考。',
    },
    {
      name: 'MusicBrainz artist relationships',
      url: 'https://musicbrainz.org/artist/81ce14d7-f806-4015-ab6c-84d081991c3f',
      description: '用于核对艺人身份与公开频道链接；不是曲目数量的来源。',
    },
    ...(independentSnapshot?.sources || []).map((source) => ({
      name: source.name,
      url: source.url,
      description: source.access,
    })),
  ],
  coverage: {
    regions: STORES,
    approach:
      '合并 Apple 美区、日区艺人曲目与发行目录，检索合作曲和署名混音，再展开全部发现的发行曲目。相同发行 ID 的多语言曲名作为搜索别名；同名、同署名且时长相近的重复发行合并。',
    scope:
      'Apple 公开署名发行、合作曲和混音版本，并补充官方 SoundCloud 与 YouTube 可核对的独立作品及不同版本。',
    limitations: [
      '这是持续维护的公开发行目录，不能证明已包含艺人的每一首作品。仅在 YouTube、SoundCloud、Bandcamp、游戏内发布、已下架或未被 Apple 收录的作品可能缺失。',
      'Apple 各地区可用性、曲名语言、发行日期与署名可能不同；日期为平台元数据，重发行日期不一定等于作品最初公开日期。',
      '同名艺人页 1738111555 的“今天不是明天 (feat. 兰音Reine)”独立标记 alternateArtistPage，保留平台来源供核验。',
      '不自动把未明确署名 PIKASONIC 的团体曲目归为个人作品；例如仅署名“ナナツカゼ”的作品需另行核对制作人名单。',
      '目录和外部封面链接不代表取得音乐或美术版权；非营利声明本身不构成授权。',
    ],
    failedRequests: failures,
    independentUpdatedAt: independentSnapshot?.updatedAt || null,
    independentProblems: independentSnapshot?.problems || [],
  },
  stats: {
    trackCount: tracks.length,
    releaseCount: new Set(
      tracks.flatMap((track) => track.releases.map((release) => release.appleCollectionId)),
    ).size,
    appleTrackCount: byAppleId.size,
    independentAdded,
    independentMatched,
    requestCount: requests.length,
    earliestRelease: tracks.filter((track) => track.releaseDate).at(-1)?.releaseDate,
    latestRelease: tracks[0]?.releaseDate,
  },
  requests,
  tracks,
}
await mkdir(path.dirname(OUTPUT), { recursive: true })
await writeFile(OUTPUT, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
console.log(`Saved ${tracks.length} tracks / ${catalog.stats.releaseCount} releases to ${OUTPUT}`)
