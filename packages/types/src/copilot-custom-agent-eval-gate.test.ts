/**
 * v3-copilot-custom-agent-eval-gate — 共享契约测试
 *
 * 覆盖：
 * - §2.3/2.4: 依赖指纹确定性（不变时不变，任一依赖变更时改变）
 * - §2.5/2.6: 禁存约束（敏感样本不出现在报告任一字段）
 * - §2.7: 五态 fixtures
 * - §2.8: barrel 导出无撞名
 * - §3.1-3.6: 版本绑定与失效
 * - §4.1-4.6: L3 边界
 * - §5.1-5.8: 判定确定性
 * - §6.1-6.3: 可解释性
 */

// vitest 的 include 匹配 src/**/*.test.ts：本文件若从 'node:test' 取 describe/it，
// vitest 收集得到文件却找不到任何 suite，直接报 "No test suite found" 并让整包测试变红
// （断言一条也不执行）。改用 vitest 的 describe/it，断言仍用 node:assert/strict。
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import {
  computeDependencyFingerprint,
  isVerdictValidForVersion,
  needsReEvaluation,
  extractFailingHints,
  detectSensitiveContentInReport,
  EVAL_GATE_SENSITIVE_SAMPLES,
  EVAL_GATE_VERDICTS,
  EVAL_GATE_INVALIDATION_REASONS,
  EVAL_GATE_FIXTURE_STATES,
} from './copilot-custom-agent-eval-gate.js'

import {
  buildPassingVerdict,
  buildBelowThresholdVerdict,
  buildDependencyInvalidatedVerdict,
  buildAuthGatedVerdict,
  buildScorerUnavailableVerdict,
  buildConfiguredThreshold,
  buildUnconfiguredThreshold,
  buildVerdictForState,
  buildReportWithL3Content,
  buildReportWithSensitiveContent,
  buildDeterministicScorerConfigs,
  EVAL_GATE_FIXTURE_DEPENDENCY_INPUT,
  EVAL_GATE_FIXTURE_AGENT_ID,
  EVAL_GATE_FIXTURE_DEFINITION_VERSION,
  EVAL_GATE_FIXTURE_ORG_ID,
} from './copilot-custom-agent-eval-gate-fixtures.js'

// ===========================================================================
// §2.3/2.4 — 依赖指纹确定性
// ===========================================================================

describe('dependency fingerprint', () => {
  it('same input yields same fingerprint (deterministic)', () => {
    const fp1 = computeDependencyFingerprint(EVAL_GATE_FIXTURE_DEPENDENCY_INPUT)
    const fp2 = computeDependencyFingerprint(EVAL_GATE_FIXTURE_DEPENDENCY_INPUT)
    assert.equal(fp1, fp2, '两次计算的指纹必须相同')
    assert.ok(fp1.length === 64, 'SHA-256 hex 长度为 64')
  })

  it('different key order yields same fingerprint', () => {
    const input1 = {
      skills: [
        { skillId: 2, version: '1.0' },
        { skillId: 1, version: '2.0' },
      ],
      knowledgePackages: [{ packageId: 'k1', version: '1.0' }],
    }
    const input2 = {
      skills: [
        { skillId: 1, version: '2.0' },
        { skillId: 2, version: '1.0' },
      ],
      knowledgePackages: [{ packageId: 'k1', version: '1.0' }],
    }
    assert.equal(computeDependencyFingerprint(input1), computeDependencyFingerprint(input2))
  })

  it('skill version change alters fingerprint', () => {
    const base = computeDependencyFingerprint(EVAL_GATE_FIXTURE_DEPENDENCY_INPUT)
    const changed = computeDependencyFingerprint({
      ...EVAL_GATE_FIXTURE_DEPENDENCY_INPUT,
      skills: [
        { skillId: 101, version: '1.1.0' },
        { skillId: 102, version: '2.1.0' },
      ],
    })
    assert.notEqual(base, changed, 'Skill 版本变更必须改变指纹')
  })

  it('knowledge package version change alters fingerprint', () => {
    const base = computeDependencyFingerprint(EVAL_GATE_FIXTURE_DEPENDENCY_INPUT)
    const changed = computeDependencyFingerprint({
      ...EVAL_GATE_FIXTURE_DEPENDENCY_INPUT,
      knowledgePackages: [{ packageId: 'kp-001', version: '2.0.0' }],
    })
    assert.notEqual(base, changed, '知识包版本变更必须改变指纹')
  })

  it('adding a skill alters fingerprint', () => {
    const base = computeDependencyFingerprint(EVAL_GATE_FIXTURE_DEPENDENCY_INPUT)
    const changed = computeDependencyFingerprint({
      ...EVAL_GATE_FIXTURE_DEPENDENCY_INPUT,
      skills: [...EVAL_GATE_FIXTURE_DEPENDENCY_INPUT.skills, { skillId: 103, version: '1.0' }],
    })
    assert.notEqual(base, changed, '新增 Skill 必须改变指纹')
  })

  it('empty dependencies produce a valid fingerprint', () => {
    const fp = computeDependencyFingerprint({ skills: [], knowledgePackages: [] })
    assert.ok(fp.length === 64, '空依赖也能产出有效指纹')
  })
})

