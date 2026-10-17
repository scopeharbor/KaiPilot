'use client'

/**
 * `/2fa/challenge` —— 已绑定账号的第二因子校验（认证器验证码或恢复码）。
 *
 * 采用新轨深空沉浸外壳（NextTwoFactorStepShell），底层安全校验 100% 零修改。
 * 双轨偏好分支：新轨偏好取消/过期回 `/next-login`，旧轨回 `/login`。
 */
import { NextTwoFactorStepShell } from '@/components/next/auth/NextTwoFactorStepShell'
import '../../(next)/next-tokens.css'

export default function TwoFactorChallengePage() {
  return <NextTwoFactorStepShell expected="verify" />
}
