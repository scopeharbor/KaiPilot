/**
 * v2-5-gitlab-linked-item-read-refresh —— GitLab 连接解析服务。
 *
 * 设计 D2/D5/D6:
 * - 刷新只能选择 `organization_id + actor.user_id + provider=gitlab` 的有效连接
 * - 连接缺失、过期且无法续期、撤销或健康失败时返回稳定 reason code
 * - service 不接受客户端提交 token、connection id 或 base URL
 * - 短时 token 续期只走 GitlabOAuthService.refreshAccessToken，不复制续期逻辑
 */

import IntegrationConnection from '#models/integration_connection'
import IntegrationTokenCipher from './token_cipher.js'
import GitlabOAuthService from './gitlab_oauth_service.js'
import { DateTime } from 'luxon'

// ---------------------------------------------------------------------------
// 连接解析结果
// ---------------------------------------------------------------------------

export type GitlabConnectionResult =
  | { type: 'connected'; accessToken: string; connection: IntegrationConnection; message?: never }
  | { type: 'not_configured'; message: string }
  | { type: 'connection_required'; message: string }
  | { type: 'reauthorization_required'; message: string }

// ---------------------------------------------------------------------------
// GitLab 连接解析服务
// ---------------------------------------------------------------------------

export class GitlabConnectionResolver {
  constructor(
    private cipher = new IntegrationTokenCipher(),
    private gitlabOAuth = new GitlabOAuthService(),
  ) {}

  /**
   * 按 actor 解析有效的 GitLab 只读连接。
   * 短时 token 过期时自动通过 refresh token 续期（D6）。
   *
   * @param organizationId 组织 ID
   * @param userId 用户 ID（actor）
   * @returns 连接解析结果
   */
  async resolve(organizationId: number, userId: number): Promise<GitlabConnectionResult> {
    const connection = await IntegrationConnection.query()
      .where('organization_id', organizationId)
      .where('user_id', userId)
      .where('provider', 'gitlab')
      .where('status', 'connected')
      .orderBy('connected_at', 'desc')
      .first()

    if (!connection) {
      return {
        type: 'connection_required',
        message: '当前用户尚未连接 GitLab，请先完成授权',
      }
    }

    // 检查是否有 access token
    if (!connection.accessTokenEncrypted) {
      return {
        type: 'reauthorization_required',
        message: 'GitLab 授权信息不完整，请重新授权',
      }
    }

    try {
      // D6: 尝试解密 access token
      let accessToken: string
      try {
        accessToken = this.cipher.decrypt(connection.accessTokenEncrypted)
      } catch {
        return {
          type: 'reauthorization_required',
          message: 'GitLab 授权信息无法解密，请重新授权',
        }
      }

      // D6: 检查 token 是否已过期
      const isTokenExpired = connection.expiresAt && DateTime.now() > connection.expiresAt

      // D6: 如果 token 已过期且有 refresh token，自动续期
      if (isTokenExpired && connection.refreshTokenEncrypted) {
        try {
          accessToken = await this.gitlabOAuth.refreshAccessToken(connection)
        } catch {
          return {
            type: 'reauthorization_required',
            message: 'GitLab token 续期失败，请重新授权',
          }
        }
      } else if (isTokenExpired) {
        // 已过期且无 refresh token：需要重新授权
        return {
          type: 'reauthorization_required',
          message: 'GitLab 连接已过期，请重新授权',
        }
      }

      // 即将过期（60 秒内）且有 refresh token，提前续期
      if (
        !isTokenExpired &&
        connection.expiresAt &&
        connection.expiresAt.diffNow('seconds').seconds <= 60 &&
        connection.refreshTokenEncrypted
      ) {
        try {
          accessToken = await this.gitlabOAuth.refreshAccessToken(connection)
        } catch {
          // 预续期失败：当前 token 仍可用，继续使用
        }
      }

      return {
        type: 'connected',
        accessToken,
        connection,
      }
    } catch {
      return {
        type: 'reauthorization_required',
        message: 'GitLab 连接解析失败，请重新授权',
      }
    }
  }
}

export default GitlabConnectionResolver
