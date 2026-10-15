import assert from 'node:assert/strict'
import test from 'node:test'
import { pickTrack, trackShareUrl } from '../src/lib/discovery.ts'

test('random discovery stays in the supplied selection and avoids the last track', () => {
  const tracks = Object.freeze([{ id: 'first' }, { id: 'second' }, { id: 'third' }])
  assert.equal(pickTrack(tracks, 'first', () => 0).id, 'second')
  assert.equal(pickTrack(tracks, 'third', () => 0.99).id, 'second')
  assert.equal(pickTrack([tracks[0]], 'first', () => 0.8).id, 'first')
  assert.equal(pickTrack([]), undefined)
  assert.equal(tracks.length, 3)
})

test('shared song links preserve Pages paths and round-trip IDs without injecting parameters', () => {
  const url = new URL(
    trackShareUrl('https://example.github.io/atlas/?lang=zh#main', 'track&测试=1'),
  )
  assert.equal(url.pathname, '/atlas/')
  assert.equal(url.searchParams.get('lang'), 'zh')
  assert.equal(url.searchParams.get('track'), 'track&测试=1')
  assert.equal(url.searchParams.size, 2)
  assert.equal(url.hash, '')
  const closed = new URL(trackShareUrl(url.href))
  assert.equal(closed.searchParams.has('track'), false)
  assert.equal(closed.searchParams.get('lang'), 'zh')
  assert.equal(closed.pathname, '/atlas/')
})
