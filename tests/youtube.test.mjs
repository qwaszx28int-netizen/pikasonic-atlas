import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeYoutubeTitle, videoTitleVariants } from '../scripts/youtube-matching.mjs'

test('official instrumental prefixes survive artist-prefix removal', () => {
  assert.equal(
    normalizeYoutubeTitle('[Instrumental] Nanatsukaze - Remedy'),
    normalizeYoutubeTitle('Remedy (Instrumental)'),
  )
  assert.notEqual(
    normalizeYoutubeTitle('[Instrumental] Nanatsukaze - Remedy', true),
    normalizeYoutubeTitle('Remedy', true),
  )
  for (const marker of ['Mixed', 'VIP', 'PIKASONIC Remix', 'Instrumental'])
    assert.notEqual(
      normalizeYoutubeTitle(`Sakura (${marker})`, true),
      normalizeYoutubeTitle('Sakura', true),
    )
})

test('verified Japanese aliases retain the instrumental version on video matching', () => {
  const variants = videoTitleVariants({
    title: '[Instrumental] Nanatsukaze - Sakura rain',
    songTitle: 'ららら (Instrumental)',
    aliases: ['ららら', 'Sakura rain'],
  }).map((title) => normalizeYoutubeTitle(title))
  assert.ok(variants.includes(normalizeYoutubeTitle('ららら (Instrumental)')))
  assert.ok(!variants.includes(normalizeYoutubeTitle('ららら')))
  assert.ok(!variants.includes(normalizeYoutubeTitle('Sakura rain')))
})
