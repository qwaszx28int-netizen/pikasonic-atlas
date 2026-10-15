export const GROUP_CHANNEL_ID = 'UCE8B2xQ4Y3Mwl9NduvwyFkQ'

export function groupVideoTitle(video) {
  let title = String(video.songTitle || video.title || '')
    .normalize('NFKC')
    .trim()
  const instrumental = /\binstrumental\b/i.test(`${video.title || ''} ${title}`)
  title = title
    .replace(/^\[instrumental\]\s*/i, '')
    .replace(/^(?:nanatsukaze|ナナツカゼ)\s*[-–—]\s*/i, '')
    .replace(
      /\[(?:[^\]]*(?:music video|official video|lyric video|performance video|release))\]/gi,
      '',
    )
    .replace(
      /\((?:[^)]*(?:music video|official video|lyric video|performance video|release))\)/gi,
      '',
    )
    .replace(/\[instrumental\]|\(instrumental\)/gi, '')
    .trim()
  return instrumental ? `${title} (Instrumental)` : title
}

const titleKey = (title) =>
  String(title || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

/** Only promote reviewed metadata from the real official channel to song records. */
export function groupSupplementFromInventory(inventory, catalog) {
  const apple = catalog.tracks.filter(
    (track) =>
      track.appleTrackId &&
      (track.projects?.includes('ナナツカゼ') || /ナナツカゼ|nanatsukaze/i.test(track.artist)),
  )
  const reviewedVideos = (inventory.videos || []).filter(
    (video) =>
      video.channelId === GROUP_CHANNEL_ID && video.official === true && video.verified === true,
  )
  const groupVideos = reviewedVideos.filter(
    (video) => video.isFullSong === true && video.version === 'instrumental',
  )
  const records = new Map()
  for (const video of groupVideos) {
    const id = video.id || video.videoId
    if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) continue
    if (
      /music mix|teaser|tutorial|piano cover|making|wip|demo|trailer|livestream/i.test(video.title)
    )
      continue
    const title = groupVideoTitle(video)
    const durationMs = Number(
      video.durationMs ||
        (video.durationSeconds && video.durationSeconds * 1000) ||
        String(video.duration || '')
          .split(':')
          .map(Number)
          .reduce((seconds, value) => seconds * 60 + value, 0) * 1000,
    )
    if (
      !title ||
      !Number.isFinite(durationMs) ||
      durationMs < 60_000 ||
      durationMs > 900_000 ||
      !video.artworkUrl
    )
      continue
    const key = titleKey(title)
    // A music video's intro/outro is not a separate song. Version markers stay
    // in the key, so an official instrumental cannot be absorbed by its vocal.
    if (
      apple.some((track) =>
        [track.title, ...(track.aliases || [])].some((alias) => titleKey(alias) === key),
      )
    )
      continue
    const instrumental = /\binstrumental\b/i.test(title)
    const baseKey = titleKey(title.replace(/\(instrumental\)/gi, '').trim())
    const bases = apple.filter((track) =>
      [track.title, ...(track.aliases || [])].some((alias) => titleKey(alias) === baseKey),
    )
    // Use the verified Japanese release title when an English official title
    // maps unambiguously to it; preserve the original English instrumental alias.
    const displayTitle =
      instrumental && bases.length === 1 ? `${bases[0].title} (Instrumental)` : title
    records.set(id, {
      id: `youtube-${id}`,
      title: displayTitle,
      artist: 'ナナツカゼ',
      album: instrumental ? '官方独立伴奏' : '官方独立发布',
      releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(video.releaseDate || '') ? video.releaseDate : '',
      durationMs,
      genre: '',
      artworkUrl: video.artworkUrl,
      sourceName: 'YouTube',
      sourceUrl: `https://www.youtube.com/watch?v=${id}`,
      aliases: [
        ...new Set(
          [title, video.title, ...(video.aliases || [])].map((alias) =>
            instrumental && !/\binstrumental\b/i.test(alias) ? `${alias} (Instrumental)` : alias,
          ),
        ),
      ],
      artistAliases: ['Nanatsukaze'],
      albumAliases: [],
      stores: [],
      kind: instrumental ? 'instrumental' : /remix|vip|bootleg/i.test(title) ? 'remix' : 'original',
      tags: ['collaboration', ...(instrumental ? ['instrumental'] : [])],
      projects: ['ナナツカゼ'],
      releases: [],
      sourceTrackId: id,
      officialChannelId: GROUP_CHANNEL_ID,
    })
  }
  return {
    tracks: [...records.values()],
    source: {
      name: 'YouTube / ナナツカゼ',
      url: `https://www.youtube.com/channel/${GROUP_CHANNEL_ID}/videos`,
      collectedVideoCount: reviewedVideos.length,
      reviewedFullInstrumentals: groupVideos.length,
      standaloneVersions: records.size,
      checkedAt: inventory.checkedAt || inventory.updatedAt || null,
      access:
        '读取已核验的官方公开视频清单；商业发行的同曲 MV 不重复计数，Apple 未收录的完整伴奏及不同版本独立保留。未下载视频、音频或图片。',
    },
  }
}
