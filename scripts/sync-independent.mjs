/** Read public SoundCloud/YouTube metadata without requesting any media files. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { groupSupplementFromInventory } from './group-supplement.mjs'
import { normalizeYoutubeTitle as normalizeTitle, videoTitleVariants } from './youtube-matching.mjs'
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(ROOT, 'public/data/supplemental.json')
const fetchedAt = new Date().toISOString()
if (process.argv.includes('--nanatsukaze-from-snapshot')) {
  const saved = JSON.parse(await readFile(output, 'utf8'))
  const group = await readGroupSupplement()
  // Keep earlier public IDs even if a later inventory is temporarily shorter.
  saved.tracks = [
    ...new Map([...saved.tracks, ...group.tracks].map((track) => [track.id, track])).values(),
  ]
  saved.sources = [
    ...saved.sources.filter((source) => source.name !== 'YouTube / ナナツカゼ'),
    group.source,
  ]
  saved.updatedAt = fetchedAt
  if (!saved.limitations.some((line) => line.includes('ナナツカゼ')))
    saved.limitations.push(
      'ナナツカゼ补遗来自已核验的官方视频清单；不同版本单列，无明确逐曲流派或发行日期时留空。公开视频清单不能证明历史上全部作品均可访问。',
    )
  await writeFile(output, `${JSON.stringify(saved, null, 2)}\n`)
  console.log(
    `Merged ${group.tracks.length} reviewed ナナツカゼ independent versions; YouTube map was not rewritten.`,
  )
  process.exit(0)
}
if (process.argv.includes('--youtube-from-snapshot')) {
  await writeYoutubeMap(JSON.parse(await readFile(output, 'utf8')))
  process.exit(0)
}
const problems = []
const sources = []
const tracks = []
const run = promisify(execFile)
const html = async (url) => {
  // Windows' system proxy is used by PowerShell but not by Node's native fetch.
  // This reads the same public URL and does not require browser cookies.
  if (process.platform === 'win32') {
    const command = `$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); (Invoke-WebRequest -UseBasicParsing -UserAgent 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36' -Uri '${url.replaceAll("'", "''")}' -TimeoutSec 25).Content`
    const { stdout } = await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64'),
      ],
      { timeout: 35000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
    )
    return stdout
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}
const json = async (url) => JSON.parse(await html(url))
const postJson = async (url, body) => {
  if (process.platform === 'win32') {
    const encodedBody = Buffer.from(JSON.stringify(body)).toString('base64')
    const command = `$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $requestBody=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedBody}')); (Invoke-WebRequest -UseBasicParsing -Method Post -ContentType 'application/json' -Uri '${url.replaceAll("'", "''")}' -Body $requestBody -TimeoutSec 25).Content`
    const { stdout } = await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64'),
      ],
      { timeout: 35000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
    )
    return JSON.parse(stdout)
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

if (process.argv.includes('--inspect-video-genres')) {
  const independent = JSON.parse(await readFile(output, 'utf8'))
  for (const track of independent.tracks.filter((entry) => entry.sourceName === 'YouTube')) {
    const page = await html(track.sourceUrl)
    const rawDescription = page.match(/"shortDescription":("(?:\\.|[^"\\])*")/)?.[1]
    const description = rawDescription ? JSON.parse(rawDescription) : ''
    const status = page.match(/"playabilityStatus":\{"status":"([^"]+)"/)?.[1] || 'unknown'
    const rawReason = page.match(
      /"playabilityStatus":\{"status":"[^"]+","reason":("(?:\\.|[^"\\])*")/,
    )?.[1]
    console.log(
      JSON.stringify(
        {
          id: track.id,
          title: track.title,
          url: track.sourceUrl,
          status,
          reason: rawReason ? JSON.parse(rawReason) : '',
          description,
        },
        null,
        2,
      ),
    )
  }
  process.exit(0)
}

try {
  const profileUrl = 'https://soundcloud.com/pika5onic'
  const page = await html(profileUrl)
  const hydration = JSON.parse(page.match(/window\.__sc_hydration\s*=\s*(\[.*?\]);/s)?.[1] || '[]')
  const user = hydration.find((entry) => entry.hydratable === 'user')?.data
  if (!user?.id) throw new Error('Public profile hydration does not expose the artist ID')
  console.log(
    `SoundCloud user ${user.id} / ${user.username} / published tracks ${user.track_count}`,
  )
  let clientId = page.match(/client_id\s*:\s*['"]([a-zA-Z0-9]{32})['"]/)?.[1]
  if (!clientId) {
    const scripts = [...page.matchAll(/<script[^>]+src="([^"]+\.js(?:\?[^"]*)?)"/g)].map(
      (match) => match[1],
    )
    for (const script of scripts.reverse()) {
      if (!/^https:\/\/a-v2\.sndcdn\.com\//.test(script)) continue
      const source = await html(script)
      clientId = source.match(/client_id\s*:\s*['"]([a-zA-Z0-9]{32})['"]/)?.[1]
      if (clientId) break
    }
  }
  const found = new Map()
  for (const entry of hydration) {
    for (const track of entry.data?.collection || [])
      if (track.kind === 'track' && track.user?.id === user.id) found.set(track.id, track)
  }
  if (!clientId) throw new Error('No public visitor client ID found in the current page scripts')
  let url = `https://api-v2.soundcloud.com/users/${user.id}/tracks?limit=200&linked_partitioning=1&client_id=${clientId}`
  for (let pageNumber = 0; url && pageNumber < 10; pageNumber += 1) {
    const result = await json(url)
    for (const track of result.collection || [])
      if (track.kind === 'track' && track.user?.id === user.id) found.set(track.id, track)
    url = result.next_href || ''
    if (url && !url.includes('client_id='))
      url += `${url.includes('?') ? '&' : '?'}client_id=${clientId}`
    console.log(
      `SoundCloud page ${pageNumber + 1}: ${found.size} tracks (${result.collection?.length || 0} rows)`,
    )
  }
  for (const track of found.values()) {
    const artworkUrl = (track.artwork_url || user.avatar_url || '').replace('-large.', '-t500x500.')
    // A track cover is required; do not silently use the artist avatar as a song cover.
    if (!track.artwork_url) continue
    const splitTitle = track.title.match(/^(.+?)\s+-\s+(.+)$/)
    const titleParts =
      splitTitle && (/pikasonic/i.test(splitTitle[1]) || /pikasonic\s+remix/i.test(splitTitle[2]))
        ? splitTitle
        : null
    const displayTitle = titleParts ? titleParts[2] : track.title
    const creditedArtist = titleParts ? titleParts[1] : 'PIKASONIC'
    tracks.push({
      id: `soundcloud-${track.id}`,
      title: displayTitle,
      artist: creditedArtist,
      album: '独立发布',
      releaseDate: (track.release_date || track.display_date || track.created_at || '').slice(
        0,
        10,
      ),
      durationMs: track.duration || 0,
      genre: track.genre || '',
      artworkUrl,
      sourceName: 'SoundCloud',
      sourceUrl: track.permalink_url,
      aliases: displayTitle === track.title ? [] : [track.title],
      artistAliases: [],
      albumAliases: [],
      stores: [],
      kind: /remix|vip|bootleg/i.test(track.title)
        ? 'remix'
        : /instrumental/i.test(track.title)
          ? 'instrumental'
          : 'original',
      tags: [
        ...(/remix|vip|bootleg/i.test(track.title) ? ['remix'] : []),
        ...(/&|、|,|feat\.?|ft\.|w\//i.test(track.title) ? ['collaboration'] : []),
      ],
      releases: [],
      sourceTrackId: track.id,
      platformLicense: track.license || null,
    })
  }
  sources.push({
    name: 'SoundCloud',
    url: profileUrl,
    publishedTrackCount: user.track_count,
    collectedTrackCount: found.size,
    access: '公开艺人页及网页访客元数据接口；未请求音频。',
  })
} catch (error) {
  problems.push({ source: 'SoundCloud', message: error.message })
  console.error('SoundCloud:', error.message)
}

try {
  const channelUrl = 'https://www.youtube.com/channel/UC2ne9XqtBWKJKLfIAKtmjAg/videos'
  const page = await html(channelUrl)
  const escapedData = page.match(/ytInitialData\s*=\s*'((?:\\.|[^'])*)';/s)?.[1]
  const decodedData = escapedData?.replace(
    /\\x([a-f\d]{2})|\\u([a-f\d]{4})|\\(['"\\/])/gi,
    (_, hex, unicode, literal) => literal || String.fromCharCode(parseInt(hex || unicode, 16)),
  )
  const initial = JSON.parse(
    decodedData || page.match(/var ytInitialData\s*=\s*(\{.*?\});<\/script>/s)?.[1] || 'null',
  )
  if (!initial) throw new Error('YouTube public page initial data not found')
  const videos = new Map()
  let continuation = ''
  const visit = (value) => {
    if (!value || typeof value !== 'object') return
    if (value.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token)
      continuation = value.continuationItemRenderer.continuationEndpoint.continuationCommand.token
    if (value.lockupViewModel?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
      const row = value.lockupViewModel
      const thumbnail = row.contentImage?.thumbnailViewModel
      const metadata = row.metadata?.lockupMetadataViewModel
      const badges =
        thumbnail?.overlays?.flatMap(
          (entry) => entry.thumbnailBottomOverlayViewModel?.badges || [],
        ) || []
      videos.set(row.contentId, {
        id: row.contentId,
        title: metadata?.title?.content || '',
        duration: badges.map((entry) => entry.thumbnailBadgeViewModel?.text).find(Boolean) || '',
        publishedText:
          metadata?.metadata?.contentMetadataViewModel?.metadataRows
            ?.flatMap((entry) => entry.metadataParts || [])
            .map((entry) => entry.text?.content)
            .filter(Boolean)
            .join(' · ') || '',
        artworkUrl: thumbnail?.image?.sources?.at(-1)?.url || '',
      })
    }
    if (value.videoRenderer) {
      const row = value.videoRenderer
      videos.set(row.videoId, {
        id: row.videoId,
        title: row.title?.runs?.map((run) => run.text).join('') || row.title?.simpleText || '',
        duration: row.lengthText?.simpleText || '',
        publishedText: row.publishedTimeText?.simpleText || '',
        artworkUrl: row.thumbnail?.thumbnails?.at(-1)?.url || '',
      })
    }
    if (value.playlistVideoRenderer) {
      const row = value.playlistVideoRenderer
      videos.set(row.videoId, {
        id: row.videoId,
        title: row.title?.runs?.map((run) => run.text).join('') || row.title?.simpleText || '',
        duration: row.lengthText?.simpleText || '',
        publishedText: '',
        artworkUrl: row.thumbnail?.thumbnails?.at(-1)?.url || '',
      })
    }
    for (const nested of Object.values(value))
      if (nested && typeof nested === 'object') visit(nested)
  }
  visit(initial)
  const config = JSON.parse(page.match(/ytcfg\.set\((\{.*?\})\);/s)?.[1] || '{}')
  const context = config.INNERTUBE_CONTEXT || {
    client: {
      clientName: 'WEB',
      clientVersion: config.INNERTUBE_CLIENT_VERSION || '2.20261014.01.00',
    },
  }
  let pages = 1
  while (continuation && pages < 12) {
    const token = continuation
    continuation = ''
    const result = await postJson('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
      context,
      continuation: token,
    })
    visit(result)
    pages += 1
    console.log(`YouTube page ${pages}: ${videos.size} videos`)
  }
  const uploadsPage = await html('https://www.youtube.com/playlist?list=UU2ne9XqtBWKJKLfIAKtmjAg')
  const uploadsEscaped = uploadsPage.match(/ytInitialData\s*=\s*'((?:\\.|[^'])*)';/s)?.[1]
  const uploadsDecoded = uploadsEscaped?.replace(
    /\\x([a-f\d]{2})|\\u([a-f\d]{4})|\\(['"\\/])/gi,
    (_, hex, unicode, literal) => literal || String.fromCharCode(parseInt(hex || unicode, 16)),
  )
  const uploadsInitial = JSON.parse(
    uploadsDecoded ||
      uploadsPage.match(/var ytInitialData\s*=\s*(\{.*?\});<\/script>/s)?.[1] ||
      'null',
  )
  if (uploadsInitial) visit(uploadsInitial)
  while (continuation && pages < 12) {
    const token = continuation
    continuation = ''
    const result = await postJson('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
      context,
      continuation: token,
    })
    visit(result)
    pages += 1
  }
  console.log(`YouTube uploads playlist: ${videos.size} videos`)
  const knownCatalog = JSON.parse(
    await readFile(path.join(ROOT, 'public/data/catalog.json'), 'utf8'),
  )
  const titleKey = (text) =>
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(
        /【[^】]*】|\[(?:[^\]]*release|music video|official video)\]|\((?:[^)]*release|official video|performance video)\)/gi,
        '',
      )
      .replace(/(?:\(|\[)?(?:feat\.?|ft\.?|w\/)\s*[^)\]]*(?:\)|\])?/gi, '')
      .replace(/[^\p{L}\p{N}]/gu, '')
  const knownTitles = new Set(
    [...knownCatalog.tracks.filter((track) => track.appleTrackId), ...tracks]
      .flatMap((track) => [track.title, ...(track.aliases || [])])
      .map(titleKey),
  )
  for (const video of videos.values()) {
    const parts = video.title.normalize('NFKC').match(/^(.+?)\s+-\s+(.+)$/)
    if (
      !parts ||
      !/pikasonic/i.test(video.title) ||
      /music mix|teaser|tutorial|minecraft|piano cover|making|wip|demo/i.test(video.title)
    )
      continue
    const title = parts[2]
    if (knownTitles.has(titleKey(title))) continue
    const durationMs =
      video.duration
        .split(':')
        .map(Number)
        .reduce((seconds, value) => seconds * 60 + value, 0) * 1000
    if (durationMs < 60000 || durationMs > 900000 || !video.artworkUrl) continue
    tracks.push({
      id: `youtube-${video.id}`,
      title,
      artist: parts[1],
      album: '独立发布',
      releaseDate: '',
      durationMs,
      genre: '',
      artworkUrl: video.artworkUrl,
      sourceName: 'YouTube',
      sourceUrl: `https://www.youtube.com/watch?v=${video.id}`,
      aliases: [video.title],
      artistAliases: [],
      albumAliases: [],
      stores: [],
      kind: /remix|vip|bootleg/i.test(title) ? 'remix' : 'original',
      tags: /remix|vip|bootleg/i.test(title) ? ['remix'] : [],
      releases: [],
      sourceTrackId: video.id,
    })
    knownTitles.add(titleKey(title))
  }
  // The inventory is useful to review missing songs without treating relative
  // upload ages or thumbnails as verified release dates and cover ownership.
  sources.push({
    name: 'YouTube',
    url: channelUrl,
    collectedVideoCount: videos.size,
    pages,
    videos: [...videos.values()],
    access:
      '官方频道首屏与 Uploads 列表的 100 条公开视频元数据，续页没有返回更多条目；视频未下载，未把预告、直播或短视频自动当成发行曲目。',
  })
  console.log(`YouTube: ${videos.size} public video entries`)
} catch (error) {
  problems.push({ source: 'YouTube', message: error.message })
  console.error('YouTube:', error.message)
}

try {
  const group = await readGroupSupplement()
  tracks.push(...group.tracks)
  sources.push(group.source)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  problems.push({
    source: 'YouTube / ナナツカゼ',
    message:
      'Reviewed official-videos.json is missing; retained catalogue IDs will not be deleted.',
  })
}

const snapshot = {
  schemaVersion: 1,
  updatedAt: fetchedAt,
  sources,
  limitations: [
    'SoundCloud 条目是艺人账号的公开上传，包含 remix、bootleg、游戏尺寸或预告版本；不等于授权的商业发行。',
    '独立上传标题保留原始署名。上传 / 展示日期不一定是歌曲首次发行日期；封面为 SoundCloud 元数据提供的远程 URL。',
    'YouTube 核对官方频道首屏与 Uploads 列表公开的前 100 条视频，续页请求未获得更多视频。仅纳入明确署名的完整歌曲或不同版本；未把相对上传时间换算为虚构发行日期。',
    'SoundCloud 账号元数据声明 108 首上传，但当前公开访客曲目分页只返回 79 首，不能据此证明 108 首全部可访问。',
    'ナナツカゼ补遗来自已核验的官方视频清单；不同版本单列，无明确逐曲流派或发行日期时留空。公开视频清单不能证明历史上全部作品均可访问。',
  ],
  problems,
  tracks,
}
if (!tracks.length) {
  try {
    await readFile(output)
    throw new Error('No independent tracks collected; existing supplemental snapshot preserved.')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`)
await writeYoutubeMap(snapshot)
console.log(`Saved ${tracks.length} independent upload records.`)

async function readGroupSupplement() {
  const inventory = JSON.parse(
    await readFile(path.join(ROOT, 'public/data/official-videos.json'), 'utf8'),
  )
  const catalog = JSON.parse(await readFile(path.join(ROOT, 'public/data/catalog.json'), 'utf8'))
  return groupSupplementFromInventory(inventory, catalog)
}

async function writeYoutubeMap(independent) {
  const catalog = JSON.parse(await readFile(path.join(ROOT, 'public/data/catalog.json'), 'utf8'))
  const sources = independent.sources.filter((entry) => entry.name === 'YouTube')
  // Curated official channels/Topic uploads survive a refresh of PIKASONIC's
  // independent uploads. This file contains public metadata, never media files.
  const official = JSON.parse(
    await readFile(path.join(ROOT, 'public/data/official-videos.json'), 'utf8'),
  )
  const videos = [
    ...new Map(
      [...sources.flatMap((source) => source.videos || []), ...official.videos].map((video) => [
        video.id,
        video,
      ]),
    ).values(),
  ]
  const matches = {}
  const scores = {}
  const remember = (track, video, rank, difference) => {
    const score = rank * 100000 - difference
    if (scores[track.id] !== undefined && scores[track.id] >= score) return
    matches[track.id] = {
      url: `https://www.youtube.com/watch?v=${video.id}`,
      title: video.title,
      id: video.id,
    }
    scores[track.id] = score
  }
  for (const video of videos) {
    if (video.isFullSong === false) continue
    if (/music mix|teaser|tutorial|minecraft|piano cover|making|wip|demo/i.test(video.title))
      continue
    const durationMs =
      video.duration
        .split(':')
        .map(Number)
        .reduce((seconds, value) => seconds * 60 + value, 0) * 1000
    if (!durationMs || durationMs > 900000) continue
    const fullTitles = videoTitleVariants(video).map((title) => normalizeTitle(title))
    const coreTitles = videoTitleVariants(video).map((title) => normalizeTitle(title, true))
    const eligible = catalog.tracks.filter(
      (track) =>
        track.durationMs &&
        Math.abs(track.durationMs - durationMs) <= 8000 &&
        (video.channelId !== 'UCE8B2xQ4Y3Mwl9NduvwyFkQ' || track.projects?.includes('ナナツカゼ')),
    )
    const fullMatches = eligible.filter((track) =>
      [track.title, ...(track.aliases || [])].some((title) =>
        fullTitles.includes(normalizeTitle(title)),
      ),
    )
    // A full feature/version match takes precedence over a generic title. This
    // keeps the KAFU and nakotanmaru vocal versions from cross-matching.
    if (fullMatches.length) {
      for (const track of fullMatches)
        remember(track, video, 2, Math.abs(track.durationMs - durationMs))
    } else {
      const coreMatches = eligible.filter((track) =>
        [track.title, ...(track.aliases || [])].some((title) =>
          coreTitles.includes(normalizeTitle(title, true)),
        ),
      )
      if (coreMatches.length === 1)
        remember(coreMatches[0], video, 1, Math.abs(coreMatches[0].durationMs - durationMs))
    }
  }
  for (const track of catalog.tracks) {
    if (track.sourceName !== 'YouTube') continue
    const id = new URL(track.sourceUrl).searchParams.get('v')
    const video = videos.find((entry) => entry.id === id)
    if (video) remember(track, video, 10, 0)
  }
  const youtube = {
    updatedAt: independent.updatedAt,
    channelUrl: 'https://www.youtube.com/channel/UC2ne9XqtBWKJKLfIAKtmjAg',
    additionalSources: official.sources,
    coverage: {
      checkedVideos: videos.length,
      matchedTracks: Object.keys(matches).length,
      totalTracks: catalog.tracks.length,
      durationToleranceSeconds: 8,
      note: '仅匹配已核对的官方视频；保留混音、VIP、Mixed和游戏短版标记。未匹配曲目使用前端明确标注的搜索入口。',
    },
    matches,
  }
  await writeFile(
    path.join(ROOT, 'public/data/youtube.json'),
    `${JSON.stringify(youtube, null, 2)}\n`,
  )
  console.log(
    `Saved ${Object.keys(matches).length} official YouTube matches from ${videos.length} checked videos.`,
  )
}
