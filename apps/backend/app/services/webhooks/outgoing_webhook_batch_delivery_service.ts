/**
 * v2-5-webhook-batched-delivery -- 出站 webhook 批量投递 Service（design D1-D7）。
 *
 * 在 durable 投递账本 pending entries 之上，做 bounded batch grouping、
 * canonical low-sensitive batch payload、batch HMAC signing、per-entry idempotency/outcome、
 * bounded retry/manual retry、redacted batch ledger API/UI 与 feature-off。
 *
 * 默认 fixture/mock 投递客户端；真实外发需用户明确授权。
 */
import crypto from 'node:crypto'
import { DateTime } from 'luxon'
import OutgoingWebhookBatchDelivery from '#models/outgoing_webhook_batch_delivery'
import OutgoingWebhookDeliveryEvent from '#models/outgoing_webhook_delivery_event'
import OutgoingWebhookSubscription from '#models/outgoing_webhook_subscription'
import IntegrationTokenCipher from '#services/integrations/token_cipher'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  FixtureOutgoingWebhookDeliveryClient,
  type OutgoingWebhookDeliveryClient,
  type OutgoingWebhookDeliveryResult,
} from './outgoing_webhook_delivery_client.js'
import {
  assertLowSensitivePayload,
  computeOutgoingWebhookSignature,
  computeBackoffDelayMs,
  isAllowedOutgoingWebhookEvent,
  DEFAULT_OUTGOING_WEBHOOK_RETRY_POLICY,
  DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG,
  type OutgoingWebhookEventType,
  type OutgoingWebhookFailureCategory,
  type OutgoingWebhookLowSensitivePayload,
  type OutgoingWebhookBatchEnvelope,
  type OutgoingWebhookBatchEntryEnvelope,
  type OutgoingWebhookBatchEntryOutcome,
  type OutgoingWebhookBatchStatus,
  type OutgoingWebhookBatchGroupingKey,
  type OutgoingWebhookBatchProjectionDto,
  type OutgoingWebhookBatchEntryOutcomeDto,
} from '@aiproj/types'

const DELIVERY_TIMEOUT_MS = 5000
/** 批量启用门控（design D7）：默认关闭。 */
function batchEnabled(): boolean {
  const raw = process.env.OUTGOING_WEBHOOK_BATCH_ENABLED
  const batchRaw = process.env.OUTGOING_WEBHOOK_BATCH_ENABLED
  return (raw === 'true' || raw === '1') && (batchRaw === 'true' || batchRaw === '1')
}

function readBatchConfig() {
  const windowSeconds = (() => {
    const raw = process.env.OUTGOING_WEBHOOK_BATCH_WINDOW_SECONDS
    if (raw !== undefined && raw !== '') {
      const n = Number(raw)
      if (Number.isFinite(n) && n >= 1 && n <= 3600) return n
    }
    return DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.windowSeconds
  })()

  const maxEntries = (() => {
    const raw = process.env.OUTGOING_WEBHOOK_BATCH_MAX_ENTRIES
    if (raw !== undefined && raw !== '') {
      const n = Number(raw)
      if (Number.isFinite(n) && n >= 1 && n <= 1000) return n
    }
    return DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.maxEntries
  })()

  const maxPayloadBytes = (() => {
    const raw = process.env.OUTGOING_WEBHOOK_BATCH_MAX_PAYLOAD_BYTES
    if (raw !== undefined && raw !== '') {
      const n = Number(raw)
      if (Number.isFinite(n) && n >= 1024 && n <= 10 * 1024 * 1024) return n
    }
    return DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.maxPayloadBytes
  })()

  return { windowSeconds, maxEntries, maxPayloadBytes, enabled: batchEnabled() }
}

export class OutgoingWebhookBatchFeatureDisabledError extends Error {
  constructor() {
    super('出站 webhook 批量投递当前未启用')
    this.name = 'OutgoingWebhookBatchFeatureDisabledError'
  }
}

export class OutgoingWebhookBatchNotFoundError extends Error {
  constructor(batchId: string) {
    super(`出站 webhook 批量投递不存在或跨组织不可见: ${batchId}`)
    this.name = 'OutgoingWebhookBatchNotFoundError'
  }
}

