import { useLayoutEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Disc3,
  ListMusic,
  Music2,
  Sparkles,
} from 'lucide-react'
import type { Track } from '../lib/catalog'
import { formatDate, safeExternalUrl } from '../lib/catalog'
import { neteaseLink, neteaseRanks } from '../lib/netease'
import type { NeteaseCatalog } from '../lib/netease'
import ArtworkBackdrop from './ArtworkBackdrop'
import '../journey.css'

interface Props {
  tracks: Track[]
  netease: NeteaseCatalog | null
  onSelect: (track: Track) => void
  showCovers?: boolean
}

function JourneyArtwork({ track, showCovers }: { track: Track; showCovers: boolean }) {
  const [failed, setFailed] = useState(false)
  const source = safeExternalUrl(track.artworkUrl)
  return (
    <span className="mj-cover">
      {showCovers && source && !failed ? (
        <img
          src={source}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="mj-cover-fallback">
          <Music2 size={36} strokeWidth={1.1} />
          <span>{track.title}</span>
        </span>
      )}
      <span className="mj-cover-overlay" aria-hidden="true">
        <span>READ THE STORY</span>
        <ArrowUpRight size={24} strokeWidth={1.3} />
      </span>
    </span>
  )
}

export default function MusicJourney({ tracks, netease, onSelect, showCovers = true }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [jumpRequest, setJumpRequest] = useState<{ year: string; sequence: number } | null>(null)
  const selectedYear = jumpRequest?.year || ''
  useLayoutEffect(() => {
    if (!jumpRequest) return
    // Measure after React commits pending expand/collapse changes to the timeline.
    const target = document.getElementById(`mj-year-${jumpRequest.year}`)
    target?.scrollIntoView({
      behavior: 'instant',
      block: 'start',
    })
    target?.focus({ preventScroll: true })
  }, [jumpRequest])
  const years = useMemo(() => {
    const ranks = neteaseRanks(netease)
    const groups = new Map<string, Track[]>()
    for (const track of tracks) {
      const year = /^\d{4}-\d{2}-\d{2}/.test(track.releaseDate || '')
        ? track.releaseDate.slice(0, 4)
        : 'unknown'
      groups.set(year, [...(groups.get(year) || []), track])
    }
    return [...groups]
      .sort(([a], [b]) => (a === 'unknown' ? 1 : b === 'unknown' ? -1 : a.localeCompare(b)))
      .map(([year, items]) => {
        const ordered = [...items].sort(
          (a, b) =>
            (a.releaseDate || '').localeCompare(b.releaseDate || '') ||
            a.title.localeCompare(b.title, 'zh-CN') ||
            a.id.localeCompare(b.id),
        )
        const seen = new Set<string>()
        const representativeOrder = [...ordered].sort(
          (a, b) =>
            (ranks[a.id] ?? Infinity) - (ranks[b.id] ?? Infinity) ||
            ordered.indexOf(a) - ordered.indexOf(b),
        )
        const featured = representativeOrder
          .filter((track) => {
            const source = safeExternalUrl(track.artworkUrl)
            if (!source || seen.has(source)) return false
            seen.add(source)
            return true
          })
          .slice(0, 3)
        return {
          year,
          tracks: ordered,
          featured,
          hasPopularity: featured.some((track) => ranks[track.id] !== undefined),
        }
      })
  }, [tracks, netease])
  const datedYears = years.filter((group) => group.year !== 'unknown')
  const allExpanded = years.length > 0 && years.every((group) => expanded.has(group.year))
  function toggle(year: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }
  function jump(year: string) {
    setJumpRequest((current) => ({ year, sequence: (current?.sequence || 0) + 1 }))
  }

  return (
    <div className="mj-page">
      <header className="mj-hero artwork-banner">
        <ArtworkBackdrop page="journey" tracks={tracks} showCovers={showCovers} onOpen={onSelect} />
        <div className="mj-hero-orbit mj-hero-orbit-one" aria-hidden="true" />
        <div className="mj-hero-orbit mj-hero-orbit-two" aria-hidden="true" />
        <span className="mj-kicker">
          <Sparkles size={13} /> THE MUSIC JOURNEY
        </span>
        <div className="mj-hero-main">
          <div>
            <h1>
              把心动，
              <br />
              <em>串成一条时间线。</em>
            </h1>
            <p>从早期曲目到新的相遇，沿着年份，寻找你与 PIKASONIC 的那一首。</p>
          </div>
          <Disc3 className="mj-hero-disc" size={118} strokeWidth={0.6} aria-hidden="true" />
        </div>
        <div className="mj-summary">
          <span>
            <CalendarDays size={14} />
            {datedYears.length
              ? `${datedYears[0].year} — ${datedYears[datedYears.length - 1].year}`
              : '等待日期资料'}
          </span>
          <span>
            <Music2 size={14} />
            <strong>{tracks.length}</strong> 首已收录曲目
          </span>
          <span>
            <span className="mj-summary-dot" />
            {datedYears.length} 个发行年份
          </span>
        </div>
        <span className="mj-hero-stamp" aria-hidden="true">
          音の記憶 / RECORDS OF SOUND
        </span>
      </header>

      {years.length === 0 ? (
        <div className="mj-empty">
          <Music2 size={35} />
          <h2>音乐历程，等待第一张记录</h2>
          <p>目录加载后，歌曲会按可用的发行年份出现在这里。</p>
        </div>
      ) : (
        <>
          <div className="mj-toolbar">
            <div>
              <span className="mj-kicker">CHOOSE A YEAR, FIND A MEMORY</span>
              <h2>沿着年份，慢慢听。</h2>
            </div>
            <button
              className="mj-expand-all"
              type="button"
              onClick={() =>
                setExpanded(allExpanded ? new Set() : new Set(years.map((group) => group.year)))
              }
            >
              {allExpanded ? <ChevronUp size={15} /> : <ListMusic size={15} />}
              {allExpanded ? '收起全部曲目' : '展开全部曲目'}
            </button>
          </div>
          <nav className="mj-year-nav" aria-label="跳转到发行年份">
            {years.map(({ year, tracks: items }) => (
              <button
                type="button"
                key={year}
                className={`mj-year-link ${selectedYear === year ? 'mj-year-link-active' : ''}`}
                onClick={() => jump(year)}
                aria-label={`跳转至${year === 'unknown' ? '年份待核实' : `${year}年`}，${items.length}首曲目`}
                aria-current={selectedYear === year ? 'location' : undefined}
              >
                <span>{year === 'unknown' ? '年份待核实' : year}</span>
                <small>{items.length}</small>
              </button>
            ))}
          </nav>
          <p className="mj-source-note">
            依据当前目录的发行日期排列，日期可能为平台重发行日期，并非创作或首次公开时间。这里记录已收录作品，不代表完整的创作年表。
          </p>

          <div className="mj-timeline">
            {years.map(({ year, tracks: items, featured, hasPopularity }, index) => {
              const open = expanded.has(year)
              return (
                <section
                  className="mj-year-section"
                  key={year}
                  aria-labelledby={`mj-heading-${year}`}
                >
                  <div className="mj-year-marker" aria-hidden="true">
                    <span className="mj-node" />
                    <span className="mj-year-number">{year === 'unknown' ? '—' : year}</span>
                    <small>CHAPTER {String(index + 1).padStart(2, '0')}</small>
                  </div>
                  <div className="mj-year-content" id={`mj-year-${year}`} tabIndex={-1}>
                    <div className="mj-year-heading">
                      <div>
                        <span className="mj-year-caption">
                          {year === 'unknown' ? 'MORE TO DISCOVER' : `SOUNDS OF ${year}`}
                        </span>
                        <h2 id={`mj-heading-${year}`}>
                          {year === 'unknown' ? '年份待核实' : `${year}，留下这些旋律。`}
                        </h2>
                      </div>
                      <span className="mj-count">
                        <strong>{items.length}</strong>首收录
                      </span>
                    </div>
                    {featured.length > 0 && (
                      <>
                        <div className="mj-featured">
                          {featured.map((track) => {
                            const link = neteaseLink(track, netease)
                            return (
                              <article className="mj-card" key={track.id}>
                                <button
                                  className="mj-track-open"
                                  type="button"
                                  onClick={() => onSelect(track)}
                                  aria-label={`阅读《${track.title}》的歌曲导听`}
                                >
                                  <JourneyArtwork track={track} showCovers={showCovers} />
                                  <span className="mj-card-title">{track.title}</span>
                                  <span className="mj-card-artist">{track.artist}</span>
                                </button>
                                <div className="mj-card-meta">
                                  <span>{formatDate(track.releaseDate)}</span>
                                  <a
                                    href={link.url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    aria-label={`在网易云${link.direct ? '打开' : '搜索'}《${track.title}》`}
                                  >
                                    {link.direct ? '网易云' : '网易云搜索'}
                                    <ArrowUpRight size={11} />
                                  </a>
                                </div>
                              </article>
                            )
                          })}
                        </div>
                        <p className="mj-selection-note">
                          {hasPopularity
                            ? '优先参考网易云艺人热歌顺序，缺失时按发行日期补充；热歌顺序不等于播放量。'
                            : '按目录发行日期选取部分不同封面作品。'}
                          展开曲单可查看{year === 'unknown' ? '这个分组' : '这一年'}全部已收录曲目。
                        </p>
                      </>
                    )}
                    <button
                      className="mj-year-toggle"
                      type="button"
                      onClick={() => toggle(year)}
                      aria-expanded={open}
                      aria-controls={`mj-list-${year}`}
                    >
                      <span>
                        <ListMusic size={15} />
                        {open
                          ? '收起完整曲单'
                          : `展开${year === 'unknown' ? '' : ` ${year} 年`}曲单`}
                        <small>{items.length} 首</small>
                      </span>
                      {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    <ol className="mj-track-list" id={`mj-list-${year}`} hidden={!open}>
                      {items.map((track, trackIndex) => (
                        <li key={track.id}>
                          <button
                            type="button"
                            onClick={() => onSelect(track)}
                            aria-label={`查看《${track.title}》，发行日期${formatDate(track.releaseDate)}`}
                          >
                            <span className="mj-track-index">
                              {String(trackIndex + 1).padStart(2, '0')}
                            </span>
                            <span className="mj-track-copy">
                              <strong>{track.title}</strong>
                              <small>{track.artist}</small>
                            </span>
                            <time
                              dateTime={
                                /^\d{4}-\d{2}-\d{2}/.test(track.releaseDate || '')
                                  ? track.releaseDate.slice(0, 10)
                                  : undefined
                              }
                            >
                              {formatDate(track.releaseDate)}
                            </time>
                            <ArrowUpRight size={15} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>
                </section>
              )
            })}
          </div>
          <div className="mj-endnote">
            <span className="mj-end-star">
              <Sparkles size={20} />
            </span>
            <h3>下一次心动，仍在路上。</h3>
            <p>发现遗漏或发行日期需要更新？欢迎通过项目的 GitHub Issue 补充可核验来源。</p>
            <ArrowDown size={15} aria-hidden="true" />
          </div>
        </>
      )}
    </div>
  )
}
