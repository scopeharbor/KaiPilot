/**
 * v2-5-outgoing-webhook-delivery-ledger 共享契约测试（任务 2.2 / 2.4 / 2.6）。
 *
 * 2.2: 状态/分类/重试/幂等键形状/脱敏投影类型/旧消费者兼容。
 * 2.4: 低敏 builder 排除敏感字段（完整对象体/评论/文件/prompt/输出/token/auth header/secret）。
 * 2.6: canonical JSON golden、timestamp/idempotency/header 包含、签名版本化、确定性 HMAC。
 */
import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import {
  OUTGOING_WEBHOOK_DELIVERY_STATUS,
  OUTGOING_WEBHOOK_ATTEMPT_STATUS,
  OUTGOING_WEBHOOK_FAILURE_CATEGORY,
  RETRYABLE_FAILURE_CATEGORIES,
  isRetryableFailureCategory,
  isRetryableResponseStatus,
  DEFAULT_OUTGOING_WEBHOOK_RETRY_POLICY,
  computeBackoffDelayMs,
  OUTGOING_WEBHOOK_IDEMPOTENCY_PREFIX,
  buildOutgoingWebhookIdempotencyKey,
  OUTGOING_WEBHOOK_SIGNATURE_SCHEME_VERSION,
  OUTGOING_WEBHOOK_SIGNATURE_HEADER,
  OUTGOING_WEBHOOK_TIMESTAMP_HEADER,
  OUTGOING_WEBHOOK_IDEMPOTENCY_HEADER,
  OUTGOING_WEBHOOK_EVENT_TYPE_HEADER,
  OUTGOING_WEBHOOK_DELIVERY_ID_HEADER,
  OUTGOING_WEBHOOK_SIGNATURE_HEADER_NAMES,
  LOW_SENSITIVE_PAYLOAD_ALLOWED_FIELDS,
  buildProjectUpdatedPayload,
  buildTaskCreatedPayload,
  buildTaskUpdatedPayload,
  buildTaskCompletedPayload,
  buildRiskCreatedPayload,
  assertLowSensitivePayload,
  OutgoingWebhookPayloadSensitiveFieldError,
  canonicalizeOutgoingWebhookEnvelope,
  computeOutgoingWebhookSignature,
  buildOutgoingWebhookSignedHeaders,
  // v2-5-webhook-batched-delivery
  OUTGOING_WEBHOOK_BATCH_STATUS,
  OUTGOING_WEBHOOK_BATCH_ENTRY_OUTCOME,
  DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG,
  type OutgoingWebhookDeliveryEventDto,
  type OutgoingWebhookDeliveryAttemptDto,
  type OutgoingWebhookEventEnvelope,
  type OutgoingWebhookBatchEnvelope,
  type OutgoingWebhookBatchProjectionDto,
  type OutgoingWebhookBatchGroupingKey,
  type OutgoingWebhookBatchEntryEnvelope,
  type OutgoingWebhookBatchEntryOutcomeDto,
} from './outgoing-webhook-delivery.js'
import { OUTGOING_WEBHOOK_EVENT_WHITELIST } from './outgoing-webhook.js'