export class OutgoingWebhookBatchNotRetryableError extends Error {
  constructor(batchId: string, reason: string) {
    super(`出站 webhook 批量投递不可手动重试: ${batchId} (${reason})`)
    this.name = 'OutgoingWebhookBatchNotRetryableError'
  }
}

export class OutgoingWebhookBatchPausedError extends Error {
  constructor(batchId: string) {
    super(`出站 webhook 批量投递已暂停: ${batchId}`)
    this.name = 'OutgoingWebhookBatchPausedError'
  }
}

export default class OutgoingWebhookBatchDeliveryService {
  constructor(
    private cipher: IntegrationTokenCipher = new IntegrationTokenCipher(),
    private audit: AuditService = new AuditService(),
    private client: OutgoingWebhookDeliveryClient = new FixtureOutgoingWebhookDeliveryClient(),
  ) {}

  /** 构建分组键（design D2）：组织/订阅/目标URL/密钥指纹/版本/签名方案/信封 schema。 */
  buildGroupingKey(
    event: OutgoingWebhookDeliveryEvent,
    subscription: OutgoingWebhookSubscription,
  ): OutgoingWebhookBatchGroupingKey {
    return {
      organizationId: event.organizationId,
      subscriptionId: event.subscriptionId,
      targetUrl: subscription.targetUrl,
      signingKeyFingerprint: subscription.secretFingerprint,
      signingKeyVersion: 'v1',
      signatureSchemeVersion: 'v1',
      eventEnvelopeSchemaVersion: 'v1',
    }
  }

  /** 分组键字符串化（用于 Map 分组）。 */
  groupingKeyToString(key: OutgoingWebhookBatchGroupingKey): string {
    return `${key.organizationId}:${key.subscriptionId}:${key.targetUrl}:${key.signingKeyFingerprint}:${key.signingKeyVersion}:${key.signatureSchemeVersion}:${key.eventEnvelopeSchemaVersion}`
  }

  /**
   * collectAndSend（3.1/3.3）：选待发 pending 入口，按组织/订阅分组，构建批量并发送。
   * 返回创建的批量数量。
   */
  async collectAndSend(limit = 100): Promise<{ batchesCreated: number }> {
    if (!batchEnabled()) return { batchesCreated: 0 }

    const config = readBatchConfig()
    const now = DateTime.now()

    // 选 due pending 事件（未暂停、未超 maxAttempts、due 或接近 due）
    const due = await OutgoingWebhookDeliveryEvent.query()
      .where('status', 'pending')
      .where('paused', false)
      .where((builder) => {
        builder.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', now.toSQL()!)
      })
      .where('attempt_count', '<', DEFAULT_OUTGOING_WEBHOOK_RETRY_POLICY.maxAttempts)
      .orderBy('next_attempt_at', 'asc')
      .limit(limit)

    if (due.length === 0) return { batchesCreated: 0 }

    // 分批加载订阅信息
    const subIds = [...new Set(due.map((e) => e.subscriptionId))]
    const subs = await OutgoingWebhookSubscription.query()
      .whereIn('id', subIds)
      .where('status', 'active')

    const subMap = new Map(subs.map((s) => [Number(s.id), s]))

    // 按分组键分组
    const groups = new Map<string, OutgoingWebhookDeliveryEvent[]>()
    for (const event of due) {
      const sub = subMap.get(event.subscriptionId)
      if (!sub || sub.status !== 'active') continue
      const key = this.groupingKeyToString(this.buildGroupingKey(event, sub))
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(event)
    }

    let batchesCreated = 0
    for (const [, entries] of groups) {
      const sub = subMap.get(entries[0].subscriptionId)
      if (!sub) continue
      const key = this.buildGroupingKey(entries[0], sub)

      // 按窗口/最大数/最大字节切分
      const slices = this.sliceEntries(entries, config, sub)
      for (const slice of slices) {
        await this.createAndSendBatch(slice, key, sub, config)
        batchesCreated++
      }
    }

    return { batchesCreated }
  }

