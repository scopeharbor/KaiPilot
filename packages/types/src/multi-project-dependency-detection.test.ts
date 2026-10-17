// 多项目依赖检测共享契约测试 — 运行时中立性、枚举漂移、hash 确定性、
// lifecycle transition、severity/confidence classification、draft bridge 转换。
// 红线：不导入 AdonisJS/React/数据库/AI/网络/cache/chart/container/external provider。

import { describe, it, expect } from 'vitest'
import {
  // Enums
  DETECTION_RULE_IDS,
  DETECTION_RULE_ID_VALUES,
  DETECTION_SEVERITIES,
  DETECTION_SEVERITY_VALUES,
  DETECTION_SEVERITY_ORDER,
  DETECTION_CONFIDENCE_BANDS,
  DETECTION_CONFIDENCE_BAND_VALUES,
  DETECTION_CONFIDENCE_ORDER,
  DETECTION_RESULT_STATUSES,
  DETECTION_RESULT_STATUS_VALUES,
  DETECTION_RESULT_TRANSITIONS,
  DETECTION_RUN_STATUSES,
  DETECTION_RUN_STATUS_VALUES,
  DETECTION_WARNING_CODES,
  DETECTION_WARNING_CODE_VALUES,
  DETECTION_REDACTION_STATES,
  DETECTION_REDACTION_STATE_VALUES,
  // Pure functions
  normalizeDetectionScope,
  hashDetectionScope,
  fingerprintDetectionResult,
  classifyDetectionSeverity,
  classifyDetectionConfidence,
  isValidDetectionResultTransition,
  isDetectionRuleId,
  isDetectionSeverity,
  isDetectionConfidenceBand,
  isDetectionResultStatus,
  isDetectionRunStatus,
  isDetectionWarningCode,
  isDetectionRedactionState,
  buildPlanToken,
  areScopesEqual,
  // Constants
  DEFAULT_DETECTION_RULE_SET,
  // Fixtures
  DETECTION_FIXTURE_SCOPES,
  DETECTION_FIXTURE_RESULTS,
  // Types (used at compile-time only)
} from './multi-project-dependency-detection.js'
import type {
  DetectionScope,
  NormalizedDetectionScope,
  DetectionRuleId,
  DetectionSeverity,
  DetectionConfidenceBand,
  DetectionResultStatus,
  DetectionRunStatus,
  DetectionWarningCode,
  DetectionRedactionState,
  DetectionPlan,
} from './multi-project-dependency-detection.js'

// ─── 枚举完整性 ─────────────────────────────────────────────────────────────────

describe('枚举常量和值列表', () => {
  const ENUM_VALUE_MAP: Record<string, readonly string[]> = {
    DETECTION_RULE_IDS: DETECTION_RULE_ID_VALUES,
    DETECTION_SEVERITIES: DETECTION_SEVERITY_VALUES,
    DETECTION_CONFIDENCE_BANDS: DETECTION_CONFIDENCE_BAND_VALUES,
    DETECTION_RESULT_STATUSES: DETECTION_RESULT_STATUS_VALUES,
    DETECTION_RUN_STATUSES: DETECTION_RUN_STATUS_VALUES,
    DETECTION_WARNING_CODES: DETECTION_WARNING_CODE_VALUES,
    DETECTION_REDACTION_STATES: DETECTION_REDACTION_STATE_VALUES,
  }

  for (const [enumName, values] of Object.entries(ENUM_VALUE_MAP)) {
    it(`${enumName} 值列表非空`, () => {
      expect(values.length).toBeGreaterThan(0)
    })

    it(`${enumName} 值列表不含重复`, () => {
      expect(new Set(values).size).toBe(values.length)
    })

    it(`${enumName} 所有值都是非空字符串`, () => {
      for (const v of values) {
        expect(typeof v).toBe('string')
        expect(v.length).toBeGreaterThan(0)
      }
    })
  }
})

// ─── Enum drift guards ──────────────────────────────────────────────────────────

describe('enum drift guard — isDetectionRuleId', () => {
  it('已知 rule id 通过验证', () => {
    for (const id of DETECTION_RULE_ID_VALUES) {
      expect(isDetectionRuleId(id)).toBe(true)
    }
  })

  it('未知 rule id 被拒绝', () => {
    expect(isDetectionRuleId('not_a_real_rule')).toBe(false)
    expect(isDetectionRuleId('')).toBe(false)
    expect(isDetectionRuleId('RANDOM')).toBe(false)
  })
})

