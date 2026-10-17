'use client'

/**
 * 两步验证设置页（`/settings/security/two-factor`）。
 *
 * 与同目录下的 SSO / KMS / DLP / 合规不同，本页是**个人账号安全**而非企业能力：
 * 不挂 `enterpriseOnly`、不设权限门——任何登录用户都应当能给自己的账号加一道锁。
 * 服务端同样只允许操作当前会话用户本人的 2FA。
 */
import { ShieldCheck } from 'lucide-react'
import { Alert } from '@/components/ui/Alert'
import { TwoFactorSettings } from '@/components/settings/TwoFactorSettings'
import { useAuthStore } from '@/stores/auth-store'

export default function TwoFactorSettingsPage() {
  const user = useAuthStore((state) => state.user)

  if (!user) {
    return <Alert className="my-8">请先登录后管理两步验证。</Alert>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-800">
          <ShieldCheck className="h-6 w-6 text-primary-500" aria-hidden />
          两步验证
        </h1>
        <p className="text-sm text-gray-500">
          为 <span className="font-medium text-gray-700">{user.email}</span>{' '}
          增加一道登录验证。启用后，密码之外还需要认证器生成的一次性验证码。
        </p>
      </header>

      <TwoFactorSettings />
    </div>
  )
}
