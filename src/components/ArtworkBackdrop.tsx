import { useState } from 'react'
import { ArrowUpRight, Image } from 'lucide-react'
import type { Track } from '../lib/catalog'
import { safeExternalUrl } from '../lib/catalog'

export type ArtworkPage =
  'explore' | 'tracks' | 'journey' | 'albums' | 'favorites' | 'ranking' | 'about'

const THEMES: Record<ArtworkPage, { title: string; position: string }> = {
  explore: { title: '朧月夜', position: '68% 30%' },
  tracks: { title: 'Kyoto', position: '36% 38%' },
  journey: { title: '夢重力', position: '55% 44%' },
  albums: { title: 'Shizuku (feat. NEONA)', position: '58% 47%' },
  favorites: { title: '春めく', position: '51% 46%' },
  ranking: { title: 'サンダーソニア', position: '52% 40%' },
  about: { title: '海底列車', position: '62% 38%' },
}

export default function ArtworkBackdrop({
  page,
  tracks,
  showCovers,
  onOpen,
  ambient = false,
}: {
  page: ArtworkPage
  tracks: Track[]
  showCovers: boolean
  onOpen?: (track: Track) => void
  ambient?: boolean
}) {
  const theme = THEMES[page]
  const track = tracks.find((item) => item.title === theme.title)
  const url = showCovers && track ? safeExternalUrl(track.artworkUrl) : undefined
  const [failedUrl, setFailedUrl] = useState('')
  const visible = url && url !== failedUrl
  const source = track ? safeExternalUrl(track.sourceUrl) : undefined
  return (
    <div className={`page-artwork page-artwork--${page} ${ambient ? 'page-artwork-ambient' : ''}`}>
      <div className="page-artwork-image" aria-hidden="true">
        {visible && (
          <img
            src={url}
            alt=""
            style={{ objectPosition: theme.position }}
            referrerPolicy="no-referrer"
            decoding="async"
            onError={() => setFailedUrl(url)}
          />
        )}
      </div>
      {!ambient &&
        visible &&
        track &&
        (onOpen ? (
          <button
            className="page-artwork-credit"
            onClick={() => onOpen(track)}
            aria-label={`背景曲绘：《${track.title}》，查看歌曲详情`}
          >
            <Image size={13} />
            <span>曲绘 · {track.title}</span>
            <ArrowUpRight size={13} />
          </button>
        ) : (
          source && (
            <a
              className="page-artwork-credit"
              href={source}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Image size={13} />
              <span>曲绘 · {track.title}</span>
              <ArrowUpRight size={13} />
            </a>
          )
        ))}
    </div>
  )
}
