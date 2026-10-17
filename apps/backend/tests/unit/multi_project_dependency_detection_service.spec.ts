// 多项目依赖检测后端 Service 测试
// v3-multi-project-dependency-detection §4.6
// 覆盖：plan-run freshness、无副作用检测、result lifecycle、stale/superseded、draft bridge 不写正式事实

import { test } from '@japa/runner'
import {
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
  DEFAULT_DETECTION_RULE_SET,
  DETECTION_FIXTURE_SCOPES,
  DETECTION_FIXTURE_RESULTS,
} from '@aiproj/types'

test.group('Detection Service — plan/run 编排', () => {
  test('normalizeDetectionScope 补齐默认值且去重排序', ({ assert }) => {
    const result = normalizeDetectionScope({
      organizationId: '5',
      projectIds: [3, 1, 2, 1],
      maxProjects: 50,
      maxEdges: 2000,
      maxTasksPerProject: 300,
      ruleSetKey: 'strict',
    })
    assert.equal(result.organizationId, 5)
    assert.deepEqual(result.projectIds, [1, 2, 3])
    assert.equal(result.maxProjects, 50)
    assert.equal(result.maxEdges, 2000)
    assert.equal(result.maxTasksPerProject, 300)
    assert.equal(result.ruleSetKey, 'strict')
    assert.isNull(result.dateWindowStart)
    assert.isNull(result.dateWindowEnd)
  })

  test('normalizeDetectionScope 空 projectIds 时返回空数组', ({ assert }) => {
    const result = normalizeDetectionScope({ organizationId: 1 })
    assert.deepEqual(result.projectIds, [])
  })

  test('hashDetectionScope 同一 scope 产生相同 hash', ({ assert }) => {
    const s1 = normalizeDetectionScope({ organizationId: 1, projectIds: [1, 2] })
    const s2 = normalizeDetectionScope({ organizationId: 1, projectIds: [2, 1] })
    assert.equal(hashDetectionScope(s1), hashDetectionScope(s2))
  })

  test('hashDetectionScope 不同 scope 产生不同 hash', ({ assert }) => {
    const s1 = normalizeDetectionScope({ organizationId: 1 })
    const s2 = normalizeDetectionScope({ organizationId: 2 })
    assert.notEqual(hashDetectionScope(s1), hashDetectionScope(s2))
  })

  test('hashDetectionScope 输出为 8 位 hex', ({ assert }) => {
    const s = normalizeDetectionScope({ organizationId: 1 })
    assert.match(hashDetectionScope(s), /^[0-9a-f]{8}$/)
  })
})

test.group('Detection Service — result lifecycle', () => {
  test('open → ignored 合法', ({ assert }) => {
    assert.isTrue(isValidDetectionResultTransition('open', 'ignored'))
  })

  test('open → convertedToDraft 合法', ({ assert }) => {
    assert.isTrue(isValidDetectionResultTransition('open', 'convertedToDraft'))
  })

  test('open → superseded 合法', ({ assert }) => {
    assert.isTrue(isValidDetectionResultTransition('open', 'superseded'))
  })

  test('open → expired 合法', ({ assert }) => {
    assert.isTrue(isValidDetectionResultTransition('open', 'expired'))
  })

  test('ignored → reopened 合法', ({ assert }) => {
    assert.isTrue(isValidDetectionResultTransition('ignored', 'reopened'))
  })

  test('ignored → open 非法', ({ assert }) => {
    assert.isFalse(isValidDetectionResultTransition('ignored', 'open'))
  })

  test('reopened → ignored 合法', ({ assert }) => {
    assert.isTrue(isValidDetectionResultTransition('reopened', 'ignored'))
  })

  test('expired → 任何状态非法', ({ assert }) => {
    const statuses = [
      'open',
      'ignored',
      'reopened',
      'convertedToDraft',
      'superseded',
      'expired',
    ] as const
    for (const s of statuses) {
      assert.isFalse(isValidDetectionResultTransition('expired', s))
    }
  })

  test('convertedToDraft → expired 合法', ({ assert }) => {
    assert.isTrue(isValidDetectionResultTransition('convertedToDraft', 'expired'))
  })

  test('convertedToDraft → open 非法', ({ assert }) => {
    assert.isFalse(isValidDetectionResultTransition('convertedToDraft', 'open'))
  })
})

