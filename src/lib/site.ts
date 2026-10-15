import { safeExternalUrl } from './catalog'

const configured = safeExternalUrl(
  import.meta.env.VITE_REPOSITORY_URL || 'https://github.com/qwaszx28int-netizen/pikasonic-atlas',
)
export const REPOSITORY_URL =
  configured && /^https:\/\/github\.com\/[^/]+\/[^/?#]+\/?$/.test(configured)
    ? configured.replace(/\/$/, '')
    : ''

const originalPreview =
  typeof window !== 'undefined' &&
  window.location.origin === 'https://qwaszx28int-netizen.github.io' &&
  /^\/pikasonic-atlas(?:\/|$)/.test(window.location.pathname)

export const FULL_SITE_URL =
  safeExternalUrl(
    import.meta.env.VITE_FULL_SITE_URL ||
      (originalPreview ? 'https://pikasonic-atlas.netlify.app' : ''),
  ) || ''