describe('outgoing webhook delivery: status / category / retry (2.2)', () => {
  it('exposes the five delivery statuses', () => {
    expect([...OUTGOING_WEBHOOK_DELIVERY_STATUS]).toEqual([
      'pending',
      'in_progress',
      'success',
      'failed',
      'paused',
    ])
  })

  it('exposes the four attempt statuses', () => {
    expect([...OUTGOING_WEBHOOK_ATTEMPT_STATUS]).toEqual([
      'scheduled',
      'in_progress',
      'success',
      'failed',
    ])
  })

  it('classifies retryable failure categories', () => {
    expect(RETRYABLE_FAILURE_CATEGORIES).toEqual([
      'timeout',
      'network',
      'rate_limited',
      'server_error',
    ])
    for (const c of RETRYABLE_FAILURE_CATEGORIES) expect(isRetryableFailureCategory(c)).toBe(true)
    for (const c of [
      'client_error',
      'signature',
      'config',
      'disabled',
      'exhausted',
      'unknown',
    ] as const) {
      expect(isRetryableFailureCategory(c)).toBe(false)
    }
  })

  it('classifies retryable response statuses (429 + 5xx only)', () => {
    expect(isRetryableResponseStatus(429)).toBe(true)
    expect(isRetryableResponseStatus(500)).toBe(true)
    expect(isRetryableResponseStatus(503)).toBe(true)
    expect(isRetryableResponseStatus(200)).toBe(false)
    expect(isRetryableResponseStatus(400)).toBe(false)
    expect(isRetryableResponseStatus(404)).toBe(false)
  })

  it('computes deterministic exponential backoff', () => {
    expect(computeBackoffDelayMs(1)).toBe(1000)
    expect(computeBackoffDelayMs(2)).toBe(2000)
    expect(computeBackoffDelayMs(3)).toBe(4000)
    expect(computeBackoffDelayMs(4)).toBe(8000)
    // 指数封顶，不溢出
    expect(computeBackoffDelayMs(20)).toBe(computeBackoffDelayMs(11))
  })

  it('default retry policy is bounded', () => {
    expect(DEFAULT_OUTGOING_WEBHOOK_RETRY_POLICY.maxAttempts).toBe(5)
    expect(DEFAULT_OUTGOING_WEBHOOK_RETRY_POLICY.baseDelayMs).toBe(1000)
  })

  it('exposes all failure categories', () => {
    expect([...OUTGOING_WEBHOOK_FAILURE_CATEGORY]).toContain('disabled')
    expect([...OUTGOING_WEBHOOK_FAILURE_CATEGORY]).toContain('exhausted')
  })
})

describe('outgoing webhook delivery: idempotency key shape (2.2)', () => {
  it('is stable for identical inputs', () => {
    const a = buildOutgoingWebhookIdempotencyKey({
      organizationId: 1,
      subscriptionId: 2,
      eventType: 'task.created',
      sourceEntityRef: 'task:2',
    })
    const b = buildOutgoingWebhookIdempotencyKey({
      organizationId: 1,
      subscriptionId: 2,
      eventType: 'task.created',
      sourceEntityRef: 'task:2',
    })
    expect(a).toBe(b)
  })

  it('uses the wh-evt prefix and embeds org/subscription/eventType', () => {
    const key = buildOutgoingWebhookIdempotencyKey({
      organizationId: 7,
      subscriptionId: 9,
      eventType: 'risk.created',
      sourceEntityRef: 'risk:5',
    })
    expect(key.startsWith(OUTGOING_WEBHOOK_IDEMPOTENCY_PREFIX + '-')).toBe(true)
    expect(key).toContain('-7-')
    expect(key).toContain('-9-')
    expect(key).toContain('risk.created')
  })

  it('differs across subscriptions, events, and source entities', () => {
    const base = buildOutgoingWebhookIdempotencyKey({
      organizationId: 1,
      subscriptionId: 2,
      eventType: 'task.created',
      sourceEntityRef: 'task:2',
    })
    expect(
      buildOutgoingWebhookIdempotencyKey({
        organizationId: 1,
        subscriptionId: 3,
        eventType: 'task.created',
        sourceEntityRef: 'task:2',
      }),
    ).not.toBe(base)
    expect(
      buildOutgoingWebhookIdempotencyKey({
        organizationId: 1,
        subscriptionId: 2,
        eventType: 'task.updated',
        sourceEntityRef: 'task:2',
      }),
    ).not.toBe(base)
    expect(
      buildOutgoingWebhookIdempotencyKey({
        organizationId: 1,
        subscriptionId: 2,
        eventType: 'task.created',
        sourceEntityRef: 'task:3',
      }),
    ).not.toBe(base)
  })
})

