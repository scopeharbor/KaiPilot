/**
 * v3-copilot-agent-workflow-orchestration —— 共享契约与禁存约束测试
 *
 * 覆盖 tasks 2.1-2.8：编排定义、步骤形状、轨迹记录、禁存约束、fixtures。
 */

import { describe, it, expect } from 'vitest'
import {
  isOrchestrationStepKind,
  isOrchestrationStepState,
  isOrchestrationState,
  traceContainsForbiddenFields,
  containsWorkflowSensitiveMarkers,
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_DURATION_MS,
  ORCHESTRATION_RUN_TYPE,
  COMPILER_RUN_TYPE,
  isCompilerRunType,
  isCeilingRaiseAttempt,
  type OrchestrationDefinition,
  type OrchestrationTrace,
  type OrchestrationCeilingConfig,
} from '../src/copilot-agent-workflow.js'
import {
  buildAllReadonlyOrchestration,
  buildWithMutationOrchestration,
  buildPausedOrchestration,
  buildFailedOrchestration,
  buildAtCeilingOrchestration,
  buildOrchestrationTrace,
  buildStepTrace,
  buildDefaultCeilingConfig,
  buildLoweredCeilingConfig,
  buildCompilerRunType,
  buildOrchestrationRunType,
  SENSITIVE_SAMPLES,
  INTERMEDIATE_BODY_SAMPLES,
} from '../src/copilot-agent-workflow-fixtures.js'

// ── §2.1-2.2 编排定义与步骤形状 ──

describe('OrchestrationStepKind', () => {
  it('validates readonly and mutation kinds', () => {
    expect(isOrchestrationStepKind('readonly')).toBe(true)
    expect(isOrchestrationStepKind('mutation')).toBe(true)
    expect(isOrchestrationStepKind('invalid')).toBe(false)
    expect(isOrchestrationStepKind(null)).toBe(false)
  })
})

describe('OrchestrationStepState', () => {
  it('validates all step states', () => {
    for (const state of ['pending', 'running', 'completed', 'failed', 'paused', 'cancelled']) {
      expect(isOrchestrationStepState(state)).toBe(true)
    }
    expect(isOrchestrationStepState('unknown')).toBe(false)
  })
})

describe('OrchestrationState', () => {
  it('validates all orchestration states', () => {
    for (const state of [
      'pending',
      'queued',
      'running',
      'paused',
      'completed',
      'failed',
      'cancelled',
      'needs_human_review',
    ]) {
      expect(isOrchestrationState(state)).toBe(true)
    }
    expect(isOrchestrationState('unknown')).toBe(false)
  })
})

describe('OrchestrationDefinition shape', () => {
  it('has required fields', () => {
    const def = buildAllReadonlyOrchestration()
    expect(def.orchestrationId).toBeTruthy()
    expect(def.name).toBeTruthy()
    expect(Array.isArray(def.steps)).toBe(true)
    expect(def.sessionId).toBeTruthy()
    expect(typeof def.userId).toBe('number')
    expect(typeof def.organizationId).toBe('number')
  })

  it('steps have stepId, kind, title, description', () => {
    const def = buildWithMutationOrchestration()
    for (const step of def.steps) {
      expect(step.stepId).toBeTruthy()
      expect(['readonly', 'mutation']).toContain(step.kind)
      expect(step.title).toBeTruthy()
      expect(step.description).toBeTruthy()
    }
  })

  it('mutation steps have targets', () => {
    const def = buildWithMutationOrchestration()
    const mutations = def.steps.filter((s) => s.kind === 'mutation')
    expect(mutations.length).toBeGreaterThan(0)
    for (const mut of mutations) {
      expect(mut.targets && mut.targets.length).toBeGreaterThan(0)
    }
  })
})

// ── §2.3 轨迹记录形状 ──

describe('OrchestrationStepTrace shape', () => {
  it('has stepId, status; does NOT have body content', () => {
    const trace = buildStepTrace()
    expect(trace.stepId).toBeTruthy()
    expect(trace.status).toBeTruthy()
    // D6：不含中间产物正文
    expect((trace as any).body).toBeUndefined()
    expect((trace as any).prompt).toBeUndefined()
    expect((trace as any).modelOutput).toBeUndefined()
  })
})

// ── §2.4-2.5 禁存约束 ──

describe('traceContainsForbiddenFields', () => {
  it('detects forbidden field names', () => {
    const trace: Record<string, unknown> = {
      stepId: 'step-1',
      status: 'completed',
      prompt: 'some prompt',
      modelOutput: 'some output',
      token: 'abc123',
    }
    const found = traceContainsForbiddenFields(trace)
    expect(found).toContain('prompt')
    expect(found).toContain('modelOutput')
    expect(found).toContain('token')
  })

  it('passes clean trace', () => {
    const trace: Record<string, unknown> = {
      stepId: 'step-1',
      status: 'completed',
      durationMs: 1234,
      artifactRef: 'art-1',
    }
    const found = traceContainsForbiddenFields(trace)
    expect(found.length).toBe(0)
  })
})

