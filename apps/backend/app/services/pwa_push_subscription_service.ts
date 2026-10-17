import crypto from 'node:crypto'
import PwaPushSubscription from '#models/pwa_push_subscription'
import PushSubscriptionCipher from '#services/push_subscription_cipher'
import pwaWebPushConfig from '#config/pwa_web_push'
import { DateTime } from 'luxon'
import type { PushSubscriptionStatus, PushSubscribeRequest } from '@aiproj/types'

/**
 * PwaPushSubscriptionService —— Web Push 订阅管理服务（design D2/D4）。
 *
 * 职责：
 * - 查询当前用户订阅状态
 * - 幂等订阅（upsert active endpoint）
 * - 取消订阅/撤销
 * - 失效 endpoint 清理
 * - 按通知接收人查找活跃订阅
 *
 * 所有操作受 feature flag 控制：PWA_WEB_PUSH_ENABLED=false 时拒绝变更。
 */
export default class PwaPushSubscriptionService {
  private cipher = new PushSubscriptionCipher()

  /**
   * 检查功能是否启用。
   */
  isEnabled(): boolean {
    return pwaWebPushConfig.enabled
  }

  /**
   * 获取当前用户在组织内的订阅状态。
   */
  async getSubscriptionState(
    organizationId: number,
    userId: number,
  ): Promise<{
    status: PushSubscriptionStatus
    subscribed: boolean
    createdAt: string | null
    userAgent: string | null
  }> {
    if (!this.isEnabled()) {
      return { status: 'none', subscribed: false, createdAt: null, userAgent: null }
    }

    const sub = await PwaPushSubscription.query()
      .where('organization_id', organizationId)
      .where('user_id', userId)
      .where('status', 'active')
      .first()

    if (!sub) {
      return { status: 'none', subscribed: false, createdAt: null, userAgent: null }
    }

    return {
      status: sub.status as PushSubscriptionStatus,
      subscribed: sub.status === 'active',
      createdAt: sub.createdAt.toISO()!,
      userAgent: sub.userAgent,
    }
  }

  /**
   * 幂等订阅：存储或更新活跃订阅。
   * 同一 endpoint 在同一组织/用户下已存在 active 记录时，更新 keys 和 userAgent。
   * 其他组织/用户的同 endpoint 视为独立订阅。
   */
  async subscribe(
    organizationId: number,
    userId: number,
    request: PushSubscribeRequest,
  ): Promise<{ success: boolean; status: PushSubscriptionStatus }> {
    if (!this.isEnabled()) {
      return { success: false, status: 'none' }
    }

    const endpointHash = crypto.createHash('sha256').update(request.endpoint).digest('hex')
    const encryptedEndpoint = this.cipher.encrypt(request.endpoint)
    const encryptedP256dh = this.cipher.encrypt(request.keys.p256dh)
    const encryptedAuth = this.cipher.encrypt(request.keys.auth)
    const userAgentHash = request.userAgent
      ? crypto.createHash('sha256').update(request.userAgent).digest('hex')
      : null

    // 查找已有活跃订阅（同组织/用户/endpoint_hash）
    const existing = await PwaPushSubscription.query()
      .where('organization_id', organizationId)
      .where('user_id', userId)
      .where('endpoint_hash', endpointHash)
      .where('status', 'active')
      .first()

    const now = DateTime.now()

    if (existing) {
      // 更新已有订阅的 keys 和 userAgent
      existing.endpointCiphertext = encryptedEndpoint
      existing.p256dhCiphertext = encryptedP256dh
      existing.authCiphertext = encryptedAuth
      existing.userAgent = request.userAgent ?? null
      existing.userAgentHash = userAgentHash
      existing.lastSeenAt = now
      await existing.save()

      return { success: true, status: 'active' }
    }

    // 创建新订阅
    await PwaPushSubscription.create({
      organizationId,
      userId,
      endpointHash,
      endpointCiphertext: encryptedEndpoint,
      p256dhCiphertext: encryptedP256dh,
      authCiphertext: encryptedAuth,
      status: 'active',
      userAgent: request.userAgent ?? null,
      userAgentHash,
      lastSeenAt: now,
    })

    return { success: true, status: 'active' }
  }

  /**
   * 取消订阅/撤销：将指定 endpoint 的活跃订阅标记为 revoked。
   * 仅操作当前组织/用户的订阅。
   */
  async unsubscribe(
    organizationId: number,
    userId: number,
    endpoint: string,
  ): Promise<{ success: boolean }> {
    if (!this.isEnabled()) {
      return { success: false }
    }

    const endpointHash = crypto.createHash('sha256').update(endpoint).digest('hex')

    const sub = await PwaPushSubscription.query()
      .where('organization_id', organizationId)
      .where('user_id', userId)
      .where('endpoint_hash', endpointHash)
      .where('status', 'active')
      .first()

    if (!sub) {
      return { success: false }
    }

    sub.status = 'revoked'
    sub.revokedAt = DateTime.now()
    await sub.save()

    return { success: true }
  }

  /**
   * 失效 endpoint：当发送器检测到 endpoint 不再可用（410 Gone/404）时调用。
   * 不修改通知事实。
   */
  async invalidateEndpoint(
    organizationId: number,
    userId: number,
    endpoint: string,
  ): Promise<{ success: boolean }> {
    const endpointHash = crypto.createHash('sha256').update(endpoint).digest('hex')

    const sub = await PwaPushSubscription.query()
      .where('organization_id', organizationId)
      .where('user_id', userId)
      .where('endpoint_hash', endpointHash)
      .where('status', 'active')
      .first()

    if (!sub) {
      return { success: false }
    }

    sub.status = 'invalidated'
    sub.invalidatedAt = DateTime.now()
    await sub.save()

    return { success: true }
  }

  /**
   * 按通知接收人查找活跃订阅列表。
   * 用于推送发送桥接：获取所有活跃订阅。
   */
  async findActiveByRecipient(
    organizationId: number,
    userId: number,
  ): Promise<PwaPushSubscription[]> {
    if (!this.isEnabled()) {
      return []
    }

    return PwaPushSubscription.query()
      .where('organization_id', organizationId)
      .where('user_id', userId)
      .where('status', 'active')
  }

  /**
   * 解密订阅的 endpoint。
   */
  decryptEndpoint(sub: PwaPushSubscription): string {
    return this.cipher.decrypt(sub.endpointCiphertext)
  }

  /**
   * 解密订阅的 p256dh key。
   */
  decryptP256dh(sub: PwaPushSubscription): string {
    return this.cipher.decrypt(sub.p256dhCiphertext)
  }

  /**
   * 解密订阅的 auth key。
   */
  decryptAuth(sub: PwaPushSubscription): string {
    return this.cipher.decrypt(sub.authCiphertext)
  }
}
