/**
 * CompilerAbAuthorizationGate —— A/B real-model 授权门（§3.1）。
 *
 * 在 real-model A/B run 前检查显式授权。
 * 未授权时返回 `authorization_required`，不进行任何 provider 调用。
 * 遵循 design D3（real provider 是 explicit opt-in）。
 */

import type { CompilerAbExperimentConfig } from '@aiproj/types'

// ── 授权检查结果 ──────────────────────────────────────────────

export interface AuthorizationCheckResult {
  ok: boolean
  reason: string
  /** 如果授权缺失，返回 `authorization_required`。 */
  reasonCode: 'authorization_required' | 'authorized' | 'budget_blocked' | 'fixture_bypass'
}

// ── 授权门服务 ────────────────────────────────────────────────

export class CompilerAbAuthorizationGateService {
  /**
   * 检查 experiment 是否获授权执行 real-model A/B run。
   *
   * 返回 `authorization_required` 时，调用方禁止执行任何 real provider 调用。
   * fixture 模式自动绕过。
   */
  checkAuthorization(config: CompilerAbExperimentConfig): AuthorizationCheckResult {
    const auth = config.authorization

    // Fixture 模式 —— 不需要授权
    if (auth.mode === 'fixture') {
      return {
        ok: true,
        reason: 'Fixture mode: no authorization needed',
        reasonCode: 'fixture_bypass',
      }
    }

    // 显式 unauthorized
    if (auth.mode === 'unauthorized') {
      return {
        ok: false,
        reason: 'Experiment explicitly unauthorized',
        reasonCode: 'authorization_required',
      }
    }

    // Authorized mode —— 检查各项授权参数
    if (auth.mode === 'authorized') {
      const missing: string[] = []

      if (!auth.authorizedProviders || auth.authorizedProviders.length === 0) {
        missing.push('authorizedProviders')
      }
      if (!auth.authorizedSampleRange) {
        missing.push('authorizedSampleRange')
      }
      if (auth.maxRunCount === undefined || auth.maxRunCount <= 0) {
        missing.push('maxRunCount')
      }
      if (auth.tokenCeiling === undefined || auth.tokenCeiling <= 0) {
        missing.push('tokenCeiling')
      }
      if (auth.costCeilingUsd === undefined || auth.costCeilingUsd <= 0) {
        missing.push('costCeilingUsd')
      }
      if (!auth.authorizedDate) {
        missing.push('authorizedDate')
      }
      if (!auth.authorizationRef) {
        missing.push('authorizationRef')
      }

      if (missing.length > 0) {
        return {
          ok: false,
          reason: `Missing authorization fields: ${missing.join(', ')}`,
          reasonCode: 'authorization_required',
        }
      }

      return { ok: true, reason: 'Explicit authorization verified', reasonCode: 'authorized' }
    }

    return {
      ok: false,
      reason: `Unknown authorization mode: ${auth.mode}`,
      reasonCode: 'authorization_required',
    }
  }

  /**
   * 验证单个 provider 是否在授权列表中。
   */
  isProviderAuthorized(
    config: CompilerAbExperimentConfig,
    provider: string,
    model: string,
  ): boolean {
    if (config.authorization.mode !== 'authorized') return false
    const providers = config.authorization.authorizedProviders ?? []
    return providers.some(
      (p) =>
        p.toLowerCase() === provider.toLowerCase() ||
        p.toLowerCase() === `${provider}/${model}`.toLowerCase(),
    )
  }
}