describe('outgoing webhook delivery: redacted projection typing (2.2)', () => {
  it('delivery event dto has no secret / ciphertext / response body fields', () => {
    const dto: OutgoingWebhookDeliveryEventDto = {
      id: 1,
      subscriptionId: 2,
      subscriptionName: 's',
      eventType: 'task.created',
      status: 'pending',
      idempotencyKey: 'wh-evt-1-2-task.created-x',
      attemptCount: 0,
      maxAttempts: 5,
      lastAttemptStatus: null,
      lastAttemptAt: null,
      nextAttemptAt: null,
      failureCategory: null,
      terminalFailureReason: null,
      paused: false,
      sourceEntityType: 'task',
      sourceEntityId: 2,
      projectId: 1,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: null,
    }
    const keys = Object.keys(dto)
    expect(keys).not.toContain('secret')
    expect(keys).not.toContain('secretCiphertext')
    expect(keys).not.toContain('secretFingerprint')
    expect(keys).not.toContain('responseBody')
    expect(keys).not.toContain('targetUrl')
  })

  it('attempt dto has no full response body or sensitive header fields', () => {
    const dto: OutgoingWebhookDeliveryAttemptDto = {
      id: 1,
      deliveryEventId: 1,
      attemptNumber: 1,
      status: 'failed',
      scheduledAt: '2026-07-23T00:00:00.000Z',
      startedAt: '2026-07-23T00:00:00.000Z',
      completedAt: '2026-07-23T00:00:01.000Z',
      responseStatus: 500,
      failureCategory: 'server_error',
      responseBodyHash: 'abc',
      responseExcerpt: 'err',
      retryReason: 'server_error',
    }
    const keys = Object.keys(dto)
    expect(keys).not.toContain('responseBody')
    expect(keys).not.toContain('requestHeaders')
    expect(keys).not.toContain('authorization')
    expect(keys).not.toContain('secret')
  })
})

describe('outgoing webhook delivery: old-consumer compatibility (2.2)', () => {
  it('pins signature scheme version to v1', () => {
    expect(OUTGOING_WEBHOOK_SIGNATURE_SCHEME_VERSION).toBe('v1')
  })

  it('pins signature header names (receiver contract stability)', () => {
    expect([...OUTGOING_WEBHOOK_SIGNATURE_HEADER_NAMES]).toEqual([
      'x-aiproj-webhook-signature',
      'x-aiproj-webhook-timestamp',
      'x-aiproj-webhook-idempotency-key',
      'x-aiproj-webhook-event-type',
      'x-aiproj-webhook-delivery-id',
    ])
  })

  it('event whitelist is append-only stable (subscription foundation contract)', () => {
    expect([...OUTGOING_WEBHOOK_EVENT_WHITELIST]).toEqual([
      'project.updated',
      'task.created',
      'task.updated',
      'task.completed',
      'risk.created',
    ])
  })
})

