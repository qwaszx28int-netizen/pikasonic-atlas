import type { Track } from './catalog'
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
}

export function neteaseLink(
  track: Track,
  catalog?: NeteaseCatalog | null,
): { url: string; direct: boolean } {
  const match = catalog?.matches[track.id]
  if (match && /^https:\/\/music\.163\.com\/#\/song\?id=\d+$/.test(match.url))
    return { url: match.url, direct: true }
  return {
    url: `https://music.163.com/#/search/m/?s=${encodeURIComponent(`${track.title} PIKASONIC`)}&type=1`,
    direct: false,
  }
}
