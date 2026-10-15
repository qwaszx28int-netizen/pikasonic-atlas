import { useState } from 'react'
import { ArrowUpRight, Image } from 'lucide-react'
import type { Track } from '../lib/catalog'
import { safeExternalUrl } from '../lib/catalog'

export type ArtworkPage =
  'explore' | 'tracks' | 'journey' | 'albums' | 'favorites' | 'ranking' | 'about'

const THEMES: Record<
  ArtworkPage,
  {
    title: string
    position: string
    artworkUrl?: string
    sourceUrl?: string
  }
> = {
  explore: {
    title: 'あのね',
    position: 'center 40%',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/b9/2d/69/b92d696c-13aa-8032-9a23-a8b89f068d5d/4550714635280_cover.png/1200x1200bb.jpg',
    sourceUrl: 'https://music.apple.com/jp/album/あのね/1860821673?i=1860821681',
  },
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
  const artworkUrl = theme.artworkUrl || track?.artworkUrl
  const url = showCovers && artworkUrl ? safeExternalUrl(artworkUrl) : undefined
  const [failedUrl, setFailedUrl] = useState('')
  const visible = url && url !== failedUrl
  const sourceUrl = theme.sourceUrl || track?.sourceUrl
  const source = sourceUrl ? safeExternalUrl(sourceUrl) : undefined
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
        (onOpen && track ? (
          <button
            className="page-artwork-credit"
            onClick={() => onOpen(track)}
            aria-label={`背景曲绘：《${theme.title}》，查看歌曲详情`}
          >
            <Image size={13} />
            <span>曲绘 · {theme.title}</span>
            <ArrowUpRight size={13} />
          </button>
        ) : (
          source && (
            <a
              className="page-artwork-credit"
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`背景曲绘：《${theme.title}》，查看发行来源`}
            >
              <Image size={13} />
              <span>曲绘 · {theme.title}</span>
              <ArrowUpRight size={13} />
            </a>
          )
        ))}
    </div>
  )
}