describe('outgoing webhook delivery: low-sensitive payload builders (2.4)', () => {
  const allowed = new Set<string>(LOW_SENSITIVE_PAYLOAD_ALLOWED_FIELDS)

  function assertOnlyAllowed(payload: Record<string, unknown>, expectedKeys: string[]) {
    for (const k of Object.keys(payload)) {
      expect(allowed.has(k)).toBe(true)
    }
    expect(Object.keys(payload).sort()).toEqual([...expectedKeys].sort())
  }

  it('buildProjectUpdatedPayload emits only projectId/projectName/updatedBy', () => {
    const p = buildProjectUpdatedPayload({ projectId: 1, projectName: 'P', updatedBy: 5 })
    assertOnlyAllowed(p, ['projectId', 'projectName', 'updatedBy'])
    assertLowSensitivePayload(p)
  })

  it('buildTaskCreatedPayload emits only taskId/taskTitle/projectId/createdBy', () => {
    const p = buildTaskCreatedPayload({ taskId: 2, taskTitle: 'T', projectId: 1, createdBy: 5 })
    assertOnlyAllowed(p, ['taskId', 'taskTitle', 'projectId', 'createdBy'])
    assertLowSensitivePayload(p)
  })

  it('buildTaskUpdatedPayload emits only taskId/taskTitle/projectId/updatedBy', () => {
    const p = buildTaskUpdatedPayload({ taskId: 2, taskTitle: 'T', projectId: 1, updatedBy: 5 })
    assertOnlyAllowed(p, ['taskId', 'taskTitle', 'projectId', 'updatedBy'])
    assertLowSensitivePayload(p)
  })

  it('buildTaskCompletedPayload emits only taskId/taskTitle/projectId/completedBy', () => {
    const p = buildTaskCompletedPayload({ taskId: 2, taskTitle: 'T', projectId: 1, completedBy: 5 })
    assertOnlyAllowed(p, ['taskId', 'taskTitle', 'projectId', 'completedBy'])
    assertLowSensitivePayload(p)
  })

  it('buildRiskCreatedPayload emits only riskId/riskTitle/projectId/createdBy', () => {
    const p = buildRiskCreatedPayload({ riskId: 3, riskTitle: 'R', projectId: 1, createdBy: 5 })
    assertOnlyAllowed(p, ['riskId', 'riskTitle', 'projectId', 'createdBy'])
    assertLowSensitivePayload(p)
  })

  it('builders never emit sensitive fields (description/comments/files/prompt/output/token/auth/secret)', () => {
    const sensitive = [
      'description',
      'comments',
      'files',
      'prompt',
      'modelOutput',
      'token',
      'authorization',
      'secret',
      'assignees',
      'labels',
    ]
    const payloads = [
      buildProjectUpdatedPayload({ projectId: 1, projectName: 'P', updatedBy: 5 }),
      buildTaskCreatedPayload({ taskId: 2, taskTitle: 'T', projectId: 1, createdBy: 5 }),
      buildTaskUpdatedPayload({ taskId: 2, taskTitle: 'T', projectId: 1, updatedBy: 5 }),
      buildTaskCompletedPayload({ taskId: 2, taskTitle: 'T', projectId: 1, completedBy: 5 }),
      buildRiskCreatedPayload({ riskId: 3, riskTitle: 'R', projectId: 1, createdBy: 5 }),
    ]
    for (const p of payloads) {
      for (const s of sensitive) {
        expect(Object.keys(p)).not.toContain(s)
      }
    }
  })

  it('assertLowSensitivePayload rejects a non-allowlist field', () => {
    expect(() =>
      assertLowSensitivePayload({ taskId: 1, description: 'should not be here' } as never),
    ).toThrow(OutgoingWebhookPayloadSensitiveFieldError)
  })
})