  /** 将入口列表按窗口/最大数/最大字节切分（design D2）。 */
  sliceEntries(
    entries: OutgoingWebhookDeliveryEvent[],
    config: { maxEntries: number; maxPayloadBytes: number; windowSeconds: number },
    _subscription: OutgoingWebhookSubscription,
  ): OutgoingWebhookDeliveryEvent[][] {
    const slices: OutgoingWebhookDeliveryEvent[][] = []
    let current: OutgoingWebhookDeliveryEvent[] = []
    let currentByteSize = 0

    for (const entry of entries) {
      // 检查是否超过最大数
      if (current.length >= config.maxEntries) {
        if (current.length > 0) {
          slices.push(current)
          current = []
          currentByteSize = 0
        }
      }

      // 估算该入口的 payload 字节数
      const entryByteSize = this.estimateEntryByteSize(entry)

      // 检查是否超过最大字节数
      if (current.length > 0 && currentByteSize + entryByteSize > config.maxPayloadBytes) {
        slices.push(current)
        current = []
        currentByteSize = 0
      }

      current.push(entry)
      currentByteSize += entryByteSize
    }

    if (current.length > 0) slices.push(current)
    return slices
  }

  /** 估算单个入口在批量中的 payload 字节数。 */
  private estimateEntryByteSize(entry: OutgoingWebhookDeliveryEvent): number {
    try {
      const payload = JSON.parse(entry.payload) as Record<string, unknown>
      const envelope: OutgoingWebhookBatchEntryEnvelope = {
        deliveryEventId: Number(entry.id),
        idempotencyKey: entry.idempotencyKey,
        eventType: entry.eventType,
        timestamp: entry.envelopeTimestamp,
        sourceEntityType: entry.sourceEntityType,
        sourceEntityId: entry.sourceEntityId,
        projectId: entry.projectId,
        payload,
      }
      return new TextEncoder().encode(JSON.stringify(envelope)).length
    } catch {
      return 512
    }
  }

  /** 创建并发送批量（design D3/D4/D5）。 */
  private async createAndSendBatch(
    entries: OutgoingWebhookDeliveryEvent[],
    groupingKey: OutgoingWebhookBatchGroupingKey,
    subscription: OutgoingWebhookSubscription,
    _config: { windowSeconds: number; maxEntries: number; maxPayloadBytes: number },
  ): Promise<void> {
    const now = DateTime.now()
    const batchId = `batch-${crypto.randomUUID().slice(0, 8)}-${now.toUnixInteger()}`
    const eventTypes = [...new Set(entries.map((e) => e.eventType as OutgoingWebhookEventType))]
    const entryIds = entries.map((e) => Number(e.id))

    // 构建批量 entry envelopes
    const entryEnvelopes: OutgoingWebhookBatchEntryEnvelope[] = entries.map((e) => {
      const payload = JSON.parse(e.payload) as Record<string, unknown>
      assertLowSensitivePayload(payload as OutgoingWebhookLowSensitivePayload)
      return {
        deliveryEventId: Number(e.id),
        idempotencyKey: e.idempotencyKey,
        eventType: e.eventType,
        timestamp: e.envelopeTimestamp,
        sourceEntityType: e.sourceEntityType,
        sourceEntityId: e.sourceEntityId,
        projectId: e.projectId,
        payload,
      }
    })

    // 按 deliveryEventId 确定性排序（design D3）
    entryEnvelopes.sort((a, b) => a.deliveryEventId - b.deliveryEventId)

    // 构建批量信封
    const batchEnvelope: OutgoingWebhookBatchEnvelope = {
      batchId,
      organizationId: groupingKey.organizationId,
      subscriptionId: groupingKey.subscriptionId,
      eventTypes,
      createdTimestamp: now.toUTC().toISO()!,
      entries: entryEnvelopes,
    }

    const canonicalPayload = JSON.stringify(batchEnvelope)
    const payloadByteSize = new TextEncoder().encode(canonicalPayload).length

    // 创建批量记录
    const batch = await OutgoingWebhookBatchDelivery.create({
      organizationId: groupingKey.organizationId,
      subscriptionId: groupingKey.subscriptionId,
      batchId,
      targetUrl: subscription.targetUrl,
      signingKeyFingerprint: groupingKey.signingKeyFingerprint,
      signingKeyVersion: groupingKey.signingKeyVersion,
      signatureSchemeVersion: groupingKey.signatureSchemeVersion,
      eventEnvelopeSchemaVersion: groupingKey.eventEnvelopeSchemaVersion,
      eventTypes,
      entryIds,
      status: 'pending' as OutgoingWebhookBatchStatus,
      entryCount: entries.length,
      attemptCount: 0,
      maxAttempts: DEFAULT_OUTGOING_WEBHOOK_RETRY_POLICY.maxAttempts,
      lastAttemptSummary: null,
      lastAttemptStatus: null,
      lastAttemptAt: null,
      nextAttemptAt: now,
      failureCategory: null,
      terminalFailureReason: null,
      paused: false,
      payloadByteSize,
      entryOutcomes: null,
      batchCreatedAt: now,
      windowClosedAt: now,
    })

    // 发送批量
    await this.sendBatchAttempt(batch, batchEnvelope, canonicalPayload, subscription, {
      organizationId: groupingKey.organizationId,
    })

    // 审计：批量创建
    await this.audit.log({
      event: AuditEvent.OUTGOING_WEBHOOK_DELIVERY_ENQUEUED,
      severity: 'info',
      userId: null,
      organizationId: groupingKey.organizationId,
      entityType: 'outgoing_webhook_batch_delivery',
      entityId: Number(batch.id),
      metadata: {
        batchId,
        subscriptionId: groupingKey.subscriptionId,
        entryCount: entries.length,
        eventTypes,
        status: 'pending',
      },
    })
  }

