/**
 * DeepSeek V4 Flash 输出边界测试（tasks 5.5）。
 *
 * 覆盖：
 * - LLM Stage 调用参数构建
 * - 空内容、非 JSON、截断 JSON 检测
 * - 未知实体 ID、重复 ID、占位符检测
 * - Thinking/non-thinking 选择策略
 */

import { test } from '@japa/runner'
import {
  buildLlmStageParams,
  checkOutputQuality,
  containsPlaceholder,
  decideModelMode,
  isComplexEntityType,
} from '#services/compiler/deepseek_v4_flash_boundary'

test.group('DeepSeekV4FlashBoundary', () => {
  // ── 5.1 调用参数 ──

  test('buildLlmStageParams 生成正确参数', ({ assert }) => {
    const params = buildLlmStageParams(
      'entity_batch_1',
      ['Wdesign_1a2b', 'Papi_5e6f'],
      2,
      'non-thinking',
    )
    assert.equal(params.jsonSchemaName, 'entity_batch_1')
    assert.includeMembers(params.entityIds, ['Wdesign_1a2b', 'Papi_5e6f'])
    assert.isAbove(params.maxTokens, 0)
    assert.equal(params.modelMode, 'non-thinking')
    assert.include(params.systemPromptSuffix, 'Wdesign_1a2b')
  })

  test('buildLlmStageParams 限制 maxTokens 上限', ({ assert }) => {
    const params = buildLlmStageParams('test', Array(10).fill('id_'), 10, 'thinking')
    assert.isAtMost(params.maxTokens, 16384)
  })

  // ── 5.3 空内容检测 ──

  test('空内容返回 empty 类型', ({ assert }) => {
    const issues = checkOutputQuality('', ['Wdesign_1a2b'], ['name'])
    assert.isTrue(issues.some((i) => i.type === 'empty'))
  })

  test('空白内容返回 empty', ({ assert }) => {
    const issues = checkOutputQuality('   ', ['Wdesign_1a2b'], ['name'])
    assert.isTrue(issues.some((i) => i.type === 'empty'))
  })

  // ── 5.3 非 JSON 检测 ──

  test('非 JSON 内容返回 non_json 类型', ({ assert }) => {
    const issues = checkOutputQuality('不是 JSON', ['Wdesign_1a2b'], ['name'])
    assert.isTrue(issues.some((i) => i.type === 'non_json'))
  })

  test('JSON 代码块可被解析', ({ assert }) => {
    const issues = checkOutputQuality(
      '```json\n{"entities": [{"entityId": "Wdesign_1a2b", "name": "设计"} ]}\n```',
      ['Wdesign_1a2b'],
      ['name'],
    )
    assert.isFalse(issues.some((i) => i.type === 'non_json'))
  })

  // ── 5.3 截断检测 ──

  test('未完成 JSON 被检测为截断', ({ assert }) => {
    const issues = checkOutputQuality(
      '{"entities": [{"entityId": "Wdesign_1a2b", "name": "设计"} ',
      ['Wdesign_1a2b'],
      ['name'],
    )
    assert.isTrue(issues.some((i) => i.type === 'truncated'))
  })

  // ── 5.3 未知实体 ID ──

  test('未知实体 ID 被检测', ({ assert }) => {
    const issues = checkOutputQuality(
      '{"entities": [{"entityId": "Xunknown_9999", "name": "未知"}]}',
      ['Wdesign_1a2b'],
      ['name'],
    )
    assert.isTrue(issues.some((i) => i.type === 'unknown_id'))
  })

  // ── 5.3 重复 ID ──

  test('重复实体 ID 被检测', ({ assert }) => {
    const issues = checkOutputQuality(
      '{"entities": [{"entityId": "Wdesign_1a2b", "name": "A"}, {"entityId": "Wdesign_1a2b", "name": "B"}]}',
      ['Wdesign_1a2b'],
      ['name'],
    )
    assert.isTrue(issues.some((i) => i.type === 'duplicate_id'))
  })

  // ── 5.3 缺字段检测 ──

  test('缺少必填字段被检测', ({ assert }) => {
    const issues = checkOutputQuality(
      '{"entities": [{"entityId": "Wdesign_1a2b"}]}',
      ['Wdesign_1a2b'],
      ['name', 'description'],
    )
    assert.isTrue(issues.some((i) => i.type === 'missing_fields'))
  })

  // ── 5.3 占位符检测 ──

  test('TODO 占位符被检测', ({ assert }) => {
    assert.isTrue(containsPlaceholder('TODO: 待完成'))
  })

  test('待填写占位符被检测', ({ assert }) => {
    assert.isTrue(containsPlaceholder('待填写'))
  })

  test('正常文本不被判定为占位符', ({ assert }) => {
    assert.isFalse(containsPlaceholder('正常项目描述'))
  })

  // ── 5.3 Contract 计数不匹配 ──

  test('实体数量少于期望被检测', ({ assert }) => {
    const issues = checkOutputQuality(
      '{"entities": [{"entityId": "Wdesign_1a2b", "name": "设计"}]}',
      ['Wdesign_1a2b', 'Papi_5e6f', 'Mlaunch_3m4n'],
      ['name'],
    )
    assert.isTrue(issues.some((i) => i.type === 'contract_count_mismatch'))
  })

  // ── 5.4 Thinking 策略 ──

  test('complex 任务启用 thinking', ({ assert }) => {
    assert.equal(decideModelMode('task_l1', 1, 'complex'), 'thinking')
  })

  test('非 complex 常规实体默认 non-thinking', ({ assert }) => {
    assert.equal(decideModelMode('task_l1', 1, 'simple'), 'non-thinking')
  })

  test('workstream 且多实体时启用 thinking', ({ assert }) => {
    assert.equal(decideModelMode('workstream', 3, 'moderate'), 'thinking')
  })

  test('milestone 默认 thinking', ({ assert }) => {
    assert.equal(decideModelMode('milestone', 1, 'simple'), 'thinking')
  })

  test('isComplexEntityType 判断正确', ({ assert }) => {
    assert.isTrue(isComplexEntityType('workstream'))
    assert.isTrue(isComplexEntityType('milestone'))
    assert.isFalse(isComplexEntityType('task_l1'))
  })
})
