/**
 * v2-5-outgoing-webhook-delivery-ledger -- 出站 webhook 投递账本 Service（design D1-D6）。
 *
 * enqueue/list/detail/attempts/manualRetry/processDue。组织隔离 + 脱敏投影 + 低敏审计。
 * 签名边界：仅在 executeAttempt 内 decrypt 订阅密钥，签名后密钥明文/签名值永不外泄
 * （不入投影/审计/日志/前端/快照）。重试复用同一 envelopeTimestamp + payload，签名恒定。
 * 默认 fixture 投递客户端；feature-off（OUTGOING_WEBHOOK_DELIVERY_ENABLED）禁用
 * enqueue/send/manualRetry，list/detail 仍安全可读（design D6）。
 */
import crypto from 'node:crypto'
import { DateTime } from 'luxon'
import OutgoingWebhookSubscription from '#models/outgoing_webhook_subscription'
import OutgoingWebhookDeliveryEvent from '#models/outgoing_webhook_delivery_event'
import OutgoingWebhookDeliveryAttempt from '#models/outgoing_webhook_delivery_attempt'
import IntegrationTokenCipher from '#services/integrations/token_cipher'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  FixtureOutgoingWebhookDeliveryClient,
  type OutgoingWebhookDeliveryClient,
} from './outgoing_webhook_delivery_client.js'
import {
  assertLowSensitivePayload,
  buildOutgoingWebhookIdempotencyKey,
  canonicalizeOutgoingWebhookEnvelope,
  computeBackoffDelayMs,
  computeOutgoingWebhookSignature,
  buildOutgoingWebhookSignedHeaders,
  isRetryableFailureCategory,
  isRetryableResponseStatus,
  DEFAULT_OUTGOING_WEBHOOK_RETRY_POLICY,
  type OutgoingWebhookEventType,
  type OutgoingWebhookSourceEntityRef,
  type OutgoingWebhookLowSensitivePayload,
  type OutgoingWebhookDeliveryEventDto,
  type OutgoingWebhookDeliveryAttemptDto,
  type OutgoingWebhookDeliveryStatus,
  type OutgoingWebhookFailureCategory,
  type OutgoingWebhookEventEnvelope,
  type ListOutgoingWebhookDeliveriesRequest,
  type OutgoingWebhookManualRetryResultDto,
} from '@aiproj/types'

const DELIVERY_TIMEOUT_MS = 5000
const RESPONSE_EXCERPT_MAX = 200

/** feature-off 门控（design D6）：默认关闭投递写/发送/手动重试，读仍安全。 */
function deliveryEnabled(): boolean {
  const raw = process.env.OUTGOING_WEBHOOK_DELIVERY_ENABLED
  return raw === 'true' || raw === '1'
}

export interface DeliveryActor {
  userId: number | null
  organizationId: number
}

export class OutgoingWebhookDeliveryFeatureDisabledError extends Error {
  constructor() {
    super('出站 webhook 投递当前未启用')
    this.name = 'OutgoingWebhookDeliveryFeatureDisabledError'
  }
}

export class OutgoingWebhookDeliveryNotFoundError extends Error {
  constructor(id: number) {
    super(`出站 webhook 投递事件不存在或跨组织不可见: ${id}`)
    this.name = 'OutgoingWebhookDeliveryNotFoundError'
  }
}

export class OutgoingWebhookDeliveryNotRetryableError extends Error {
  constructor(id: number, reason: string) {
    super(`出站 webhook 投递事件不可手动重试: ${id} (${reason})`)
    this.name = 'OutgoingWebhookDeliveryNotRetryableError'
  }
}

export class OutgoingWebhookDeliveryPausedError extends Error {
  constructor(id: number) {
    super(`出站 webhook 投递事件已暂停: ${id}`)
    this.name = 'OutgoingWebhookDeliveryPausedError'
  }
}

export default class OutgoingWebhookDeliveryService {
  constructor(
    private cipher: IntegrationTokenCipher = new IntegrationTokenCipher(),
    private audit: AuditService = new AuditService(),
    private client: OutgoingWebhookDeliveryClient = new FixtureOutgoingWebhookDeliveryClient(),
  ) {}