  /** 发送批量尝试（design D4/D5）。 */
  private async sendBatchAttempt(
    batch: OutgoingWebhookBatchDelivery,
    batchEnvelope: OutgoingWebhookBatchEnvelope,
    canonicalPayload: string,
    subscription: OutgoingWebhookSubscription,
    actor: { organizationId: number },
  ): Promise<void> {
    // 签名边界：decrypt 密钥 -> 构造签名 -> HMAC
    const plainSecret = this.cipher.decrypt(subscription.secretCiphertext)
    const timestamp = batchEnvelope.createdTimestamp
    const signature = computeOutgoingWebhookSignature(canonicalPayload, timestamp, plainSecret)
    // 密钥明文/签名值到此为止
    void plainSecret
    void signature

    const attemptNumber = batch.attemptCount + 1
    // 更新批量状态为 in_progress
    batch.status = 'in_progress'
    batch.attemptCount = attemptNumber
    await batch.save()

    // 构建批量签名 headers
    const headers = {
      'x-aiproj-webhook-batch-signature': signature,
      'x-aiproj-webhook-batch-timestamp': timestamp,
      'x-aiproj-webhook-batch-id': batch.batchId,
      'x-aiproj-webhook-batch-subscription-id': String(batch.subscriptionId),
    }

    // 使用客户端发送
    const result = await this.client.send({
      targetUrl: subscription.targetUrl,
      headers: headers as never,
      body: canonicalPayload,
      timeoutMs: DELIVERY_TIMEOUT_MS,
      deliveryId: 0,
      attemptNumber,
    })

    const completedAt = DateTime.now()

    if (result.ok) {
      // 尝试解析逐项结果（仅 fixture 支持；2xx 无逐项结果视作全成功）
      const outcomes = this.parseBatchEntryOutcomes(result, batch)

      batch.status = 'success'
      batch.lastAttemptSummary = 'HTTP 200'
      batch.lastAttemptStatus = 'success'
      batch.lastAttemptAt = completedAt
      batch.nextAttemptAt = null
      batch.failureCategory = null
      batch.terminalFailureReason = null
      batch.entryOutcomes = outcomes

      // 更新逐项投递事件状态
      for (const entryId of batch.entryIds) {
        const outcome = outcomes?.find(
          (o: { deliveryEventId: number }) => o.deliveryEventId === entryId,
        )
        if (outcome && outcome.outcome === 'success') {
          await this.markEntryDelivered(entryId, actor)
        } else if (!outcome || outcome.outcome === 'success') {
          // 无逐项结果 = 全成功
          await this.markEntryDelivered(entryId, actor)
        }
      }
    } else {
      const category = result.failureCategory
      batch.status = 'failed'
      batch.lastAttemptSummary = `HTTP ${result.status ?? '??'}, ${category}`
      batch.lastAttemptStatus = 'failed'
      batch.lastAttemptAt = completedAt
      batch.failureCategory = category

      const retryable = result.isRetryable
      const exhausted = attemptNumber >= batch.maxAttempts
      if (retryable && !exhausted) {
        batch.status = 'pending'
        batch.nextAttemptAt = DateTime.now().plus({
          milliseconds: computeBackoffDelayMs(attemptNumber),
        })
        batch.terminalFailureReason = null
      } else {
        batch.status = 'failed'
        batch.nextAttemptAt = null
        batch.terminalFailureReason = exhausted ? 'exhausted' : category
      }
    }

    await batch.save()

    // 审计：发送尝试
    await this.audit.log({
      event:
        batch.status === 'success' || batch.status === 'pending'
          ? AuditEvent.OUTGOING_WEBHOOK_DELIVERY_SUCCESS
          : AuditEvent.OUTGOING_WEBHOOK_DELIVERY_FAILED,
      severity: batch.status === 'success' ? 'info' : 'warning',
      userId: null,
      organizationId: actor.organizationId,
      entityType: 'outgoing_webhook_batch_delivery',
      entityId: Number(batch.id),
      metadata: {
        batchId: batch.batchId,
        subscriptionId: batch.subscriptionId,
        entryCount: batch.entryCount,
        status: batch.status,
        failureCategory: batch.failureCategory,
        attemptNumber,
      },
    })
  }

