/**
 * v2-5-provider-incoming-webhook-foundation —— 入站接收管线 Service（design D3/D5/D7/D8）。
 *
 * 校验顺序（快失败 + 全留痕）：全局 kill switch 优先 → endpoint 存在且启用 → 签名 →
 * 时间戳 → 去重。每条交付无论通过与否**恰好写一条投递账本**。
 *
 * SSRF 边界（D7）：本 Service 不注入任何 HTTP client、不 import 会发起出站请求的模块、
 * 不写业务表。只做校验与记账。
 *
 * 不抛 HTTP 异常——返回结构化 IngestResult，由 Controller 映射状态码（分层职责）。
 */
import crypto from 'node:crypto'
import { DateTime } from 'luxon'
import WebhookEndpoint from '#models/webhook_endpoint'
import WebhookDelivery from '#models/webhook_delivery'
import IntegrationTokenCipher from '#services/integrations/token_cipher'
import { getWebhookVerifier } from './verifiers/registry.js'
import type { WebhookProviderVerifier, WebhookHeaders } from './verifiers/interfaces.js'

/** ingest 结果，Controller 据此映射 HTTP 状态码。 */
export type IngestResult =
  | { status: 'accepted'; deliveryId: number }
  | { status: 'duplicate'; deliveryId: number }
  | {
      status: 'rejected'
      httpStatus: 401 | 400 | 403 | 404
      code: string
      message: string
      deliveryId: number
    }

export interface IngestInput {
  provider: string
  /** 未经反序列化的原始 body 字节（HMAC 对此计算）。 */
  rawBody: Buffer
  headers: WebhookHeaders
  /** 可注入的当前时间（毫秒），默认 Date.now()；测试覆盖时间戳新鲜度判定。 */
  now?: () => number
  /** 可注入的全局 kill switch，默认读 env WEBHOOKS_INGEST_ENABLED。 */
  ingestEnabled?: boolean
}

const ROTATION_WINDOW_MS = 24 * 60 * 60 * 1000 // 轮换过渡窗口：24h

export default class WebhookIngestService {
  constructor(private cipher: IntegrationTokenCipher = new IntegrationTokenCipher()) {}

