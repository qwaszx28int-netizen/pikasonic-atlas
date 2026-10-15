import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, ChevronUp, Heart, RefreshCw, ThumbsUp, Trophy, Users } from 'lucide-react'
import type { Track } from '../lib/catalog'
import { genreLabel } from '../lib/genres'
import ArtworkBackdrop from './ArtworkBackdrop'

interface Leaderboard {
  entries: { trackId: string; votes: number }[]
  counts: Record<string, number>
  totalVotes: number
  totalVoters: number
}
const EMPTY: Leaderboard = { entries: [], counts: {}, totalVotes: 0, totalVoters: 0 }

export function useVoting() {
  const [leaderboard, setLeaderboard] = useState<Leaderboard>(EMPTY)
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set())
  const [available, setAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const busy = useRef(new Set<string>())
  const mounted = useRef(true)
  const refresh = useCallback(async () => {
    try {
      const [rankingResponse, personalResponse] = await Promise.all([
        fetch('/api/leaderboard', { credentials: 'same-origin', cache: 'no-store' }),
        fetch('/api/votes', { credentials: 'same-origin', cache: 'no-store' }),
      ])
      if (!rankingResponse.ok || !personalResponse.ok) throw new Error('Unavailable')
      const [ranking, personal] = await Promise.all([
        rankingResponse.json(),
        personalResponse.json(),
      ])
      if (!Array.isArray(ranking.entries) || !Array.isArray(personal.votedTrackIds))
        throw new Error('Unavailable')
      if (mounted.current) {
        setLeaderboard({ ...ranking, counts: ranking.counts || {} })
        setVotedIds(new Set(personal.votedTrackIds))
        setAvailable(true)
      }
    } catch {
      if (mounted.current) setAvailable(false)
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const timer = window.setInterval(() => {
      if (!document.hidden && !busy.current.size) void refresh()
    }, 30000)
    return () => {
      mounted.current = false
      window.clearInterval(timer)
    }
  }, [refresh])
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 3500)
    return () => window.clearTimeout(timer)
  }, [message])
  async function vote(track: Track) {
    if (!available || busy.current.has(track.id)) return
    busy.current.add(track.id)
    setPending(new Set(busy.current))
    try {
      const response = await fetch(`/api/votes/${encodeURIComponent(track.id)}`, {
        method: votedIds.has(track.id) ? 'DELETE' : 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '投票暂时没有成功，请重试。')
      await refresh()
      if (mounted.current) setMessage(data.voted ? '投票已计入共享排行榜' : '已撤回这首作品的投票')
    } catch (error) {
      if (mounted.current)
        setMessage(error instanceof Error ? error.message : '投票未成功，请稍后重试。')
    } finally {
      busy.current.delete(track.id)
      if (mounted.current) setPending(new Set(busy.current))
    }
  }
  return { leaderboard, votedIds, available, loading, pending, message, refresh, vote }
}

export type VotingState = ReturnType<typeof useVoting>

export function VoteButton({
  track,
  voting,
  detail = false,
}: {
  track: Track
  voting: VotingState
  detail?: boolean
}) {
  const voted = voting.votedIds.has(track.id)
  const pending = voting.pending.has(track.id)
  return (
    <button
      className={`vote-button ${voted ? 'has-voted' : ''} ${detail ? 'vote-button-detail' : ''}`}
      disabled={!voting.available || pending}
      onClick={() => void voting.vote(track)}
      aria-pressed={voted}
      aria-label={`${voted ? '撤回' : '给'}《${track.title}》${voted ? '的投票' : '投票'}`}
      title={
        !voting.available
          ? '投票服务暂不可用'
          : voted
            ? '再次点击可撤回这首歌的投票'
            : '每个浏览器每首作品可投一票'
      }
    >
      {pending ? (
        <RefreshCw size={14} className="spinning" />
      ) : (
        <ThumbsUp size={14} fill={voted ? 'currentColor' : 'none'} />
      )}
      <span>{pending ? '提交中' : voted ? '已投票' : '投一票'}</span>
      <strong>
        {voting.available ? (voting.leaderboard.counts[track.id] || 0).toLocaleString() : '—'}
      </strong>
    </button>
  )
}