  /** 解析 fixture 批量响应中的逐项结果。 */
  private parseBatchEntryOutcomes(
    result: OutgoingWebhookDeliveryResult,
    _batch: OutgoingWebhookBatchDelivery,
  ): OutgoingWebhookBatchEntryOutcomeDto[] | null {
    if (!result.responseBody) return null
    try {
      const parsed = JSON.parse(result.responseBody) as {
        outcomes?: {
          deliveryEventId: number
          idempotencyKey: string
          outcome: OutgoingWebhookBatchEntryOutcome
          failureCategory: OutgoingWebhookFailureCategory | null
          failureReason: string | null
        }[]
      }
      if (parsed.outcomes && Array.isArray(parsed.outcomes)) {
        return parsed.outcomes.map((o) => ({
          deliveryEventId: o.deliveryEventId,
          idempotencyKey: o.idempotencyKey,
          outcome: o.outcome,
          failureCategory: o.failureCategory,
          failureReason: o.failureReason,
        }))
      }
    } catch {
      // 不可解析 -> 全成功语义
    }
    return null
  }

  /** 标记单个投递事件为已投递。 */
  private async markEntryDelivered(
    entryId: number,
    actor: { organizationId: number },
  ): Promise<void> {
    try {
      const event = await OutgoingWebhookDeliveryEvent.query()
        .where('id', entryId)
        .where('organization_id', actor.organizationId)
        .first()
      if (event && event.status === 'pending') {
        event.status = 'success'
        event.lastAttemptStatus = 'success'
        event.lastAttemptAt = DateTime.now()
        event.nextAttemptAt = null
        await event.save()
      }
    } catch {
      // 单个失败不影响整体
    }
  }

