import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowDown,
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Disc3,
  ExternalLink,
  Github,
  Grid2X2,
  Heart,
  Image,
  Library,
  List,
  Menu,
  Music2,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Waves,
  X,
  Youtube,
} from 'lucide-react'
import {
  filterTracks,
  formatDate,
  formatDuration,
  isCollaboration,
  isRemix,
  safeExternalUrl,
  sourceLabel,
} from './lib/catalog'
import type { Catalog, Category, SortOrder, Track } from './lib/catalog'
import { getGuide } from './lib/guides'
import { REPOSITORY_URL } from './lib/site'
import { genreLabel, genreDescription, genreInfo } from './lib/genres'
import { neteaseLink } from './lib/netease'
import type { NeteaseCatalog } from './lib/netease'
import { youtubeLink } from './lib/youtube'
import type { YoutubeCatalog } from './lib/youtube'
import { Ranking, VoteButton, useVoting } from './components/Voting'
import type { VotingState } from './components/Voting'
import CoverWall from './components/CoverWall'

type Page = 'explore' | 'tracks' | 'albums' | 'favorites' | 'ranking' | 'about'
type Dialog = { type: 'track'; track: Track } | { type: 'about' } | null
const PAGE_SIZE = 24
const NAV = [
  { id: 'explore', label: '发现音乐', icon: Grid2X2 },
  { id: 'tracks', label: '全部歌曲', icon: AudioLines },
  { id: 'albums', label: '发行专辑', icon: Disc3 },
  { id: 'favorites', label: '我的收藏', icon: Heart },
  { id: 'ranking', label: '心动排行榜', icon: Trophy },
] as const

function readSaved<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

