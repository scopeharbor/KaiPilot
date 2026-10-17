/**
 * v2-5-github-linked-item-read-refresh —— GitHub 连接解析服务。
 *
 * 设计 D2:
 * - 刷新只能选择 `organization_id + actor.user_id + provider=github` 的有效连接
 * - 连接缺失、过期、撤销或健康失败时返回稳定 reason code
 * - service 不接受客户端提交 token 或 connection id
 */

import IntegrationConnection from '#models/integration_connection'
import IntegrationTokenCipher from './token_cipher.js'
import { DateTime } from 'luxon'

// ---------------------------------------------------------------------------
// 连接解析结果
// ---------------------------------------------------------------------------

export type GitHubConnectionResult =
  | { type: 'connected'; accessToken: string; connection: IntegrationConnection; message?: never }
  | { type: 'not_configured'; message: string }
  | { type: 'connection_required'; message: string }
  | { type: 'reauthorization_required'; message: string }

// ---------------------------------------------------------------------------
// GitHub 连接解析服务
// ---------------------------------------------------------------------------

export class GitHubConnectionResolver {
  constructor(private cipher = new IntegrationTokenCipher()) {}

  /**
   * 按 actor 解析有效的 GitHub 只读连接。
   *
   * @param organizationId 组织 ID
   * @param userId 用户 ID（actor）
   * @returns 连接解析结果
   */
  async resolve(organizationId: number, userId: number): Promise<GitHubConnectionResult> {
    const connection = await IntegrationConnection.query()
      .where('organization_id', organizationId)
      .where('user_id', userId)
      .where('provider', 'github')
      .where('status', 'connected')
      .orderBy('connected_at', 'desc')
      .first()

    if (!connection) {
      return {
        type: 'connection_required',
        message: '当前用户尚未连接 GitHub，请先完成授权',
      }
    }

    // 检查 token 是否过期
    if (connection.expiresAt && DateTime.now() > connection.expiresAt) {
      return {
        type: 'reauthorization_required',
        message: 'GitHub 连接已过期，请重新授权',
      }
    }

    // 检查是否有 access token
    if (!connection.accessTokenEncrypted) {
      return {
        type: 'reauthorization_required',
        message: 'GitHub 授权信息不完整，请重新授权',
      }
    }

    try {
      const accessToken = this.cipher.decrypt(connection.accessTokenEncrypted)
      return {
        type: 'connected',
        accessToken,
        connection,
      }
    } catch {
      return {
        type: 'reauthorization_required',
        message: 'GitHub 授权信息无法解密，请重新授权',
      }
    }
  }
}

export default GitHubConnectionResolver