  /**
   * processDue（design D5）：选 due pending 批量执行。
   */
  async processDue(limit = 50): Promise<{ processed: number }> {
    if (!batchEnabled()) return { processed: 0 }
    const now = DateTime.now()
    const due = await OutgoingWebhookBatchDelivery.query()
      .where('status', 'pending')
      .where('paused', false)
      .where((builder) => {
        builder.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', now.toSQL()!)
      })
      .where('attempt_count', '<', DEFAULT_OUTGOING_WEBHOOK_RETRY_POLICY.maxAttempts)
      .orderBy('next_attempt_at', 'asc')
      .limit(limit)

    let processed = 0
    for (const batch of due) {
      try {
        const subscription = await OutgoingWebhookSubscription.query()
          .where('id', batch.subscriptionId)
          .first()
        if (!subscription || subscription.status !== 'active') {
          batch.status = 'failed'
          batch.terminalFailureReason = 'subscription_inactive'
          await batch.save()
          processed++
          continue
        }

        // 重建批量信封
        const entryEnvelopes: OutgoingWebhookBatchEntryEnvelope[] = []
        for (const entryId of batch.entryIds) {
          const event = await OutgoingWebhookDeliveryEvent.query()
            .where('id', entryId)
            .where('organization_id', batch.organizationId)
            .first()
          if (event) {
            const payload = JSON.parse(event.payload) as Record<string, unknown>
            entryEnvelopes.push({
              deliveryEventId: Number(event.id),
              idempotencyKey: event.idempotencyKey,
              eventType: event.eventType,
              timestamp: event.envelopeTimestamp,
              sourceEntityType: event.sourceEntityType,
              sourceEntityId: event.sourceEntityId,
              projectId: event.projectId,
              payload,
            })
          }
        }

        entryEnvelopes.sort((a, b) => a.deliveryEventId - b.deliveryEventId)

        const batchEnvelope: OutgoingWebhookBatchEnvelope = {
          batchId: batch.batchId,
          organizationId: batch.organizationId,
          subscriptionId: batch.subscriptionId,
          eventTypes: this.toAllowedEventTypes(batch.eventTypes),
          createdTimestamp: batch.batchCreatedAt.toISO()!,
          entries: entryEnvelopes,
        }

        const canonicalPayload = JSON.stringify(batchEnvelope)
        await this.sendBatchAttempt(batch, batchEnvelope, canonicalPayload, subscription, {
          organizationId: batch.organizationId,
        })
        processed++
      } catch {
        // 单条失败不影响整体
      }
    }

    return { processed }
  }

