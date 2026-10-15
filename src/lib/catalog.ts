export interface Track {
  id: string
  title: string
  artist: string
  album: string
  releaseDate: string
  durationMs: number
  genre: string
  genreDetails?: { genre: string; sourceName: string; sourceUrl: string }[]
  artworkUrl: string
  sourceUrl: string
  sourceName?: string
  aliases?: string[]
  artistAliases?: string[]
  albumAliases?: string[]
  kind?: string
  appleTrackId?: number
  appleCollectionId?: number
  tags?: string[]
  releases?: unknown[]
}

export interface Catalog {
  updatedAt: string
  artist: { name: string; appleArtistId: number; appleArtistUrl: string }
  sources: { name: string; url: string; description?: string }[]
  coverage: { regions?: string[]; approach?: string; limitations: string[] }
  stats: { trackCount: number; releaseCount: number }
  tracks: Track[]
}

export type Category = 'all' | 'solo' | 'collab' | 'remix'
export type SortOrder = 'featured' | 'newest' | 'oldest' | 'title'

export function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .normalize('NFD')
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

export function isCollaboration(track: Track): boolean {
  return (
    /[,;;&×、，]|\s(?:feat\.?|ft\.?|with|x|and)\s/i.test(track.artist) ||
    /\b(?:feat|ft)\.?\s/i.test(track.title) ||
    track.tags?.includes('collaboration') === true
  )
}

export function isRemix(track: Track): boolean {
  return (
    track.kind === 'remix' ||
    /\b(remix|rework|bootleg|edit|vip)\b/i.test(
      `${track.title} ${track.album} ${(track.aliases || []).join(' ')}`,
    )
  )
}

const FEATURED_TITLES = [
  'nostalgia',
  'skyfall',
  'infinity',
  'lost my mind (feat. nakotanmaru)',
  'euphoria (feat. tsugumi nagahara)',
  'dreamland',
  'lockdown (feat. neona)',
  'haruka',
  'reflect',
  'after rain',
  'asuka',
  'blossom',
]

function featuredRank(track: Track): number {
  const index = FEATURED_TITLES.indexOf(normalize(track.title))
  return index === -1 ? FEATURED_TITLES.length : index
}

export function filterTracks(
  tracks: Track[],
  options: {
    query?: string
    category?: Category
    year?: string
    sort?: SortOrder
    favorites?: Set<string>
  } = {},
): Track[] {
  const terms = normalize(options.query || '')
    .split(/\s+/)
    .filter(Boolean)
  return tracks
    .filter((track) => {
      const haystack = normalize(
        [
          track.title,
          track.artist,
          track.album,
          track.genre,
          ...(track.aliases || []),
          ...(track.artistAliases || []),
          ...(track.albumAliases || []),
        ].join(' '),
      )
      return (
        terms.every((term) => haystack.includes(term)) &&
        (!options.year || (track.releaseDate || '').startsWith(options.year)) &&
        (!options.favorites || options.favorites.has(String(track.id))) &&
        (options.category !== 'solo' || !isCollaboration(track)) &&
        (options.category !== 'collab' || isCollaboration(track)) &&
        (options.category !== 'remix' || isRemix(track))
      )
    })
    .sort((a, b) => {
      if (options.sort === 'title')
        return a.title.localeCompare(b.title, 'zh-CN', { numeric: true })
      if (options.sort === 'featured') {
        const rank = featuredRank(a) - featuredRank(b)
        if (rank) return rank
      }
      const difference =
        Date.parse(b.releaseDate || '1970-01-01') - Date.parse(a.releaseDate || '1970-01-01')
      return (
        (options.sort === 'oldest' ? -difference : difference) || a.title.localeCompare(b.title)
      )
    })
}

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '—'
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  return match ? `${match[1]}.${match[2]}.${match[3]}` : '日期待核实'
}

export function safeExternalUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' ? parsed.href : undefined
  } catch {
    return undefined
  }
}

export function sourceLabel(track: Track): string {
  if (track.sourceName) return track.sourceName
  try {
    const host = new URL(track.sourceUrl).hostname
    if (host.endsWith('apple.com')) return 'Apple Music'
    if (host.endsWith('soundcloud.com')) return 'SoundCloud'
    if (host.endsWith('youtube.com') || host === 'youtu.be') return 'YouTube'
    if (host.endsWith('bandcamp.com')) return 'Bandcamp'
  } catch {
    /* The source button falls back to a non-interactive span for invalid URLs. */
  }
  return '发行平台'
}