  /**
   * enqueue（4.1/4.3）：低敏事件匹配组织内 active 订阅，创建 pending ledger 事件（幂等）。
   * 不发起外发 HTTP（发送由 processDue/executeAttempt 承接）。
   */
  async enqueue(
    input: {
      eventType: OutgoingWebhookEventType
      source: OutgoingWebhookSourceEntityRef
      payload: OutgoingWebhookLowSensitivePayload
    },
    actor: DeliveryActor,
  ): Promise<OutgoingWebhookDeliveryEventDto[]> {
    this.requireDeliveryEnabled()
    assertLowSensitivePayload(input.payload)
    const sourceEntityRef = `${input.source.entityType}:${input.source.entityId}`
    const subscriptions = await OutgoingWebhookSubscription.query()
      .where('organization_id', actor.organizationId)
      .where('status', 'active')
    const matched = subscriptions.filter((s) =>
      (s.eventTypes as readonly string[]).includes(input.eventType),
    )

    const envelopeTimestamp = DateTime.now().toUTC().toISO()!
    const canonicalPayload = JSON.stringify(input.payload)
    const results: OutgoingWebhookDeliveryEventDto[] = []

    for (const sub of matched) {
      const idempotencyKey = buildOutgoingWebhookIdempotencyKey({
        organizationId: actor.organizationId,
        subscriptionId: Number(sub.id),
        eventType: input.eventType,
        sourceEntityRef,
      })
      // 幂等：同 org + idempotencyKey 已存在则复用，不创建重复 active 投递
      const existing = await OutgoingWebhookDeliveryEvent.query()
        .where('organization_id', actor.organizationId)
        .where('idempotency_key', idempotencyKey)
        .first()
      if (existing) {
        results.push(await this.toEventDto(existing))
        continue
      }

      const event = await OutgoingWebhookDeliveryEvent.create({
        organizationId: actor.organizationId,
        subscriptionId: Number(sub.id),
        eventType: input.eventType,
        sourceEntityType: input.source.entityType,
        sourceEntityId: input.source.entityId,
        projectId: input.source.projectId,
        idempotencyKey,
        status: 'pending' as OutgoingWebhookDeliveryStatus,
        attemptCount: 0,
        maxAttempts: DEFAULT_OUTGOING_WEBHOOK_RETRY_POLICY.maxAttempts,
        lastAttemptStatus: null,
        lastAttemptAt: null,
        nextAttemptAt: DateTime.now(),
        failureCategory: null,
        terminalFailureReason: null,
        paused: false,
        payload: canonicalPayload,
        envelopeTimestamp,
      })

      await this.audit.log({
        event: AuditEvent.OUTGOING_WEBHOOK_DELIVERY_ENQUEUED,
        severity: 'info',
        userId: actor.userId,
        organizationId: actor.organizationId,
        entityType: 'outgoing_webhook_delivery_event',
        entityId: Number(event.id),
        metadata: {
          subscriptionId: Number(sub.id),
          eventType: input.eventType,
          sourceEntityType: input.source.entityType,
          sourceEntityId: input.source.entityId,
          idempotencyKey,
          status: 'pending',
        },
      })
      results.push(await this.toEventDto(event))
    }
    return results
  }

