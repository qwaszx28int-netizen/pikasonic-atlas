import type { Track } from './catalog'
import { isNanatsukaze } from './catalog.ts'

/** Keep group-only releases searchable under their credited artist. */
export function channelArtist(track: Track): string {
  return isNanatsukaze(track) ? 'ナナツカゼ' : 'PIKASONIC'
}