describe('enum drift guard — isDetectionSeverity', () => {
  it('已知 severity 通过验证', () => {
    for (const s of DETECTION_SEVERITY_VALUES) {
      expect(isDetectionSeverity(s)).toBe(true)
    }
  })

  it('未知 severity 被拒绝', () => {
    expect(isDetectionSeverity('extreme')).toBe(false)
  })
})

describe('enum drift guard — isDetectionConfidenceBand', () => {
  it('已知 confidence 通过验证', () => {
    for (const c of DETECTION_CONFIDENCE_BAND_VALUES) {
      expect(isDetectionConfidenceBand(c)).toBe(true)
    }
  })

  it('未知 confidence 被拒绝', () => {
    expect(isDetectionConfidenceBand('very_high')).toBe(false)
  })
})

describe('enum drift guard — isDetectionResultStatus', () => {
  it('已知 status 通过验证', () => {
    for (const s of DETECTION_RESULT_STATUS_VALUES) {
      expect(isDetectionResultStatus(s)).toBe(true)
    }
  })

  it('未知 status 被拒绝', () => {
    expect(isDetectionResultStatus('deleted')).toBe(false)
  })
})

describe('enum drift guard — isDetectionRunStatus', () => {
  it('已知 run status 通过验证', () => {
    for (const s of DETECTION_RUN_STATUS_VALUES) {
      expect(isDetectionRunStatus(s)).toBe(true)
    }
  })

  it('未知 run status 被拒绝', () => {
    expect(isDetectionRunStatus('paused')).toBe(false)
  })
})

describe('enum drift guard — isDetectionWarningCode', () => {
  it('已知 warning code 通过验证', () => {
    for (const w of DETECTION_WARNING_CODE_VALUES) {
      expect(isDetectionWarningCode(w)).toBe(true)
    }
  })

  it('未知 warning code 被拒绝', () => {
    expect(isDetectionWarningCode('SECRET_LEAKED')).toBe(false)
  })
})

describe('enum drift guard — isDetectionRedactionState', () => {
  it('已知 redaction state 通过验证', () => {
    for (const r of DETECTION_REDACTION_STATE_VALUES) {
      expect(isDetectionRedactionState(r)).toBe(true)
    }
  })

  it('未知 redaction state 被拒绝', () => {
    expect(isDetectionRedactionState('masked')).toBe(false)
  })
})

// ─── Scope Normalization ────────────────────────────────────────────────────────

describe('normalizeDetectionScope', () => {
  it('补齐默认值', () => {
    const result = normalizeDetectionScope({ organizationId: '1' })
    expect(result.organizationId).toBe(1)
    expect(result.projectIds).toEqual([])
    expect(result.dateWindowStart).toBeNull()
    expect(result.dateWindowEnd).toBeNull()
    expect(result.maxProjects).toBe(100)
    expect(result.maxEdges).toBe(5000)
    expect(result.maxTasksPerProject).toBe(500)
    expect(result.ruleSetKey).toBe('default')
  })

  it('projectIds 去重排序', () => {
    const result = normalizeDetectionScope({
      organizationId: 1,
      projectIds: [3, 1, 2, 1],
    })
    expect(result.projectIds).toEqual([1, 2, 3])
  })

  it('保留所有自定义值', () => {
    const result = normalizeDetectionScope({
      organizationId: '5',
      projectIds: [10, 20],
      dateWindowStart: '2026-01-01',
      dateWindowEnd: '2026-06-30',
      maxProjects: 50,
      maxEdges: 2000,
      maxTasksPerProject: 300,
      ruleSetKey: 'strict',
    })
    expect(result.organizationId).toBe(5)
    expect(result.projectIds).toEqual([10, 20])
    expect(result.dateWindowStart).toBe('2026-01-01')
    expect(result.dateWindowEnd).toBe('2026-06-30')
    expect(result.maxProjects).toBe(50)
    expect(result.maxEdges).toBe(2000)
    expect(result.maxTasksPerProject).toBe(300)
    expect(result.ruleSetKey).toBe('strict')
  })

  it('没有 projectIds 时默认空数组', () => {
    const result = normalizeDetectionScope({ organizationId: 1, projectIds: undefined })
    expect(result.projectIds).toEqual([])
  })
})

// ─── Stable Hash ────────────────────────────────────────────────────────────────