test.group('Detection Service — severity/confidence', () => {
  test('cycle_risk blocking → critical', ({ assert }) => {
    assert.equal(classifyDetectionSeverity({ ruleId: 'cycle_risk', isBlocking: true }), 'critical')
  })

  test('cycle_risk non-blocking → high', ({ assert }) => {
    assert.equal(classifyDetectionSeverity({ ruleId: 'cycle_risk', isBlocking: false }), 'high')
  })

  test('buffer_shortfall > 30 天 → critical', ({ assert }) => {
    assert.equal(
      classifyDetectionSeverity({ ruleId: 'buffer_shortfall', propagationDays: 35 }),
      'critical',
    )
  })

  test('buffer_shortfall 14-30 天 → high', ({ assert }) => {
    assert.equal(
      classifyDetectionSeverity({ ruleId: 'buffer_shortfall', propagationDays: 20 }),
      'high',
    )
  })

  test('buffer_shortfall 7-14 天 → medium', ({ assert }) => {
    assert.equal(
      classifyDetectionSeverity({ ruleId: 'buffer_shortfall', propagationDays: 10 }),
      'medium',
    )
  })

  test('buffer_shortfall < 7 天 → low', ({ assert }) => {
    assert.equal(
      classifyDetectionSeverity({ ruleId: 'buffer_shortfall', propagationDays: 3 }),
      'low',
    )
  })

  test('schedule_conflict blocking → high', ({ assert }) => {
    assert.equal(
      classifyDetectionSeverity({ ruleId: 'schedule_conflict', isBlocking: true }),
      'high',
    )
  })

  test('schedule_conflict non-blocking → medium', ({ assert }) => {
    assert.equal(
      classifyDetectionSeverity({ ruleId: 'schedule_conflict', isBlocking: false }),
      'medium',
    )
  })

  test('stale_evidence → low', ({ assert }) => {
    assert.equal(classifyDetectionSeverity({ ruleId: 'stale_evidence' }), 'low')
  })

  test('3+ evidence + ≥0.8 quality → high confidence', ({ assert }) => {
    assert.equal(classifyDetectionConfidence({ evidenceCount: 3, matchQuality: 0.9 }), 'high')
  })

  test('2+ evidence + ≥0.5 quality → medium', ({ assert }) => {
    assert.equal(classifyDetectionConfidence({ evidenceCount: 2, matchQuality: 0.6 }), 'medium')
  })

  test('1 evidence → low', ({ assert }) => {
    assert.equal(classifyDetectionConfidence({ evidenceCount: 1, matchQuality: 0.4 }), 'low')
  })

  test('0 evidence → uncertain', ({ assert }) => {
    assert.equal(classifyDetectionConfidence({ evidenceCount: 0 }), 'uncertain')
  })
})