export function Ranking({
  tracks,
  voting,
  showCovers,
  onOpen,
  onBrowse,
}: {
  tracks: Track[]
  voting: VotingState
  showCovers: boolean
  onOpen: (track: Track) => void
  onBrowse: () => void
}) {
  const entries = voting.leaderboard.entries.flatMap((entry) => {
    const track = tracks.find((item) => item.id === entry.trackId)
    return track ? [{ ...entry, track }] : []
  })
  return (
    <div className="ranking-page">
      <div className="ranking-hero artwork-banner">
        <ArtworkBackdrop page="ranking" tracks={tracks} showCovers={showCovers} onOpen={onOpen} />
        <span className="eyebrow">CHOSEN BY LISTENERS, SHARED BY EVERYONE</span>
        <div className="ranking-title">
          <h1>让喜欢，被更多人听见。</h1>
          <Trophy size={43} strokeWidth={1.2} />
        </div>
        <p>为心动的作品投一票，和大家一起选出 PIKASONIC 人气前十。</p>
        <div className="ranking-stats">
          <span>
            <ThumbsUp size={14} />
            <strong>{voting.available ? voting.leaderboard.totalVotes : '—'}</strong>票心动
          </span>
          <span>
            <Users size={15} />
            <strong>{voting.available ? voting.leaderboard.totalVoters : '—'}</strong>个参与浏览器
          </span>
          <span>
            <span className={`live-dot ${voting.available ? 'online' : ''}`} />
            {voting.available
              ? '共享榜单 · 每 30 秒更新'
              : voting.loading
                ? '正在连接榜单'
                : '投票服务暂不可用'}
          </span>
        </div>
      </div>
      <div className="ranking-heading">
        <div>
          <span className="eyebrow">THE COMMUNITY TOP 10</span>
          <h2>
            此刻，大家的心动<span>TOP 10</span>
          </h2>
        </div>
        <button className="ranking-refresh" onClick={() => void voting.refresh()}>
          <RefreshCw size={14} />
          刷新榜单
        </button>
      </div>
      {!voting.available ? (
        <div className="empty-state">
          <Trophy size={39} />
          <h3>{voting.loading ? '正在收集大家的心动' : '暂时没能连接投票服务'}</h3>
          <p>
            {voting.loading
              ? '稍等片刻，正在读取共享榜单。'
              : '共享排行榜需要投票服务在线。请稍后重试，歌曲资料仍可正常浏览。'}
          </p>
          <button className="button-primary" onClick={() => void voting.refresh()}>
            重新连接
            <RefreshCw size={14} />
          </button>
        </div>
      ) : entries.length === 0 ? (
        <div className="empty-state">
          <Heart size={38} />
          <h3>第一份心动，等你来点亮</h3>
          <p>还没有作品获得投票。为喜欢的歌投票，它就会出现在这里。</p>
          <button className="button-primary" onClick={onBrowse}>
            去发现作品
            <ArrowUpRight size={16} />
          </button>
        </div>
      ) : (
        <div className="ranking-list">
          {entries.map(({ track, votes }, index) => (
            <article className={`ranking-entry ${index < 3 ? 'on-podium' : ''}`} key={track.id}>
              <span className={`rank-position rank-${index + 1}`}>
                {String(index + 1).padStart(2, '0')}
                {index === 0 && <Trophy size={13} />}
              </span>
              <button className="ranking-track" onClick={() => onOpen(track)}>
                <div className="ranking-cover">
                  {showCovers && track.artworkUrl ? (
                    <img
                      src={track.artworkUrl}
                      alt={`《${track.album}》发行封面`}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={(event) => {
                        event.currentTarget.style.visibility = 'hidden'
                      }}
                    />
                  ) : (
                    <Trophy size={23} strokeWidth={1} />
                  )}
                </div>
                <span>
                  <strong>{track.title}</strong>
                  <small>{track.artist}</small>
                </span>
              </button>
              <span className="ranking-genre">{genreLabel(track)}</span>
              <div className="ranking-votes">
                <strong>{votes.toLocaleString()}</strong>
                <span>票心动</span>
              </div>
              <VoteButton track={track} voting={voting} />
            </article>
          ))}
        </div>
      )}
      <div className="voting-rules">
        <ChevronUp size={17} />
        <div>
          <h3>让每份喜欢，都被认真记下。</h3>
          <p>
            每个浏览器可为多首作品投票，同一作品最多保留一票，也可以随时撤回。排名按总票数排序，同票作品依曲目
            ID 稳定排列。榜单表示本站访客偏好，参与数按浏览器身份计算，不代表独立真人数或官方热度。
          </p>
        </div>
      </div>
    </div>
  )
}
