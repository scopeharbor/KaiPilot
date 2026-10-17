/**
 * v2-5-outgoing-webhook-subscription-foundation -- 出站 webhook 订阅管理 Service（design D1/D3/D5/D6）。
 *
 * list/create/update/deactivate/rotate，组织隔离 + 脱敏投影。密钥服务端生成、AES-GCM 加密存储、
 * 明文仅创建/轮换响应一次性返回。生命周期写操作触发低敏审计（不含密钥明文/密文/payload/token）。
 *
 * 无交付 guard（spec「No external delivery」）：本 service 不发起任何外发 HTTP、不签名 payload、
 * 不入队投递、不写投递账本--投递由后续 change 承接。
 */
import crypto from 'node:crypto'
import { DateTime } from 'luxon'
import OutgoingWebhookSubscription from '#models/outgoing_webhook_subscription'
import IntegrationTokenCipher from '#services/integrations/token_cipher'
import AuditService, { AuditEvent } from '#services/audit_service'
import { normalizeAndValidateTargetUrl } from './outgoing_webhook_url_validator.js'
import {
  isAllowedOutgoingWebhookEvent,
  type OutgoingWebhookEventType,
  type OutgoingWebhookSubscriptionDto,
  type OutgoingWebhookSubscriptionCreatedDto,
  type OutgoingWebhookSubscriptionRotatedDto,
  type CreateOutgoingWebhookSubscriptionRequest,
  type UpdateOutgoingWebhookSubscriptionRequest,
} from '@aiproj/types'

export interface SubscriptionActor {
  userId: number
  organizationId: number
}

