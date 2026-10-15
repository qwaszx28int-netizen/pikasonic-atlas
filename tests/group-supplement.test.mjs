import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GROUP_CHANNEL_ID,
  groupSupplementFromInventory,
  groupVideoTitle,
} from '../scripts/group-supplement.mjs'

const video = (extra = {}) => ({
  id: '4zEyJ2CgIBY',
  title: '[Instrumental] Nanatsukaze - Remedy',
  duration: '3:44',
  artworkUrl: 'https://i.ytimg.com/vi/4zEyJ2CgIBY/hqdefault.jpg',
  channelId: GROUP_CHANNEL_ID,
  official: true,
  verified: true,
  isFullSong: true,
  version: 'instrumental',
  ...extra,
})

test('an instrumental before the artist prefix survives title cleanup', () => {
  assert.equal(groupVideoTitle(video()), 'Remedy (Instrumental)')
  assert.equal(groupVideoTitle(video({ songTitle: 'Remedy' })), 'Remedy (Instrumental)')
})

test('official standalone instrumentals keep version markers on every alias', () => {
  const { tracks } = groupSupplementFromInventory(
    { videos: [video({ aliases: ['四面楚歌'] })] },
    { tracks: [] },
  )
  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].id, 'youtube-4zEyJ2CgIBY')
  assert.equal(tracks[0].kind, 'instrumental')
  assert.ok(tracks[0].aliases.every((alias) => /instrumental/i.test(alias)))
  assert.equal(tracks[0].genre, '')
  assert.equal(tracks[0].releaseDate, '')
})

test('a vocal Apple release cannot absorb its instrumental, while existing instrumentals are not duplicated', () => {
  const vocal = { appleTrackId: 1, title: '四面楚歌', aliases: ['Remedy'], artist: 'ナナツカゼ' }
  assert.equal(
    groupSupplementFromInventory({ videos: [video()] }, { tracks: [vocal] }).tracks.length,
    1,
  )
  const instrumental = {
    ...vocal,
    appleTrackId: 2,
    title: '四面楚歌 (Instrumental)',
    aliases: ['Remedy (Instrumental)'],
  }
  assert.equal(
    groupSupplementFromInventory({ videos: [video()] }, { tracks: [vocal, instrumental] }).tracks
      .length,
    0,
  )
})

test('unverified channels, excerpts, medleys and unreviewed versions cannot create catalogue songs', () => {
  for (const extra of [
    { official: false },
    { verified: false },
    { channelId: 'unrelated' },
    { isFullSong: false },
    { version: 'medley' },
    { version: 'acoustic-excerpt' },
  ])
    assert.equal(
      groupSupplementFromInventory({ videos: [video(extra)] }, { tracks: [] }).tracks.length,
      0,
    )
})