describe('containsWorkflowSensitiveMarkers', () => {
  it('detects sk- tokens', () => {
    expect(containsWorkflowSensitiveMarkers('sk-abc123def456ghi789jkl012mno')).toBe(true)
  })

  it('detects token: patterns', () => {
    expect(containsWorkflowSensitiveMarkers('token: Bearer eyJhbGciOiJIUzI1NiIs')).toBe(true)
  })

  it('detects api_key patterns', () => {
    expect(containsWorkflowSensitiveMarkers('api_key: AKIAIOSFODNN7EXAMPLE')).toBe(true)
  })

  it('passes non-sensitive strings', () => {
    expect(containsWorkflowSensitiveMarkers('这是一个普通描述')).toBe(false)
    expect(containsWorkflowSensitiveMarkers('step-1 completed')).toBe(false)
  })

  it('passes non-string values', () => {
    expect(containsWorkflowSensitiveMarkers(null)).toBe(false)
    expect(containsWorkflowSensitiveMarkers(123)).toBe(false)
    expect(containsWorkflowSensitiveMarkers(undefined)).toBe(false)
  })
})

describe('sensitive samples absent from traces', () => {
  it('no sensitive sample appears in a clean trace field', () => {
    const trace = buildOrchestrationTrace({
      steps: [buildStepTrace({ stepId: 'step-1', artifactRef: 'art-1' })],
    })
    const traceJson = JSON.stringify(trace)
    for (const sample of SENSITIVE_SAMPLES) {
      expect(traceJson).not.toContain(sample)
    }
  })

  it('no intermediate body appears in a clean trace field', () => {
    const trace = buildOrchestrationTrace()
    const traceJson = JSON.stringify(trace)
    for (const body of INTERMEDIATE_BODY_SAMPLES) {
      expect(traceJson).not.toContain(body)
    }
  })
})

// ── §2.6 常量 ──

describe('ceiling constants', () => {
  it('DEFAULT_MAX_STEPS is positive integer', () => {
    expect(DEFAULT_MAX_STEPS).toBeGreaterThan(0)
    expect(Number.isInteger(DEFAULT_MAX_STEPS)).toBe(true)
  })

  it('DEFAULT_MAX_DURATION_MS is positive', () => {
    expect(DEFAULT_MAX_DURATION_MS).toBeGreaterThan(0)
  })

  it('ORCHESTRATION_RUN_TYPE is distinct from COMPILER_RUN_TYPE', () => {
    expect(ORCHESTRATION_RUN_TYPE).not.toBe(COMPILER_RUN_TYPE)
  })
})

// ── §2.7 Fixtures 五态 ──

describe('fixtures - five states', () => {
  it('all-readonly orchestration has only readonly steps', () => {
    const def = buildAllReadonlyOrchestration()
    for (const step of def.steps) {
      expect(step.kind).toBe('readonly')
    }
  })

  it('with-mutation orchestration has at least one mutation step', () => {
    const def = buildWithMutationOrchestration()
    const mutations = def.steps.filter((s) => s.kind === 'mutation')
    expect(mutations.length).toBeGreaterThan(0)
  })

  it('paused orchestration has mutation steps for pausing', () => {
    const def = buildPausedOrchestration()
    const mutations = def.steps.filter((s) => s.kind === 'mutation')
    expect(mutations.length).toBeGreaterThanOrEqual(2)
  })

  it('failed orchestration has mutation steps for failure', () => {
    const def = buildFailedOrchestration()
    expect(def.steps.length).toBeGreaterThanOrEqual(3)
  })

  it('at-ceiling orchestration has DEFAULT_MAX_STEPS steps', () => {
    const def = buildAtCeilingOrchestration()
    expect(def.steps.length).toBe(DEFAULT_MAX_STEPS)
  })
})

// ── §2.8 run type ──

describe('CompilerRunType', () => {
  it('validates compiler type', () => {
    expect(isCompilerRunType('compiler')).toBe(true)
    expect(isCompilerRunType(buildCompilerRunType())).toBe(true)
  })

  it('validates orchestration type', () => {
    expect(isCompilerRunType('copilot_orchestration')).toBe(true)
    expect(isCompilerRunType(buildOrchestrationRunType())).toBe(true)
  })

  it('rejects unknown type', () => {
    expect(isCompilerRunType('unknown')).toBe(false)
  })
})

// ── Ceiling config ──

describe('OrchestrationCeilingConfig', () => {
  it('default config has expected values', () => {
    const config = buildDefaultCeilingConfig()
    expect(config.maxSteps).toBe(DEFAULT_MAX_STEPS)
    expect(config.maxDurationMs).toBe(DEFAULT_MAX_DURATION_MS)
  })

  it('lowered config is strictly less', () => {
    const config = buildLoweredCeilingConfig()
    expect(config.maxSteps!).toBeLessThan(DEFAULT_MAX_STEPS)
    expect(config.maxDurationMs!).toBeLessThan(DEFAULT_MAX_DURATION_MS)
  })
})

describe('isCeilingRaiseAttempt', () => {
  it('detects step count raise', () => {
    const current = buildLoweredCeilingConfig()
    const proposed: OrchestrationCeilingConfig = { maxSteps: 100, maxDurationMs: null }
    expect(isCeilingRaiseAttempt(current, proposed)).toBe(true)
  })

  it('detects duration raise', () => {
    const current = buildLoweredCeilingConfig()
    const proposed: OrchestrationCeilingConfig = { maxSteps: null, maxDurationMs: 60 * 60 * 1000 }
    expect(isCeilingRaiseAttempt(current, proposed)).toBe(true)
  })

  it('allows lowering', () => {
    const current = buildDefaultCeilingConfig()
    const proposed = buildLoweredCeilingConfig()
    expect(isCeilingRaiseAttempt(current, proposed)).toBe(false)
  })

  it('allows same values', () => {
    const current = buildDefaultCeilingConfig()
    const proposed = buildDefaultCeilingConfig()
    expect(isCeilingRaiseAttempt(current, proposed)).toBe(false)
  })
})
