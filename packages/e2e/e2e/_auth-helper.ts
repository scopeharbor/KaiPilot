/**
 * E2E Test auth helper.
 */
import type { Page, APIRequestContext } from '@playwright/test'

export const API_BASE = process.env.E2E_API_URL || 'http://localhost:3333/api/v1'

/** 从 JWT claims 解码权限（登录响应体的 permissions 可能为空，令牌内才是权威集）。 */
export function tokenPermissions(accessToken?: string): string[] {
  if (!accessToken) return []
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString()) as {
      permissions?: string[]
    }
    return Array.isArray(payload.permissions) ? payload.permissions : []
  } catch {
    return []
  }
}
const ADMIN_CREDENTIALS = { email: 'admin@test.local', password: 'Passw0rd!' }

export interface AuthSession {
  user: {
    id: number
    email: string
    fullName: string
    organizations: Array<{ id: number; name: string; slug: string; role: string }>
  }
  accessToken: string
  refreshToken: string
  permissions: string[]
  currentOrganizationId: number
  roleVersion: number
  isAuthenticated: boolean
}

export async function loginAsAdmin(request: APIRequestContext): Promise<AuthSession> {
  const res = await request.post(API_BASE + '/auth/login', { data: ADMIN_CREDENTIALS })
  const body = await res.json()
  const data = body.data ?? body
  const user = data.user ?? data
  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      organizations: user.organizations,
    },
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    permissions:
      data.permissions?.length > 0 ? data.permissions : tokenPermissions(data.accessToken),
    currentOrganizationId: user.organizations?.[0]?.id ?? 1,
    roleVersion: 1,
    isAuthenticated: true,
  }
}

const AUTH_SESSION_KEY = 'aiproj-auth-session'

export async function setAuthSession(page: Page, session: AuthSession): Promise<void> {
  await page.evaluate(
    ({ key, value }) => {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          state: value,
          version: 0,
        }),
      )
    },
    { key: AUTH_SESSION_KEY, value: session },
  )
}
