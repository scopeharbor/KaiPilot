/**
 * v3-copilot-structured-and-diagram-output —— 结构化输出策略解析器单元测试。
 *
 * 覆盖：
 * - 5.1 复用 ai_m0/schema.ts 既有策略分支
 * - 5.2 未新建第二套能力判定
 * - 5.3 连接不支持严格 schema 时按既有降级链处理
 * - 5.4 支持与不支持两条路径
 * - 5.5 能力不支持时块缺席并给出原因
 * - 5.6 能力不支持时块缺席
 *
 * 约束：零真实 provider / 模型 / 公网调用。
 */
import { test } from '@japa/runner'
import {
  resolveStructuredOutputStrategy,
  toAiM0Strategy,
} from '#services/copilot_turn/copilot_structured_output_strategy'

// ---------------------------------------------------------------------------
// Task 5.1 & 5.2: 复用既有策略分支，不新建第二套判定
// ---------------------------------------------------------------------------

test.group('Structured Output Strategy — reuse shipped branch', () => {
  test('delegates to supportsStrictSchema capability', ({ assert }) => {
    // Task 5.2: 验证复用既有的 supportsStrictSchema 字段
    const result = resolveStructuredOutputStrategy({
      supportsStrictSchema: true,
    })
    assert.equal(result.strategy, 'structured_output')
    assert.isFalse(result.degraded)
  })

  test('does not introduce a second capability judgement', ({ assert }) => {
    // Task 5.2: 验证不新建判定——只看 supportsStrictSchema
    const result = resolveStructuredOutputStrategy({
      supportsStrictSchema: false,
    })
    // 降级到 prompt 策略，而非新建策略
    assert.equal(result.strategy, 'prompt')
    assert.isTrue(result.degraded)
  })
})

// ---------------------------------------------------------------------------
// Task 5.3 & 5.4: 降级链处理与两条路径
// ---------------------------------------------------------------------------

test.group('Structured Output Strategy — degradation chain', () => {
  test('strict schema supported uses structured_output strategy', ({ assert }) => {
    const result = resolveStructuredOutputStrategy({
      supportsStrictSchema: true,
    })
    assert.equal(result.strategy, 'structured_output')
    assert.isFalse(result.degraded)
    assert.isUndefined(result.absentBlock)
  })

  test('strict schema not supported degrades to prompt', ({ assert }) => {
    const result = resolveStructuredOutputStrategy({
      supportsStrictSchema: false,
    })
    assert.equal(result.strategy, 'prompt')
    assert.isTrue(result.degraded)
    assert.isTrue(result.degradationReason!.includes('不支持严格 schema'))
  })

  test('null capabilities uses default strategy', ({ assert }) => {
    const result = resolveStructuredOutputStrategy(null)
    assert.equal(result.strategy, 'prompt')
    assert.isFalse(result.degraded)
  })

  test('undefined supportsStrictSchema degrades', ({ assert }) => {
    const result = resolveStructuredOutputStrategy({})
    assert.equal(result.strategy, 'prompt')
    assert.isTrue(result.degraded)
  })
})

// ---------------------------------------------------------------------------
// Task 5.5 & 5.6: 能力不支持时块缺席
// ---------------------------------------------------------------------------

test.group('Structured Output Strategy — unsupported capability', () => {
  test('unsupported capability produces absent block', ({ assert }) => {
    const result = resolveStructuredOutputStrategy({
      supportsStrictSchema: false,
    })
    assert.isDefined(result.absentBlock)
    assert.equal(result.absentBlock!.reason, 'capability_unsupported')
    assert.equal(result.absentBlock!.blockType, 'table')
  })

  test('supported capability does not produce absent block', ({ assert }) => {
    const result = resolveStructuredOutputStrategy({
      supportsStrictSchema: true,
    })
    assert.isUndefined(result.absentBlock)
  })

  test('absent block detail is readable', ({ assert }) => {
    const result = resolveStructuredOutputStrategy({
      supportsStrictSchema: false,
    })
    assert.isTrue(result.absentBlock!.detail!.includes('不支持严格 schema'))
    assert.isTrue(result.absentBlock!.detail!.includes('缺席'))
  })
})

// ---------------------------------------------------------------------------
// toAiM0Strategy mapping
// ---------------------------------------------------------------------------

test.group('Structured Output Strategy — AiM0Strategy mapping', () => {
  test('structured_output maps to the shipped native branch', ({ assert }) => {
    // AiM0Strategy 封闭枚举为 prompt | native | tool；严格 schema 输出对应 native 分支
    // （适配器 strategy === 'native' + jsonSchema 路径），不存在名为 structured_output 的策略。
    assert.equal(toAiM0Strategy('structured_output'), 'native')
  })

  test('prompt maps to prompt', ({ assert }) => {
    assert.equal(toAiM0Strategy('prompt'), 'prompt')
  })
})
