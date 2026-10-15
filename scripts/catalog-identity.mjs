const appleIds = (track) =>
  new Set(
    [track.appleTrackId, ...(track.releases || []).map((release) => release.appleTrackId)]
      .filter(Boolean)
      .map(String),
  )

function unionRecords(previous = [], current = [], key) {
  return [...new Map([...previous, ...current].map((record) => [key(record), record])).values()]
}

/** Keep published voting keys when a reissue becomes the preferred Apple record. */
export function preserveTrackIdentities(current, previous = []) {
  const claimed = new Set()
  const retainedTrackIds = []
  const tracks = current.map((track) => {
    const ids = appleIds(track)
    const matches = previous.filter(
      (old) =>
        old.id === track.id ||
        [...appleIds(old)].some((id) => ids.has(id)) ||
        (!old.appleTrackId && !track.appleTrackId && old.sourceUrl === track.sourceUrl),
    )
    if (matches.length > 1)
      throw new Error(
        `Refusing to merge previously distinct voting IDs: ${matches.map((old) => old.id).join(', ')}`,
      )
    const old = matches[0]
    if (!old) return track
    if (claimed.has(old.id))
      throw new Error(`Refusing to split an existing voting ID into multiple tracks: ${old.id}`)
    claimed.add(old.id)
    const merged = { ...track, id: old.id }
    for (const field of ['aliases', 'artistAliases', 'albumAliases', 'stores', 'tags', 'projects'])
      if (old[field] || track[field])
        merged[field] = [...new Set([...(old[field] || []), ...(track[field] || [])])]
    merged.releases = unionRecords(old.releases, track.releases, (release) =>
      String(release.appleTrackId || release.sourceUrl),
    )
    if (old.externalSources || track.externalSources)
      merged.externalSources = unionRecords(
        old.externalSources,
        track.externalSources,
        (source) => source.url,
      )
    if (old.creditSources || track.creditSources)
      merged.creditSources = unionRecords(
        old.creditSources,
        track.creditSources,
        (source) => source.url,
      )
    return merged
  })
  for (const old of previous) {
    if (claimed.has(old.id)) continue
    if (tracks.some((track) => track.id === old.id))
      throw new Error(`Conflicting stable voting ID: ${old.id}`)
    // Platform removals or a temporarily incomplete lookup must not delete a
    // published song or strand the votes already stored under its public ID.
    tracks.push(old)
    retainedTrackIds.push(old.id)
  }
  if (new Set(tracks.map((track) => track.id)).size !== tracks.length)
    throw new Error('Duplicate voting IDs after catalogue reconciliation')
  tracks.sort(
    (a, b) =>
      (b.releaseDate || '').localeCompare(a.releaseDate || '') ||
      a.title.localeCompare(b.title, 'ja'),
  )
  return { tracks, retainedTrackIds }
}
