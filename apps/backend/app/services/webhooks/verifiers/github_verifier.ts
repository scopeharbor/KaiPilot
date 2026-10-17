/**
 * GitHub 风格 webhook 签名 verifier（design D2）。
 *
 * GitHub 推送：
 *   - `X-Hub-Signature-256: sha256=<hex>`
 *   - `X-GitHub-Delivery: <uuid>`（delivery id / 幂等首选）
 *
 * 时间戳：GitHub 官方 webhook 不在标准头里携带时间戳，故 `extractTimestamp` 返回 null，
 * 时间戳新鲜度校验对该 provider 跳过（由幂等去重承担重放防护）。
 */
import crypto from 'node:crypto'
import type { WebhookHeaders, WebhookProviderVerifier } from './interfaces.js'

export default class GithubWebhookVerifier implements WebhookProviderVerifier {
  readonly provider = 'github'
  readonly headerName = 'x-hub-signature-256'

  extractDeliveryId(headers: WebhookHeaders): string | null {
    const value = headers['x-github-delivery']
    if (Array.isArray(value)) return value[0] ? String(value[0]) : null
    return value ? String(value) : null
  }

  extractTimestamp(_headers: WebhookHeaders): number | null {
    return null
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
