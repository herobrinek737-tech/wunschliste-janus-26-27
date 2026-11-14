import type { WishListSlug } from './types'

const storageKey = 'wishlist-bulk-delete-link'

export function rememberBulkDelete(list: WishListSlug, state: string) {
  localStorage.setItem(storageKey, JSON.stringify({ list, state, expiresAt: Date.now() + 600_000 }))
}

function readReturn() {
  const url = new URL(location.href)
  const code = url.searchParams.get('code')
  if (!code) return null
  try {
    const pending = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (!pending || (pending.list !== 'janus' && pending.list !== 'marlene') ||
      typeof pending.state !== 'string' || pending.expiresAt < Date.now()) return null
    const list = pending.list as WishListSlug
    url.searchParams.delete('code')
    url.searchParams.delete('flow_id')
    if (list === 'marlene') url.searchParams.set('list', list)
    else url.searchParams.delete('list')
    url.hash = '#/admin'
    history.replaceState(history.state, '', url)
    return { list, state: pending.state as string, code }
  } catch {
    return null
  }
}

export let bulkDeleteReturn = readReturn()

export function clearBulkDeleteReturn() {
  bulkDeleteReturn = null
  try { localStorage.removeItem(storageKey) } catch { /* The current confirmation has already ended. */ }
}
