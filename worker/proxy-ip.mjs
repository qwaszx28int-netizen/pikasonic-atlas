const encoder = new TextEncoder()
const IPV4_PART = /^(?:0|[1-9]\d{0,2})$/
const IPV6_WORD = /^[0-9a-f]{1,4}$/i

function ipv4Parts(value) {
  const parts = value.split('.')
  if (parts.length !== 4 || parts.some((part) => !IPV4_PART.test(part) || Number(part) > 255))
    return undefined
  return parts.map(Number)
}

// Accept a single plain address, not lists, ports, URL brackets or zone IDs.
// Expand IPv6 so equivalent spellings cannot create different limiter buckets.
export function normalizeClientIp(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 45) return undefined
  if (/[^0-9a-f:.]/i.test(value)) return undefined
  const v4 = ipv4Parts(value)
  if (v4) return v4.join('.')
  if (!value.includes(':')) return undefined
  let address = value
  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':')
    const tail = ipv4Parts(address.slice(lastColon + 1))
    if (!tail) return undefined
    address = `${address.slice(0, lastColon + 1)}${((tail[0] << 8) | tail[1]).toString(16)}:${((tail[2] << 8) | tail[3]).toString(16)}`
  }
  const halves = address.split('::')
  if (halves.length > 2) return undefined
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if ([...left, ...right].some((word) => !IPV6_WORD.test(word))) return undefined
  if (halves.length === 1 && left.length !== 8) return undefined
  if (halves.length === 2 && left.length + right.length >= 8) return undefined
  return [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    .map((word) => Number.parseInt(word, 16).toString(16))
    .join(':')
}

function validSecret(value) {
  return typeof value === 'string' && value.length >= 32 && value.length <= 4096
}

async function secretMatches(expected, actual) {
  if (!validSecret(expected) || !validSecret(actual)) return false
  const [left, right] = await Promise.all(
    [expected, actual].map(
      async (value) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))),
    ),
  )
  let difference = 0
  for (let i = 0; i < 32; i++) difference |= left[i] ^ right[i]
  return difference === 0
}

export async function authenticatedProxyIp(request, configuredSecret) {
  if (!validSecret(configuredSecret)) return undefined
  const ip = normalizeClientIp(request.headers.get('X-Pikasonic-Client-IP'))
  if (!ip) return undefined
  return (await secretMatches(configuredSecret, request.headers.get('X-Pikasonic-Proxy-Secret')))
    ? ip
    : undefined
}
