/** Normalize public video titles without discarding recording-version markers. */
export function normalizeYoutubeTitle(text, core = false) {
  let title = String(text || '')
    .normalize('NFKC')
    .toLowerCase()
  const instrumentalPrefix = /^\s*\[instrumental\]\s*/.test(title)
  title = title.replace(/^\s*\[instrumental\]\s*/, '')
  const split = title.match(/^(.+?)\s+-\s+(.+)$/)
  if (
    split &&
    (/pikasonic|nanatsukaze|ナナツカゼ/i.test(split[1]) || /pikasonic\s+remix/i.test(split[2]))
  )
    title = split[2]
  title = title.replace(
    /【[^】]*】|\[(?:[^\]]*release|music video|official video)\]|\((?:[^)]*release|official video|performance video)\)/gi,
    '',
  )
  if (instrumentalPrefix && !/instrumental/i.test(title)) title += ' (instrumental)'
  if (core) title = title.replace(/(?:\(|\[)?(?:feat\.?|ft\.?|w\/)\s*[^)\]]*(?:\)|\])?/gi, '')
  title = title.replace(/\bft\.?/g, 'feat').replace(/\bver\.?\b/g, 'version')
  return title.replace(/[^\p{L}\p{N}]/gu, '')
}

export function videoTitleVariants(video) {
  const title = video.songTitle || video.title
  const instrumental = /\binstrumental\b/i.test(`${video.title} ${title}`)
  return [...new Set([title, ...(video.aliases || [])])].map((variant) =>
    instrumental && !/\binstrumental\b/i.test(variant) ? `${variant} (Instrumental)` : variant,
  )
}