  async ingest(input: IngestInput): Promise<IngestResult> {
    const verifier = getWebhookVerifier(input.provider)
    if (!verifier) {
      return {
        status: 'rejected',
        httpStatus: 404,
        code: 'WEBHOOK_PROVIDER_NOT_FOUND',
        message: `未注册的 webhook provider: ${input.provider}`,
        deliveryId: 0,
      }
    }

    const now = (input.now ?? Date.now)()
    const ingestEnabled = input.ingestEnabled ?? this.readIngestEnabled()

    // 1) 全局 kill switch 优先
    if (!ingestEnabled) {
      return await this.recordAndReturn({
        verifier,
        endpoint: null,
        input,
        signatureResult: 'skipped',
        timestampResult: 'skipped',
        dedupResult: 'skipped',
        outcome: {
          status: 'rejected',
          httpStatus: 403,
          code: 'WEBHOOK_INGEST_DISABLED',
          message: '入站 webhook 接收已被全局停用',
        },
        now,
        reason: 'global_disabled',
      })
    }

    // 2) 解析端点：按 provider 找到端点（不限 enabled——需区分「无端点 404」与
    //    「端点存在但禁用 403」，spec 要求禁用端点记 endpoint_disabled 返回 403）。
    const endpoint = await this.findEndpointForProvider(input.provider)
    if (!endpoint) {
      return await this.recordAndReturn({
        verifier,
        endpoint: null,
        input,
        signatureResult: 'skipped',
        timestampResult: 'skipped',
        dedupResult: 'skipped',
        outcome: {
          status: 'rejected',
          httpStatus: 404,
          code: 'WEBHOOK_ENDPOINT_NOT_FOUND',
          message: `未找到 ${input.provider} 接收端点`,
        },
        now,
        reason: 'no_endpoint',
      })
    }
    if (!endpoint.enabled) {
      return await this.recordAndReturn({
        verifier,
        endpoint,
        input,
        signatureResult: 'skipped',
        timestampResult: 'skipped',
        dedupResult: 'skipped',
        outcome: {
          status: 'rejected',
          httpStatus: 403,
          code: 'WEBHOOK_ENDPOINT_DISABLED',
          message: '该端点已被禁用',
        },
        now,
        reason: 'endpoint_disabled',
      })
    }

    // 3) 签名校验（含轮换过渡窗口）
    const signatureCheck = this.verifySignature(verifier, input.rawBody, input.headers, endpoint)
    if (!signatureCheck.valid) {
      return await this.recordAndReturn({
        verifier,
        endpoint,
        input,
        signatureResult: 'invalid',
        timestampResult: 'skipped',
        dedupResult: 'skipped',
        outcome: {
          status: 'rejected',
          httpStatus: 401,
          code: 'WEBHOOK_SIGNATURE_INVALID',
          message: '签名校验失败',
        },
        now,
      })
    }

    // 4) 时间戳新鲜度（provider 不提供时间戳则跳过）
    const timestampCheck = this.verifyTimestamp(
      verifier,
      input.headers,
      endpoint.timestampToleranceSeconds,
      now,
    )
    if (timestampCheck === 'expired') {
      return await this.recordAndReturn({
        verifier,
        endpoint,
        input,
        signatureResult: 'valid',
        timestampResult: 'expired',
        dedupResult: 'skipped',
        outcome: {
          status: 'rejected',
          httpStatus: 400,
          code: 'WEBHOOK_TIMESTAMP_INVALID',
          message: '交付时间戳超出容差窗口',
        },
        now,
      })
    }

    // 5) 去重：幂等键 + DB 复合唯一约束
    const idempotencyKey = this.computeIdempotencyKey(verifier, input)
    const dedup = await this.dedup(endpoint, idempotencyKey)
    if (dedup === 'duplicate') {
      return await this.recordAndReturn({
        verifier,
        endpoint,
        input,
        signatureResult: 'valid',
        timestampResult: timestampCheck === 'fresh' ? 'fresh' : 'skipped',
        dedupResult: 'duplicate',
        outcome: { status: 'duplicate' },
        now,
        idempotencyKey,
      })
    }

    // 6) 通过
    return await this.recordAndReturn({
      verifier,
      endpoint,
      input,
      signatureResult: 'valid',
      timestampResult: timestampCheck === 'fresh' ? 'fresh' : 'skipped',
      dedupResult: 'first',
      outcome: { status: 'accepted' },
      now,
      idempotencyKey,
    })
  }

  private readIngestEnabled(): boolean {
    // 直接读 process.env 而非 env.get：env.get 在启动时缓存（Env.create 一次性解析），
    // 运行时改环境变量（测试 kill switch 覆盖、运维热切换）不会反映。kill switch 必须可
    // 运行时切换，故实时读 process.env。默认关闭贴合「真实接收受授权门控」红线。
    const raw = process.env.WEBHOOKS_INGEST_ENABLED
    if (raw === undefined) return false
    return raw === 'true' || raw === '1'
  }

  private async findEndpointForProvider(provider: string): Promise<WebhookEndpoint | null> {
    // 接收路由按 provider 路由，不暴露 slug；取该 provider 下任一端点（不限 enabled，
    // 由调用方区分禁用态）。多端点场景下取最早创建的，保证稳定。
    return await WebhookEndpoint.query().where('provider', provider).orderBy('id', 'asc').first()
  }

  private verifySignature(
    verifier: WebhookProviderVerifier,
    rawBody: Buffer,
    headers: WebhookHeaders,
    endpoint: WebhookEndpoint,
  ): { valid: boolean } {
    const received = verifier.extractReceivedSignature(headers)
    if (!received) return { valid: false }

    const secret = this.cipher.decrypt(endpoint.signingSecretEncrypted)
    const expected = verifier.computeExpected(rawBody, secret)
    if (verifier.compare(received, expected)) return { valid: true }

    // 轮换过渡窗口：尝试旧密钥
    if (endpoint.previousSecretEncrypted && endpoint.secretRotatedAt) {
      const windowEnd = endpoint.secretRotatedAt.toMillis() + ROTATION_WINDOW_MS
      if (Date.now() <= windowEnd) {
        const oldSecret = this.cipher.decrypt(endpoint.previousSecretEncrypted)
        const oldExpected = verifier.computeExpected(rawBody, oldSecret)
        if (verifier.compare(received, oldExpected)) return { valid: true }
      }
    }
    return { valid: false }
  }

