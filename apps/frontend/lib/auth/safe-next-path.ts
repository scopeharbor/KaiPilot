export function safeNextPath(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback

  const path = value.split('#', 1)[0] ?? ''
  if (path === '/login' || path.startsWith('/login?')) return fallback
  return value
}