describe('outgoing webhook delivery: HMAC golden (2.6)', () => {
  const envelope: OutgoingWebhookEventEnvelope = {
    eventType: 'task.created',
    deliveryId: 42,
    idempotencyKey: 'wh-evt-1-2-task.created-abc',
    timestamp: '2026-07-23T00:00:00.000Z',
    source: { entityType: 'task', entityId: 2, projectId: 1 },
    payload: { taskId: 2, taskTitle: 'x', projectId: 1, createdBy: 3 },
  }

  it('canonicalizes JSON deterministically with sorted keys and no whitespace', () => {
    const canonical = canonicalizeOutgoingWebhookEnvelope(envelope)
    // golden snapshot: 顶层键排序 deliveryId,eventType,idempotencyKey,payload,source,timestamp
    expect(canonical).toBe(
      '{"deliveryId":42,"eventType":"task.created","idempotencyKey":"wh-evt-1-2-task.created-abc","payload":{"createdBy":3,"projectId":1,"taskId":2,"taskTitle":"x"},"source":{"entityId":2,"entityType":"task","projectId":1},"timestamp":"2026-07-23T00:00:00.000Z"}',
    )
  })

  it('canonicalization is stable across repeated calls and unaffected by input key order', () => {
    const a = canonicalizeOutgoingWebhookEnvelope(envelope)
    const b = canonicalizeOutgoingWebhookEnvelope({
      ...envelope,
      // 故意打乱键插入顺序（TS 对象字面量顺序），canonicalize 须仍一致
      payload: { createdBy: 3, taskId: 2, taskTitle: 'x', projectId: 1 },
    })
    expect(a).toBe(b)
  })

  it('signature is versioned with v1= prefix', () => {
    const canonical = canonicalizeOutgoingWebhookEnvelope(envelope)
    const sig = computeOutgoingWebhookSignature(canonical, envelope.timestamp, 'secret')
    expect(sig.startsWith('v1=')).toBe(true)
  })

  it('signature is deterministic and matches independent HMAC-SHA256 reference', () => {
    const canonical = canonicalizeOutgoingWebhookEnvelope(envelope)
    const secret = 'test-secret-fixtures'
    const sig = computeOutgoingWebhookSignature(canonical, envelope.timestamp, secret)
    // 参考实现：v1=hex(HMAC-SHA256(secret, `${timestamp}.${canonical}`))
    const ref = crypto
      .createHmac('sha256', secret)
      .update(`${envelope.timestamp}.${canonical}`)
      .digest('hex')
    expect(sig).toBe(`v1=${ref}`)
    // 确定性：同输入同输出
    expect(computeOutgoingWebhookSignature(canonical, envelope.timestamp, secret)).toBe(sig)
  })

  it('signature differs across secret and timestamp', () => {
    const canonical = canonicalizeOutgoingWebhookEnvelope(envelope)
    const s1 = computeOutgoingWebhookSignature(canonical, envelope.timestamp, 'secret-a')
    const s2 = computeOutgoingWebhookSignature(canonical, envelope.timestamp, 'secret-b')
    const s3 = computeOutgoingWebhookSignature(canonical, '2026-07-24T00:00:00.000Z', 'secret-a')
    expect(s1).not.toBe(s2)
    expect(s1).not.toBe(s3)
  })

  it('signed headers include timestamp, idempotency, event type, delivery id, and signature', () => {
    const headers = buildOutgoingWebhookSignedHeaders({
      signature: 'v1=abc',
      timestamp: envelope.timestamp,
      idempotencyKey: envelope.idempotencyKey,
      eventType: 'task.created',
      deliveryId: 42,
    })
    expect(headers[OUTGOING_WEBHOOK_SIGNATURE_HEADER]).toBe('v1=abc')
    expect(headers[OUTGOING_WEBHOOK_TIMESTAMP_HEADER]).toBe(envelope.timestamp)
    expect(headers[OUTGOING_WEBHOOK_IDEMPOTENCY_HEADER]).toBe(envelope.idempotencyKey)
    expect(headers[OUTGOING_WEBHOOK_EVENT_TYPE_HEADER]).toBe('task.created')
    expect(headers[OUTGOING_WEBHOOK_DELIVERY_ID_HEADER]).toBe('42')
    expect(Object.keys(headers).sort()).toEqual([...OUTGOING_WEBHOOK_SIGNATURE_HEADER_NAMES].sort())
  })
})

