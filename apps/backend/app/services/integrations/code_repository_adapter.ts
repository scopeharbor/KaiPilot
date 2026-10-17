/**
 * v2-github-gitlab-light-links —— Code Repository Provider Adapter。
 *
 * 当前阶段只返回 `not_configured` 或 `pre_connection_only` 降级结果，
 * 不做真实 token 交换、API 调用或 outbound write。
 *
 * v2-5-github-readonly-oauth-connection: GitHub 连接就绪后, check 返回
 * `readonly_connection_ready` 而非 `pre_connection_only`，但 refresh 仍返回降级。
 *
 * 设计 D3: 未来加入真实 OAuth 或 API 请求时，必须通过此 adapter 边界并默认 mock。
 */

import type { ExternalLinkProvider } from '@aiproj/types'
import {
  getIntegrationProviderConfig,
  missingEnvKeys,
  type IntegrationEnv,
} from './provider_registry.js'

// ---------------------------------------------------------------------------
// Refresh 结果类型
// ---------------------------------------------------------------------------

export interface CodeRepositoryRefreshResult {
  result:
    'not_configured' | 'pre_connection_only' | 'success' | 'degraded' | 'readonly_connection_ready'
  message: string
  status?: 'open' | 'closed' | 'merged' | 'draft' | 'unknown'
  title?: string
  lastObservedAt?: string
}

// ---------------------------------------------------------------------------
// Check 结果类型
// ---------------------------------------------------------------------------

export interface CodeRepositoryCheckResult {
  status: 'not_configured' | 'pre_connection_only' | 'readonly_connection_ready'
  message: string
  missingEnvKeys?: string[]
}

/**
 * CodeRepositoryProviderAdapter —— 代码仓库 provider 预连接 adapter。
 *
 * 当前版本默认降级，所有 refresh/check 操作返回未配置或预连接状态。
 */
export default class CodeRepositoryProviderAdapter {
  constructor(private envOverrides: IntegrationEnv = {}) {}

  /**
   * Pre-connection check: 检查 provider 配置状态。
   * 当前阶段始终返回降级信息。
   *
   * v2-5-github-readonly-oauth-connection: GitHub 已连接时返回
   * `readonly_connection_ready`，标志连接就绪但链接刷新未启用。
   */
  check(provider: ExternalLinkProvider, isConnected?: boolean): CodeRepositoryCheckResult {
    const config = getIntegrationProviderConfig(provider)
    if (!config) {
      return {
        status: 'not_configured',
        message: `${provider} provider 未注册`,
      }
    }

    const missing = missingEnvKeys(config, this.envOverrides)
    if (missing.length > 0) {
      return {
        status: 'not_configured',
        message: `${config.displayName} 尚未配置 OAuth 应用参数；当前只能手动维护外部链接。`,
        missingEnvKeys: missing,
      }
    }

    // v2-5-github-readonly-oauth-connection / v2-5-gitlab-readonly-oauth-connection
    if (isConnected && (provider === 'github' || provider === 'gitlab')) {
      return {
        status: 'readonly_connection_ready',
        message: `${config.displayName} 只读连接已就绪；Issue/PR 状态刷新将在后续启用。`,
      }
    }

    return {
      status: 'pre_connection_only',
      message: `${config.displayName} 应用配置已就绪；当前版本只预连接，不做真实 token 交换或自动同步。`,
    }
  }

  /**
   * Refresh: 刷新外部链接状态。
   * 当前阶段始终返回降级结果，不发起对外部 API 的调用。
   *
   * v2-5-github-readonly-oauth-connection: GitHub 已连接但链接刷新未启用时
   * 返回 `readonly_connection_ready`，保留现有快照。
   */
  refresh(provider: ExternalLinkProvider, isConnected?: boolean): CodeRepositoryRefreshResult {
    const config = getIntegrationProviderConfig(provider)
    if (!config) {
      return {
        result: 'not_configured',
        message: `Provider ${provider} 未注册，无法刷新。`,
      }
    }

    const missing = missingEnvKeys(config, this.envOverrides)
    if (missing.length > 0) {
      return {
        result: 'not_configured',
        message: `${config.displayName} 未配置 OAuth 应用参数。请完成配置后重试，或手动更新外部链接状态。`,
      }
    }

    // v2-5-github-readonly-oauth-connection / v2-5-gitlab-readonly-oauth-connection
    if (isConnected && (provider === 'github' || provider === 'gitlab')) {
      return {
        result: 'readonly_connection_ready',
        message: `${config.displayName} 只读连接已就绪；Issue/PR 状态刷新将在后续 change 中启用。当前保留现有快照。`,
      }
    }

    return {
      result: 'pre_connection_only',
      message: `${config.displayName} 预连接模式：当前版本不发起真实 API 请求，请手动更新外部链接状态。`,
    }
  }
}
