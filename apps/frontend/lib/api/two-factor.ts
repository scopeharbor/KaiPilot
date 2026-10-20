import { apiFetch } from '@/lib/api-client'
import type { TwoFactorState } from '@/lib/api/two-factor-state'

export type { TwoFactorState }
export { twoFactorStateLabel } from '@/lib/api/two-factor-state'

/** 第二因子可用方式（与后端 `TwoFactorMethod` 对齐）。 */
export type TwoFactorMethod = 'totp' | 'recovery_code'

/** 账号两步验证状态（低敏投影，来自 `GET /account/two-factor`）。 */
export interface TwoFactorStatus {
  /** 显式状态机取值；下面的布尔量是它的派生投影。 */
  state: TwoFactorState
  enabled: boolean
  /** 已生成密钥但尚未确认——UI 据此提示「继续完成设置」。 */
  pending: boolean
  /** 「更换认证器」在途：已扫新二维码但尚未确认，旧认证器仍然有效。 */
  rebinding: boolean
  label: string | null
  confirmedAt: string | null
  lastUsedAt: string | null
  recoveryCodesRemaining: number
}

/** 设置向导第一步的产物。`secret` 全流程只返回一次，不得写入任何持久化存储。 */
export interface TwoFactorEnrollment {
  secret: string
  otpauthUri: string
  digits: number
  period: number
  algorithm: string
}

/** 确认 / 重置恢复码的响应：状态 + 仅此一次的恢复码明文。 */
export interface TwoFactorStatusWithCodes extends TwoFactorStatus {
  recoveryCodes: string[]
}

/**
 * 把后端第二因子相关错误码映射成中文文案。
 *
 * 与登录页其他错误一样：**不回显服务端原始 message**，未知码归一到通用提示，
 * 避免把内部细节或可枚举信息带到界面上。
 */
export function twoFactorErrorMessage(error: unknown): string {
  const apiError = error as { code?: string } | null
  switch (apiError?.code) {
    case 'TWO_FACTOR_INVALID_CODE':
      return '验证码不正确。请确认认证器时间已同步，或改用恢复码。'
    case 'TWO_FACTOR_CHALLENGE_INVALID':
      return '本次验证已失效（超时或尝试次数过多），请重新登录。'
    case 'TWO_FACTOR_STATE_CONFLICT':
      return '两步验证状态已变化，请按页面提示补齐信息或刷新后重试。'
    case 'TWO_FACTOR_THROTTLED':
      return '尝试次数过多，请 15 分钟后再试。'
    case 'TWO_FACTOR_UNAVAILABLE':
      return '两步验证服务暂时不可用，请联系管理员。'
    case 'VALIDATION_ERROR':
      return '请输入验证码。'
    case 'AUTH_REQUIRED':
      return '登录状态已失效，请重新登录。'
    default:
      return '操作失败，请稍后重试。'
  }
}

/** 把 16 位恢复码整批渲染成便于打印/保存的纯文本。 */
export function formatRecoveryCodesForDownload(codes: string[], accountLabel: string): string {
  return [
    '开项 KaiPilot — 两步验证恢复码',
    `账号：${accountLabel}`,
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '每条恢复码只能使用一次。请离线保存在安全的地方；',
    '重新生成恢复码会让以下全部代码立即失效。',
    '',
    ...codes,
    '',
  ].join('\n')
}

export const twoFactorApi = {
  /** 读取当前账号的两步验证状态。 */
  async status(): Promise<TwoFactorStatus> {
    return apiFetch<TwoFactorStatus>('/account/two-factor')
  },

  /**
   * 开始设置 / 更换认证器：生成待确认密钥与 otpauth URI。
   * 账号已启用时必须带 `currentCode`（当前认证器验证码或恢复码）授权。
   */
  async setup(
    input: { label?: string | null; currentCode?: string; password?: string } = {},
  ): Promise<TwoFactorEnrollment> {
    return apiFetch<TwoFactorEnrollment>('/account/two-factor/setup', {
      method: 'POST',
      body: JSON.stringify({
        label: input.label?.trim() ? input.label.trim() : null,
        ...(input.currentCode ? { currentCode: input.currentCode } : {}),
        ...(input.password ? { password: input.password } : {}),
      }),
    })
  },

  /** 用认证器验证码确认，启用两步验证并领取恢复码。 */
  async confirm(code: string): Promise<TwoFactorStatusWithCodes> {
    return apiFetch<TwoFactorStatusWithCodes>('/account/two-factor/confirm', {
      method: 'POST',
      body: JSON.stringify({ code }),
    })
  },

  /** 关闭两步验证（高风险：需要第二因子 + 密码重认证）。 */
  async disable(code: string, password?: string): Promise<TwoFactorStatus> {
    return apiFetch<TwoFactorStatus>('/account/two-factor/disable', {
      method: 'POST',
      body: JSON.stringify({ code, ...(password ? { password } : {}) }),
    })
  },

  /** 整批重置恢复码（旧码立即失效）。 */
  async regenerateRecoveryCodes(code: string): Promise<TwoFactorStatusWithCodes> {
    return apiFetch<TwoFactorStatusWithCodes>('/account/two-factor/recovery-codes', {
      method: 'POST',
      body: JSON.stringify({ code }),
    })
  },
}
