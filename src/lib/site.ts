import { safeExternalUrl } from './catalog'

const configured = safeExternalUrl(
  import.meta.env.VITE_REPOSITORY_URL || 'https://github.com/qwaszx28int-netizen/pikasonic-atlas',
)
export const REPOSITORY_URL =
  configured && /^https:\/\/github\.com\/[^/]+\/[^/?#]+\/?$/.test(configured)
    ? configured.replace(/\/$/, '')
    : ''