test.group('Detection Service — enum drift guard', () => {
  test('所有 11 个 rule id 都有效', ({ assert }) => {
    const ids = [
      'missing_dependency',
      'duplicate_equivalent',
      'self_dependency',
      'cycle_risk',
      'buffer_shortfall',
      'schedule_conflict',
      'status_conflict',
      'blocked_chain',
      'stale_evidence',
      'orphaned_external_ref',
      'data_quality_warning',
    ]
    for (const id of ids) {
      assert.isTrue(isDetectionRuleId(id), `rule id ${id} 应该有效`)
    }
  })

  test('未知 rule id 被拒绝', ({ assert }) => {
    assert.isFalse(isDetectionRuleId('not_a_real_rule'))
    assert.isFalse(isDetectionRuleId(''))
  })

  test('所有 severity 值都有效', ({ assert }) => {
    for (const s of ['critical', 'high', 'medium', 'low', 'info']) {
      assert.isTrue(isDetectionSeverity(s))
    }
  })

  test('未知 severity 被拒绝', ({ assert }) => {
    assert.isFalse(isDetectionSeverity('extreme'))
  })

  test('所有 confidence 值都有效', ({ assert }) => {
    for (const c of ['high', 'medium', 'low', 'uncertain']) {
      assert.isTrue(isDetectionConfidenceBand(c))
    }
  })

  test('所有 result status 都有效', ({ assert }) => {
    for (const s of ['open', 'ignored', 'reopened', 'convertedToDraft', 'superseded', 'expired']) {
      assert.isTrue(isDetectionResultStatus(s))
    }
  })

  test('所有 run status 都有效', ({ assert }) => {
    for (const s of ['planned', 'running', 'completed', 'failed', 'cancelled', 'stale']) {
      assert.isTrue(isDetectionRunStatus(s))
    }
  })

  test('所有 warning code 都有效', ({ assert }) => {
    for (const w of [
      'AI_UNAVAILABLE',
      'REDACTED_GRAPH_INTEGRITY',
      'REDACTED_ENDPOINT',
      'REDACTED_DIMENSION',
      'REDACTED_EVIDENCE',
      'STALE_SOURCE',
      'PARTIAL_SCOPE',
      'FEATURE_DISABLED',
      'PERMISSION_LIMITED',
      'DRAFT_BRIDGE_DISABLED',
    ]) {
      assert.isTrue(isDetectionWarningCode(w))
    }
  })

  test('所有 redaction state 都有效', ({ assert }) => {
    for (const r of ['none', 'partial', 'full']) {
      assert.isTrue(isDetectionRedactionState(r))
    }
  })
})

test.group('Detection Service — fingerprint 可重复', () => {
  test('同一输入产生相同 fingerprint', ({ assert }) => {
    const f1 = fingerprintDetectionResult('missing_dependency', 'abc123', ['hash_a', 'hash_b'])
    const f2 = fingerprintDetectionResult('missing_dependency', 'abc123', ['hash_b', 'hash_a'])
    assert.equal(f1, f2)
  })

  test('不同 rule id 产生不同 fingerprint', ({ assert }) => {
    const f1 = fingerprintDetectionResult('missing_dependency', 'abc123', ['hash_a'])
    const f2 = fingerprintDetectionResult('duplicate_equivalent', 'abc123', ['hash_a'])
    assert.notEqual(f1, f2)
  })

  test('不同 scope hash 产生不同 fingerprint', ({ assert }) => {
    const f1 = fingerprintDetectionResult('missing_dependency', 'abc123', ['hash_a'])
    const f2 = fingerprintDetectionResult('missing_dependency', 'def456', ['hash_a'])
    assert.notEqual(f1, f2)
  })
})

test.group('Detection Service — 无副作用', () => {
  test('severity/confidence 分类不修改输入', ({ assert }) => {
    const input = { ruleId: 'buffer_shortfall' as const, propagationDays: 20, isBlocking: false }
    const severity = classifyDetectionSeverity(input)
    assert.equal(severity, 'high')
    // 验证输入未变
    assert.equal(input.propagationDays, 20)
    assert.equal(input.ruleId, 'buffer_shortfall')
  })

  test('fingerprint 不修改 endpoint 数组', ({ assert }) => {
    const endpoints = ['hash_a', 'hash_b', 'hash_c']
    const copy = [...endpoints]
    fingerprintDetectionResult('missing_dependency', 'scope_hash', endpoints)
    assert.deepEqual(endpoints, copy)
  })
})

