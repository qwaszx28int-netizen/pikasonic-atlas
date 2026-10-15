import type { Track } from './catalog'

export function pickTrack(
  tracks: Track[],
  previousId?: string,
  random: () => number = Math.random,
): Track | undefined {
  const candidates = tracks.length > 1 ? tracks.filter((track) => track.id !== previousId) : tracks
  if (!candidates.length) return undefined
  const index = Math.min(
    candidates.length - 1,
    Math.max(0, Math.floor(random() * candidates.length)),
  )
  return candidates[index]
}

export function trackShareUrl(base: string, trackId?: string): string {
  const url = new URL(base)
  url.hash = ''
  if (trackId) url.searchParams.set('track', trackId)
  else url.searchParams.delete('track')
  return url.href
}