function Cover({
  track,
  className = '',
  enabled = true,
  eager = false,
}: {
  track: Track
  className?: string
  enabled?: boolean
  eager?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const url = safeExternalUrl(track.artworkUrl)
  return (
    <div className={`cover ${className}`}>
      {enabled && url && !failed ? (
        <img
          src={url}
          alt={`《${track.album}》发行封面`}
          loading={eager ? 'eager' : 'lazy'}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="cover-fallback">
          <Waves size={40} strokeWidth={1} />
          <span>{track.title}</span>
          <small>PIKASONIC</small>
        </div>
      )}
    </div>
  )
}

function External({
  href,
  children,
  className = '',
  title,
}: {
  href: string
  children: ReactNode
  className?: string
  title?: string
}) {
  const safe = safeExternalUrl(href)
  return safe ? (
    <a href={safe} className={className} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span className={className}>{children}</span>
  )
}

function Modal({
  children,
  onClose,
  label,
  wide = false,
}: {
  children: ReactNode
  onClose: () => void
  label: string
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
      if (event.key === 'Tab') {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, [tabindex="0"]',
        )
        if (!items?.length) {
          event.preventDefault()
          return
        }
        const first = items[0],
          last = items[items.length - 1]
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === ref.current)
        ) {
          event.preventDefault()
          last.focus()
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || document.activeElement === ref.current)
        ) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.body.style.overflow = oldOverflow
      document.removeEventListener('keydown', keydown)
      previous?.focus()
    }
  }, [])
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        ref={ref}
      >
        <button className="icon-button modal-close" onClick={onClose} aria-label="关闭窗口">
          <X size={21} />
        </button>
        {children}
      </div>
    </div>
  )
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [netease, setNetease] = useState<NeteaseCatalog | null>(null)
  const [youtube, setYoutube] = useState<YoutubeCatalog | null>(null)
  const voting = useVoting()
  const [genre, setGenre] = useState('')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [page, setPage] = useState<Page>('explore')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const [year, setYear] = useState('')
  const [sort, setSort] = useState<SortOrder>('featured')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [favorites, setFavorites] = useState<string[]>(() => {
    const value = readSaved<unknown>('pikasonic:favorites', [])
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  })
  const [showCovers, setShowCovers] = useState(
    () => readSaved<boolean>('pikasonic:covers', true) !== false,
  )
  const [storageNotice, setStorageNotice] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [toast, setToast] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const collectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    fetch(`${import.meta.env.BASE_URL}data/youtube.json`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then(setYoutube)
      .catch(() => {})
    fetch(`${import.meta.env.BASE_URL}data/netease.json`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then(setNetease)
      .catch(() => {})
    fetch(`${import.meta.env.BASE_URL}data/catalog.json`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('目录暂时无法加载')
        return response.json()
      })
      .then((data: Catalog) => {
        if (!Array.isArray(data.tracks) || !data.tracks.length) throw new Error('目录数据不完整')
        setCatalog({
          ...data,
          tracks: data.tracks.map((track) => ({
            ...track,
            id: String(track.id),
            releaseDate: track.releaseDate || '',
          })),
        })
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setError('歌曲目录加载失败，请检查网络后重试。')
      })
    return () => controller.abort()
  }, [retry])

  useEffect(() => {
    try {
      localStorage.setItem('pikasonic:favorites', JSON.stringify(favorites))
      localStorage.setItem('pikasonic:covers', JSON.stringify(showCovers))
    } catch {
      setStorageNotice('浏览器无法保存偏好，收藏仅在本次访问期间有效。')
    }
  }, [favorites, showCovers])

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [query, category, year, genre, sort, page])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (dialog) return
        if (page === 'about' || page === 'ranking') setPage('tracks')
        window.setTimeout(() => searchRef.current?.focus(), 0)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [dialog, page])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const tracks = catalog?.tracks || []
  const favoriteSet = useMemo(() => new Set(favorites), [favorites])
  const results = useMemo(
    () =>
      filterTracks(tracks, {
        query,
        category,
        year,
        sort,
        favorites: page === 'favorites' ? favoriteSet : undefined,
      }).filter((track) => !genre || genreLabel(track) === genre),
    [tracks, query, category, year, genre, sort, page, favoriteSet],
  )
  const genres = useMemo(() => [...new Set(tracks.map(genreLabel))].sort(), [tracks])
  const years = useMemo(
    () =>
      [...new Set(tracks.map((track) => track.releaseDate.slice(0, 4)).filter(Boolean))]
        .sort()
        .reverse(),
    [tracks],
  )
  const albumResults = useMemo(() => {
    const albums = new Map<string, { track: Track; count: number }>()
    for (const track of results) {
      const key = String(track.appleCollectionId || `${track.album}::${track.artist}`)
      const entry = albums.get(key)
      if (entry) entry.count++
      else albums.set(key, { track, count: 1 })
    }
    return [...albums.values()]
  }, [results])

  function toggleFavorite(track: Track) {
    const exists = favoriteSet.has(track.id)
    setFavorites((previous) =>
      exists ? previous.filter((id) => id !== track.id) : [...previous, track.id],
    )
    setToast(exists ? '已从收藏移除' : '已加入我的收藏')
  }
  function navigate(next: Page) {
    setPage(next)
    setSort(next === 'explore' ? 'featured' : 'newest')
    setQuery('')
    setCategory('all')
    setYear('')
    setGenre('')
    setMobileMenu(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function browse() {
    collectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    searchRef.current?.focus({ preventScroll: true })
  }
  function resetFilters() {
    setQuery('')
    setCategory('all')
    setYear('')
    setGenre('')
  }
  const labels: Record<Page, string> = {
    explore: '发现音乐',
    tracks: '全部歌曲',
    albums: '发行专辑',
    favorites: '我的收藏',
    ranking: '心动排行榜',
    about: '关于档案馆',
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        跳转至内容
      </a>
      {mobileMenu && (
        <button
          className="sidebar-scrim"
          aria-label="关闭导航"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
        <button
          className="brand"
          onClick={() => navigate('explore')}
          aria-label="PIKASONIC ATLAS 首页"
        >
          <span className="brand-icon">
            <AudioLines size={26} />
          </span>
          <span>
            <strong>PIKASONIC</strong>
            <small>A T L A S</small>
          </span>
        </button>
        <div className="sidebar-divider" />
        <span className="nav-label">你的音乐坐标</span>
        <nav aria-label="主导航">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? 'active' : ''}`}
              onClick={() => navigate(id)}
              aria-current={page === id ? 'page' : undefined}
            >
              <Icon size={19} strokeWidth={1.7} />
              <span>{label}</span>
              {id === 'favorites' && favorites.length > 0 && (
                <span className="nav-count">{favorites.length}</span>
              )}
              {page === id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-orbit">
            <Sparkles size={23} strokeWidth={1.2} />
          </span>
          <p>
            心动的旋律，
            <br />
            在这里相遇。
          </p>
          <small>
            A little world.
            <br />A lot of daydreams.
          </small>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${page === 'about' ? 'active' : ''}`}
            onClick={() => navigate('about')}
          >
            <CircleHelp size={18} strokeWidth={1.7} />
            <span>关于这个项目</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-status">
            <span />
            独立 · 非官方 · 非营利
          </div>
          <small className="sidebar-credit">MADE FOR THE LOVE OF MUSIC</small>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button menu-toggle"
              aria-label="打开导航"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={22} />
            </button>
            <span className="topbar-root">音乐档案馆</span>
            <span className="breadcrumb-slash">/</span>
            <span>{labels[page]}</span>
          </div>
          <div className="topbar-actions">
            <span className="fan-badge">
              <span /> FAN-MADE ARCHIVE
            </span>
            <span className="topbar-separator" />
            <button className="github-button" onClick={() => setDialog({ type: 'about' })}>
              <Github size={17} />
              <span>开源项目</span>
              <ArrowUpRight size={14} />
            </button>
          </div>
        </header>

        <main id="main" className="main-content">
          {page === 'about' ? (
            <AboutContent
              catalog={catalog}
              showCovers={showCovers}
              onCoversChange={() => setShowCovers((value) => !value)}
            />
          ) : page === 'ranking' ? (
            <Ranking
              tracks={tracks}
              voting={voting}
              showCovers={showCovers}
              onOpen={(track) => setDialog({ type: 'track', track })}
              onBrowse={() => navigate('tracks')}
            />
          ) : (
            <>
              {page === 'explore' ? (
                <>
                  <section className="hero" aria-label="欢迎来到 PIKASONIC 音乐档案馆">
                    <div className="hero-lines" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                    </div>
                    <div className="hero-copy">
                      <span className="hero-eyebrow">
                        <span /> PIKASONIC / SOUND & DAYDREAMS
                      </span>
                      <h1>
                        每一份心动，
                        <br />
                        <em>都有它的 BGM。</em>
                        <span className="hero-star">✧</span>
                      </h1>
                      <p>
                        穿过音符与幻想，遇见下一首心动。
                        <br />
                        欢迎来到你的 PIKASONIC 音乐宇宙。
                      </p>
                      <div className="hero-actions">
                        <button className="hero-cta" onClick={browse}>
                          进入音乐宇宙
                          <ArrowUpRight size={18} />
                        </button>
                        <button className="hero-secondary" onClick={() => navigate('ranking')}>
                          <Trophy size={14} />
                          心动 TOP 10
                        </button>
                      </div>
                    </div>
                    <CoverWall
                      tracks={tracks}
                      showCovers={showCovers}
                      onOpen={(track) => setDialog({ type: 'track', track })}
                    />
                    <span className="hero-japanese" aria-hidden="true">
                      音楽が、きらめく。
                    </span>
                    <span className="hero-twinkle t1" aria-hidden="true">
                      ✦
                    </span>
                    <span className="hero-twinkle t2" aria-hidden="true">
                      ✧
                    </span>
                    <span className="hero-twinkle t3" aria-hidden="true">
                      ✦
                    </span>
                    <span className="hero-bottom-label">
                      音楽 × イラスト × ときめき · A LITTLE WORLD OF PIKASONIC
                    </span>
                  </section>
                  <div className="archive-intro">
                    <p>
                      <span className="intro-icon">
                        <Library size={17} />
                      </span>
                      一份不断生长的音乐档案<span className="intro-separator">·</span>
                      <strong>{tracks.length || '—'}</strong>首已收录
                      <span className="intro-separator">/</span>
                      <strong>{catalog?.stats.releaseCount || '—'}</strong>张发行
                    </p>
                    <button onClick={() => setDialog({ type: 'about' })}>
                      了解档案
                      <ArrowUpRight size={13} />
                    </button>
                  </div>
                </>
              ) : (
                <div className="page-heading">
                  <span className="eyebrow">
                    {page === 'favorites'
                      ? 'YOUR PERSONAL COLLECTION'
                      : page === 'albums'
                        ? 'RELEASES & RECORDS'
                        : 'EVERY MELODY, ONE PLACE'}
                  </span>
                  <h1>
                    {labels[page]}
                    <span className="heading-spark">✳</span>
                  </h1>
                  <p>
                    {page === 'favorites'
                      ? '把喜欢的旋律留在这里，下次再见。收藏保存在当前浏览器。'
                      : page === 'albums'
                        ? '从一张封面开始，走近每一次发行。'
                        : '沿着旋律的轨迹，发现下一首喜欢的歌。'}
                  </p>
                </div>
              )}

              <section className="collection" ref={collectionRef} aria-label="歌曲目录">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">
                      {page === 'albums'
                        ? 'THE RELEASES'
                        : page === 'favorites'
                          ? 'SAVED FOR LATER'
                          : 'THE DISCOGRAPHY'}
                    </span>
                    <h2>
                      {page === 'albums'
                        ? '探索发行'
                        : page === 'favorites'
                          ? '心动收藏夹'
                          : '探索作品'}
                      <span className="count-badge">
                        {page === 'albums' ? albumResults.length : results.length}
                      </span>
                    </h2>
                  </div>
                  <div className="section-heading-right">
                    <span className="collection-hint">每一首，都是一个小小的宇宙</span>
                    {page !== 'albums' && (
                      <div className="view-switch" aria-label="展示方式">
                        <button
                          className={view === 'grid' ? 'selected' : ''}
                          onClick={() => setView('grid')}
                          aria-label="网格视图"
                          aria-pressed={view === 'grid'}
                        >
                          <Grid2X2 size={16} />
                        </button>
                        <button
                          className={view === 'list' ? 'selected' : ''}
                          onClick={() => setView('list')}
                          aria-label="列表视图"
                          aria-pressed={view === 'list'}
                        >
                          <List size={18} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="search-row">
                  <div className="search-field">
                    <Search size={19} strokeWidth={1.6} />
                    <input
                      ref={searchRef}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="搜索歌名、专辑或合作艺人…"
                      aria-label="搜索歌名、专辑或合作艺人"
                    />
                    {query ? (
                      <button
                        className="icon-button clear-search"
                        onClick={() => {
                          setQuery('')
                          searchRef.current?.focus()
                        }}
                        aria-label="清除搜索"
                      >
                        <X size={16} />
                      </button>
                    ) : (
                      <kbd>Ctrl K</kbd>
                    )}
                  </div>
                  <label className="sort-select">
                    <ArrowDownUp size={15} />
                    <select
                      value={sort}
                      onChange={(event) => setSort(event.target.value as SortOrder)}
                      aria-label="排序方式"
                    >
                      <option value="featured">编辑选曲</option>
                      <option value="newest">最新发行</option>
                      <option value="oldest">最早发行</option>
                      <option value="title">歌曲名称 A–Z</option>
                    </select>
                    <ChevronDown size={13} />
                  </label>
                </div>
                <div className="filter-row">
                  <div className="category-tabs" aria-label="作品类型">
                    {(
                      [
                        { id: 'all', label: '全部作品' },
                        { id: 'solo', label: '个人作品' },
                        { id: 'collab', label: '合作作品' },
                        { id: 'remix', label: 'Remix' },
                      ] as const
                    ).map((item) => (
                      <button
                        className={category === item.id ? 'selected' : ''}
                        key={item.id}
                        onClick={() => setCategory(item.id)}
                        aria-pressed={category === item.id}
                      >
                        {item.id === 'all' && <AudioLines size={14} />}
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="filter-right">
                    <label className="genre-select">
                      <Music2 size={14} />
                      <select
                        value={genre}
                        onChange={(event) => setGenre(event.target.value)}
                        aria-label="歌曲曲风"
                      >
                        <option value="">全部曲风</option>
                        {genres.map((value) => (
                          <option value={value} key={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={12} />
                    </label>
                    <label className="year-select">
                      <SlidersHorizontal size={14} />
                      <select
                        value={year}
                        onChange={(event) => setYear(event.target.value)}
                        aria-label="发行年份"
                      >
                        <option value="">全部年份</option>
                        {years.map((value) => (
                          <option value={value} key={value}>
                            {value} 年
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={12} />
                    </label>
                    <button
                      className={`cover-toggle ${showCovers ? 'enabled' : ''}`}
                      onClick={() => setShowCovers((value) => !value)}
                      aria-pressed={showCovers}
                      title={showCovers ? '切换为纯文字封面' : '显示网络封面'}
                      aria-label={showCovers ? '隐藏网络封面' : '显示网络封面'}
                    >
                      <Image size={16} />
                    </button>
                  </div>
                </div>

                <div className="results-announcement" role="status" aria-live="polite">
                  {query && `“${query}” 的搜索结果：${results.length} 首`}
                </div>
                {error ? (
                  <div className="empty-state">
                    <CircleHelp size={36} />
                    <h3>暂时没能打开档案</h3>
                    <p>{error}</p>
                    <button
                      className="button-primary"
                      onClick={() => setRetry((value) => value + 1)}
                    >
                      重新加载
                      <ArrowRight size={16} />
                    </button>
                  </div>
                ) : !catalog ? (
                  <div className="track-grid" aria-label="正在加载歌曲" aria-busy="true">
                    {Array.from({ length: 8 }, (_, i) => (
                      <div className="skeleton-card" key={i}>
                        <div />
                        <span />
                        <small />
                      </div>
                    ))}
                  </div>
                ) : results.length === 0 ? (
                  <div className="empty-state">
                    {page === 'favorites' && favorites.length === 0 ? (
                      <Heart size={37} />
                    ) : (
                      <Search size={37} />
                    )}
                    <h3>
                      {page === 'favorites' && favorites.length === 0
                        ? '下一份心动，留在这里'
                        : '还没有找到这段旋律'}
                    </h3>
                    <p>
                      {page === 'favorites' && favorites.length === 0
                        ? '点击歌曲旁的爱心，就能把它加入你的收藏夹。'
                        : '试试更短的歌名、合作艺人，或调整筛选条件。'}
                    </p>
                    <button
                      className="button-primary"
                      onClick={() => {
                        if (page === 'favorites' && favorites.length === 0) navigate('tracks')
                        else resetFilters()
                      }}
                    >
                      {page === 'favorites' && favorites.length === 0 ? '去发现歌曲' : '清除筛选'}
                      <ArrowRight size={16} />
                    </button>
                  </div>
                ) : page === 'albums' ? (
                  <div className="track-grid album-grid">
                    {albumResults.slice(0, visibleCount).map(({ track, count }) => (
                      <article
                        className="album-card"
                        key={String(track.appleCollectionId || `${track.album}::${track.artist}`)}
                      >
                        <button
                          className="card-cover-button"
                          onClick={() => {
                            setPage('tracks')
                            setQuery(track.album)
                            setCategory('all')
                            setYear('')
                          }}
                          aria-label={`查看《${track.album}》的歌曲`}
                        >
                          <Cover track={track} enabled={showCovers} />
                          <span className="album-open">
                            <ArrowUpRight size={23} />
                          </span>
                        </button>
                        <div className="album-title">
                          <h3>{track.album}</h3>
                          <Disc3 size={17} />
                        </div>
                        <p>{track.artist}</p>
                        <div className="card-bottom">
                          <span>{track.releaseDate.slice(0, 4) || '年份待核实'}</span>
                          <span>{count} 首收录歌曲</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : view === 'grid' ? (
                  <div className="track-grid">
                    {results.slice(0, visibleCount).map((track, index) => (
                      <article
                        className="track-card"
                        key={track.id}
                        style={{ animationDelay: `${Math.min(index, 7) * 35}ms` }}
                      >
                        <div className="card-art">
                          <button
                            className="card-cover-button"
                            onClick={() => setDialog({ type: 'track', track })}
                            aria-label={`查看《${track.title}》的歌曲解读`}
                          >
                            <Cover track={track} enabled={showCovers} />
                            <span className="cover-shade" />
                            <span className="open-track">
                              <ArrowUpRight size={22} />
                            </span>
                          </button>
                          <span className="card-type">
                            {isRemix(track)
                              ? 'REMIX'
                              : isCollaboration(track)
                                ? 'COLLAB'
                                : 'SINGLE / TRACK'}
                          </span>
                          <button
                            className={`favorite-button ${favoriteSet.has(track.id) ? 'is-favorite' : ''}`}
                            onClick={() => toggleFavorite(track)}
                            aria-label={`${favoriteSet.has(track.id) ? '取消收藏' : '收藏'}《${track.title}》`}
                            aria-pressed={favoriteSet.has(track.id)}
                          >
                            <Heart
                              size={16}
                              fill={favoriteSet.has(track.id) ? 'currentColor' : 'none'}
                            />
                          </button>
                        </div>
                        <button
                          className="track-title-button"
                          onClick={() => setDialog({ type: 'track', track })}
                        >
                          <h3 title={track.title}>{track.title}</h3>
                        </button>
                        <p className="track-artist" title={track.artist}>
                          {track.artist}
                        </p>
                        <div className="track-genre">
                          <span>{genreLabel(track)}</span>
                        </div>
                        <div className="card-bottom">
                          <span>
                            {track.releaseDate.slice(0, 4) || '年份待核实'}
                            <i />
                            {formatDuration(track.durationMs)}
                          </span>
                          <button onClick={() => setDialog({ type: 'track', track })}>
                            歌曲笔记
                            <ArrowUpRight size={12} />
                          </button>
                        </div>
                        <div className="card-tools">
                          <div className="platform-channels">
                            <NeteaseChannel track={track} netease={netease} small />
                            <YoutubeChannel track={track} youtube={youtube} small />
                          </div>
                          <VoteButton track={track} voting={voting} />
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="track-list">
                    <div className="list-head">
                      <span>#</span>
                      <span>歌曲 / 艺人</span>
                      <span>专辑</span>
                      <span>发行日期</span>
                      <span>时长</span>
                      <span>支持与渠道</span>
                      <span />
                    </div>
                    {results.slice(0, visibleCount).map((track, index) => (
                      <div className="track-list-row" key={track.id}>
                        <span className="list-index">{String(index + 1).padStart(2, '0')}</span>
                        <button
                          className="list-track"
                          onClick={() => setDialog({ type: 'track', track })}
                        >
                          <Cover track={track} enabled={showCovers} />
                          <span>
                            <strong>{track.title}</strong>
                            <small>
                              {track.artist} · {genreLabel(track)}
                            </small>
                          </span>
                        </button>
                        <span className="list-album">{track.album}</span>
                        <span className="list-date">{formatDate(track.releaseDate)}</span>
                        <span className="list-duration">{formatDuration(track.durationMs)}</span>
                        <div className="list-channels">
                          <div className="platform-channels">
                            <NeteaseChannel track={track} netease={netease} small />
                            <YoutubeChannel track={track} youtube={youtube} small />
                          </div>
                          <VoteButton track={track} voting={voting} />
                        </div>
                        <button
                          className={`list-favorite icon-button ${favoriteSet.has(track.id) ? 'is-favorite' : ''}`}
                          onClick={() => toggleFavorite(track)}
                          aria-label={`${favoriteSet.has(track.id) ? '取消收藏' : '收藏'}《${track.title}》`}
                          aria-pressed={favoriteSet.has(track.id)}
                        >
                          <Heart
                            size={17}
                            fill={favoriteSet.has(track.id) ? 'currentColor' : 'none'}
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {catalog && !error && results.length > 0 && (
                  <div className="load-more">
                    <span>
                      已展示{' '}
                      {Math.min(
                        visibleCount,
                        page === 'albums' ? albumResults.length : results.length,
                      )}{' '}
                      / {page === 'albums' ? albumResults.length : results.length}{' '}
                      {page === 'albums' ? '张发行' : '首作品'}
                    </span>
                    {visibleCount < (page === 'albums' ? albumResults.length : results.length) && (
                      <button onClick={() => setVisibleCount((value) => value + PAGE_SIZE)}>
                        再发现一些
                        <ArrowDown size={15} />
                      </button>
                    )}
                  </div>
                )}
              </section>

              <section className="endnote">
                <div className="endnote-icon">
                  <BookOpen size={25} strokeWidth={1.4} />
                </div>
                <div>
                  <h3>让喜欢，有迹可循。</h3>
                  <p>这里整理作品资料与聆听线索。真正的音乐体验，请前往正版平台支持创作者。</p>
                </div>
                <External
                  href={
                    catalog?.artist.appleArtistUrl ||
                    'https://music.apple.com/artist/pikasonic/1450218337'
                  }
                >
                  前往艺人主页
                  <ArrowUpRight size={16} />
                </External>
              </section>
            </>
          )}
          <footer className="footer">
            <div>
              <span className="footer-brand">
                <AudioLines size={14} />
                PIKASONIC ATLAS
              </span>
              <p>为热爱而整理 · 非官方、非营利音乐资料站</p>
            </div>
            <div className="footer-right">
              <button onClick={() => setDialog({ type: 'about' })}>
                版权与来源
                <ArrowUpRight size={12} />
              </button>
              <span>
                {catalog ? `目录更新 ${formatDate(catalog.updatedAt)}` : '独立音乐档案'}
                <span className="footer-dot">·</span>WITH LOVE, ALWAYS.
              </span>
            </div>
          </footer>
        </main>
      </div>

      {storageNotice && (
        <div className="storage-notice" role="status">
          {storageNotice}
          <button aria-label="关闭提示" onClick={() => setStorageNotice('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {(toast || voting.message) && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast || voting.message}
        </div>
      )}
      {dialog?.type === 'track' && (
        <Modal label={`歌曲笔记：${dialog.track.title}`} onClose={() => setDialog(null)} wide>
          <TrackDetail
            track={dialog.track}
            showCovers={showCovers}
            favorite={favoriteSet.has(dialog.track.id)}
            onFavorite={() => toggleFavorite(dialog.track)}
            netease={netease}
            youtube={youtube}
            voting={voting}
          />
        </Modal>
      )}
      {dialog?.type === 'about' && (
        <Modal label="关于与版权说明" onClose={() => setDialog(null)} wide>
          <AboutContent
            catalog={catalog}
            showCovers={showCovers}
            onCoversChange={() => setShowCovers((value) => !value)}
            compact
          />
        </Modal>
      )}
    </div>
  )
}

function TrackDetail({
  track,
  showCovers,
  favorite,
  onFavorite,
  netease,
  youtube,
  voting,
}: {
  track: Track
  showCovers: boolean
  favorite: boolean
  onFavorite: () => void
  netease: NeteaseCatalog | null
  youtube: YoutubeCatalog | null
  voting: VotingState
}) {
  const guide = getGuide(track)
  return (
    <div className="track-detail">
      <div className="detail-banner">
        <Cover track={track} enabled={showCovers} eager />
        <div className="detail-summary">
          <span className="eyebrow">A LITTLE NOTE ON THIS TRACK</span>
          <h2>{track.title}</h2>
          <p>{track.artist}</p>
          <div className="detail-chips">
            <span>{genreLabel(track)}</span>
            <span>
              {isRemix(track) ? 'Remix' : isCollaboration(track) ? '合作作品' : '个人作品'}
            </span>
          </div>
          <button className={`save-button ${favorite ? 'saved' : ''}`} onClick={onFavorite}>
            <Heart size={15} fill={favorite ? 'currentColor' : 'none'} />
            {favorite ? '已收藏这首歌' : '收藏这首歌'}
          </button>
        </div>
      </div>
      <div className="detail-body">
        <div className="detail-facts">
          <div>
            <small>发行日期</small>
            <strong>{formatDate(track.releaseDate)}</strong>
          </div>
          <div>
            <small>歌曲时长</small>
            <strong>{formatDuration(track.durationMs)}</strong>
          </div>
          <div>
            <small>收录发行</small>
            <strong>{track.album}</strong>
          </div>
        </div>
        <section className="guide-section">
          <span className="guide-number">01</span>
          <div>
            <h3>认识这首作品</h3>
            <p>{guide.intro}</p>
            <div className="genre-explainer">
              <span>{genreLabel(track)}</span>
              <p>{genreDescription(track)}</p>
              <small>
                曲风标签保留公开来源；未核实的细分流派不会自动添加。{' '}
                <External href={genreInfo(track).sourceUrl}>
                  曲风来源：{genreInfo(track).sourceName}
                  <ArrowUpRight size={10} />
                </External>
              </small>
            </div>
          </div>
        </section>
        <section className="guide-section">
          <span className="guide-number">02</span>
          <div>
            <h3>
              从标题走近音乐<span className="editorial-label">编辑导听</span>
            </h3>
            <p>{guide.titleNote}</p>
            <p>{guide.versionNote}</p>
          </div>
        </section>
        <section className="guide-section">
          <span className="guide-number">03</span>
          <div>
            <h3>带着三个问题聆听</h3>
            <ul className="listening-questions">
              {guide.questions.map((question, index) => (
                <li key={question}>
                  <span>{index + 1}</span>
                  {question}
                </li>
              ))}
            </ul>
          </div>
        </section>
        <div className="editorial-notice">
          <BookOpen size={16} />
          <p>
            发行信息来自公开目录；导听为本站编辑提供的开放式阅读建议，不代表艺人的创作自述。暂无经核实的逐曲制作背景或乐理分析。
          </p>
        </div>
        <div className="detail-vote-box">
          <div>
            <strong>这首歌，也让你心动了吗？</strong>
            <small>投一票，让它出现在大家的前十里。</small>
          </div>
          <VoteButton track={track} voting={voting} detail />
        </div>
        <NeteaseChannel track={track} netease={netease} />
        <YoutubeChannel track={track} youtube={youtube} />
        {sourceLabel(track) !== 'YouTube' && (
          <External href={track.sourceUrl} className="source-button">
            <Music2 size={18} />
            <span>
              在 {sourceLabel(track)} 查看 / 收听
              <small>发行资料与正版试听以平台为准，可能需要账户或订阅</small>
            </span>
            <ExternalLink size={17} />
          </External>
        )}
        <p className="cover-attribution">
          封面由发行平台远程提供，版权归原权利人所有。本网站不托管歌曲音频或完整歌词。
        </p>
      </div>
    </div>
  )
}

function NeteaseChannel({
  track,
  netease,
  small = false,
}: {
  track: Track
  netease: NeteaseCatalog | null
  small?: boolean
}) {
  const link = neteaseLink(track, netease)
  return (
    <External
      href={link.url}
      className={small ? 'netease-small' : 'netease-channel'}
      title={link.direct ? '已匹配网易云歌曲 · 直达' : '未核实歌曲 ID · 前往网易云搜索'}
    >
      <Music2 size={small ? 12 : 18} />
      <span>
        {small ? '网易云' : '网易云音乐'}
        {!small && (
          <small>
            {link.direct ? '已匹配歌曲 · 前往原平台收听' : '尚未核实歌曲 ID · 前往平台搜索该作品'}
          </small>
        )}
      </span>
      {small ? (
        <ArrowUpRight size={10} />
      ) : (
        <>
          <span className="channel-mode">{link.direct ? '歌曲直达' : '歌名搜索'}</span>
          <ExternalLink size={17} />
        </>
      )}
    </External>
  )
}

function YoutubeChannel({
  track,
  youtube,
  small = false,
}: {
  track: Track
  youtube: YoutubeCatalog | null
  small?: boolean
}) {
  const link = youtubeLink(track, youtube)
  return (
    <External
      href={link.url}
      className={small ? 'youtube-small' : 'youtube-channel'}
      title={
        link.direct ? '已匹配官方 YouTube 视频 · 直达' : '尚未匹配官方视频 · 前往 YouTube 搜索'
      }
    >
      <Youtube size={small ? 13 : 19} />
      <span>
        YouTube
        {!small && (
          <small>
            {link.direct
              ? '已匹配官方视频 · 前往原平台观看'
              : '尚未核实对应视频 · 前往平台搜索该作品'}
          </small>
        )}
      </span>
      {small ? (
        <ArrowUpRight size={10} />
      ) : (
        <>
          <span className="channel-mode">{link.direct ? '官方视频' : '歌名搜索'}</span>
          <ExternalLink size={17} />
        </>
      )}
    </External>
  )
}

function AboutContent({
  catalog,
  showCovers,
  onCoversChange,
  compact = false,
}: {
  catalog: Catalog | null
  showCovers: boolean
  onCoversChange: () => void
  compact?: boolean
}) {
  return (
    <div className={`about-content ${compact ? 'about-compact' : ''}`}>
      <span className="eyebrow">AN ARCHIVE MADE WITH LOVE</span>
      <h1>
        关于这份音乐档案<span>。</span>
      </h1>
      <p className="about-lead">
        因为喜欢，所以想把每一份旋律，
        <br />
        好好地整理在一起。
      </p>
      <div className="about-intro">
        <AudioLines size={25} />
        <p>
          <strong>PIKASONIC ATLAS</strong>{' '}
          是一个由乐迷制作的中文歌曲资料与导听项目，独立、非官方、非营利，与 PIKASONIC
          及其唱片公司没有隶属或授权关系。
        </p>
      </div>
      <section className="about-section">
        <h2>
          <Library size={18} />
          我们收录了什么
        </h2>
        <p>
          目前整理了 <strong>{catalog?.tracks.length ?? '—'} 首作品</strong>
          ，覆盖公开目录可查询到的个人发行与合作作品。每首歌曲均提供发行资料、资料解读与开放式聆听问题。
        </p>
        <p>
          本目录来自公开音乐平台，可能受地区上架、下架、署名方式与平台收录范围影响。暂不声称已覆盖全球全部作品；未上架的早期作品、部分重混和其他平台独占作品可能缺失。
        </p>
        {catalog && (
          <div className="source-list">
            {catalog.sources.map((source, index) => (
              <External key={`${source.name}-${index}`} href={source.url}>
                <span>{source.name}</span>
                <ArrowUpRight size={14} />
              </External>
            ))}
            <small>
              最后同步：{formatDate(catalog.updatedAt)} · 同一曲目的重复发行会合并，原版与 Remix
              尽量分别保留。
            </small>
          </div>
        )}
      </section>
      <section className="about-section">
        <h2>
          <ShieldCheck size={18} />
          非营利与版权说明
        </h2>
        <p>
          本项目不销售音乐、不提供音频下载、不复制完整歌词，不投放商业广告。音乐、封面、商标及第三方资料的权利均属于各自权利人。
        </p>
        <div className="rights-callout">
          非营利声明并不等于取得授权，也不能保证免除版权责任。封面展示和其他内容的使用仍应遵守权利人许可、平台条款与适用法律。
        </div>
        <p>
          封面采用发行平台的远程图片链接，并随页面按需加载。若你是权利人或授权代表，可通过部署者
          GitHub 仓库的 Issues
          提交作品链接、权属说明和处理要求；维护者核实后可移除封面、修正资料或下架条目。请勿在公开
          Issue 中提交敏感证件。
        </p>
        <button className="preference-toggle" onClick={onCoversChange} aria-pressed={showCovers}>
          <span>
            <Image size={19} />
            <span>
              <strong>显示网络封面</strong>
              <small>
                {showCovers ? '已开启 · 封面从第三方平台加载' : '已关闭 · 使用本站生成的纯文字封面'}
              </small>
            </span>
          </span>
          <span className={`switch ${showCovers ? 'on' : ''}`}>
            <i />
          </span>
        </button>
      </section>
      <section className="about-section">
        <h2>
          <Github size={18} />
          把热爱做成开源项目
        </h2>
        <p>
          网站使用 React、TypeScript 与 Vite 构建，原创代码采用 MIT 许可证。MIT
          不授予音乐、封面、艺人名称或其他第三方素材的使用权。
        </p>
        <p>
          项目已包含目录同步脚本、贡献指南和 GitHub Pages 部署流程。建立自己的 GitHub
          仓库并推送代码后，在 Settings → Pages 中选择 GitHub Actions 即可部署。
        </p>
        <External href={REPOSITORY_URL || 'https://github.com/new'} className="button-primary">
          {REPOSITORY_URL ? '查看 GitHub 源代码' : '创建 GitHub 仓库'}
          <ArrowUpRight size={16} />
        </External>
        {REPOSITORY_URL && (
          <External href={`${REPOSITORY_URL}/issues`} className="rights-link">
            资料纠错 / 权利请求
            <ArrowUpRight size={14} />
          </External>
        )}
        <p className="about-small">
          欢迎补充有来源的遗漏作品、纠正资料、贡献原创歌评。收藏仅保存在当前浏览器，不会上传至服务器。
        </p>
      </section>
    </div>
  )
}
