/**
 * 通用 fixture verifier（design D2）—— 仅供测试本地签名。
 *
 * 头约定：
 *   - `X-Webhook-Signature: sha256=<hex>`
 *   - `X-Webhook-Delivery: <id>`
 *   - `X-Webhook-Timestamp: <秒>`
 */
import crypto from 'node:crypto'
import type { WebhookHeaders, WebhookProviderVerifier } from './interfaces.js'

export default class FixtureWebhookVerifier implements WebhookProviderVerifier {
  readonly provider = 'fixture'
  readonly headerName = 'x-webhook-signature'

  extractDeliveryId(headers: WebhookHeaders): string | null {
    const value = headers['x-webhook-delivery']
    if (Array.isArray(value)) return value[0] ? String(value[0]) : null
    return value ? String(value) : null
  }

  extractTimestamp(headers: WebhookHeaders): number | null {
    const value = headers['x-webhook-timestamp']
    const raw = Array.isArray(value) ? value[0] : value
    if (!raw) return null
    const seconds = Number(raw)
    return Number.isFinite(seconds) ? seconds * 1000 : null
  }

  extractReceivedSignature(headers: WebhookHeaders): string | null {
    const value = headers[this.headerName]
    const raw = Array.isArray(value) ? value[0] : value
    return raw ? String(raw) : null
  }

  computeExpected(rawBody: Buffer, secret: string): string {
    const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    return `sha256=${digest}`
  }

  compare(received: string, expected: string): boolean {
    const a = Buffer.from(received)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  }
}
