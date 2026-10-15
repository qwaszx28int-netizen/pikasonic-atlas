import type { Track } from './catalog'
import { channelArtist } from './channel-artist.ts'
export interface NeteaseMatch {
  id: number
  title: string
  artist: string
  url: string
  matchType: string
}
export interface NeteaseCatalog {
  updatedAt: string
  matches: Record<string, NeteaseMatch>
  hotUpdatedAt?: string
  hotSource?: { name: string; url: string; description: string }
  hotSongs?: {
    rank: number
    id: number
    title: string
    artist: string
    durationMs: number
    popularity?: number
    score?: number
    url: string
  }[]
  hotRanks?: Record<string, number>
  hotOrder?: string[]
}

/** One-based positions in the artist's captured hotSongs order, never play counts. */
export function neteaseRanks(catalog?: NeteaseCatalog | null): Record<string, number> {
  if (!catalog) return {}
  const ranks: Record<string, number> = {}
  if (catalog.hotRanks) {
    for (const [trackId, rank] of Object.entries(catalog.hotRanks))
      if (Number.isSafeInteger(rank) && rank > 0) ranks[trackId] = rank
    return ranks
  }
  const songRanks = new Map<number, number>()
  for (const song of catalog.hotSongs || [])
    if (Number.isSafeInteger(song.rank) && song.rank > 0)
      songRanks.set(song.id, Math.min(songRanks.get(song.id) ?? Infinity, song.rank))
  for (const [trackId, match] of Object.entries(catalog.matches)) {
    const rank = songRanks.get(match.id)
    if (rank !== undefined) ranks[trackId] = rank
  }
  return ranks
}

export function neteaseLink(
  track: Track,
  catalog?: NeteaseCatalog | null,
): { url: string; direct: boolean } {
  const match = catalog?.matches[track.id]
  if (match && /^https:\/\/music\.163\.com\/#\/song\?id=\d+$/.test(match.url))
    return { url: match.url, direct: true }
  return {
    url: `https://music.163.com/#/search/m/?s=${encodeURIComponent(`${track.title} ${channelArtist(track)}`)}&type=1`,
    direct: false,
  }
}
