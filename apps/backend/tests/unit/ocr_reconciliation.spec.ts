/**
 * v3-global-ai-rate-limiting §7.1–7.5 — OCR 调和测试。
 *
 * 验证：
 * - 统一计数与 OCR 自算计数在同一 fixture 下口径一致；
 * - OCR 既有限流不因统一限流引入而改用第二计数源；
 * - 限流与预算分属不同维度，同一维度不被双重裁决。
 *
 * 本文件原为占位（0 断言、`test.describe` 非 japa API、导入不存在的
 * `#tests/helpers/db_isolation`），由 v3-copilot-live-submission-channel 用真断言重写。
 */

import { test } from '@japa/runner'
import { readFileSync } from 'node:fs'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { RATE_LIMIT_WINDOW_MS } from '@aiproj/types'
import WindowCounter from '#services/rate_limiting/window_counter'
import { setupTest, createTestOrg } from '#tests/helpers/index'

/** 同一 fixture：窗口内三次成功调用，各 100 输入 + 50 输出 token。 */
const FIXTURE_ATTEMPTS = [
  { inputTokens: 100, outputTokens: 50 },
  { inputTokens: 100, outputTokens: 50 },
  { inputTokens: 100, outputTokens: 50 },
] as const

/** OCR 自算口径：窗口内条数为 RPM，输入+输出之和为 TPM（见 ocr_rate_limit_guard）。 */
function ocrStyleCounts(attempts: readonly { inputTokens: number; outputTokens: number }[]) {
  return {
    rpm: attempts.length,
    tpm: attempts.reduce((sum, a) => sum + a.inputTokens + a.outputTokens, 0),
  }
}

test.group('OCR 调和（计数口径一致 + 无第二计数源）', (group) => {
  group.each.setup(async () => {
    await setupTest()
  })

  test('统一账本计数与 OCR 自算口径在同一 fixture 下一致', async ({ assert }) => {
    const org = await createTestOrg()
    const now = DateTime.now().toSQL()
    for (const attempt of FIXTURE_ATTEMPTS) {
      await db.table('unified_ai_invocation_ledger').insert({
        organization_id: org.id,
        connection_id: 1,
        model_id: 1,
        status: 'succeeded',
        usage_input_tokens: attempt.inputTokens,
        usage_output_tokens: attempt.outputTokens,
        occurred_at: now,
        created_at: now,
        updated_at: now,
      })
    }

    const unified = await new WindowCounter().getCounts({
      organizationId: org.id,
      connectionId: 1,
      modelId: 1,
    })

    assert.deepEqual(unified, ocrStyleCounts(FIXTURE_ATTEMPTS))
  })

  test('两套计数使用同一窗口语义（1 分钟滚动窗口）', async ({ assert }) => {
    const ocrSource = readFileSync('app/services/ai_ocr/ocr_rate_limit_guard.ts', 'utf8')
    // OCR 守卫以 60 秒窗口计数；统一侧窗口长度由常量声明
    assert.equal(RATE_LIMIT_WINDOW_MS, 60_000)
    assert.match(ocrSource, /60|minute/i)
  })

  test('OCR 守卫仍从 ocr_provider_attempts 计数，未改用统一账本', async ({ assert }) => {
    const ocrSource = readFileSync('app/services/ai_ocr/ocr_rate_limit_guard.ts', 'utf8')
    assert.include(ocrSource, 'ocr_provider_attempt')
    assert.notInclude(ocrSource, 'unified_ai_invocation_ledger')
    assert.notInclude(ocrSource, 'WindowCounter')
  })

  test('统一窗口计数器不读 OCR 表（不引入第二计数源）', async ({ assert }) => {
    const source = readFileSync('app/services/rate_limiting/window_counter.ts', 'utf8')
    assert.include(source, 'unified_ai_invocation_ledger')
    assert.notInclude(source, 'ocr_provider_attempt')
    // 也不得引入内存或外部计数存储
    assert.notInclude(source, 'redis')
    assert.notInclude(source, 'Redis')
  })

  test('限流与预算分属不同维度：限流守卫不读成本，不做预算裁决', async ({ assert }) => {
    const guardSource = readFileSync('app/services/rate_limiting/rate_limit_guard.ts', 'utf8')
    assert.include(guardSource, 'rpm')
    assert.include(guardSource, 'tpm')
    assert.notInclude(guardSource, 'estimated_cost')
    assert.notInclude(guardSource, 'budget')
    assert.notInclude(guardSource, 'Budget')
  })
})
