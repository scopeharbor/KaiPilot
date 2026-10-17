/**
 * Compiler Realtime Mapper —— unit tests (tasks 1.4, 1.5)
 *
 * 使用 vitest（纯逻辑测试，不依赖 AdonisJS 运行时）。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  mapStageEventToEnvelope,
  validateEnvelopeSafety,
  isValidTransition,
  isTerminalEvent,
  resetSequenceCounter,
} from '../../app/services/compiler/compiler_realtime_mapper.js'

describe('Compiler Realtime Mapper', () => {
  beforeEach(() => {
    resetSequenceCounter()
  })

  it('started → started envelope', () => {
    const entry = {
      compilerRunId: 1,
      stageId: 'intent_ingestion',
      phase: 'ingestion',
      attemptNumber: 1,
    }
    const env = mapStageEventToEnvelope(entry as any, 'running')
    expect(env.domain).toBe('compiler')
    expect(env.type).toBe('started')
    expect(env.sequence).toBeGreaterThan(0)
  })

  it('completed → completed envelope', () => {
    const entry = {
      compilerRunId: 1,
      stageId: 'dag_stub',
      phase: 'build',
      durationMs: 500,
      llmCalls: 2,
    }
    const env = mapStageEventToEnvelope(entry as any, 'completed')
    expect(env.type).toBe('completed')
  })

  it('skipped → cancelled envelope', () => {
    const entry = { compilerRunId: 1, stageId: 'intent_parsing', phase: 'parsing' }
    const env = mapStageEventToEnvelope(entry as any, 'skipped')
    expect(env.type).toBe('cancelled')
  })

  it('needs_human_review → progress envelope', () => {
    const entry = { compilerRunId: 1, stageId: 'validation', phase: 'validate', attemptNumber: 1 }
    const env = mapStageEventToEnvelope(entry as any, 'needs_human_review')
    expect(env.type).toBe('progress')
  })

  it('sequence 单调递增', () => {
    const entry = { compilerRunId: 1, stageId: 's1', phase: 'p' }
    const e1 = mapStageEventToEnvelope(entry as any, 'running')
    const e2 = mapStageEventToEnvelope(entry as any, 'running')
    expect(e2.sequence).toBe(e1.sequence + 1)
  })

  it('eventId 包含 runId 和 stageId', () => {
    const entry = { compilerRunId: 42, stageId: 'my_stage', phase: 'p' }
    const env = mapStageEventToEnvelope(entry as any, 'running')
    expect(env.eventId).toContain('42')
    expect(env.eventId).toContain('my_stage')
  })

  it('envelope 不含敏感字段 (task 1.5)', () => {
    const entry = {
      compilerRunId: 1,
      stageId: 's',
      phase: 'p',
      contextPacketRef: 'secret',
      inputArtifactRefs: ['ref'],
      modelOutputRef: 'secret',
      tokenCostSummary: 'secret',
    }
    const env = mapStageEventToEnvelope(entry as any, 'running')
    // 即使输入有敏感字段，envelope 不应包含
    expect(validateEnvelopeSafety(env)).toBe(true)
    const json = JSON.stringify(env)
    expect(json).not.toContain('contextPacketRef')
    expect(json).not.toContain('inputArtifactRefs')
    expect(json).not.toContain('modelOutputRef')
    expect(json).not.toContain('tokenCostSummary')
  })

  it('FSM 合法转换判定', () => {
    expect(isValidTransition('started', 'completed')).toBe(true)
    expect(isValidTransition('started', 'failed')).toBe(true)
    expect(isValidTransition('completed', 'started')).toBe(false)
    expect(isValidTransition('failed', 'started')).toBe(false)
  })

  it('终态判定', () => {
    expect(isTerminalEvent('completed')).toBe(true)
    expect(isTerminalEvent('failed')).toBe(true)
    expect(isTerminalEvent('started')).toBe(false)
    expect(isTerminalEvent('progress')).toBe(false)
  })
})