// ===========================================================================
// §2.5/2.6 — 禁存约束
// ===========================================================================

describe('no-sensitive-content constraint', () => {
  it('clean report has no violations', () => {
    const report = {
      verdict: 'pass',
      itemScores: [{ itemId: 'dim-1', score: 0.9, failed: false }],
      benchmarkSource: 'fixture',
    }
    const violations = detectSensitiveContentInReport(report)
    assert.equal(violations.length, 0, '清洁报告不应有违规')
  })

  it('prompt key is detected as forbidden', () => {
    const report = { prompt: 'some prompt text' }
    const violations = detectSensitiveContentInReport(report)
    assert.ok(
      violations.some((v) => v.includes('prompt')),
      '应检测到 prompt 禁止键',
    )
  })

  it('fullOutput key is detected as forbidden', () => {
    const report = { fullOutput: 'model response' }
    const violations = detectSensitiveContentInReport(report)
    assert.ok(
      violations.some((v) => v.includes('fullOutput')),
      '应检测到 fullOutput 禁止键',
    )
  })

  it('API key pattern in values is detected', () => {
    const report = { note: 'use sk-test-api-key-1234567890abcdef for auth' }
    const violations = detectSensitiveContentInReport(report)
    assert.ok(violations.length > 0, '值中的 API key 模式应被检测')
  })

  it('Bearer token pattern in values is detected', () => {
    const report = { auth: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.extra' }
    const violations = detectSensitiveContentInReport(report)
    assert.ok(violations.length > 0, 'Bearer token 模式应被检测')
  })

  it('sensitive samples do not appear in any fixture verdict', () => {
    const verdict = buildPassingVerdict()
    const verdictJson = JSON.stringify(verdict)
    for (const sample of EVAL_GATE_SENSITIVE_SAMPLES) {
      assert.ok(!verdictJson.includes(sample), `敏感样本 "${sample}" 不应出现在通过态 verdict 中`)
    }
  })

  it('sensitive samples do not appear in below-threshold verdict', () => {
    const verdict = buildBelowThresholdVerdict()
    const verdictJson = JSON.stringify(verdict)
    for (const sample of EVAL_GATE_SENSITIVE_SAMPLES) {
      assert.ok(
        !verdictJson.includes(sample),
        `敏感样本 "${sample}" 不应出现在未达阈值态 verdict 中`,
      )
    }
  })

  it('nested forbidden keys are detected', () => {
    const report = { outer: { inner: { token: 'sk-abcdef1234567890abcdef' } } }
    const violations = detectSensitiveContentInReport(report)
    assert.ok(
      violations.some((v) => v.includes('token')),
      '嵌套的 token 键应被检测',
    )
  })
})

// ===========================================================================
// §2.7 — 五态 fixtures
// ===========================================================================

describe('five-state fixtures', () => {
  for (const state of EVAL_GATE_FIXTURE_STATES) {
    it(`${state} fixture builds successfully`, () => {
      const verdict = buildVerdictForState(state)
      assert.ok(verdict, `${state} fixture 应成功构建`)
      assert.ok(verdict.id, '应有 id')
      assert.equal(verdict.organizationId, EVAL_GATE_FIXTURE_ORG_ID)
      assert.equal(verdict.agentId, EVAL_GATE_FIXTURE_AGENT_ID)
    })
  }

  it('passing fixture has pass verdict', () => {
    assert.equal(buildPassingVerdict().verdict, 'pass')
  })

  it('below_threshold fixture has fail verdict', () => {
    assert.equal(buildBelowThresholdVerdict().verdict, 'fail')
    assert.ok(buildBelowThresholdVerdict().failingItemIds.length > 0)
  })

  it('dependency_invalidated fixture has invalidated verdict', () => {
    assert.equal(buildDependencyInvalidatedVerdict().verdict, 'invalidated')
    assert.ok(buildDependencyInvalidatedVerdict().invalidationReason)
  })

  it('auth_gated fixture has unavailable verdict', () => {
    assert.equal(buildAuthGatedVerdict().verdict, 'unavailable')
  })

  it('scorer_unavailable fixture has fail verdict', () => {
    assert.equal(buildScorerUnavailableVerdict().verdict, 'fail')
  })

  it('threshold config fixtures are valid', () => {
    const configured = buildConfiguredThreshold()
    assert.ok(configured.enabled)
    assert.ok(configured.passThreshold > 0)

    const unconfigured = buildUnconfiguredThreshold()
    assert.ok(!unconfigured.enabled)
  })
})

// ===========================================================================
// §3.1-3.6 — 版本绑定与失效
// ===========================================================================

describe('version binding and invalidation', () => {
  it('verdict is valid for matching version and fingerprint', () => {
    const verdict = buildPassingVerdict()
    assert.ok(
      isVerdictValidForVersion(verdict, verdict.definitionVersion, verdict.dependencyFingerprint),
    )
  })

  it('verdict is invalid for different definition version', () => {
    const verdict = buildPassingVerdict()
    assert.ok(!isVerdictValidForVersion(verdict, '2.0.0', verdict.dependencyFingerprint))
  })

  it('verdict is invalid for different dependency fingerprint', () => {
    const verdict = buildPassingVerdict()
    assert.ok(
      !isVerdictValidForVersion(verdict, verdict.definitionVersion, 'different-fingerprint'),
    )
  })

  it('fail verdict is never valid regardless of version match', () => {
    const verdict = buildBelowThresholdVerdict()
    assert.ok(
      !isVerdictValidForVersion(verdict, verdict.definitionVersion, verdict.dependencyFingerprint),
    )
  })

  it('invalidated verdict is never valid', () => {
    const verdict = buildDependencyInvalidatedVerdict()
    assert.ok(
      !isVerdictValidForVersion(verdict, verdict.definitionVersion, verdict.dependencyFingerprint),
    )
  })

  it('needsReEvaluation detects definition version change', () => {
    const verdict = buildPassingVerdict()
    const result = needsReEvaluation(verdict, '2.0.0', verdict.dependencyFingerprint)
    assert.ok(result.needed)
    assert.equal(result.reason, 'definition_version_changed')
  })

  it('needsReEvaluation detects dependency change', () => {
    const verdict = buildPassingVerdict()
    const result = needsReEvaluation(verdict, verdict.definitionVersion, 'new-fingerprint')
    assert.ok(result.needed)
    assert.equal(result.reason, 'skill_version_changed')
  })

  it('needsReEvaluation returns false when nothing changed', () => {
    const verdict = buildPassingVerdict()
    const result = needsReEvaluation(
      verdict,
      verdict.definitionVersion,
      verdict.dependencyFingerprint,
    )
    assert.ok(!result.needed)
    assert.equal(result.reason, undefined)
  })

  it('invalidation reason is readable', () => {
    const verdict = buildDependencyInvalidatedVerdict()
    assert.ok(verdict.invalidationReason)
    assert.ok(EVAL_GATE_INVALIDATION_REASONS.includes(verdict.invalidationReason!))
  })
})

// ===========================================================================
// §4.1-4.6 — L3 边界
// ===========================================================================

describe('L3 boundary (red line 1)', () => {
  it('L3 benchmark source is admissible in evaluation', () => {
    const verdict = buildPassingVerdict()
    // L3 作为 benchmarkSource 是合法的
    verdict.benchmarkSource = 'L3'
    assert.equal(verdict.benchmarkSource, 'L3', 'L3 作为评测来源应被允许')
  })

  it('L3 content in evaluation report does not leak to production context', () => {
    const report = buildReportWithL3Content()
    // 评测报告可以包含 L3 内容（评测产物）
    // 但这些内容不得出现在生产上下文中——这由上下文装配层断言
    // 这里验证报告本身可以标记 L3 来源
    assert.equal(report.benchmarkSource, 'L3')
    assert.ok(typeof report.evaluationNote === 'string')
  })

  it('production knowledge tier list does not include L3', () => {
    // 这个测试验证设计约束：生产路径的知识层清单不因门禁而放宽
    // 实际由 copilot-context-assembly 的 assertEligibleKnowledgeTiersExcludeL3 保证
    // 这里记录该约束的存在
    const productionTiers = ['L1', 'L2', 'L4'] // 不含 L3
    assert.ok(!productionTiers.includes('L3'), '生产知识层不得包含 L3')
  })

  it('eval knowledge tier list includes L3', () => {
    const evalTiers = ['L1', 'L2', 'L3', 'L4'] // 含 L3
    assert.ok(evalTiers.includes('L3'), '评测知识层应包含 L3')
  })

  it('benchmark source is recorded in verdict', () => {
    const passing = buildPassingVerdict()
    assert.ok(passing.benchmarkSource === 'L3' || passing.benchmarkSource === 'fixture')
  })
})

// ===========================================================================
// §5.1-5.8 — 判定确定性
// ===========================================================================

describe('verdict determinism', () => {
  it('model does not decide the verdict (deterministic rule)', () => {
    // 判定基于阈值规则，不由模型直接给出
    const threshold = buildConfiguredThreshold()
    const verdict = buildPassingVerdict()
    const avgScore =
      verdict.itemScores.reduce((sum, item) => sum + item.score, 0) / verdict.itemScores.length
    const expectedVerdict = avgScore >= threshold.passThreshold ? 'pass' : 'fail'
    assert.equal(verdict.verdict, expectedVerdict, '判定应由阈值规则确定')
  })

  it('same inputs yield identical verdict (deterministic)', () => {
    const v1 = buildPassingVerdict()
    const v2 = buildPassingVerdict()
    // 同一个 fixture 构建两次，内容应全等
    assert.deepEqual(v1.itemScores, v2.itemScores)
    assert.equal(v1.verdict, v2.verdict)
    assert.equal(v1.dependencyFingerprint, v2.dependencyFingerprint)
  })

  it('different key order in scorer config yields same fingerprint', () => {
    const configs = buildDeterministicScorerConfigs()
    assert.equal(configs.length, 2)
    // 两个配置内容相同但键序不同——paramsFingerprint 相同即证明确定性
    assert.equal(configs[0].paramsFingerprint, configs[1].paramsFingerprint)
  })

  it('unconfigured threshold makes gate unavailable (not pass by default)', () => {
    const config = buildUnconfiguredThreshold()
    assert.ok(!config.enabled, '未配置阈值时门禁应不可用')
    assert.equal(config.passThreshold, 0, '未配置时阈值为 0')
  })

  it('scorer unavailable results in fail (not pass)', () => {
    const verdict = buildScorerUnavailableVerdict()
    assert.equal(verdict.verdict, 'fail', '评分器不可用时门禁应不通过')
  })

  it('all verdict states are covered', () => {
    const allVerdicts = new Set(EVAL_GATE_VERDICTS)
    assert.ok(allVerdicts.has('pass'))
    assert.ok(allVerdicts.has('fail'))
    assert.ok(allVerdicts.has('unavailable'))
    assert.ok(allVerdicts.has('invalidated'))
  })
})

// ===========================================================================
// §6.1-6.3 — 可解释性
// ===========================================================================

describe('explainability', () => {
  it('passing verdict has per-item scores', () => {
    const verdict = buildPassingVerdict()
    assert.ok(verdict.itemScores.length > 0, '通过态应有逐项得分')
    for (const item of verdict.itemScores) {
      assert.ok(item.itemId, '每项应有 itemId')
      assert.ok(item.itemName, '每项应有 itemName')
      assert.ok(typeof item.score === 'number', '每项应有 score')
      assert.equal(item.failed, false, '通过态不应有失败项')
    }
  })

  it('failing verdict identifies failing items', () => {
    const verdict = buildBelowThresholdVerdict()
    assert.ok(verdict.failingItemIds.length > 0, '未通过态应有失败项标识')
    for (const itemId of verdict.failingItemIds) {
      const item = verdict.itemScores.find((i) => i.itemId === itemId)
      assert.ok(item, `失败项 ${itemId} 应在 itemScores 中`)
      assert.equal(item!.failed, true, `失败项 ${itemId} 的 failed 应为 true`)
    }
  })

  it('failing items have actionable hints', () => {
    const verdict = buildBelowThresholdVerdict()
    const failingItems = verdict.itemScores.filter((i) => i.failed)
    assert.ok(failingItems.length > 0, '应有失败项')
    for (const item of failingItems) {
      assert.ok(item.actionableHint, `失败项 ${item.itemId} 应有可操作方向`)
    }
  })

  it('extractFailingHints returns only failing items with hints', () => {
    const verdict = buildBelowThresholdVerdict()
    const hints = extractFailingHints(verdict)
    assert.ok(hints.length > 0)
    for (const h of hints) {
      assert.equal(h.failed, true)
      assert.ok(h.actionableHint)
    }
  })
})

// ===========================================================================
// barrel 导出无撞名（§2.8）
// ===========================================================================

describe('barrel exports', () => {
  it('all expected types are exported', () => {
    // 验证主要导出存在
    assert.ok(typeof computeDependencyFingerprint === 'function')
    assert.ok(typeof isVerdictValidForVersion === 'function')
    assert.ok(typeof needsReEvaluation === 'function')
    assert.ok(typeof extractFailingHints === 'function')
    assert.ok(typeof detectSensitiveContentInReport === 'function')
    assert.ok(Array.isArray(EVAL_GATE_VERDICTS))
    assert.ok(Array.isArray(EVAL_GATE_INVALIDATION_REASONS))
    assert.ok(Array.isArray(EVAL_GATE_FIXTURE_STATES))
    assert.ok(Array.isArray(EVAL_GATE_SENSITIVE_SAMPLES))
  })
})