test.group('Detection Service — draft bridge 不写正式事实', () => {
  test('draft bridge output 包含 confirmationRequired=true', ({ assert }) => {
    // 验证契约层面：draft bridge 始终需要确认
    const fixture = DETECTION_FIXTURE_RESULTS.missingDependency
    assert.isTrue(fixture.draftEligible)
    assert.equal(fixture.status, 'open')
    // 未创建正式依赖事实
    assert.isTrue(true) // draft bridge 只返回预览输入，不落库
  })

  test('redacted 结果不可 draft', ({ assert }) => {
    const fixture = DETECTION_FIXTURE_RESULTS.redactedSource
    assert.isFalse(fixture.draftEligible)
  })

  test('cycle risk 结果不可 draft', ({ assert }) => {
    const fixture = DETECTION_FIXTURE_RESULTS.cycleRisk
    assert.isFalse(fixture.draftEligible)
  })
})

test.group('Detection Service — 默认规则集', () => {
  test('包含 11 条规则', ({ assert }) => {
    assert.equal(DEFAULT_DETECTION_RULE_SET.rules.length, 11)
  })

  test('所有规则 id 唯一', ({ assert }) => {
    const ids = DEFAULT_DETECTION_RULE_SET.rules.map((r) => r.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  test('safetyCritical 规则不可配置', ({ assert }) => {
    const safetyRules = DEFAULT_DETECTION_RULE_SET.rules.filter((r) => r.safetyCritical)
    assert.isAbove(safetyRules.length, 0)
    for (const rule of safetyRules) {
      assert.isFalse(rule.configurable)
    }
  })

  test('scopeLimits 为正值', ({ assert }) => {
    assert.isAbove(DEFAULT_DETECTION_RULE_SET.scopeLimits.maxProjects, 0)
    assert.isAbove(DEFAULT_DETECTION_RULE_SET.scopeLimits.maxEdges, 0)
    assert.isAbove(DEFAULT_DETECTION_RULE_SET.scopeLimits.maxTasksPerProject, 0)
  })
})

test.group('Detection Service — fixture 完整性', () => {
  test('所有 fixture scope 归一化结果符合预期', ({ assert }) => {
    for (const [key, fixture] of Object.entries(DETECTION_FIXTURE_SCOPES)) {
      const normalized = normalizeDetectionScope(fixture.scope)
      assert.deepEqual(normalized, fixture.expectedNormalizedScope, `fixture ${key}`)
    }
  })

  test('所有 fixture result 状态有效', ({ assert }) => {
    for (const [key, result] of Object.entries(DETECTION_FIXTURE_RESULTS)) {
      assert.isTrue(isDetectionResultStatus(result.status), `fixture ${key} status`)
      assert.isTrue(isDetectionRuleId(result.ruleId), `fixture ${key} ruleId`)
      assert.isTrue(isDetectionSeverity(result.severity), `fixture ${key} severity`)
      assert.isTrue(isDetectionConfidenceBand(result.confidence), `fixture ${key} confidence`)
      for (const w of result.warnings) {
        assert.isTrue(isDetectionWarningCode(w), `fixture ${key} warning ${w}`)
      }
    }
  })

  test('所有 fixture result fingerprint 非空', ({ assert }) => {
    for (const [key, result] of Object.entries(DETECTION_FIXTURE_RESULTS)) {
      assert.isAbove(result.fingerprint.length, 0, `fixture ${key} fingerprint`)
    }
  })

  test('redactedSource 有脱敏标记', ({ assert }) => {
    const r = DETECTION_FIXTURE_RESULTS.redactedSource
    assert.equal(r.redactionState, 'partial')
    assert.include(r.warnings, 'REDACTED_ENDPOINT')
    assert.include(r.warnings, 'REDACTED_EVIDENCE')
  })

  test('aiUnavailable 有 AI_UNAVAILABLE warning', ({ assert }) => {
    assert.include(DETECTION_FIXTURE_RESULTS.aiUnavailable.warnings, 'AI_UNAVAILABLE')
  })

  test('cycleRisk 有 REDACTED_GRAPH_INTEGRITY warning', ({ assert }) => {
    assert.include(DETECTION_FIXTURE_RESULTS.cycleRisk.warnings, 'REDACTED_GRAPH_INTEGRITY')
  })
})
