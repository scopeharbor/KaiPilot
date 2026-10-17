/**
 * 轻量 JWT 解码（**仅用于前端展示层**：解析 access token 的权限声明与过期时间）。
 *
 * 不做任何签名校验——一切权限判定以服务端为准（前端权限仅控展示，非安全边界）。
 */

export interface AccessTokenClaims {
  sub: number
  organizationId: number | null
  roleVersion: number
  permissions: string[]
  /**
   * 套餐（低敏展示声明）：'free' | 'team' | 'enterprise'。
   * 仅透传原始字符串，合法性校验在 `auth-store.normalizePlanTier` 统一做。
   */
  planTier?: string | null
  iat?: number
  exp?: number
}

/** base64url → 字符串（兼容浏览器与 jsdom）。 */
function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const withPad = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  if (typeof atob === 'function') {
    return decodeURIComponent(
      atob(withPad)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    )
  }
  // Node 回退
  return Buffer.from(withPad, 'base64').toString('utf-8')
}

/**
 * 解析 access token 的 payload。非法 token 返回 null（不抛错）。
 */
export function decodeAccessToken(token: string): AccessTokenClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const json = base64UrlDecode(parts[1]!)
    const raw = JSON.parse(json) as Record<string, unknown>
    return {
      sub: Number(raw.sub),
      organizationId: (raw.organizationId as number | null) ?? null,
      roleVersion: (raw.roleVersion as number) ?? 0,
      permissions: Array.isArray(raw.permissions) ? (raw.permissions as string[]) : [],
      planTier: raw.planTier === null || raw.planTier === undefined ? null : String(raw.planTier),
      iat: raw.iat as number | undefined,
      exp: raw.exp as number | undefined,
    }
  } catch {
    return null
  }
}

/** access token 是否已过期（含 30s 时钟偏移缓冲）。 */
export function isTokenExpired(token: string, skewSeconds = 30): boolean {
  const claims = decodeAccessToken(token)
  if (!claims?.exp) return true
  return claims.exp <= Math.floor(Date.now() / 1000) + skewSeconds
}
