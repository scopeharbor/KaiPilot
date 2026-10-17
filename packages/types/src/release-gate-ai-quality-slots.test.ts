/**
 * v3-release-gate-ai-quality-slots —— AI 门槽契约单测。
 *
 * 覆盖：
 * - §1 门槽枚举与类型守卫
 * - §2 判定口径声明（D5）
 * - §3 证据强制（D1：运行标识强制、人工断言拒绝）
 * - §4 无数据语义（D2：pending 语义）
 * - §5 漂移门槽特殊判定（D8）
 * - §6 禁存约束（值级敏感检测）
 * - §7 评估器（D6：零域写；D7：可复现）
 * - §8 与既有清单的集成
 *
 * 全部确定性 fixture，无网络/数据库/provider。
 */
import { describe, expect, it } from 'vitest'
import {
  AI_QUALITY_EVIDENCE_SOURCES,
  AI_QUALITY_SLOT_CRITERIA,
  AI_QUALITY_SLOT_IDS,
  AI_QUALITY_SLOT_STATUSES,
  assertNoDataIsPending,
  assertRunReferenceResolvable,
  assertSlotRequiresRunReference,
  assertSlotEvaluationWritesNothing,
  evaluateAiQualitySlot,
  evaluateAllAiQualitySlots,
  evaluateDriftSlot,
  findAiQualitySlotCriterion,
  isAiQualityEvidenceSource,
  isAiQualityGate,
  isAiQualitySlotId,
  isAiQualitySlotStatus,
  validateAiQualitySlotTypedEvidence,
  aiSlotRecordContainsSensitiveFields,
  type AiQualitySlotRecord,
  type AiQualitySlotStatus,
  type DriftConfirmationStatus,
} from './release-gate-ai-quality-slots.js'
import {
  AI_SLOT_FIXTURE_EVALUATED_AT,
  AI_SLOT_FIXTURE_ORG_ID,
  AI_SLOT_SENSITIVE_SAMPLES,
  fixtureAllSlotsPassed,
  fixtureAllSlotsPending,
  fixtureCostFailed,
  fixtureCostPassed,
  fixtureDriftConfirmedPassed,
  fixtureDriftPassed,
  fixtureDriftUnconfirmedFailed,
  fixtureEvaluationInputAllPassed,
  fixtureEvaluationInputDriftConfirmed,
  fixtureEvaluationInputDriftUnconfirmed,
  fixtureEvaluationInputNoData,
  fixtureEvaluationInputOutputQualityFailed,
  fixtureOfflineRegressionFailed,
  fixtureOfflineRegressionPassed,
  fixtureOutputQualityFailed,
  fixtureOutputQualityPending,
  fixtureOutputQualityPassed,
  fixtureRunReferenceResolver,
  fixtureRunReferenceResolverAlwaysFails,
  fixtureSecurityEventsPassed,
  containsAiSlotSensitiveContent,
} from './release-gate-ai-quality-slots-fixtures.js'

// ═══════════════════════════════════════════════════════════════════════════════
// §1 门槽枚举与类型守卫
// ═══════════════════════════════════════════════════════════════════════════════

