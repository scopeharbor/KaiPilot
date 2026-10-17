/**
 * v2-5-provider-incoming-webhook-foundation —— provider 签名 verifier 单元测试。
 *
 * 覆盖：有效签名通过、篡改一字节失效、缺失签名头拒绝、比较走 timingSafeEqual
 * （长度先校验）。
 */
import { test } from '@japa/runner'
import crypto from 'node:crypto'
import GithubWebhookVerifier from '#services/webhooks/verifiers/github_verifier'
import FixtureWebhookVerifier from '#services/webhooks/verifiers/fixture_verifier'
import {
  getWebhookVerifier,
  isSupportedWebhookProvider,
} from '#services/webhooks/verifiers/registry'

const SECRET = 'whsec_test_secret_abc123'
const RAW = Buffer.from(JSON.stringify({ action: 'opened', number: 42 }), 'utf8')

function sign(body: Buffer, secret: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`
}

test.group('Webhook Verifier - GitHub', () => {
  const verifier = new GithubWebhookVerifier()

  test('valid signature passes', ({ assert }) => {
    const received = sign(RAW, SECRET)
    const expected = verifier.computeExpected(RAW, SECRET)
    assert.isTrue(verifier.compare(received, expected))
  })

  test('tampered body fails signature', ({ assert }) => {
    const received = sign(RAW, SECRET)
    const tampered = Buffer.from(RAW.toString('utf8').replace('42', '43'), 'utf8')
    const expected = verifier.computeExpected(tampered, SECRET)
    assert.isFalse(verifier.compare(received, expected))
  })

  test('missing signature header returns null', ({ assert }) => {
    const headers = {} as Record<string, string>
    assert.isNull(verifier.extractReceivedSignature(headers))
  })

  test('compare length-mismatched returns false without throw', ({ assert }) => {
    assert.isFalse(verifier.compare('sha256=abc', 'sha256=abcd'))
    assert.isFalse(verifier.compare('', 'sha256=anything'))
  })

  test('extracts delivery id from X-GitHub-Delivery', ({ assert }) => {
    const headers = { 'x-github-delivery': 'abc-123' } as Record<string, string>
    assert.equal(verifier.extractDeliveryId(headers), 'abc-123')
  })

  test('returns null timestamp for GitHub (no standard timestamp header)', ({ assert }) => {
    const headers = { 'x-github-delivery': 'abc' } as Record<string, string>
    assert.isNull(verifier.extractTimestamp(headers))
  })
})

test.group('Webhook Verifier - Fixture', () => {
  const verifier = new FixtureWebhookVerifier()

  test('valid signature passes', ({ assert }) => {
    const received = sign(RAW, SECRET)
    const expected = verifier.computeExpected(RAW, SECRET)
    assert.isTrue(verifier.compare(received, expected))
  })

  test('tampered one byte fails', ({ assert }) => {
    const received = sign(RAW, SECRET)
    const tampered = Buffer.concat([RAW.slice(0, -1), Buffer.from([RAW[RAW.length - 1] ^ 0xff])])
    const expected = verifier.computeExpected(tampered, SECRET)
    assert.isFalse(verifier.compare(received, expected))
  })

  test('extracts timestamp and delivery id', ({ assert }) => {
    const headers = {
      'x-webhook-timestamp': '1700000000',
      'x-webhook-delivery': 'del-9',
    } as Record<string, string>
    assert.equal(verifier.extractTimestamp(headers), 1700000000 * 1000)
    assert.equal(verifier.extractDeliveryId(headers), 'del-9')
  })
})

test.group('Webhook Verifier Registry', () => {
  test('resolves github and fixture verifiers', ({ assert }) => {
    assert.isNotNull(getWebhookVerifier('github'))
    assert.isNotNull(getWebhookVerifier('fixture'))
  })

  test('returns null for unknown provider', ({ assert }) => {
    assert.isNull(getWebhookVerifier('unknown-provider'))
  })

  test('isSupportedWebhookProvider reports registration', ({ assert }) => {
    assert.isTrue(isSupportedWebhookProvider('github'))
    assert.isTrue(isSupportedWebhookProvider('fixture'))
    assert.isFalse(isSupportedWebhookProvider('nope'))
  })
})
