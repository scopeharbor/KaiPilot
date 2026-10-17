/**
 * 帮助中心 Route Handler 鉴权（v3-help-and-operational-issues-center 1.3）。
 *
 * Agent/复制 Markdown 出口不信任前端解密 token：以 Bearer token 回调后端
 * `GET /api/v1/auth/me`（AuthController.me，与 `/account/profile` 同 handler，
 * 返回 { user, permissions }；`/auth/profile` 是历史注释里的别名，实际未注册）
 * 做权威校验，返回用户权限集，供文章 permission/edition 过滤
 * （spec「Web and Agent consume one Markdown source」）。
 */
import { API_BASE_URL } from '@/lib/api-client'

export interface HelpActor {
  userId: number
  permissions: string[]
}

/**
 * 校验 Bearer token。无效/过期/后端不可用 → null（路由返回 401，不泄露细节）。
 * 不在日志中输出 token。
 *
 * 说明：本机开发时后端可能只绑定 IPv4，而 Node fetch 对 `localhost` 优先解析 ::1；
 * 首次失败后以 127.0.0.1 回退重试一次（仅当原 host 为 localhost 时）。
 */
const PROFILE_PATH = '/auth/me'

async function profileFetch(url: string, token: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    // 帮助内容出口不需要后端 cookie 会话
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })
}

export async function verifyHelpActor(authorization: string | null): Promise<HelpActor | null> {
  if (!authorization || !authorization.startsWith('Bearer ')) return null
  const token = authorization.slice('Bearer '.length).trim()
  if (!token) return null

  const base = API_BASE_URL.replace(/\/$/, '')
  const candidates = [base]
  try {
    const { hostname } = new URL(base)
    if (hostname === 'localhost' || hostname === '') {
      candidates.push(base.replace(/^https?:\/\/localhost(?=([:/]|$))/i, 'http://127.0.0.1'))
      candidates.push(base.replace(/^https?:\/\/(?=([:/]|$))/, 'http://127.0.0.1'))
    }
  } catch {
    // 忽略解析失败
  }

  for (const url of candidates) {
    try {
      const res = await profileFetch(`${url}${PROFILE_PATH}`, token)
      if (!res.ok) return null
      const body = (await res.json()) as {
        data?: { user?: { id?: number }; permissions?: string[] }
      }
      const userId = body.data?.user?.id
      if (typeof userId !== 'number') return null
      return { userId, permissions: body.data?.permissions ?? [] }
    } catch {
      // 尝试下一个候选
    }
  }
  return null
}

/** 文章权限过滤：frontmatter.permissions 非空时，actor 必须命中其一。 */
export function canAccessArticle(articlePermissions: readonly string[], actor: HelpActor): boolean {
  if (articlePermissions.length === 0) return true
  return articlePermissions.some((p) => actor.permissions.includes(p))
}
