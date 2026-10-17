/**
 * LLM Stage Adapter 单元测试（tasks 9.4）。
 */

import { describe, expect, it } from 'vitest'
import {
  buildStagePrompt,
  checkLlmOutput,
  estimateMaxTokens,
  needsHumanReview,
  type LlmStageCallConfig,
} from '../../../app/services/compiler/deterministic/llm_stage_adapter.js'

const sampleConfig: LlmStageCallConfig = {
  stageId: 'test_stage',
  jsonSchemaName: 'test_entity',
  entityIds: ['entity_1', 'entity_2'],
  sampleJson: { id: '', name: '', description: '' },
  maxTokens: 4096,
  thinkingMode: false,
  computedFields: ['plannedStart', 'plannedEnd', 'durationWorkingDays'],
  maxRetries: 2,
}

describe('checkLlmOutput', () => {
  it('空内容检测', () => {
    const result = checkLlmOutput('', sampleConfig)
    expect(result.passed).toBe(false)
    expect(result.issues.some((i) => i.type === 'empty_content')).toBe(true)
    expect(result.shouldRetry).toBe(true)
  })

  it('空白字符也判定为空', () => {
    const result = checkLlmOutput('   \n  ', sampleConfig)
    expect(result.passed).toBe(false)
    expect(result.issues.some((i) => i.type === 'empty_content')).toBe(true)
  })

  it('合法 JSON 通过', () => {
    const result = checkLlmOutput(
      '{"id": "entity_1", "name": "test", "description": "desc"}',
      sampleConfig,
    )
    expect(result.passed).toBe(true)
    expect(result.parsedData).not.toBeNull()
    expect(result.normalized).not.toBeNull()
  })

  it('malformed JSON 被恢复', () => {
    const result = checkLlmOutput('```json\n{"id": "entity_1"}\n```', sampleConfig)
    // 应成功解析
    expect(result.parsedData).not.toBeNull()
    expect(result.issues.some((i) => i.type === 'malformed_json')).toBe(true)
  })

  it('截断 JSON 检测', () => {
    const result = checkLlmOutput('{"id": "entity_1", "name": "unfinished', sampleConfig)
    expect(result.issues.some((i) => i.type === 'truncated_json')).toBe(true)
    expect(result.shouldRetry).toBe(true)
  })

  it('computed 字段被移除', () => {
    const result = checkLlmOutput(
      '{"id": "entity_1", "plannedStart": "2026-07-13", "name": "test"}',
      sampleConfig,
    )
    expect(result.issues.some((i) => i.type === 'computed_field_in_output')).toBe(true)
    expect(result.normalized).not.toBeNull()
    expect(result.normalized!['plannedStart']).toBeUndefined()
  })

  it('unknown fields 被丢弃', () => {
    const result = checkLlmOutput(
      '{"id": "entity_1", "extraField": "should_be_dropped", "name": "test"}',
      sampleConfig,
    )
    expect(result.issues.some((i) => i.type === 'schema_unknown_fields')).toBe(true)
    expect(result.normalized!['extraField']).toBeUndefined()
  })

  it('candidate_only 提示始终出现', () => {
    const result = checkLlmOutput('{"id": "entity_1", "name": "test"}', sampleConfig)
    expect(result.issues.some((i) => i.type === 'candidate_only')).toBe(true)
  })

  it('needsHumanReview 判定', () => {
    const result = checkLlmOutput('', sampleConfig)
    // 空内容 + 可重试 → 不触发 human review
    expect(needsHumanReview({ ...result, attemptNumber: 1 })).toBe(false)
    // 空内容 + 超出重试 → 触发 human review
    expect(needsHumanReview({ ...result, attemptNumber: 3 })).toBe(false) // shouldRetry is true
  })
})

describe('buildStagePrompt', () => {
  it('prompt 包含 JSON 示例', () => {
    const prompt = buildStagePrompt(sampleConfig, '生成测试数据')
    expect(prompt).toContain('JSON Schema 示例')
    expect(prompt).toContain('"id"')
    expect(prompt).toContain('自动计算')
    expect(prompt).toContain('plannedStart')
  })

  it('thinking mode 时包含思考指令', () => {
    const thinkingConfig = { ...sampleConfig, thinkingMode: true }
    const prompt = buildStagePrompt(thinkingConfig, '复杂规划')
    expect(prompt).toContain('请先思考')
  })
})

describe('estimateMaxTokens', () => {
  it('small entity count → moderate tokens', () => {
    expect(estimateMaxTokens(1, 'simple')).toBe(1536)
  })

  it('large entity count → capped at 16384', () => {
    expect(estimateMaxTokens(100, 'complex')).toBe(16384)
  })
})
