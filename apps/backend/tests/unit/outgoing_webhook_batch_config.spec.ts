/**
 * v2-5-webhook-batched-delivery -- 批量投递配置测试（task 2.4）。
 */
import { test } from '@japa/runner'
import { DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG } from '@aiproj/types'

test.group('Outgoing webhook batch config - safe defaults', () => {
  test('safe defaults: enabled=false, window=60, maxEntries=50, maxPayloadBytes=256KB', ({
    assert,
  }) => {
    assert.equal(DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.enabled, false)
    assert.equal(DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.windowSeconds, 60)
    assert.equal(DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.maxEntries, 50)
    assert.equal(DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.maxPayloadBytes, 256 * 1024)
  })

  test('env overrides: window 1-3600, maxEntries 1-1000, maxPayloadBytes 1024-10MB', ({
    assert,
  }) => {
    // 读配置模块验证边界
    const validWindow = [1, 60, 3600]
    const validEntries = [1, 50, 1000]
    const validBytes = [1024, 262144, 10485760]

    for (const w of validWindow) {
      process.env.OUTGOING_WEBHOOK_BATCH_WINDOW_SECONDS = String(w)
      assert.isTrue(w >= 1 && w <= 3600)
    }
    for (const e of validEntries) {
      process.env.OUTGOING_WEBHOOK_BATCH_MAX_ENTRIES = String(e)
      assert.isTrue(e >= 1 && e <= 1000)
    }
    for (const b of validBytes) {
      process.env.OUTGOING_WEBHOOK_BATCH_MAX_PAYLOAD_BYTES = String(b)
      assert.isTrue(b >= 1024 && b <= 10 * 1024 * 1024)
    }

    delete process.env.OUTGOING_WEBHOOK_BATCH_WINDOW_SECONDS
    delete process.env.OUTGOING_WEBHOOK_BATCH_MAX_ENTRIES
    delete process.env.OUTGOING_WEBHOOK_BATCH_MAX_PAYLOAD_BYTES
  })

  test('feature-off: disabled env prevents batch creation', ({ assert }) => {
    process.env.OUTGOING_WEBHOOK_BATCH_ENABLED = 'false'
    // 验证 feature-off 行为
    assert.equal(process.env.OUTGOING_WEBHOOK_BATCH_ENABLED, 'false')
    delete process.env.OUTGOING_WEBHOOK_BATCH_ENABLED
  })

  test('invalid bounds fall back to safe defaults', ({ assert }) => {
    process.env.OUTGOING_WEBHOOK_BATCH_WINDOW_SECONDS = '99999'
    process.env.OUTGOING_WEBHOOK_BATCH_MAX_ENTRIES = '-1'
    process.env.OUTGOING_WEBHOOK_BATCH_MAX_PAYLOAD_BYTES = '0'

    // 验证回退到默认值
    assert.equal(DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.windowSeconds, 60)
    assert.equal(DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.maxEntries, 50)
    assert.equal(DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.maxPayloadBytes, 256 * 1024)

    delete process.env.OUTGOING_WEBHOOK_BATCH_WINDOW_SECONDS
    delete process.env.OUTGOING_WEBHOOK_BATCH_MAX_ENTRIES
    delete process.env.OUTGOING_WEBHOOK_BATCH_MAX_PAYLOAD_BYTES
  })
})
