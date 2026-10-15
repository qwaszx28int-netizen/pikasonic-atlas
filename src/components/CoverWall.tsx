import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Music2, Pause, Play } from 'lucide-react'
import { safeExternalUrl } from '../lib/catalog'
import type { Track } from '../lib/catalog'
import '../cover-wall.css'

const PRIORITY = [
  'infinity',
  'lost my mind',
  'euphoria',
  'haruka',
  'flora',
  'shizuku',
  'remember',
  'dreamland',
  'サンダーソニア',
  'メテオ',
  '海底列車',
  'blossom',
  'skyfall',
  'nostalgia',
  'unbreakable',
  'ヒロイン',
  '朧月夜',
  'sapphire',
]
const baseTitle = (title: string) =>
  title
    .toLocaleLowerCase()
    .replace(/\s*[([](?:feat\.?|ft\.?|.*remix|mixed|.*ver\.).*$/i, '')
    .trim()

function Artwork({ track, showCovers }: { track: Track; showCovers: boolean }) {
  const [failed, setFailed] = useState(false)
  const source = safeExternalUrl(track.artworkUrl)
  return (
    <>
      {showCovers && source && !failed ? (
        <img
          className="cw-artwork"
          src={source}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="cw-placeholder">
          <Music2 size={28} strokeWidth={1.25} aria-hidden="true" />
          <span>{track.title}</span>
          <small>PIKASONIC</small>
        </span>
      )}
      <span className="cw-card-shade" aria-hidden="true" />
      <span className="cw-card-caption">
        <span>{track.title}</span>
        <ArrowUpRight size={14} aria-hidden="true" />
      </span>
    </>
  )
}

export default function CoverWall({
  tracks,
  showCovers,
  onOpen,
}: {
  tracks: Track[]
  showCovers: boolean
  onOpen: (track: Track) => void
}) {
  const [paused, setPaused] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) setPaused(true)
    }
    preference.addEventListener('change', handleChange)
    return () => preference.removeEventListener('change', handleChange)
  }, [])
  const columns = useMemo(() => {
    const seen = new Set<string>()
    const seenTitles = new Set<string>()
    const ranked = [...tracks]
      .sort((a, b) => {
        const rank = (track: Track) => {
          const index = PRIORITY.indexOf(baseTitle(track.title))
          return index < 0 ? PRIORITY.length : index
        }
        const versionPenalty = (track: Track) =>
          track.kind === 'remix' ? 2 : track.kind === 'alternate' ? 1 : 0
        return rank(a) - rank(b) || versionPenalty(a) - versionPenalty(b)
      })
      .filter((track) => {
        const key = safeExternalUrl(track.artworkUrl) || track.id
        const title = baseTitle(track.title)
        if (seen.has(key) || seenTitles.has(title)) return false
        seen.add(key)
        seenTitles.add(title)
        return true
      })
      .slice(0, 15)
    return [0, 1, 2].map((column) => ranked.filter((_, index) => index % 3 === column))
  }, [tracks])

  return (
    <section className="cw-wall" data-paused={paused} aria-label="流动音乐曲绘墙">
      <div className="cw-glow cw-glow-blue" aria-hidden="true" />
      <div className="cw-glow cw-glow-pink" aria-hidden="true" />
      <div className="cw-viewport">
        <div className="cw-grid">
          {columns.map((column, index) => (
            <div className={`cw-column cw-column-${index + 1}`} key={index}>
              <div className="cw-column-loop">
                {[false, true].map((clone) => (
                  <div className="cw-group" key={String(clone)} aria-hidden={clone || undefined}>
                    {column.map((track) => (
                      <button
                        className="cw-card"
                        type="button"
                        key={track.id}
                        onClick={() => onOpen(track)}
                        tabIndex={clone ? -1 : 0}
                        aria-label={clone ? undefined : `查看《${track.title}》的歌曲导听`}
                      >
                        <Artwork track={track} showCovers={showCovers} />
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="cw-footer">
        <span className="cw-eyebrow">
          <span className="cw-status-dot" aria-hidden="true" />
          曲绘漫游 <span className="cw-footer-en">/ ARTWORK IN MOTION</span>
        </span>
        <button
          className="cw-control"
          type="button"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
          aria-label={paused ? '播放曲绘墙动画' : '暂停曲绘墙动画'}
        >
          {paused ? (
            <Play size={12} fill="currentColor" aria-hidden="true" />
          ) : (
            <Pause size={12} fill="currentColor" aria-hidden="true" />
          )}
          <span>{paused ? '播放' : '暂停'}</span>
        </button>
      </div>
    </section>
  )
}