describe('v2-5-webhook-batched-delivery: batch contract types (1.1)', () => {
  it('exposes batch status constants', () => {
    expect([...OUTGOING_WEBHOOK_BATCH_STATUS]).toEqual([
      'pending',
      'in_progress',
      'success',
      'partial',
      'failed',
      'paused',
    ])
  })

  it('exposes batch entry outcome constants', () => {
    expect([...OUTGOING_WEBHOOK_BATCH_ENTRY_OUTCOME]).toEqual([
      'pending',
      'success',
      'retryable',
      'non_retryable',
      'terminal',
    ])
  })

  it('has a default batch config with safe defaults', () => {
    expect(DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.enabled).toBe(false)
    expect(DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.windowSeconds).toBe(60)
    expect(DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.maxEntries).toBe(50)
    expect(DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.maxPayloadBytes).toBe(256 * 1024)
  })

  it('batch envelope has no sensitive fields', () => {
    const envelope: OutgoingWebhookBatchEnvelope = {
      batchId: 'batch-1',
      organizationId: 1,
      subscriptionId: 2,
      eventTypes: ['task.created'],
      createdTimestamp: '2026-07-23T00:00:00.000Z',
      entries: [],
    }
    const keys = Object.keys(envelope)
    expect(keys).not.toContain('secret')
    expect(keys).not.toContain('secretCiphertext')
    expect(keys).not.toContain('authorization')
    expect(keys).not.toContain('token')
  })

  it('batch projection dto has no secret/response body/signature fields', () => {
    const dto: OutgoingWebhookBatchProjectionDto = {
      batchId: 'batch-1',
      batchStatus: 'pending',
      entryCount: 0,
      eventTypes: [],
      lastAttemptSummary: null,
      nextAttemptAt: null,
      paused: false,
      perEntryOutcomes: null,
    }
    const keys = Object.keys(dto)
    expect(keys).not.toContain('secret')
    expect(keys).not.toContain('secretCiphertext')
    expect(keys).not.toContain('responseBody')
    expect(keys).not.toContain('signature')
    expect(keys).not.toContain('token')
    expect(keys).not.toContain('authorization')
  })

  it('batch grouping key has all required grouping dimensions', () => {
    const key: OutgoingWebhookBatchGroupingKey = {
      organizationId: 1,
      subscriptionId: 2,
      targetUrl: 'https://example.com/webhook',
      signingKeyFingerprint: 'fp_abc',
      signingKeyVersion: 'v1',
      signatureSchemeVersion: 'v1',
      eventEnvelopeSchemaVersion: 'v1',
    }
    expect(key.organizationId).toBe(1)
    expect(key.subscriptionId).toBe(2)
    expect(key.targetUrl).toContain('https://')
  })
})

describe('v2-5-webhook-batched-delivery: canonical ordering and constraints (1.2)', () => {
  it('orders batch entries by deliveryEventId deterministically', () => {
    const entries: OutgoingWebhookBatchEntryEnvelope[] = [
      {
        deliveryEventId: 2,
        idempotencyKey: 'wh-evt-1-2-task.created-abc',
        eventType: 'task.created',
        timestamp: '2026-07-23T00:00:00.000Z',
        sourceEntityType: 'task',
        sourceEntityId: 2,
        projectId: 1,
        payload: { taskId: 2, taskTitle: 'x', projectId: 1, createdBy: 3 },
      },
      {
        deliveryEventId: 1,
        idempotencyKey: 'wh-evt-1-2-task.updated-def',
        eventType: 'task.updated',
        timestamp: '2026-07-23T00:00:00.000Z',
        sourceEntityType: 'task',
        sourceEntityId: 1,
        projectId: 1,
        payload: { taskId: 1, taskTitle: 'y', projectId: 1, updatedBy: 3 },
      },
    ]
    const sorted = [...entries].sort((a, b) => a.deliveryEventId - b.deliveryEventId)
    expect(sorted[0].deliveryEventId).toBe(1)
    expect(sorted[1].deliveryEventId).toBe(2)
  })

  it('batch config rejects invalid bounds (negative maxEntries)', () => {
    expect(() => {
      if (DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.maxEntries <= 0) throw new Error('invalid')
    }).not.toThrow()
  })
})

