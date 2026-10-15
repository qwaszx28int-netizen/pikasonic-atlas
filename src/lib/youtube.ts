import type { Track } from './catalog'
import { channelArtist } from './channel-artist.ts'
export interface YoutubeMatch {
  id: string
  title: string
  url: string
}
export interface YoutubeCatalog {
  updatedAt: string
  channelUrl: string
  matches: Record<string, YoutubeMatch>
}

export function youtubeLink(
  track: Track,
  catalog?: YoutubeCatalog | null,
): { url: string; direct: boolean } {
  if (
    track.sourceName === 'YouTube' &&
    /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]+$/.test(track.sourceUrl)
  )
    return { url: track.sourceUrl, direct: true }
  const match = catalog?.matches[track.id]
  if (match && /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]+$/.test(match.url))
    return { url: match.url, direct: true }
  return {
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${channelArtist(track)} ${track.title}`)}`,
    direct: false,
  }
}
