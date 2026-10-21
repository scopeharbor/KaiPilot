import type { Metadata } from 'next'
import { NextLoginForm } from '@/components/next/auth/NextLoginForm'
import { safeNextPath } from '@/lib/auth/safe-next-path'
import '../(next)/next-tokens.css'

export const metadata: Metadata = {
  title: '登录 · 开项 KaiPilot',
  robots: { index: false, follow: false },
}

/** 过滤回跳目标：`/next-login` 自身路径禁止作为回跳（防登录循环，design 风险表）。 */
function resolveNextPath(raw: string | null | undefined): string {
  const safe = safeNextPath(raw, '/next')
  return safe.startsWith('/next-login') ? '/next' : safe
}

/**
 * 新 UI 登录页（/next-login，v3-ui-next-track-foundation D-d / spec「新 UI 登录页」）。
 *
 * 挂载 Layer 1 深空沉浸 3D 原型（v3-next-layer1-login-3d-m0）：
 * - 认证动作 100% 复用既有 `authApi.login` 链路与 2FA 挑战；
 * - 容器层通过 `next/dynamic(..., { ssr: false })` 异步拉取 3D 视口，保证主包零增量；
 * - 纯 CSS 渐变光晕兜底保障无阻塞水合；
 * - 令牌与 `(next)` 路由组共用 `next-tokens.css`。
 */
export default async function NextLoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string | string[] }>
}) {
  const resolved = searchParams ? await searchParams : undefined
  const requested = typeof resolved?.next === 'string' ? resolved.next : null
  return <NextLoginForm nextPath={resolveNextPath(requested)} />
}
