export function euroToCents(input: string): number | null {
  const match = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(input.trim())
  if (!match) return null
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return cents <= 2_147_483_647 ? cents : null
}

export function isPublicShopUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return url.protocol === 'https:' && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(url.hostname) && !url.username && !url.password
  } catch {
    return false
  }
}

// PostgREST can return a plain object as well as an Error.
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return fallback
}