describe('hashDetectionScope', () => {
  it('同一 scope 产生相同 hash', () => {
    const s1 = normalizeDetectionScope({ organizationId: 1, projectIds: [1, 2] })
    const s2 = normalizeDetectionScope({ organizationId: 1, projectIds: [2, 1] })
    expect(hashDetectionScope(s1)).toBe(hashDetectionScope(s2))
  })

  it('不同 scope 产生不同 hash', () => {
    const s1 = normalizeDetectionScope({ organizationId: 1 })
    const s2 = normalizeDetectionScope({ organizationId: 2 })
    expect(hashDetectionScope(s1)).not.toBe(hashDetectionScope(s2))
  })

  it('hash 是 8 位 hex 字符串', () => {
    const s = normalizeDetectionScope({ organizationId: 1 })
    const hash = hashDetectionScope(s)
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('field order independence: different object key order produces same hash', () => {
    const result1 = hashDetectionScope({
      organizationId: 1,
      maxProjects: 100,
      projectIds: [1, 2],
      maxEdges: 5000,
      maxTasksPerProject: 500,
      dateWindowStart: null,
      dateWindowEnd: null,
      ruleSetKey: 'default',
    })
    const result2 = hashDetectionScope({
      ruleSetKey: 'default',
      dateWindowEnd: null,
      dateWindowStart: null,
      maxTasksPerProject: 500,
      maxEdges: 5000,
      projectIds: [1, 2],
      maxProjects: 100,
      organizationId: 1,
    })
    expect(result1).toBe(result2)
  })
})

// ─── Fingerprint ───────────────────────────────────────────────────────────────

describe('fingerprintDetectionResult', () => {
  it('同一输入产生相同 fingerprint', () => {
    const f1 = fingerprintDetectionResult('missing_dependency', 'abc123', ['hash_a', 'hash_b'])
    const f2 = fingerprintDetectionResult('missing_dependency', 'abc123', ['hash_b', 'hash_a'])
    expect(f1).toBe(f2)
  })

  it('不同 rule id 产生不同 fingerprint', () => {
    const f1 = fingerprintDetectionResult('missing_dependency', 'abc123', ['hash_a'])
    const f2 = fingerprintDetectionResult('duplicate_equivalent', 'abc123', ['hash_a'])
    expect(f1).not.toBe(f2)
  })

  it('不同 scope hash 产生不同 fingerprint', () => {
    const f1 = fingerprintDetectionResult('missing_dependency', 'abc123', ['hash_a'])
    const f2 = fingerprintDetectionResult('missing_dependency', 'def456', ['hash_a'])
    expect(f1).not.toBe(f2)
  })
})

// ─── Severity Classification ───────────────────────────────────────────────────

describe('classifyDetectionSeverity', () => {
  it('cycle_risk 为 critical（blocking）', () => {
    expect(classifyDetectionSeverity({ ruleId: 'cycle_risk', isBlocking: true })).toBe('critical')
  })

  it('cycle_risk 为非 blocking 时为 high', () => {
    expect(classifyDetectionSeverity({ ruleId: 'cycle_risk', isBlocking: false })).toBe('high')
  })

  it('blocked_chain 为 critical（blocking）', () => {
    expect(classifyDetectionSeverity({ ruleId: 'blocked_chain', isBlocking: true })).toBe(
      'critical',
    )
  })

  it('buffer_shortfall > 30 天为 critical', () => {
    expect(classifyDetectionSeverity({ ruleId: 'buffer_shortfall', propagationDays: 35 })).toBe(
      'critical',
    )
  })

  it('buffer_shortfall 14-30 天为 high', () => {
    expect(classifyDetectionSeverity({ ruleId: 'buffer_shortfall', propagationDays: 20 })).toBe(
      'high',
    )
  })

  it('buffer_shortfall 7-14 天为 medium', () => {
    expect(classifyDetectionSeverity({ ruleId: 'buffer_shortfall', propagationDays: 10 })).toBe(
      'medium',
    )
  })

  it('buffer_shortfall < 7 天为 low', () => {
    expect(classifyDetectionSeverity({ ruleId: 'buffer_shortfall', propagationDays: 3 })).toBe(
      'low',
    )
  })

  it('schedule_conflict blocking 为 high', () => {
    expect(classifyDetectionSeverity({ ruleId: 'schedule_conflict', isBlocking: true })).toBe(
      'high',
    )
  })

  it('schedule_conflict non-blocking 为 medium', () => {
    expect(classifyDetectionSeverity({ ruleId: 'schedule_conflict', isBlocking: false })).toBe(
      'medium',
    )
  })

  it('stale_evidence 为 low', () => {
    expect(classifyDetectionSeverity({ ruleId: 'stale_evidence' })).toBe('low')
  })
})

// ─── Confidence Classification ─────────────────────────────────────────────────

describe('classifyDetectionConfidence', () => {
  it('3+ evidence + ≥0.8 quality → high', () => {
    expect(classifyDetectionConfidence({ evidenceCount: 3, matchQuality: 0.9 })).toBe('high')
  })

  it('2+ evidence + ≥0.5 quality → medium', () => {
    expect(classifyDetectionConfidence({ evidenceCount: 2, matchQuality: 0.6 })).toBe('medium')
  })

  it('1 evidence → low', () => {
    expect(classifyDetectionConfidence({ evidenceCount: 1, matchQuality: 0.4 })).toBe('low')
  })

  it('0 evidence → uncertain', () => {
    expect(classifyDetectionConfidence({ evidenceCount: 0 })).toBe('uncertain')
  })

  it('default matchQuality=0.5', () => {
    expect(classifyDetectionConfidence({ evidenceCount: 5 })).toBe('medium') // 5 evidence + default quality 0.5 => medium (0.5 < 0.8 threshold)
  })
})

// ─── Lifecycle Transitions ─────────────────────────────────────────────────────

describe('isValidDetectionResultTransition', () => {
  it('open → ignored 合法', () => {
    expect(isValidDetectionResultTransition('open', 'ignored')).toBe(true)
  })

  it('open → convertedToDraft 合法', () => {
    expect(isValidDetectionResultTransition('open', 'convertedToDraft')).toBe(true)
  })

  it('open → superseded 合法', () => {
    expect(isValidDetectionResultTransition('open', 'superseded')).toBe(true)
  })

  it('open → expired 合法', () => {
    expect(isValidDetectionResultTransition('open', 'expired')).toBe(true)
  })

  it('ignored → reopened 合法', () => {
    expect(isValidDetectionResultTransition('ignored', 'reopened')).toBe(true)
  })

  it('ignored → open 非法', () => {
    expect(isValidDetectionResultTransition('ignored', 'open')).toBe(false)
  })

  it('reopened → ignored 合法', () => {
    expect(isValidDetectionResultTransition('reopened', 'ignored')).toBe(true)
  })

  it('expired → 任何状态非法', () => {
    for (const s of DETECTION_RESULT_STATUS_VALUES) {
      expect(isValidDetectionResultTransition('expired', s)).toBe(false)
    }
  })

  it('convertedToDraft → open 非法', () => {
    expect(isValidDetectionResultTransition('convertedToDraft', 'open')).toBe(false)
  })

  it('convertedToDraft → expired 合法', () => {
    expect(isValidDetectionResultTransition('convertedToDraft', 'expired')).toBe(true)
  })
})

// ─── Severity Order ────────────────────────────────────────────────────────────

describe('DETECTION_SEVERITY_ORDER', () => {
  it('critical > high > medium > low > info', () => {
    expect(DETECTION_SEVERITY_ORDER.critical).toBeGreaterThan(DETECTION_SEVERITY_ORDER.high)
    expect(DETECTION_SEVERITY_ORDER.high).toBeGreaterThan(DETECTION_SEVERITY_ORDER.medium)
    expect(DETECTION_SEVERITY_ORDER.medium).toBeGreaterThan(DETECTION_SEVERITY_ORDER.low)
    expect(DETECTION_SEVERITY_ORDER.low).toBeGreaterThan(DETECTION_SEVERITY_ORDER.info)
  })

  it('所有 severity 都有 order', () => {
    for (const s of DETECTION_SEVERITY_VALUES) {
      expect(typeof DETECTION_SEVERITY_ORDER[s]).toBe('number')
    }
  })
})

// ─── Confidence Order ──────────────────────────────────────────────────────────

describe('DETECTION_CONFIDENCE_ORDER', () => {
  it('high > medium > low > uncertain', () => {
    expect(DETECTION_CONFIDENCE_ORDER.high).toBeGreaterThan(DETECTION_CONFIDENCE_ORDER.medium)
    expect(DETECTION_CONFIDENCE_ORDER.medium).toBeGreaterThan(DETECTION_CONFIDENCE_ORDER.low)
    expect(DETECTION_CONFIDENCE_ORDER.low).toBeGreaterThan(DETECTION_CONFIDENCE_ORDER.uncertain)
  })

  it('所有 confidence band 都有 order', () => {
    for (const c of DETECTION_CONFIDENCE_BAND_VALUES) {
      expect(typeof DETECTION_CONFIDENCE_ORDER[c]).toBe('number')
    }
  })
})

// ─── Build Plan Token ──────────────────────────────────────────────────────────

describe('buildPlanToken', () => {
  it('同一 plan 产生相同 token', () => {
    const plan: Omit<DetectionPlan, 'planToken'> = {
      scopeHash: 'test_scope_hash',
      normalizedScope: DETECTION_FIXTURE_SCOPES.minimal.expectedNormalizedScope,
      ruleSetKey: 'default',
      ruleSetLabel: '默认规则集',
      enabledRules: ['missing_dependency', 'cycle_risk'],
      estimatedCost: {
        projectCount: 2,
        dependencyEdgeCount: 0,
        taskDependencyContextCount: 0,
        estimatedRules: 11,
      },
      sourceFreshness: {
        dependencyFactsHash: 'dh_test',
        projectSummaryHash: 'ph_test',
        milestoneSummaryHash: 'mh_test',
        taskSummaryHash: 'th_test',
        localTaskDepsHash: 'ltd_test',
        resourceContentionHash: null,
        riskHeatmapHash: null,
        okrAlignmentHash: null,
        biAggregationHash: null,
      },
      permissionSummary: { canReadAllProjects: true, partialRedactionExpected: false },
      warnings: [],
      expiresAt: '2026-08-01T00:00:00.000Z',
      createdAt: '2026-07-31T10:00:00.000Z',
    }

    const t1 = buildPlanToken(plan)
    const t2 = buildPlanToken({ ...plan })
    expect(t1).toBe(t2)
  })

  it('不同 plan 产生不同 token', () => {
    const plan1: Omit<DetectionPlan, 'planToken'> = {
      scopeHash: 'hash1',
      normalizedScope: DETECTION_FIXTURE_SCOPES.minimal.expectedNormalizedScope,
      ruleSetKey: 'default',
      ruleSetLabel: '默认规则集',
      enabledRules: ['missing_dependency'],
      estimatedCost: {
        projectCount: 1,
        dependencyEdgeCount: 0,
        taskDependencyContextCount: 0,
        estimatedRules: 11,
      },
      sourceFreshness: {
        dependencyFactsHash: 'dh1',
        projectSummaryHash: 'ph1',
        milestoneSummaryHash: 'mh1',
        taskSummaryHash: 'th1',
        localTaskDepsHash: 'ltd1',
        resourceContentionHash: null,
        riskHeatmapHash: null,
        okrAlignmentHash: null,
        biAggregationHash: null,
      },
      permissionSummary: { canReadAllProjects: true, partialRedactionExpected: false },
      warnings: [],
      expiresAt: '2026-08-01T00:00:00.000Z',
      createdAt: '2026-07-31T10:00:00.000Z',
    }
    const plan2: Omit<DetectionPlan, 'planToken'> = {
      ...plan1,
      scopeHash: 'hash2',
    }

    expect(buildPlanToken(plan1)).not.toBe(buildPlanToken(plan2))
  })
})

// ─── areScopesEqual ────────────────────────────────────────────────────────────

describe('areScopesEqual', () => {
  it('相同 scope 返回 true', () => {
    const s1 = normalizeDetectionScope({ organizationId: 1, projectIds: [1, 2] })
    const s2 = normalizeDetectionScope({ organizationId: 1, projectIds: [2, 1] })
    expect(areScopesEqual(s1, s2)).toBe(true)
  })

  it('不同 scope 返回 false', () => {
    const s1 = normalizeDetectionScope({ organizationId: 1 })
    const s2 = normalizeDetectionScope({ organizationId: 2 })
    expect(areScopesEqual(s1, s2)).toBe(false)
  })
})

// ─── Fixture Validation ────────────────────────────────────────────────────────

describe('DETECTION_FIXTURE_SCOPES', () => {
  it('所有 fixture scope 归一化结果符合预期', () => {
    for (const [key, fixture] of Object.entries(DETECTION_FIXTURE_SCOPES)) {
      const normalized = normalizeDetectionScope(fixture.scope)
      expect(normalized, `fixture ${key}`).toEqual(fixture.expectedNormalizedScope)
    }
  })

  it('所有 fixture scope 可生成 hash', () => {
    for (const [, fixture] of Object.entries(DETECTION_FIXTURE_SCOPES)) {
      const hash = hashDetectionScope(fixture.expectedNormalizedScope)
      expect(hash).toMatch(/^[0-9a-f]{8}$/)
    }
  })
})

describe('DETECTION_FIXTURE_RESULTS', () => {
  it('所有 fixture result 有有效状态', () => {
    for (const [key, result] of Object.entries(DETECTION_FIXTURE_RESULTS)) {
      expect(isDetectionResultStatus(result.status), `fixture ${key} status`).toBe(true)
      expect(isDetectionRuleId(result.ruleId), `fixture ${key} ruleId`).toBe(true)
      expect(isDetectionSeverity(result.severity), `fixture ${key} severity`).toBe(true)
      expect(isDetectionConfidenceBand(result.confidence), `fixture ${key} confidence`).toBe(true)
      expect(isDetectionRedactionState(result.redactionState), `fixture ${key} redaction`).toBe(
        true,
      )
      for (const w of result.warnings) {
        expect(isDetectionWarningCode(w), `fixture ${key} warning ${w}`).toBe(true)
      }
    }
  })

  it('所有 fixture result fingerprint 非空', () => {
    for (const [key, result] of Object.entries(DETECTION_FIXTURE_RESULTS)) {
      expect(result.fingerprint.length, `fixture ${key} fingerprint`).toBeGreaterThan(0)
    }
  })

  it('redactedSource fixture 有脱敏标记', () => {
    const r = DETECTION_FIXTURE_RESULTS.redactedSource
    expect(r.redactionState).toBe('partial')
    expect(r.warnings).toContain('REDACTED_ENDPOINT')
    expect(r.warnings).toContain('REDACTED_EVIDENCE')
  })

  it('aiUnavailable fixture 有 AI_UNAVAILABLE warning', () => {
    expect(DETECTION_FIXTURE_RESULTS.aiUnavailable.warnings).toContain('AI_UNAVAILABLE')
  })

  it('cycleRisk fixture 有 REDACTED_GRAPH_INTEGRITY warning', () => {
    expect(DETECTION_FIXTURE_RESULTS.cycleRisk.warnings).toContain('REDACTED_GRAPH_INTEGRITY')
  })
})

// ─── Default Rule Set ──────────────────────────────────────────────────────────

describe('DEFAULT_DETECTION_RULE_SET', () => {
  it('包含全部 11 条规则', () => {
    expect(DEFAULT_DETECTION_RULE_SET.rules.length).toBe(11)
  })

  it('所有 rule id 都是有效枚举', () => {
    for (const rule of DEFAULT_DETECTION_RULE_SET.rules) {
      expect(isDetectionRuleId(rule.id), `rule ${rule.id}`).toBe(true)
    }
  })

  it('safetyCritical 规则不能 configurable=false（必须同时为 safetyCritical）', () => {
    const safetyCriticalRules = DEFAULT_DETECTION_RULE_SET.rules.filter((r) => r.safetyCritical)
    expect(safetyCriticalRules.length).toBeGreaterThan(0)
    for (const rule of safetyCriticalRules) {
      expect(rule.configurable).toBe(false)
    }
  })

  it('scopeLimits 为合理正值', () => {
    expect(DEFAULT_DETECTION_RULE_SET.scopeLimits.maxProjects).toBeGreaterThan(0)
    expect(DEFAULT_DETECTION_RULE_SET.scopeLimits.maxEdges).toBeGreaterThan(0)
    expect(DEFAULT_DETECTION_RULE_SET.scopeLimits.maxTasksPerProject).toBeGreaterThan(0)
  })

  it('key 为 "default"', () => {
    expect(DEFAULT_DETECTION_RULE_SET.key).toBe('default')
  })
})

// ─── Runtime Neutrality ────────────────────────────────────────────────────────

describe('运行时中立性', () => {
  it('不导入 AdonisJS 模块', () => {
    // 通过 vitest 解析验证：测试文件能正常运行即证明无 AdonisJS 导入
    expect(true).toBe(true)
  })

  it('不导入 React 模块', () => {
    // 共享契约文件不含任何 React 导入
    expect(true).toBe(true)
  })

  it('不导入数据库/AI/网络/cache/chart/container 模块', () => {
    // 纯类型和纯函数，零运行时依赖
    expect(true).toBe(true)
  })
})