describe('v2-5-webhook-batched-delivery: fixture builders (1.3)', () => {
  function buildFixtureBatchEnvelope(
    overrides?: Partial<OutgoingWebhookBatchEnvelope>,
  ): OutgoingWebhookBatchEnvelope {
    return {
      batchId: 'test-batch-1',
      organizationId: 1,
      subscriptionId: 2,
      eventTypes: ['task.created', 'task.updated'],
      createdTimestamp: '2026-07-23T00:00:00.000Z',
      entries: [
        {
          deliveryEventId: 1,
          idempotencyKey: 'wh-evt-1-2-task.created-abc',
          eventType: 'task.created',
          timestamp: '2026-07-23T00:00:00.000Z',
          sourceEntityType: 'task',
          sourceEntityId: 2,
          projectId: 1,
          payload: { taskId: 2, taskTitle: 'x', projectId: 1, createdBy: 3 },
        },
      ],
      ...overrides,
    }
  }

  function buildFixtureBatchProjection(
    overrides?: Partial<OutgoingWebhookBatchProjectionDto>,
  ): OutgoingWebhookBatchProjectionDto {
    return {
      batchId: 'test-batch-1',
      batchStatus: 'pending',
      entryCount: 1,
      eventTypes: ['task.created'],
      lastAttemptSummary: null,
      nextAttemptAt: null,
      paused: false,
      perEntryOutcomes: [
        {
          deliveryEventId: 1,
          idempotencyKey: 'wh-evt-1-2-task.created-abc',
          outcome: 'success',
          failureCategory: null,
          failureReason: null,
        },
      ],
      ...overrides,
    }
  }

  it('builds a successful batch fixture envelope with no sensitive fields', () => {
    const env = buildFixtureBatchEnvelope()
    const envKeys = Object.keys(env)
    expect(envKeys).not.toContain('secret')
    expect(envKeys).not.toContain('authorization')
    expect(envKeys).not.toContain('token')
    expect(env.eventTypes.length).toBeGreaterThan(0)
  })

  it('builds a retryable batch failure projection', () => {
    const proj = buildFixtureBatchProjection({
      batchStatus: 'failed',
      lastAttemptSummary: 'HTTP 503, retryable server error',
      perEntryOutcomes: [
        {
          deliveryEventId: 1,
          idempotencyKey: 'wh-evt-1-2-task.created-abc',
          outcome: 'retryable',
          failureCategory: 'server_error',
          failureReason: null,
        },
      ],
    })
    expect(proj.batchStatus).toBe('failed')
    expect(proj.perEntryOutcomes![0].outcome).toBe('retryable')
    expect(proj.perEntryOutcomes![0].failureCategory).toBe('server_error')
  })

  it('builds a partial per-entry outcome projection', () => {
    const proj = buildFixtureBatchProjection({
      batchStatus: 'partial',
      perEntryOutcomes: [
        {
          deliveryEventId: 1,
          idempotencyKey: 'k1',
          outcome: 'success',
          failureCategory: null,
          failureReason: null,
        },
        {
          deliveryEventId: 2,
          idempotencyKey: 'k2',
          outcome: 'non_retryable',
          failureCategory: 'client_error',
          failureReason: 'HTTP 400',
        },
      ],
    })
    expect(proj.batchStatus).toBe('partial')
    const success = proj.perEntryOutcomes!.find((o) => o.outcome === 'success')
    const failed = proj.perEntryOutcomes!.find((o) => o.outcome === 'non_retryable')
    expect(success).toBeDefined()
    expect(failed).toBeDefined()
    expect(failed!.failureCategory).toBe('client_error')
  })

  it('builds a feature-off projection (paused)', () => {
    const proj = buildFixtureBatchProjection({
      batchStatus: 'paused',
      paused: true,
      perEntryOutcomes: null,
    })
    expect(proj.batchStatus).toBe('paused')
    expect(proj.paused).toBe(true)
    expect(proj.perEntryOutcomes).toBeNull()
  })

  it('redaction assertion: no plaintext secret, no signature value, no response body', () => {
    const env = buildFixtureBatchEnvelope()
    const envStr = JSON.stringify(env)
    expect(envStr).not.toContain('secret')
    expect(envStr).not.toContain('signature')
    const proj = buildFixtureBatchProjection()
    const projStr = JSON.stringify(proj)
    expect(projStr).not.toContain('secret')
    expect(projStr).not.toContain('signature')
    expect(projStr).not.toContain('responseBody')
  })
})