function generateSecret(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/** 非密钥指纹：sha256 前 8 hex，供 UI 识别，不可还原密钥。 */
function fingerprintOf(plainSecret: string): string {
  return crypto.createHash('sha256').update(plainSecret).digest('hex').slice(0, 8)
}

/** feature-off 门控（design D6）：默认关闭写操作，list 仍安全可用。运行时读 env 避免启动缓存。 */
function writesEnabled(): boolean {
  const raw = process.env.OUTGOING_WEBHOOKS_ENABLED
  if (raw === undefined) return false
  return raw === 'true' || raw === '1'
}

export class OutgoingWebhookFeatureDisabledError extends Error {
  constructor() {
    super('出站 webhook 订阅写操作当前未启用')
    this.name = 'OutgoingWebhookFeatureDisabledError'
  }
}

export class OutgoingWebhookSubscriptionNotFoundError extends Error {
  constructor(id: number) {
    super(`出站 webhook 订阅不存在或跨组织不可见: ${id}`)
    this.name = 'OutgoingWebhookSubscriptionNotFoundError'
  }
}

export class OutgoingWebhookEventRejectedError extends Error {
  constructor(type: string) {
    super(`不在白名单的出站 webhook 事件类型: ${type}`)
    this.name = 'OutgoingWebhookEventRejectedError'
  }
}

export default class OutgoingWebhookSubscriptionService {
  constructor(
    private cipher: IntegrationTokenCipher = new IntegrationTokenCipher(),
    private audit: AuditService = new AuditService(),
  ) {}

  async list(actor: SubscriptionActor): Promise<OutgoingWebhookSubscriptionDto[]> {
    const rows = await OutgoingWebhookSubscription.query()
      .where('organization_id', actor.organizationId)
      .orderBy('created_at', 'desc')
    return rows.map((r) => this.toDto(r))
  }

  async create(
    input: CreateOutgoingWebhookSubscriptionRequest,
    actor: SubscriptionActor,
  ): Promise<OutgoingWebhookSubscriptionCreatedDto> {
    this.requireWritesEnabled()
    const eventTypes = this.validateEventTypes(input.eventTypes)
    const { normalized, host } = normalizeAndValidateTargetUrl(input.targetUrl)
    const plainSecret = generateSecret()
    const subscription = await OutgoingWebhookSubscription.create({
      organizationId: actor.organizationId,
      projectId: null,
      name: input.name,
      targetUrl: normalized,
      eventTypes: eventTypes,
      status: 'active',
      secretCiphertext: this.cipher.encrypt(plainSecret),
      secretFingerprint: fingerprintOf(plainSecret),
      createdBy: actor.userId,
      updatedBy: actor.userId,
      lastRotatedAt: DateTime.now(),
      deactivatedAt: null,
    })

    await this.audit.log({
      event: AuditEvent.OUTGOING_WEBHOOK_SUBSCRIPTION_CREATED,
      severity: 'info',
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'outgoing_webhook_subscription',
      entityId: Number(subscription.id),
      metadata: {
        name: input.name,
        targetHost: host,
        eventTypes,
        status: 'active',
        secretFingerprint: subscription.secretFingerprint,
      },
    })

    return {
      ...this.toDto(subscription),
      secret: {
        secret: plainSecret,
        fingerprint: subscription.secretFingerprint,
        rotatedAt: subscription.lastRotatedAt!.toISO()!,
      },
    }
  }

  async update(
    subscriptionId: number,
    input: UpdateOutgoingWebhookSubscriptionRequest,
    actor: SubscriptionActor,
  ): Promise<OutgoingWebhookSubscriptionDto> {
    this.requireWritesEnabled()
    const subscription = await this.findOwned(subscriptionId, actor)
    const changes: Record<string, { before: unknown; after: unknown }> = {}
    if (input.name !== undefined && input.name !== subscription.name) {
      changes.name = { before: subscription.name, after: input.name }
      subscription.name = input.name
    }
    if (input.targetUrl !== undefined) {
      const { normalized, host } = normalizeAndValidateTargetUrl(input.targetUrl)
      if (normalized !== subscription.targetUrl) {
        changes.targetUrl = { before: subscription.targetUrl, after: normalized }
        changes.targetHost = { before: this.hostOf(subscription.targetUrl), after: host }
      }
      subscription.targetUrl = normalized
    }
    if (input.eventTypes !== undefined) {
      const eventTypes = this.validateEventTypes(input.eventTypes)
      const before = subscription.eventTypes
      if (JSON.stringify([...before].sort()) !== JSON.stringify([...eventTypes].sort())) {
        changes.eventTypes = { before, after: eventTypes }
      }
      subscription.eventTypes = eventTypes
    }
    subscription.updatedBy = actor.userId
    await subscription.save()

    await this.audit.log({
      event: AuditEvent.OUTGOING_WEBHOOK_SUBSCRIPTION_UPDATED,
      severity: 'info',
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'outgoing_webhook_subscription',
      entityId: Number(subscription.id),
      metadata: {
        name: subscription.name,
        targetHost: this.hostOf(subscription.targetUrl),
        eventTypes: subscription.eventTypes,
        changes: Object.keys(changes),
        secretFingerprint: subscription.secretFingerprint,
      },
    })

    return this.toDto(subscription)
  }

  async deactivate(
    subscriptionId: number,
    actor: SubscriptionActor,
  ): Promise<OutgoingWebhookSubscriptionDto> {
    this.requireWritesEnabled()
    const subscription = await this.findOwned(subscriptionId, actor)
    const before = subscription.status
    subscription.status = 'inactive'
    subscription.deactivatedAt = DateTime.now()
    subscription.updatedBy = actor.userId
    await subscription.save()

    await this.audit.log({
      event: AuditEvent.OUTGOING_WEBHOOK_SUBSCRIPTION_DEACTIVATED,
      severity: 'warning',
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'outgoing_webhook_subscription',
      entityId: Number(subscription.id),
      metadata: {
        name: subscription.name,
        targetHost: this.hostOf(subscription.targetUrl),
        eventTypes: subscription.eventTypes,
        statusBefore: before,
        statusAfter: 'inactive',
        secretFingerprint: subscription.secretFingerprint,
      },
    })

    return this.toDto(subscription)
  }

  async rotateSecret(
    subscriptionId: number,
    actor: SubscriptionActor,
  ): Promise<OutgoingWebhookSubscriptionRotatedDto> {
    this.requireWritesEnabled()
    const subscription = await this.findOwned(subscriptionId, actor)
    const plainSecret = generateSecret()
    subscription.secretCiphertext = this.cipher.encrypt(plainSecret)
    subscription.secretFingerprint = fingerprintOf(plainSecret)
    subscription.lastRotatedAt = DateTime.now()
    subscription.updatedBy = actor.userId
    // 轮换不改变 active/inactive 状态
    await subscription.save()

    await this.audit.log({
      event: AuditEvent.OUTGOING_WEBHOOK_SUBSCRIPTION_SECRET_ROTATED,
      severity: 'warning',
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'outgoing_webhook_subscription',
      entityId: Number(subscription.id),
      metadata: {
        name: subscription.name,
        targetHost: this.hostOf(subscription.targetUrl),
        secretFingerprint: subscription.secretFingerprint,
      },
    })

    return {
      ...this.toDto(subscription),
      secret: {
        secret: plainSecret,
        fingerprint: subscription.secretFingerprint,
        rotatedAt: subscription.lastRotatedAt!.toISO()!,
      },
    }
  }

  async getOwned(
    subscriptionId: number,
    actor: Pick<SubscriptionActor, 'organizationId'>,
  ): Promise<OutgoingWebhookSubscriptionDto> {
    return this.toDto(await this.findOwned(subscriptionId, actor))
  }

  async getOwnedModel(
    subscriptionId: number,
    actor: Pick<SubscriptionActor, 'organizationId'>,
  ): Promise<OutgoingWebhookSubscription> {
    return this.findOwned(subscriptionId, actor)
  }

  private requireWritesEnabled() {
    if (!writesEnabled()) throw new OutgoingWebhookFeatureDisabledError()
  }

  private validateEventTypes(types: readonly string[]): OutgoingWebhookEventType[] {
    if (!Array.isArray(types) || types.length === 0) {
      throw new OutgoingWebhookEventRejectedError('(empty)')
    }
    const seen = new Set<string>()
    for (const t of types) {
      if (!isAllowedOutgoingWebhookEvent(t)) throw new OutgoingWebhookEventRejectedError(t)
      if (seen.has(t)) throw new OutgoingWebhookEventRejectedError(`${t}(duplicate)`)
      seen.add(t)
    }
    return [...new Set(types)] as OutgoingWebhookEventType[]
  }

  private hostOf(targetUrl: string): string {
    try {
      return new URL(targetUrl).hostname.toLowerCase()
    } catch {
      return ''
    }
  }

  private async findOwned(
    subscriptionId: number,
    actor: Pick<SubscriptionActor, 'organizationId'>,
  ): Promise<OutgoingWebhookSubscription> {
    const subscription = await OutgoingWebhookSubscription.query()
      .where('id', subscriptionId)
      .where('organization_id', actor.organizationId)
      .first()
    if (!subscription) throw new OutgoingWebhookSubscriptionNotFoundError(subscriptionId)
    return subscription
  }

  private toDto(subscription: OutgoingWebhookSubscription): OutgoingWebhookSubscriptionDto {
    return {
      id: Number(subscription.id),
      name: subscription.name,
      targetUrl: subscription.targetUrl,
      eventTypes: subscription.eventTypes,
      status: subscription.status,
      secretFingerprint: subscription.secretFingerprint,
      lastRotatedAt: subscription.lastRotatedAt ? subscription.lastRotatedAt.toISO() : null,
      deactivatedAt: subscription.deactivatedAt ? subscription.deactivatedAt.toISO() : null,
      createdBy: subscription.createdBy,
      updatedBy: subscription.updatedBy,
      createdAt: subscription.createdAt.toISO()!,
      updatedAt: subscription.updatedAt ? subscription.updatedAt.toISO() : null,
    }
  }
}