  /**
   * list（design D6/D7）：组织隔离批量列表。
   */
  async list(
    actor: { organizationId: number },
    query: {
      page?: number
      perPage?: number
      status?: OutgoingWebhookBatchStatus
      subscriptionId?: number
    } = {},
  ): Promise<{
    data: OutgoingWebhookBatchProjectionDto[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const page = Math.max(query.page ?? 1, 1)
    const perPage = Math.min(Math.max(query.perPage ?? 20, 1), 100)
    const q = OutgoingWebhookBatchDelivery.query()
      .where('organization_id', actor.organizationId)
      .orderBy('created_at', 'desc')
    if (query.subscriptionId !== undefined) q.where('subscription_id', query.subscriptionId)
    if (query.status !== undefined) q.where('status', query.status)
    const total = await q.clone().clearOrder().count('* as c').first()
    const totalNum = Number(total?.$extras?.c ?? 0)
    const rows = await q.clone().forPage(page, perPage)
    const data = rows.map((r) => this.toBatchProjectionDto(r))
    return {
      data,
      meta: { total: totalNum, page, perPage, totalPages: Math.ceil(totalNum / perPage) || 1 },
    }
  }

  /**
   * getDetail（design D7）：组织隔离批量详情。
   */
  async getDetail(
    batchId: string,
    actor: { organizationId: number },
  ): Promise<OutgoingWebhookBatchProjectionDto> {
    return this.toBatchProjectionDto(await this.findOwned(batchId, actor))
  }

  /**
   * manualRetry（design D5）：手动重试失败的批量。
   */
  async manualRetry(
    batchId: string,
    actor: { userId: number | null; organizationId: number },
    input: { reason?: string } = {},
  ): Promise<OutgoingWebhookBatchProjectionDto> {
    this.requireBatchEnabled()
    const batch = await this.findOwned(batchId, actor)
    if (batch.paused) throw new OutgoingWebhookBatchPausedError(batchId)
    if (batch.status !== 'failed') {
      throw new OutgoingWebhookBatchNotRetryableError(batchId, `status=${batch.status}`)
    }

    // 重置为 pending
    batch.status = 'pending'
    batch.failureCategory = null
    batch.terminalFailureReason = null
    batch.nextAttemptAt = DateTime.now()
    await batch.save()

    await this.audit.log({
      event: AuditEvent.OUTGOING_WEBHOOK_DELIVERY_MANUAL_RETRY,
      severity: 'warning',
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'outgoing_webhook_batch_delivery',
      entityId: Number(batch.id),
      metadata: {
        batchId: batch.batchId,
        subscriptionId: batch.subscriptionId,
        reason: input.reason ?? null,
      },
    })

    // 立即调度
    const subscription = await OutgoingWebhookSubscription.query()
      .where('id', batch.subscriptionId)
      .where('organization_id', actor.organizationId)
      .first()
    if (subscription && subscription.status === 'active') {
      const entryEnvelopes: OutgoingWebhookBatchEntryEnvelope[] = []
      for (const entryId of batch.entryIds) {
        const event = await OutgoingWebhookDeliveryEvent.query()
          .where('id', entryId)
          .where('organization_id', batch.organizationId)
          .first()
        if (event) {
          const payload = JSON.parse(event.payload) as Record<string, unknown>
          entryEnvelopes.push({
            deliveryEventId: Number(event.id),
            idempotencyKey: event.idempotencyKey,
            eventType: event.eventType,
            timestamp: event.envelopeTimestamp,
            sourceEntityType: event.sourceEntityType,
            sourceEntityId: event.sourceEntityId,
            projectId: event.projectId,
            payload,
          })
        }
      }
      entryEnvelopes.sort((a, b) => a.deliveryEventId - b.deliveryEventId)

      const batchEnvelope: OutgoingWebhookBatchEnvelope = {
        batchId: batch.batchId,
        organizationId: batch.organizationId,
        subscriptionId: batch.subscriptionId,
        eventTypes: this.toAllowedEventTypes(batch.eventTypes),
        createdTimestamp: batch.batchCreatedAt.toISO()!,
        entries: entryEnvelopes,
      }

      const canonicalPayload = JSON.stringify(batchEnvelope)
      await this.sendBatchAttempt(batch, batchEnvelope, canonicalPayload, subscription, {
        organizationId: batch.organizationId,
      })
    }

    return this.toBatchProjectionDto(await this.findOwned(batchId, actor))
  }

  /** 批量脱敏投影（加性字段，design D4/D6）。 */
  toBatchProjectionDto(batch: OutgoingWebhookBatchDelivery): OutgoingWebhookBatchProjectionDto {
    // 计算事件类型
    const eventTypes = this.toAllowedEventTypes(batch.eventTypes)

    // 解析逐项结果
    let perEntryOutcomes: OutgoingWebhookBatchEntryOutcomeDto[] | null = null
    try {
      if (batch.entryOutcomes) {
        perEntryOutcomes = batch.entryOutcomes as OutgoingWebhookBatchEntryOutcomeDto[]
      }
    } catch {
      perEntryOutcomes = null
    }

    return {
      batchId: batch.batchId,
      batchStatus: batch.status,
      entryCount: batch.entryCount,
      eventTypes,
      lastAttemptSummary: batch.lastAttemptSummary,
      nextAttemptAt: batch.nextAttemptAt ? batch.nextAttemptAt.toISO() : null,
      paused: batch.paused,
      perEntryOutcomes,
    }
  }

  private toAllowedEventTypes(
    value: readonly string[] | null | undefined,
  ): OutgoingWebhookEventType[] {
    return (value ?? []).filter(isAllowedOutgoingWebhookEvent)
  }

  private requireBatchEnabled() {
    if (!batchEnabled()) throw new OutgoingWebhookBatchFeatureDisabledError()
  }

  private async findOwned(
    batchId: string,
    actor: { organizationId: number },
  ): Promise<OutgoingWebhookBatchDelivery> {
    const batch = await OutgoingWebhookBatchDelivery.query()
      .where('batch_id', batchId)
      .where('organization_id', actor.organizationId)
      .first()
    if (!batch) throw new OutgoingWebhookBatchNotFoundError(batchId)
    return batch
  }
}
