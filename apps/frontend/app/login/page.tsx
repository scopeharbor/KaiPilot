import type { Metadata } from 'next'
import { LoginForm } from '@/components/auth/LoginForm'
import { TextVariantSwitcher } from '@/components/locale/text-variant-switcher'
import { safeNextPath } from '@/lib/auth/safe-next-path'

export const metadata: Metadata = {
  title: '登录 · 开项 OpenXiang',
  robots: { index: false, follow: false },
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{
    next?: string | string[]
    saml_error?: string | string[]
    oidc_error?: string | string[]
    google_error?: string | string[]
  }>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const requested =
    typeof resolvedSearchParams?.next === 'string' ? resolvedSearchParams.next : null
  // 企业单点登录的失败提示（个人版没有 SSO，保持为空）
  const sso: { error: string | null } = { error: null }
  // Google OAuth 失败回跳同款约定（v3-docker-google-oauth-runtime-wiring design D）：
  // 只带 typed code，由 googleErrorMessage 映射中文，未知 code 归一 null。
  const googleCallbackError =
    typeof resolvedSearchParams?.google_error === 'string'
      ? resolvedSearchParams.google_error
      : null
  return (
    <div className="relative">
      {/* 右上角界面文字变体切换：绝对定位，不参与登录表单布局 */}
      <TextVariantSwitcher
        variant="outline"
        className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6"
      />
      <LoginForm
        nextPath={safeNextPath(requested)}
        showDevelopmentAccount={process.env.NODE_ENV === 'development'}
        ssoError={sso.error}
        googleCallbackError={googleCallbackError}
      />
    </div>
  )
}
