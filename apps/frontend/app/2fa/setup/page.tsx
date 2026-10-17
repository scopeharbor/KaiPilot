'use client'

/**
 * `/2fa/setup` —— 登录期首次绑定/重新绑定（扫码 → 输码 → 恢复码）。
 *
 * 采用新轨深空沉浸外壳（NextTwoFactorStepShell），底层 TOTP 协议 100% 零修改。
 * 双轨偏好分支：新轨偏好取消/过期回 `/next-login`，旧轨回 `/login`。
 */
import { NextTwoFactorStepShell } from '@/components/next/auth/NextTwoFactorStepShell'
import '../../(next)/next-tokens.css'

export default function TwoFactorSetupPage() {
  return <NextTwoFactorStepShell expected="enroll" />
}