  private verifyTimestamp(
    verifier: WebhookProviderVerifier,
    headers: WebhookHeaders,
    toleranceSeconds: number,
    nowMs: number,
  ): 'fresh' | 'expired' | 'skipped' {
    const ts = verifier.extractTimestamp(headers)
    if (ts === null) return 'skipped'
    const toleranceMs = toleranceSeconds * 1000
    const delta = Math.abs(nowMs - ts)
    return delta <= toleranceMs ? 'fresh' : 'expired'
  }

  private computeIdempotencyKey(verifier: WebhookProviderVerifier, input: IngestInput): string {
    const deliveryId = verifier.extractDeliveryId(input.headers)
    if (deliveryId) return deliveryId
    // 缺失时 sha256(provider + timestamp + rawBody)
    const ts = verifier.extractTimestamp(input.headers) ?? 0
    return crypto
      .createHash('sha256')
      .update(`${input.provider}|${ts}|${input.rawBody.toString('utf8')}`)
      .digest('hex')
  }

  private async dedup(
    endpoint: WebhookEndpoint,
    idempotencyKey: string,
  ): Promise<'first' | 'duplicate'> {
    const existing = await WebhookDelivery.query()
      .where('endpoint_id', endpoint.id)
      .where('idempotency_key', idempotencyKey)
      .first()
    return existing ? 'duplicate' : 'first'
  }

  private async recordAndReturn(args: {
    verifier: WebhookProviderVerifier
    endpoint: WebhookEndpoint | null
    input: IngestInput
    signatureResult: 'valid' | 'invalid' | 'skipped'
    timestampResult: 'fresh' | 'expired' | 'skipped'
    dedupResult: 'first' | 'duplicate' | 'skipped'
    outcome:
      | { status: 'accepted' }
      | { status: 'duplicate' }
      | {
          status: 'rejected'
          httpStatus: 401 | 400 | 403 | 404
          code: string
          message: string
        }
    now: number
    idempotencyKey?: string
    reason?: string
  }): Promise<IngestResult> {
    const {
      verifier,
      endpoint,
      input,
      signatureResult,
      timestampResult,
      dedupResult,
      outcome,
      now,
    } = args
    const idempotencyKey =
      args.idempotencyKey ??
      (endpoint ? this.computeIdempotencyKey(verifier, input) : 'no-endpoint')

    // payload 脱敏摘要：sha256 hex（不可逆，不落原始敏感 payload）
    const payloadDigest = crypto.createHash('sha256').update(input.rawBody).digest('hex')
    const eventType = this.extractEventType(verifier, input)

    let deliveryRowId = 0
    if (endpoint) {
      try {
        const row = await WebhookDelivery.create({
          organizationId: endpoint.organizationId,
          endpointId: endpoint.id,
          provider: input.provider,
          idempotencyKey,
          eventType,
          signatureResult,
          timestampResult,
          dedupResult,
          payloadDigest,
          receivedAt: DateTime.fromMillis(now),
        })
        deliveryRowId = Number(row.id)
      } catch {
        // DB 复合唯一约束冲突 = 并发重复，按 duplicate 处理
        if (dedupResult !== 'skipped') {
          return { status: 'duplicate', deliveryId: 0 }
        }
      }
    }

    return { ...outcome, deliveryId: deliveryRowId } as IngestResult
  }

  private extractEventType(verifier: WebhookProviderVerifier, input: IngestInput): string | null {
    const headers = input.headers as Record<string, unknown>
    const candidates = verifier.provider === 'github' ? ['x-github-event'] : ['x-webhook-event']
    for (const key of candidates) {
      const value = headers[key]
      const raw = Array.isArray(value) ? value[0] : value
      if (raw) return String(raw).slice(0, 120)
    }
    // 兜底：从 body JSON 解析 event_type（只读，不改事实）
    try {
      const parsed = JSON.parse(input.rawBody.toString('utf8'))
      if (parsed && typeof parsed === 'object' && 'event_type' in parsed) {
        return String((parsed as Record<string, unknown>).event_type).slice(0, 120)
      }
    } catch {
      // 非 JSON body，无 event type
    }
    return null
  }
}