  /** list（3.3/8.1）：组织隔离 + 分页。 */
  async list(
    actor: Pick<DeliveryActor, 'organizationId'>,
    query: ListOutgoingWebhookDeliveriesRequest = {},
  ): Promise<{
    data: OutgoingWebhookDeliveryEventDto[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const page = Math.max(query.page ?? 1, 1)
    const perPage = Math.min(Math.max(query.perPage ?? 20, 1), 100)
    const q = OutgoingWebhookDeliveryEvent.query()
      .where('organization_id', actor.organizationId)
      .orderBy('created_at', 'desc')
    if (query.subscriptionId !== undefined) q.where('subscription_id', query.subscriptionId)
    if (query.status !== undefined) q.where('status', query.status)
    const total = await q.clone().clearOrder().count('* as c').first()
    const totalNum = Number(total?.$extras?.c ?? 0)
    const rows = await q.clone().forPage(page, perPage)
    const data = await Promise.all(rows.map((r) => this.toEventDto(r)))
    return {
      data,
      meta: {
        total: totalNum,
        page,
        perPage,
        totalPages: Math.ceil(totalNum / perPage) || 1,
      },
    }
  }

  /** detail（8.1）：组织隔离详情。 */
  async getDetail(
    eventId: number,
    actor: Pick<DeliveryActor, 'organizationId'>,
  ): Promise<OutgoingWebhookDeliveryEventDto> {
    return this.toEventDto(await this.findOwned(eventId, actor))
  }

  /** attempts（8.1）：组织隔离尝试列表。 */
  async listAttempts(
    eventId: number,
    actor: Pick<DeliveryActor, 'organizationId'>,
  ): Promise<OutgoingWebhookDeliveryAttemptDto[]> {
    const event = await this.findOwned(eventId, actor)
    const rows = await OutgoingWebhookDeliveryAttempt.query()
      .where('delivery_event_id', Number(event.id))
      .where('organization_id', actor.organizationId)
      .orderBy('attempt_number', 'asc')
    return rows.map((r) => this.toAttemptDto(r))
  }

  /**
   * manualRetry（7.3/8.1）：特权审计动作。校验资格（仅终态 failed）、组织隔离、暂停态。
   * 创建新尝试 lineage，立即调度执行，保留旧尝试。feature-off 时拒绝。
   */
  async manualRetry(
    eventId: number,
    actor: DeliveryActor,
    input: { reason?: string } = {},
  ): Promise<OutgoingWebhookManualRetryResultDto> {
    this.requireDeliveryEnabled()
    const event = await this.findOwned(eventId, actor)
    if (event.paused) throw new OutgoingWebhookDeliveryPausedError(eventId)
    if (event.status !== 'failed') {
      throw new OutgoingWebhookDeliveryNotRetryableError(eventId, `status=${event.status}`)
    }
    const previousStatus = event.status
    const previousFailureCategory = event.failureCategory

    // 重置为 pending，立即调度，清除终态元数据
    event.status = 'pending'
    event.failureCategory = null
    event.terminalFailureReason = null
    event.nextAttemptAt = DateTime.now()
    await event.save()

    await this.audit.log({
      event: AuditEvent.OUTGOING_WEBHOOK_DELIVERY_MANUAL_RETRY,
      severity: 'warning',
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'outgoing_webhook_delivery_event',
      entityId: Number(event.id),
      metadata: {
        subscriptionId: event.subscriptionId,
        eventType: event.eventType,
        previousStatus,
        previousFailureCategory,
        idempotencyKey: event.idempotencyKey,
        reason: input.reason ?? null,
      },
    })

    const newAttemptNumber = await this.executeAttempt(event, actor)
    const refreshed = await this.findOwned(eventId, actor)
    return {
      deliveryEventId: Number(refreshed.id),
      newAttemptNumber,
      scheduledAt: refreshed.lastAttemptAt
        ? refreshed.lastAttemptAt.toISO()!
        : DateTime.now().toISO()!,
      status: refreshed.status,
    }
  }

  /**
   * pause（8.3/D6）：暂停某投递事件，停止新发送/手动重试，保留账本只读可见。
   */
  async pauseEvent(
    eventId: number,
    actor: DeliveryActor,
  ): Promise<OutgoingWebhookDeliveryEventDto> {
    this.requireDeliveryEnabled()
    const event = await this.findOwned(eventId, actor)
    const wasPaused = event.paused
    event.paused = true
    if (event.status === 'pending' || event.status === 'in_progress') {
      event.status = 'paused'
    }
    await event.save()
    if (!wasPaused) {
      await this.audit.log({
        event: AuditEvent.OUTGOING_WEBHOOK_DELIVERY_PAUSED,
        severity: 'warning',
        userId: actor.userId,
        organizationId: actor.organizationId,
        entityType: 'outgoing_webhook_delivery_event',
        entityId: Number(event.id),
        metadata: {
          subscriptionId: event.subscriptionId,
          eventType: event.eventType,
          action: 'pause',
          idempotencyKey: event.idempotencyKey,
        },
      })
    }
    return this.toEventDto(event)
  }

  /**
   * unpause（8.3/D6）：恢复暂停的投递事件，重新调度 pending。
   */
  async unpauseEvent(
    eventId: number,
    actor: DeliveryActor,
  ): Promise<OutgoingWebhookDeliveryEventDto> {
    this.requireDeliveryEnabled()
    const event = await this.findOwned(eventId, actor)
    if (!event.paused) return this.toEventDto(event)
    event.paused = false
    if (event.status === 'paused') {
      event.status = 'pending'
      event.nextAttemptAt = DateTime.now()
    }
    await event.save()
    await this.audit.log({
      event: AuditEvent.OUTGOING_WEBHOOK_DELIVERY_PAUSED,
      severity: 'info',
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'outgoing_webhook_delivery_event',
      entityId: Number(event.id),
      metadata: {
        subscriptionId: event.subscriptionId,
        eventType: event.eventType,
        action: 'unpause',
        idempotencyKey: event.idempotencyKey,
      },
    })
    return this.toEventDto(event)
  }

  /**
   * processDue（6.5）：选 due pending 事件执行。feature-off/暂停/超 maxAttempts 跳过。
   * 用 attemptNumber unique 约束防并发重复执行。
   */
  async processDue(limit = 50): Promise<{ processed: number }> {
    if (!deliveryEnabled()) return { processed: 0 }
    const now = DateTime.now()
    const due = await OutgoingWebhookDeliveryEvent.query()
      .where('status', 'pending')
      .where('paused', false)
      .where((builder) => {
        builder.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', now.toSQL()!)
      })
      .where('attempt_count', '<', DEFAULT_OUTGOING_WEBHOOK_RETRY_POLICY.maxAttempts)
      .orderBy('next_attempt_at', 'asc')
      .limit(limit)
    let processed = 0
    for (const event of due) {
      try {
        await this.executeAttempt(event, { organizationId: event.organizationId })
        processed++
      } catch {
        // 单条失败不影响其它 due 事件
      }
    }
    return { processed }
  }

  /**
   * executeAttempt（5.1/6.1/6.3）：签名边界 + 发送 + 尝试记录 + 重试/终态。
   * 仅在此处 decrypt 订阅密钥；签名值/密钥明文永不入投影/审计。
   */
  async executeAttempt(
    event: OutgoingWebhookDeliveryEvent,
    actor: Pick<DeliveryActor, 'organizationId'>,
  ): Promise<number> {
    if (event.paused) {
      event.status = 'paused'
      await event.save()
      return 0
    }
    const subscription = await OutgoingWebhookSubscription.query()
      .where('id', event.subscriptionId)
      .where('organization_id', actor.organizationId)
      .first()
    if (!subscription || subscription.status !== 'active') {
      // 订阅失活/不可见 -> 终态失败（disabled）
      await this.recordAttemptFailure(event, {
        attemptNumber: event.attemptCount + 1,
        failureCategory: 'disabled',
        responseStatus: null,
        responseBody: '',
        retryReason: 'subscription_inactive_or_hidden',
        actor,
        terminal: true,
      })
      return event.attemptCount
    }

    // 签名边界：decrypt 密钥 -> 构造信封 -> canonicalize -> HMAC
    const plainSecret = this.cipher.decrypt(subscription.secretCiphertext)
    const payload = JSON.parse(event.payload) as OutgoingWebhookLowSensitivePayload
    const envelope: OutgoingWebhookEventEnvelope = {
      eventType: event.eventType,
      deliveryId: Number(event.id),
      idempotencyKey: event.idempotencyKey,
      timestamp: event.envelopeTimestamp,
      source: {
        entityType: event.sourceEntityType,
        entityId: event.sourceEntityId,
        projectId: event.projectId,
      },
      payload,
    }
    const canonical = canonicalizeOutgoingWebhookEnvelope(envelope)
    const signature = computeOutgoingWebhookSignature(
      canonical,
      event.envelopeTimestamp,
      plainSecret,
    )
    const headers = buildOutgoingWebhookSignedHeaders({
      signature,
      timestamp: event.envelopeTimestamp,
      idempotencyKey: event.idempotencyKey,
      eventType: event.eventType,
      deliveryId: Number(event.id),
    })
    // 密钥明文/签名值到此为止，后续不持有引用
    void plainSecret
    void signature

    const attemptNumber = event.attemptCount + 1
    const now = DateTime.now()
    const attempt = await OutgoingWebhookDeliveryAttempt.create({
      deliveryEventId: Number(event.id),
      organizationId: event.organizationId,
      attemptNumber,
      status: 'in_progress',
      scheduledAt: event.nextAttemptAt ?? now,
      startedAt: now,
      completedAt: null,
      responseStatus: null,
      failureCategory: null,
      responseBodyHash: null,
      responseExcerpt: null,
      retryReason: null,
    })

    const result = await this.client.send({
      targetUrl: subscription.targetUrl,
      headers,
      body: canonical,
      timeoutMs: DELIVERY_TIMEOUT_MS,
      deliveryId: Number(event.id),
      attemptNumber,
    })

    const completedAt = DateTime.now()
    attempt.completedAt = completedAt
    attempt.responseStatus = result.status
    attempt.responseBodyHash = result.responseBody
      ? crypto.createHash('sha256').update(result.responseBody).digest('hex')
      : null
    attempt.responseExcerpt = result.responseBody
      ? result.responseBody.slice(0, RESPONSE_EXCERPT_MAX)
      : null

    if (result.ok) {
      attempt.status = 'success'
      attempt.failureCategory = null
      await attempt.save()
      event.status = 'success'
      event.lastAttemptStatus = 'success'
      event.lastAttemptAt = completedAt
      event.nextAttemptAt = null
      event.failureCategory = null
      event.terminalFailureReason = null
      event.attemptCount = attemptNumber
      await event.save()
      await this.auditDeliveryResult(event, subscription, 'success', null, actor)
      return attemptNumber
    }

    // 失败
    const category = result.failureCategory
    attempt.status = 'failed'
    attempt.failureCategory = category
    attempt.retryReason = category
    await attempt.save()
    event.lastAttemptStatus = 'failed'
    event.lastAttemptAt = completedAt
    event.attemptCount = attemptNumber
    event.failureCategory = category

    const retryable =
      result.isRetryable ||
      isRetryableFailureCategory(category) ||
      isRetryableResponseStatus(result.status ?? 0)
    const exhausted = attemptNumber >= event.maxAttempts
    if (retryable && !exhausted) {
      event.status = 'pending'
      event.nextAttemptAt = DateTime.now().plus({
        milliseconds: computeBackoffDelayMs(attemptNumber),
      })
      event.terminalFailureReason = null
    } else {
      event.status = 'failed'
      event.nextAttemptAt = null
      event.terminalFailureReason = exhausted ? 'exhausted' : category
    }
    await event.save()
    await this.auditDeliveryResult(event, subscription, 'failed', category, actor)
    return attemptNumber
  }

  /** 记录订阅失活/不可见导致的终态失败（无外发）。 */
  private async recordAttemptFailure(
    event: OutgoingWebhookDeliveryEvent,
    args: {
      attemptNumber: number
      failureCategory: OutgoingWebhookFailureCategory
      responseStatus: number | null
      responseBody: string
      retryReason: string
      actor: Pick<DeliveryActor, 'organizationId'>
      terminal: boolean
    },
  ) {
    const now = DateTime.now()
    await OutgoingWebhookDeliveryAttempt.create({
      deliveryEventId: Number(event.id),
      organizationId: event.organizationId,
      attemptNumber: args.attemptNumber,
      status: 'failed',
      scheduledAt: event.nextAttemptAt ?? now,
      startedAt: now,
      completedAt: now,
      responseStatus: args.responseStatus,
      failureCategory: args.failureCategory,
      responseBodyHash: args.responseBody
        ? crypto.createHash('sha256').update(args.responseBody).digest('hex')
        : null,
      responseExcerpt: args.responseBody ? args.responseBody.slice(0, RESPONSE_EXCERPT_MAX) : null,
      retryReason: args.retryReason,
    })
    event.lastAttemptStatus = 'failed'
    event.lastAttemptAt = now
    event.attemptCount = args.attemptNumber
    event.failureCategory = args.failureCategory
    if (args.terminal) {
      event.status = 'failed'
      event.nextAttemptAt = null
      event.terminalFailureReason = args.retryReason
    }
    await event.save()
  }

  /** 投递成功/失败低敏审计（不含 payload body/secret/signature/token）。 */
  private async auditDeliveryResult(
    event: OutgoingWebhookDeliveryEvent,
    subscription: OutgoingWebhookSubscription,
    outcome: 'success' | 'failed',
    category: OutgoingWebhookFailureCategory | null,
    actor: Pick<DeliveryActor, 'organizationId'>,
  ) {
    await this.audit.log({
      event:
        outcome === 'success'
          ? AuditEvent.OUTGOING_WEBHOOK_DELIVERY_SUCCESS
          : AuditEvent.OUTGOING_WEBHOOK_DELIVERY_FAILED,
      severity: outcome === 'success' ? 'info' : 'warning',
      userId: null,
      organizationId: actor.organizationId,
      entityType: 'outgoing_webhook_delivery_event',
      entityId: Number(event.id),
      metadata: {
        subscriptionId: Number(subscription.id),
        eventType: event.eventType,
        status: event.status,
        failureCategory: category,
        attemptCount: event.attemptCount,
        idempotencyKey: event.idempotencyKey,
      },
    })
  }

  private requireDeliveryEnabled() {
    if (!deliveryEnabled()) throw new OutgoingWebhookDeliveryFeatureDisabledError()
  }

  private async findOwned(
    eventId: number,
    actor: Pick<DeliveryActor, 'organizationId'>,
  ): Promise<OutgoingWebhookDeliveryEvent> {
    const event = await OutgoingWebhookDeliveryEvent.query()
      .where('id', eventId)
      .where('organization_id', actor.organizationId)
      .first()
    if (!event) throw new OutgoingWebhookDeliveryNotFoundError(eventId)
    return event
  }

  private async toEventDto(
    event: OutgoingWebhookDeliveryEvent,
  ): Promise<OutgoingWebhookDeliveryEventDto> {
    let subscriptionName = ''
    try {
      const sub = await OutgoingWebhookSubscription.query()
        .where('id', event.subscriptionId)
        .where('organization_id', event.organizationId)
        .select('name')
        .first()
      subscriptionName = sub?.name ?? ''
    } catch {
      subscriptionName = ''
    }
    return {
      id: Number(event.id),
      subscriptionId: event.subscriptionId,
      subscriptionName,
      eventType: event.eventType,
      status: event.status,
      idempotencyKey: event.idempotencyKey,
      attemptCount: event.attemptCount,
      maxAttempts: event.maxAttempts,
      lastAttemptStatus: event.lastAttemptStatus,
      lastAttemptAt: event.lastAttemptAt ? event.lastAttemptAt.toISO() : null,
      nextAttemptAt: event.nextAttemptAt ? event.nextAttemptAt.toISO() : null,
      failureCategory: event.failureCategory,
      terminalFailureReason: event.terminalFailureReason,
      paused: event.paused,
      sourceEntityType: event.sourceEntityType,
      sourceEntityId: event.sourceEntityId,
      projectId: event.projectId,
      createdAt: event.createdAt.toISO()!,
      updatedAt: event.updatedAt ? event.updatedAt.toISO() : null,
    }
  }

  private toAttemptDto(attempt: OutgoingWebhookDeliveryAttempt): OutgoingWebhookDeliveryAttemptDto {
    return {
      id: Number(attempt.id),
      deliveryEventId: attempt.deliveryEventId,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      scheduledAt: attempt.scheduledAt.toISO()!,
      startedAt: attempt.startedAt ? attempt.startedAt.toISO() : null,
      completedAt: attempt.completedAt ? attempt.completedAt.toISO() : null,
      responseStatus: attempt.responseStatus,
      failureCategory: attempt.failureCategory,
      responseBodyHash: attempt.responseBodyHash,
      responseExcerpt: attempt.responseExcerpt,
      retryReason: attempt.retryReason,
    }
  }

  /** 测试/生产可注入客户端（默认 fixture）。 */
  withClient(client: OutgoingWebhookDeliveryClient): this {
    this.client = client
    return this
  }
}