describe('AI 门槽枚举与类型守卫', () => {
  it('五个门槽 ID 已定义', () => {
    expect(AI_QUALITY_SLOT_IDS).toHaveLength(5)
    expect(AI_QUALITY_SLOT_IDS).toEqual([
      'ai-output-quality',
      'ai-offline-regression',
      'ai-cost',
      'ai-model-drift',
      'ai-security-events',
    ])
  })

  it('三种门槽状态已定义', () => {
    expect(AI_QUALITY_SLOT_STATUSES).toEqual(['passed', 'failed', 'pending'])
  })

  it('五种证据源已定义', () => {
    expect(AI_QUALITY_EVIDENCE_SOURCES).toHaveLength(5)
  })

  it('isAiQualitySlotId 类型守卫正确', () => {
    expect(isAiQualitySlotId('ai-output-quality')).toBe(true)
    expect(isAiQualitySlotId('ai-offline-regression')).toBe(true)
    expect(isAiQualitySlotId('ai-cost')).toBe(true)
    expect(isAiQualitySlotId('ai-model-drift')).toBe(true)
    expect(isAiQualitySlotId('ai-security-events')).toBe(true)
    expect(isAiQualitySlotId('unknown')).toBe(false)
  })

  it('isAiQualitySlotStatus 类型守卫正确', () => {
    expect(isAiQualitySlotStatus('passed')).toBe(true)
    expect(isAiQualitySlotStatus('failed')).toBe(true)
    expect(isAiQualitySlotStatus('pending')).toBe(true)
    expect(isAiQualitySlotStatus('blocked')).toBe(false)
  })

  it('isAiQualityEvidenceSource 类型守卫正确', () => {
    expect(isAiQualityEvidenceSource('online-evaluation')).toBe(true)
    expect(isAiQualityEvidenceSource('offline-eval-dataset')).toBe(true)
    expect(isAiQualityEvidenceSource('invocation-ledger')).toBe(true)
    expect(isAiQualityEvidenceSource('drift-detection')).toBe(true)
    expect(isAiQualityEvidenceSource('security-observability')).toBe(true)
    expect(isAiQualityEvidenceSource('unknown')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §2 判定口径声明（D5）
// ═══════════════════════════════════════════════════════════════════════════════

describe('判定口径声明（D5）', () => {
  it('五个门槽各有判定口径', () => {
    expect(AI_QUALITY_SLOT_CRITERIA).toHaveLength(5)
    for (const criterion of AI_QUALITY_SLOT_CRITERIA) {
      expect(criterion.slotId).toBeTruthy()
      expect(criterion.name).toBeTruthy()
      expect(criterion.passCondition).toBeTruthy()
      expect(criterion.pendingCondition).toBeTruthy()
      expect(criterion.failCondition).toBeTruthy()
    }
  })

  it('findAiQualitySlotCriterion 返回正确口径', () => {
    const criterion = findAiQualitySlotCriterion('ai-output-quality')
    expect(criterion).toBeDefined()
    expect(criterion?.name).toBe('输出质量')
    expect(criterion?.passCondition).toContain('通过率')
  })

  it('findAiQualitySlotCriterion 对未知 ID 返回 undefined', () => {
    expect(findAiQualitySlotCriterion('unknown' as any)).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §3 证据强制（D1：运行标识强制、人工断言拒绝）
// ═══════════════════════════════════════════════════════════════════════════════

describe('证据强制（D1）', () => {
  it('passed 无 runReference → 被拒', () => {
    const slot: AiQualitySlotRecord = {
      slotId: 'ai-output-quality',
      name: '输出质量',
      status: 'passed',
      runReference: null,
      criterion: '',
      evaluatedAt: AI_SLOT_FIXTURE_EVALUATED_AT,
      organizationId: AI_SLOT_FIXTURE_ORG_ID,
    }
    const error = assertSlotRequiresRunReference(slot)
    expect(error).toContain('人工断言无法把门槽标为通过')
  })

  it('passed 有 runReference → 通过', () => {
    const error = assertSlotRequiresRunReference(fixtureOutputQualityPassed)
    expect(error).toBeNull()
  })

  it('pending 无 runReference → 通过（pending 不需要引用）', () => {
    const slot: AiQualitySlotRecord = {
      slotId: 'ai-output-quality',
      name: '输出质量',
      status: 'pending',
      runReference: null,
      criterion: '',
      evaluatedAt: AI_SLOT_FIXTURE_EVALUATED_AT,
      organizationId: AI_SLOT_FIXTURE_ORG_ID,
    }
    const error = assertSlotRequiresRunReference(slot)
    expect(error).toBeNull()
  })

  it('failed 有 runReference → 通过', () => {
    const error = assertSlotRequiresRunReference(fixtureOutputQualityFailed)
    expect(error).toBeNull()
  })

  it('passed 有 runReference 但 runId 为空 → 被拒', () => {
    const slot: AiQualitySlotRecord = {
      slotId: 'ai-output-quality',
      name: '输出质量',
      status: 'passed',
      runReference: {
        evidenceSource: 'online-evaluation',
        runId: '',
        runAt: '2026-08-22T11:00:00.000Z',
      },
      criterion: '',
      evaluatedAt: AI_SLOT_FIXTURE_EVALUATED_AT,
      organizationId: AI_SLOT_FIXTURE_ORG_ID,
    }
    const error = assertSlotRequiresRunReference(slot)
    expect(error).toContain('runReference.runId 为空')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §3b 引用解析（D1：引用失效 → pending）
// ═══════════════════════════════════════════════════════════════════════════════

describe('引用解析（D1）', () => {
  it('已知 runReference → 解析成功', () => {
    const error = assertRunReferenceResolvable(
      fixtureOutputQualityPassed,
      fixtureRunReferenceResolver,
    )
    expect(error).toBeNull()
  })

  it('未知 runReference → 引用失效', () => {
    const slot: AiQualitySlotRecord = {
      ...fixtureOutputQualityPassed,
      runReference: {
        evidenceSource: 'online-evaluation',
        runId: 'nonexistent-run-001',
        runAt: '2026-08-22T11:00:00.000Z',
      },
    }
    const error = assertRunReferenceResolvable(slot, fixtureRunReferenceResolver)
    expect(error).toContain('无法解析')
  })

  it('全部失败的解析器 → 引用失效', () => {
    const error = assertRunReferenceResolvable(
      fixtureOutputQualityPassed,
      fixtureRunReferenceResolverAlwaysFails,
    )
    expect(error).toContain('无法解析')
  })

  it('pending 状态不检查解析（runReference 为 null）', () => {
    const error = assertRunReferenceResolvable(
      fixtureAllSlotsPending[0],
      fixtureRunReferenceResolverAlwaysFails,
    )
    expect(error).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §4 无数据语义（D2：pending 语义）
// ═══════════════════════════════════════════════════════════════════════════════

describe('无数据语义（D2）', () => {
  it('无数据 + passed → 违反 D2', () => {
    const error = assertNoDataIsPending(fixtureOutputQualityPassed, false)
    expect(error).toContain('无数据必须记为 pending')
  })

  it('无数据 + pending → 符合 D2', () => {
    const error = assertNoDataIsPending(fixtureOutputQualityPending, false)
    expect(error).toBeNull()
  })

  it('有数据 + passed → 符合 D2', () => {
    const error = assertNoDataIsPending(fixtureOutputQualityPassed, true)
    expect(error).toBeNull()
  })

  it('有数据 + failed → 符合 D2', () => {
    const error = assertNoDataIsPending(fixtureOutputQualityFailed, true)
    expect(error).toBeNull()
  })

  it('五个门槽在无数据时均为 pending', () => {
    expect(fixtureAllSlotsPending).toHaveLength(5)
    for (const slot of fixtureAllSlotsPending) {
      expect(slot.status).toBe('pending')
      expect(slot.runReference).toBeNull()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §5 漂移门槽特殊判定（D8）
// ═══════════════════════════════════════════════════════════════════════════════

describe('漂移门槽判定（D8）', () => {
  it('无漂移检测记录 → pending', () => {
    const status = evaluateDriftSlot([], false)
    expect(status).toBe('pending')
  })

  it('有漂移事件但全部已确认 → passed', () => {
    const events = [
      { eventId: 'e1', confirmationStatus: 'confirmed' as DriftConfirmationStatus },
      { eventId: 'e2', confirmationStatus: 'confirmed' as DriftConfirmationStatus },
    ]
    const status = evaluateDriftSlot(events, true)
    expect(status).toBe('passed')
  })

  it('有未经确认的漂移事件 → failed', () => {
    const events = [
      { eventId: 'e1', confirmationStatus: 'confirmed' as DriftConfirmationStatus },
      { eventId: 'e2', confirmationStatus: 'unconfirmed' as DriftConfirmationStatus },
    ]
    const status = evaluateDriftSlot(events, true)
    expect(status).toBe('failed')
  })

  it('全部未确认 → failed', () => {
    const events = [{ eventId: 'e1', confirmationStatus: 'unconfirmed' as DriftConfirmationStatus }]
    const status = evaluateDriftSlot(events, true)
    expect(status).toBe('failed')
  })

  it('无事件但有检测记录 → passed', () => {
    const status = evaluateDriftSlot([], true)
    expect(status).toBe('passed')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §6 禁存约束（值级敏感检测）
// ═══════════════════════════════════════════════════════════════════════════════

describe('禁存约束', () => {
  it('门槽记录不含敏感内容', () => {
    for (const slot of fixtureAllSlotsPassed) {
      const violations = aiSlotRecordContainsSensitiveFields(
        slot as unknown as Record<string, unknown>,
      )
      expect(violations).toEqual([])
    }
  })

  it('包含 API key 的记录被检出', () => {
    const record = {
      slotId: 'ai-output-quality',
      resultSummary: 'sk-abcdefghijklmnopqrstuvwxyz123456',
    }
    const violations = aiSlotRecordContainsSensitiveFields(record)
    expect(violations).toContain('api_key')
  })

  it('包含 Bearer token 的记录被检出', () => {
    const record = {
      slotId: 'ai-output-quality',
      resultSummary: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature',
    }
    const violations = aiSlotRecordContainsSensitiveFields(record)
    expect(violations).toContain('bearer_token')
  })

  it('包含 password 的记录被检出', () => {
    const record = {
      slotId: 'ai-output-quality',
      resultSummary: 'password=hunter2secret123',
    }
    const violations = aiSlotRecordContainsSensitiveFields(record)
    expect(violations).toContain('password')
  })

  it('包含 token 赋值的记录被检出', () => {
    const record = {
      slotId: 'ai-output-quality',
      resultSummary: 'token=abcdefghijklmnopqrstuvwxyz1234567890',
    }
    const violations = aiSlotRecordContainsSensitiveFields(record)
    expect(violations).toContain('token_assignment')
  })

  it('包含 secret 赋值的记录被检出', () => {
    const record = {
      slotId: 'ai-output-quality',
      resultSummary: 'secret=mysupersecretkey1234567890',
    }
    const violations = aiSlotRecordContainsSensitiveFields(record)
    expect(violations).toContain('secret_assignment')
  })

  it('fixture 全部通过敏感检测', () => {
    const allFixtures = [
      fixtureOutputQualityPassed,
      fixtureOfflineRegressionPassed,
      fixtureCostPassed,
      fixtureDriftPassed,
      fixtureSecurityEventsPassed,
      fixtureOutputQualityFailed,
      fixtureOfflineRegressionFailed,
      fixtureCostFailed,
      fixtureDriftConfirmedPassed,
      fixtureDriftUnconfirmedFailed,
      ...fixtureAllSlotsPending,
    ]
    for (const slot of allFixtures) {
      const violations = aiSlotRecordContainsSensitiveFields(
        slot as unknown as Record<string, unknown>,
      )
      expect(violations).toEqual([])
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §7 评估器（D6：零域写；D7：可复现）
// ═══════════════════════════════════════════════════════════════════════════════

describe('评估器', () => {
  describe('D7 可复现性', () => {
    it('同一批输入产出同一批状态', () => {
      const result1 = evaluateAllAiQualitySlots(fixtureEvaluationInputAllPassed)
      const result2 = evaluateAllAiQualitySlots(fixtureEvaluationInputAllPassed)
      expect(result1.map((s) => s.status)).toEqual(result2.map((s) => s.status))
    })

    it('无数据输入产出全 pending', () => {
      const result = evaluateAllAiQualitySlots(fixtureEvaluationInputNoData)
      expect(result).toHaveLength(5)
      for (const slot of result) {
        expect(slot.status).toBe('pending')
        expect(slot.runReference).toBeNull()
      }
    })
  })

  describe('D6 零域写', () => {
    it('评估路径无发布动作依赖', () => {
      expect(assertSlotEvaluationWritesNothing()).toBe(true)
    })
  })

  describe('单门槽评估', () => {
    it('输出质量：通过率 >= 0.8 → passed', () => {
      const slot = evaluateAiQualitySlot('ai-output-quality', fixtureEvaluationInputAllPassed)
      expect(slot.status).toBe('passed')
      expect(slot.runReference).not.toBeNull()
      expect(slot.runReference?.evidenceSource).toBe('online-evaluation')
      expect(slot.aggregateValue).toBe(0.92)
    })

    it('输出质量：通过率 < 0.8 → failed', () => {
      const slot = evaluateAiQualitySlot(
        'ai-output-quality',
        fixtureEvaluationInputOutputQualityFailed,
      )
      expect(slot.status).toBe('failed')
      expect(slot.aggregateValue).toBe(0.65)
    })

    it('输出质量：无数据 → pending', () => {
      const slot = evaluateAiQualitySlot('ai-output-quality', fixtureEvaluationInputNoData)
      expect(slot.status).toBe('pending')
      expect(slot.runReference).toBeNull()
    })

    it('离线回归：无回归 → passed', () => {
      const slot = evaluateAiQualitySlot('ai-offline-regression', fixtureEvaluationInputAllPassed)
      expect(slot.status).toBe('passed')
      expect(slot.runReference?.evidenceSource).toBe('offline-eval-dataset')
    })

    it('离线回归：有回归 → failed', () => {
      const input = {
        ...fixtureEvaluationInputAllPassed,
        offlineRegression: {
          runId: 'offline-run-002',
          runAt: '2026-08-22T10:45:00.000Z',
          hasRegression: true,
          regressionCount: 3,
          totalSamples: 100,
        },
      }
      const slot = evaluateAiQualitySlot('ai-offline-regression', input)
      expect(slot.status).toBe('failed')
      expect(slot.aggregateValue).toBe(3)
    })

    it('成本：未超预算 → passed', () => {
      const slot = evaluateAiQualitySlot('ai-cost', fixtureEvaluationInputAllPassed)
      expect(slot.status).toBe('passed')
      expect(slot.runReference?.evidenceSource).toBe('invocation-ledger')
    })

    it('成本：超预算 → failed', () => {
      const input = {
        ...fixtureEvaluationInputAllPassed,
        cost: {
          windowStart: '2026-08-21T12:00:00.000Z',
          windowEnd: '2026-08-22T12:00:00.000Z',
          totalCost: 75.0,
          budgetLimit: 50.0,
          totalCalls: 300,
        },
      }
      const slot = evaluateAiQualitySlot('ai-cost', input)
      expect(slot.status).toBe('failed')
      expect(slot.aggregateValue).toBe(75.0)
    })

    it('漂移：无事件 → passed', () => {
      const slot = evaluateAiQualitySlot('ai-model-drift', fixtureEvaluationInputAllPassed)
      expect(slot.status).toBe('passed')
    })

    it('漂移：已确认 → passed', () => {
      const slot = evaluateAiQualitySlot('ai-model-drift', fixtureEvaluationInputDriftConfirmed)
      expect(slot.status).toBe('passed')
    })

    it('漂移：未确认 → failed', () => {
      const slot = evaluateAiQualitySlot('ai-model-drift', fixtureEvaluationInputDriftUnconfirmed)
      expect(slot.status).toBe('failed')
    })

    it('安全事件：无事件 → passed', () => {
      const slot = evaluateAiQualitySlot('ai-security-events', fixtureEvaluationInputAllPassed)
      expect(slot.status).toBe('passed')
      expect(slot.runReference?.evidenceSource).toBe('security-observability')
    })

    it('安全事件：有事件 → failed', () => {
      const input = {
        ...fixtureEvaluationInputAllPassed,
        securityEvents: {
          windowStart: '2026-08-21T12:00:00.000Z',
          windowEnd: '2026-08-22T12:00:00.000Z',
          eventCount: 2,
        },
      }
      const slot = evaluateAiQualitySlot('ai-security-events', input)
      expect(slot.status).toBe('failed')
      expect(slot.aggregateValue).toBe(2)
    })
  })

  describe('全量评估', () => {
    it('返回五个门槽', () => {
      const result = evaluateAllAiQualitySlots(fixtureEvaluationInputAllPassed)
      expect(result).toHaveLength(5)
      const ids = result.map((s) => s.slotId)
      expect(ids).toEqual(AI_QUALITY_SLOT_IDS)
    })

    it('全绿输入 → 全 passed', () => {
      const result = evaluateAllAiQualitySlots(fixtureEvaluationInputAllPassed)
      for (const slot of result) {
        expect(slot.status).toBe('passed')
        expect(slot.runReference).not.toBeNull()
      }
    })

    it('全绿输入 → 全低敏', () => {
      const result = evaluateAllAiQualitySlots(fixtureEvaluationInputAllPassed)
      for (const slot of result) {
        const violations = aiSlotRecordContainsSensitiveFields(
          slot as unknown as Record<string, unknown>,
        )
        expect(violations).toEqual([])
      }
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §8 与既有清单的集成
// ═══════════════════════════════════════════════════════════════════════════════

describe('与既有清单的集成', () => {
  it('手写门槽结论没有 typed record → 失败', () => {
    const result = validateAiQualitySlotTypedEvidence(
      fixtureOutputQualityPassed,
      () => undefined,
      'head-current',
    )
    expect(result.valid).toBe(false)
    expect(result.stale).toBe(false)
    expect(result.message).toContain('recordId')
  })

  it('门槽记录采自旧 HEAD → stale 而非 passing', () => {
    const slot = { ...fixtureOutputQualityPassed, recordId: 'record-ai-quality' }
    const result = validateAiQualitySlotTypedEvidence(
      slot,
      () => ({
        recordId: 'record-ai-quality',
        gateId: 'ai-quality-slots',
        command: 'pnpm check:ai-quality-slots -- --json',
        exitCode: 0,
        startedAt: '2026-08-27T00:00:00.000Z',
        finishedAt: '2026-08-27T00:00:01.000Z',
        collectedHead: 'head-old',
        outputDigest: 'sha256:fixture',
      }),
      'head-current',
    )
    expect(result.valid).toBe(false)
    expect(result.stale).toBe(true)
    expect(result.message).toContain('旧 HEAD')
  })

  it('isAiQualityGate 正确识别 AI 门槽', () => {
    expect(isAiQualityGate('ai-output-quality')).toBe(true)
    expect(isAiQualityGate('ai-offline-regression')).toBe(true)
    expect(isAiQualityGate('ai-cost')).toBe(true)
    expect(isAiQualityGate('ai-model-drift')).toBe(true)
    expect(isAiQualityGate('ai-security-events')).toBe(true)
  })

  it('isAiQualityGate 不误判既有门槽', () => {
    expect(isAiQualityGate('openspec')).toBe(false)
    expect(isAiQualityGate('typecheck')).toBe(false)
    expect(isAiQualityGate('lint')).toBe(false)
    expect(isAiQualityGate('format')).toBe(false)
    expect(isAiQualityGate('tests')).toBe(false)
    expect(isAiQualityGate('build')).toBe(false)
    expect(isAiQualityGate('browser-smoke')).toBe(false)
    expect(isAiQualityGate('specialized-gates')).toBe(false)
    expect(isAiQualityGate('uat-scenarios')).toBe(false)
    expect(isAiQualityGate('known-issues')).toBe(false)
  })
})
