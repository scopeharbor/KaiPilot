/**
 * v2-5-outgoing-webhook-subscription-foundation -- 目标 URL 保守校验单元测试（design D4 / 任务 3.6）。
 *
 * 纯函数测试，不依赖 DB。覆盖接受 HTTPS、规范化、拒绝非支持 scheme、拒绝凭据 URL、
 * 拒绝 loopback/私有目标，以及 test/dev 显式允许私网。
 */
import { test } from '@japa/runner'
import {
  normalizeAndValidateTargetUrl,
  OutgoingWebhookUrlError,
} from '#services/webhooks/outgoing_webhook_url_validator'

test.group('Outgoing Webhook URL Validation', () => {
  test('accepts valid HTTPS URL and normalizes host case', ({ assert }) => {
    const { normalized, host } = normalizeAndValidateTargetUrl('https://Hooks.Example.COM/Incoming')
    assert.equal(host, 'hooks.example.com')
    assert.equal(normalized, 'https://hooks.example.com/Incoming')
  })

  test('strips default https port 443', ({ assert }) => {
    const { normalized } = normalizeAndValidateTargetUrl('https://hooks.example.com:443/incoming')
    assert.equal(normalized, 'https://hooks.example.com/incoming')
  })

  test('keeps non-default port', ({ assert }) => {
    const { normalized, host } = normalizeAndValidateTargetUrl(
      'https://hooks.example.com:9000/incoming',
    )
    assert.equal(host, 'hooks.example.com')
    assert.equal(normalized, 'https://hooks.example.com:9000/incoming')
  })

  test('rejects http scheme', ({ assert }) => {
    assert.throws(
      () => normalizeAndValidateTargetUrl('http://hooks.example.com/incoming'),
      OutgoingWebhookUrlError,
    )
  })

  test('rejects javascript scheme', ({ assert }) => {
    assert.throws(
      () => normalizeAndValidateTargetUrl('javascript:alert(1)'),
      OutgoingWebhookUrlError,
    )
  })

  test('rejects file scheme', ({ assert }) => {
    assert.throws(
      () => normalizeAndValidateTargetUrl('file:///etc/passwd'),
      OutgoingWebhookUrlError,
    )
  })

  test('rejects malformed URL', ({ assert }) => {
    assert.throws(() => normalizeAndValidateTargetUrl('not a url'), OutgoingWebhookUrlError)
  })

  test('rejects empty URL', ({ assert }) => {
    assert.throws(() => normalizeAndValidateTargetUrl('   '), OutgoingWebhookUrlError)
  })

  test('rejects credential-bearing URL', ({ assert }) => {
    assert.throws(
      () => normalizeAndValidateTargetUrl('https://user:pass@hooks.example.com/incoming'),
      OutgoingWebhookUrlError,
    )
  })

  test('rejects loopback 127.0.0.1', ({ assert }) => {
    assert.throws(
      () => normalizeAndValidateTargetUrl('https://127.0.0.1:9000/hook'),
      OutgoingWebhookUrlError,
    )
  })

  test('rejects localhost', ({ assert }) => {
    assert.throws(
      () => normalizeAndValidateTargetUrl('https://localhost/hook'),
      OutgoingWebhookUrlError,
    )
  })

  test('rejects IPv6 loopback ::1', ({ assert }) => {
    assert.throws(
      () => normalizeAndValidateTargetUrl('https://[::1]/hook'),
      OutgoingWebhookUrlError,
    )
  })

  test('rejects private 10.x', ({ assert }) => {
    assert.throws(
      () => normalizeAndValidateTargetUrl('https://10.0.0.1/hook'),
      OutgoingWebhookUrlError,
    )
  })

  test('rejects private 192.168.x', ({ assert }) => {
    assert.throws(
      () => normalizeAndValidateTargetUrl('https://192.168.1.1/hook'),
      OutgoingWebhookUrlError,
    )
  })

  test('rejects private 172.16.x', ({ assert }) => {
    assert.throws(
      () => normalizeAndValidateTargetUrl('https://172.16.0.1/hook'),
      OutgoingWebhookUrlError,
    )
  })

  test('allows public host that is not private', ({ assert }) => {
    const { host } = normalizeAndValidateTargetUrl('https://8.8.8.8/hook')
    assert.equal(host, '8.8.8.8')
  })
})

test.group('Outgoing Webhook URL Validation - dev allow private', (group) => {
  group.setup(() => {
    process.env.OUTGOING_WEBHOOK_DEV_ALLOW_PRIVATE = 'true'
    return () => {
      delete process.env.OUTGOING_WEBHOOK_DEV_ALLOW_PRIVATE
    }
  })

  test('allows loopback when dev allowance enabled', ({ assert }) => {
    const { host } = normalizeAndValidateTargetUrl('https://127.0.0.1:9000/hook')
    assert.equal(host, '127.0.0.1')
  })

  test('allows private 10.x when dev allowance enabled', ({ assert }) => {
    const { normalized } = normalizeAndValidateTargetUrl('https://10.0.0.1/hook')
    assert.equal(normalized, 'https://10.0.0.1/hook')
  })
})
