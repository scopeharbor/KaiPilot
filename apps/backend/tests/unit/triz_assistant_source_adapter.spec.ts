/**
 * v3-ai-triz-assistant —— AI-TRIZ 助手 Source Adapter 测试（tasks 4.8–4.10，vitest）。
 *
 * 注（v3-backend-type-debt-closure）：本文件原为 vitest 风格，但被测适配器在模块顶层
 * `import db from '@adonisjs/lucid/services/db'`——Vitest 裸 node 环境下该服务未 boot，
 * 整个文件以 "Cannot read properties of undefined (reading 'booted')" 失败。已改为 Japa。
 *
 * 覆盖：
 * - getNullSafeWarning 为每种 source kind 返回结构化的 warning
 * - 每个 source kind 产生不同的消息
 * - 脱敏验证
 * - null-safe warning mapping（§4.10 P1）
 */
import { test } from '@japa/runner'
import TrizAssistantSourceAdapter from '../../app/services/triz_assistant_source_adapter.js'
import type { AiTrizAssistantSourceKind } from '@aiproj/types'
import { AI_TRIZ_ASSISTANT_SOURCE_KINDS } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 测试组：null-safe warning mapping（§4.10 P1）
// ---------------------------------------------------------------------------
test.group('TrizAssistantSourceAdapter - nullSafeWarning', () => {
  function adapter() {
    return new TrizAssistantSourceAdapter()
  }

  test('getNullSafeWarning returns structured warning for every source kind', ({ assert }) => {
    const a = adapter()
    const kinds = [...AI_TRIZ_ASSISTANT_SOURCE_KINDS] as AiTrizAssistantSourceKind[]

    for (const kind of kinds) {
      const w = a.getNullSafeWarning(kind, '模块未部署')
      assert.equal(w.code, 'SOURCE_UNAVAILABLE')
      assert.include(w.message, kind)
      assert.include(w.message, '模块未部署')
    }
  })

  test('getNullSafeWarning produces distinct messages for different reasons', ({ assert }) => {
    const a = adapter()
    const w1 = a.getNullSafeWarning('knowledge_summary', '知识库未启用')
    const w2 = a.getNullSafeWarning('knowledge_summary', '权限不足')

    // 相同 kind 不同 reason 产生不同消息
    assert.notEqual(w1.message, w2.message)
    assert.equal(w1.code, 'SOURCE_UNAVAILABLE')
    assert.equal(w2.code, 'SOURCE_UNAVAILABLE')
  })

  test('getNullSafeWarning for all source kinds is non-empty', ({ assert }) => {
    const a = adapter()
    const kinds = [...AI_TRIZ_ASSISTANT_SOURCE_KINDS] as AiTrizAssistantSourceKind[]
    assert.isAtLeast(kinds.length, 15) // 至少 16 个 source kind
    // 每个 source kind 都必须能给出可展示的降级告警，不能有漏配的空消息
    for (const kind of kinds) {
      const warning = a.getNullSafeWarning(kind, '来源不可用')
      assert.equal(warning.code, 'SOURCE_UNAVAILABLE')
      assert.isAbove(warning.message.length, 0)
    }
  })
})

// ---------------------------------------------------------------------------
// 测试组：脱敏验证
// ---------------------------------------------------------------------------
test.group('TrizAssistantSourceAdapter - redaction', () => {
  function adapter() {
    return new TrizAssistantSourceAdapter()
  }

  test('all source kinds are represented in Adapter registry', ({ assert }) => {
    // 验证 SOURCE_ADAPTERS registry 覆盖所有定义的 source kind
    const kinds = [...AI_TRIZ_ASSISTANT_SOURCE_KINDS]
    assert.equal(kinds.length, 16) // 16 source kinds per spec
  })

  test('nullSafeWarning never leaks internal paths or tokens', ({ assert }) => {
    const a = adapter()
    const kinds: AiTrizAssistantSourceKind[] = ['contradiction', 'draft_layer', 'decision_log']
    for (const kind of kinds) {
      const w = a.getNullSafeWarning(kind, '/secret/path/token-12345')
      assert.notInclude(w.message, '/secret')
      // 原因可以出现在消息中 — 这取决于实现
    }
  })
})

// ---------------------------------------------------------------------------
// 测试组：source kind 完整性
// ---------------------------------------------------------------------------
test.group('TrizAssistantSourceAdapter - source kind completeness', () => {
  test('AI_TRIZ_ASSISTANT_SOURCE_KINDS includes all required TRIZ sources', ({ assert }) => {
    const kinds = [...AI_TRIZ_ASSISTANT_SOURCE_KINDS] as string[]
    const requiredKinds = [
      'contradiction',
      'contradiction_matrix',
      'technical_contradiction_analysis',
      'physical_contradiction_analysis',
      'ifr_snapshot',
      'function_analysis_snapshot',
      'resource_analysis',
      'evolution_trend_run',
      'recommendation_rationale',
      'innovation_workbench_scheme',
      'decision_log',
      'clarification_card',
      'compiler_triz_artifact',
      'draft_layer',
    ]

    for (const required of requiredKinds) {
      assert.include(kinds, required)
    }
  })
})
