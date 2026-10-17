/**
 * v2-5-outgoing-webhook-delivery-ledger -- 出站 webhook 投递客户端接口与实现（design D3）。
 *
 * 窄接口：接收规范化 HTTPS URL、已签名 header、canonical body、超时、关联元数据。
 * 默认 fixture/mock 实现（5.3），永不发起真实 HTTP；生产 http 实现仅在显式配置启用（5.5），
 * 且任何真实外发 smoke 需用户明确授权（spec fixture-first boundary）。
 */
import type { OutgoingWebhookSignedHeaders, OutgoingWebhookFailureCategory } from '@aiproj/types'

/** 投递请求（发送侧，含真实签名值；调用方保证不入投影/审计）。 */
export interface OutgoingWebhookDeliveryRequest {
  targetUrl: string
  headers: OutgoingWebhookSignedHeaders
  body: string
  timeoutMs: number
  deliveryId: number
  attemptNumber: number
}

/** 投递结果（responseBody 仅供 hash/excerpt 计算，调用方不得原样落库）。 */
export interface OutgoingWebhookDeliveryResult {
  ok: boolean
  status: number | null
  responseBody: string
  failureCategory: OutgoingWebhookFailureCategory
  isRetryable: boolean
}

/** 投递客户端接口（fixture/http 共用）。 */
export interface OutgoingWebhookDeliveryClient {
  send(req: OutgoingWebhookDeliveryRequest): Promise<OutgoingWebhookDeliveryResult>
  readonly kind: 'fixture' | 'http'
}

/** 默认成功结果（fixture 队列空时用）。 */
export const DEFAULT_FIXTURE_DELIVERY_RESULT: OutgoingWebhookDeliveryResult = {
  ok: true,
  status: 200,
  responseBody: '',
  failureCategory: 'unknown',
  isRetryable: false,
}

/**
 * Fixture/mock 投递客户端（5.3 default）。
 * 可配置队列响应，记录所有调用供 no-real-HTTP 断言；永不发起真实 HTTP。
 */
export class FixtureOutgoingWebhookDeliveryClient implements OutgoingWebhookDeliveryClient {
  readonly kind = 'fixture' as const
  private queue: OutgoingWebhookDeliveryResult[] = []
  private defaultResult: OutgoingWebhookDeliveryResult = DEFAULT_FIXTURE_DELIVERY_RESULT
  public readonly calls: OutgoingWebhookDeliveryRequest[] = []

  setNext(result: OutgoingWebhookDeliveryResult): this {
    this.queue.push(result)
    return this
  }

  setDefault(result: OutgoingWebhookDeliveryResult): this {
    this.defaultResult = result
    return this
  }

  reset(): this {
    this.queue = []
    this.calls.length = 0
    this.defaultResult = DEFAULT_FIXTURE_DELIVERY_RESULT
    return this
  }

  async send(req: OutgoingWebhookDeliveryRequest): Promise<OutgoingWebhookDeliveryResult> {
    this.calls.push(req)
    if (this.queue.length > 0) return this.queue.shift()!
    return this.defaultResult
  }
}

/**
 * 生产 HTTP 投递客户端（5.5）。
 * 仅在显式配置启用时注入；本 change 默认不启用，且不运行任何真实外发 smoke（spec boundary）。
 * 失败分类：timeout -> timeout；网络错误 -> network；429 -> rate_limited；5xx -> server_error；
 * 4xx -> client_error；2xx -> success（failureCategory 'unknown'，ok=true）。
 */
export class HttpOutgoingWebhookDeliveryClient implements OutgoingWebhookDeliveryClient {
  readonly kind = 'http' as const

  async send(req: OutgoingWebhookDeliveryRequest): Promise<OutgoingWebhookDeliveryResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), req.timeoutMs)
    try {
      const res = await fetch(req.targetUrl, {
        method: 'POST',
        headers: req.headers as unknown as Record<string, string>,
        body: req.body,
        signal: controller.signal,
      })
      const body = await res.text().catch(() => '')
      const status = res.status
      if (status >= 200 && status <= 299) {
        return {
          ok: true,
          status,
          responseBody: body,
          failureCategory: 'unknown',
          isRetryable: false,
        }
      }
      if (status === 429) {
        return {
          ok: false,
          status,
          responseBody: body,
          failureCategory: 'rate_limited',
          isRetryable: true,
        }
      }
      if (status >= 500 && status <= 599) {
        return {
          ok: false,
          status,
          responseBody: body,
          failureCategory: 'server_error',
          isRetryable: true,
        }
      }
      return {
        ok: false,
        status,
        responseBody: body,
        failureCategory: 'client_error',
        isRetryable: false,
      }
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      return {
        ok: false,
        status: null,
        responseBody: '',
        failureCategory: aborted ? 'timeout' : 'network',
        isRetryable: true,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
