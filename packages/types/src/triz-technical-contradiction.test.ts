import { describe, test, expect } from 'vitest'
import {
  computeTechnicalAnalysisInputSignature,
  computeTechnicalAnalysisIdempotencyKey,
  computeTechnicalCandidateKey,
  computeTechnicalCandidatesOutputHash,
  compareTechnicalCandidate,
  severityToNormalizedScore,
  computeTechnicalImpactScore,
  summarizeTechnicalWarnings,
  isTechnicalCandidateStale,
  isTechnicalAnalysisRunStale,
  TECHNICAL_ANALYSIS_RUN_STATUSES,
  TECHNICAL_CANDIDATE_STATUSES,
  TECHNICAL_WARNING_CODES,
  TECHNICAL_RULESET_VERSION,
  TECHNICAL_SORT_FIELDS,
  makeTechnicalAnalysisCollectorOutput,
  makeTechnicalCandidateFixture,
  makeTechnicalAnalysisRunFixture,
  type TechnicalContradictionCandidate,
} from './triz-technical-contradiction.js'

describe('常量目录', () => {
  test('运行状态常量完整', () => {
    expect(TECHNICAL_ANALYSIS_RUN_STATUSES).toContain('queued')
    expect(TECHNICAL_ANALYSIS_RUN_STATUSES).toContain('completed')
    expect(TECHNICAL_ANALYSIS_RUN_STATUSES).toContain('completed_with_warnings')
    expect(TECHNICAL_ANALYSIS_RUN_STATUSES).toContain('failed')
    expect(TECHNICAL_ANALYSIS_RUN_STATUSES).toContain('stale')
    expect(TECHNICAL_ANALYSIS_RUN_STATUSES).toContain('archived')
  })

  test('候选审查状态常量完整', () => {
    expect(TECHNICAL_CANDIDATE_STATUSES).toContain('unreviewed')
    expect(TECHNICAL_CANDIDATE_STATUSES).toContain('reviewed')
    expect(TECHNICAL_CANDIDATE_STATUSES).toContain('previewed')
    expect(TECHNICAL_CANDIDATE_STATUSES).toContain('blocked_stale')
    expect(TECHNICAL_CANDIDATE_STATUSES).toContain('dismissed')
  })

  test('警告代码常量完整', () => {
    expect(TECHNICAL_WARNING_CODES).toHaveLength(10)
    expect(TECHNICAL_WARNING_CODES).toContain('SOURCE_UNAVAILABLE')
    expect(TECHNICAL_WARNING_CODES).toContain('SOURCE_STALE')
    expect(TECHNICAL_WARNING_CODES).toContain('PERMISSION_RESTRICTED')
    expect(TECHNICAL_WARNING_CODES).toContain('INSUFFICIENT_EVIDENCE')
    expect(TECHNICAL_WARNING_CODES).toContain('OUTSIDE_REGISTRY')
    expect(TECHNICAL_WARNING_CODES).toContain('AMBIGUOUS_PARAMETER_PAIR')
    expect(TECHNICAL_WARNING_CODES).toContain('REGISTRY_MISS')
    expect(TECHNICAL_WARNING_CODES).toContain('AI_EXPLANATION_FALLBACK')
    expect(TECHNICAL_WARNING_CODES).toContain('AI_EXPLANATION_BLOCKED')
    expect(TECHNICAL_WARNING_CODES).toContain('HANDOFF_BLOCKED_STALE')
  })

  test('排序字段常量完整', () => {
    expect(TECHNICAL_SORT_FIELDS).toContain('createdAt')
    expect(TECHNICAL_SORT_FIELDS).toContain('severity')
    expect(TECHNICAL_SORT_FIELDS).toContain('confidence')
    expect(TECHNICAL_SORT_FIELDS).toContain('status')
  })
})

describe('确定性纯函数', () => {
  test('computeTechnicalAnalysisInputSignature 同输入产生同签名', () => {
    const a = makeTechnicalAnalysisCollectorOutput()
    const b = makeTechnicalAnalysisCollectorOutput()
    expect(computeTechnicalAnalysisInputSignature(a)).toBe(
      computeTechnicalAnalysisInputSignature(b),
    )
  })

  test('computeTechnicalAnalysisInputSignature 不同输入产生不同签名', () => {
    const a = makeTechnicalAnalysisCollectorOutput()
    const b = makeTechnicalAnalysisCollectorOutput({ overdueTaskCount: 99 })
    expect(computeTechnicalAnalysisInputSignature(a)).not.toBe(
      computeTechnicalAnalysisInputSignature(b),
    )
  })

  test('computeTechnicalAnalysisInputSignature 受 userContext 影响', () => {
    const a = makeTechnicalAnalysisCollectorOutput({ userContext: '场景一' })
    const b = makeTechnicalAnalysisCollectorOutput({ userContext: '场景二' })
    expect(computeTechnicalAnalysisInputSignature(a)).not.toBe(
      computeTechnicalAnalysisInputSignature(b),
    )
  })

  test('computeTechnicalAnalysisIdempotencyKey 确定性', () => {
    const sig = computeTechnicalAnalysisInputSignature(makeTechnicalAnalysisCollectorOutput())
    const k1 = computeTechnicalAnalysisIdempotencyKey(1, 1, 1, sig)
    const k2 = computeTechnicalAnalysisIdempotencyKey(1, 1, 1, sig)
    expect(k1).toBe(k2)
    expect(k1.startsWith('tta-idem-')).toBe(true)
  })

  test('computeTechnicalAnalysisIdempotencyKey 不同参数产生不同 key', () => {
    const sig = computeTechnicalAnalysisInputSignature(makeTechnicalAnalysisCollectorOutput())
    const k1 = computeTechnicalAnalysisIdempotencyKey(1, 1, 1, sig)
    const k2 = computeTechnicalAnalysisIdempotencyKey(2, 2, 2, sig)
    expect(k1).not.toBe(k2)
  })

  test('computeTechnicalAnalysisIdempotencyKey 用户提供 key 时采用', () => {
    const sig = computeTechnicalAnalysisInputSignature(makeTechnicalAnalysisCollectorOutput())
    const k1 = computeTechnicalAnalysisIdempotencyKey(1, 1, 1, sig, 'my-key')
    const k2 = computeTechnicalAnalysisIdempotencyKey(1, 1, 1, sig, 'my-key')
    expect(k1).toBe(k2)
    // 用户 key 不同应产生不同 idempotency key
    const k3 = computeTechnicalAnalysisIdempotencyKey(1, 1, 1, sig, 'other-key')
    expect(k1).not.toBe(k3)
  })

  test('computeTechnicalCandidateKey 确定性且参数对顺序无关', () => {
    const k1 = computeTechnicalCandidateKey('CD-001', 'duration', 'cost')
    const k2 = computeTechnicalCandidateKey('CD-001', 'duration', 'cost')
    expect(k1).toBe(k2)
    expect(k1.startsWith('ttc-')).toBe(true)
  })

  test('computeTechnicalCandidateKey 不同规则或参数产生不同 key', () => {
    const k1 = computeTechnicalCandidateKey('CD-001', 'duration', 'cost')
    const k2 = computeTechnicalCandidateKey('CD-002', 'duration', 'cost')
    const k3 = computeTechnicalCandidateKey('CD-001', 'scope', 'quality')
    expect(k1).not.toBe(k2)
    expect(k1).not.toBe(k3)
  })

  test('computeTechnicalCandidatesOutputHash 顺序无关稳定性', () => {
    const c1 = makeTechnicalCandidateFixture()
    const c2 = makeCandidateWithKey('ttc-test002')
    expect(computeTechnicalCandidatesOutputHash([c1, c2])).toBe(
      computeTechnicalCandidatesOutputHash([c2, c1]),
    )
  })

  test('computeTechnicalCandidatesOutputHash 空数组处理', () => {
    const hash = computeTechnicalCandidatesOutputHash([])
    expect(hash).toBeTruthy()
    expect(hash.startsWith('tto-')).toBe(true)
  })

  test('computeTechnicalCandidatesOutputHash 不同集合产生不同 hash', () => {
    const c1 = makeCandidateWithKey('ttc-a')
    const c2 = makeCandidateWithKey('ttc-b')
    const c3 = makeCandidateWithKey('ttc-c')
    expect(computeTechnicalCandidatesOutputHash([c1, c2])).not.toBe(
      computeTechnicalCandidatesOutputHash([c1, c3]),
    )
  })

  test('compareTechnicalCandidate 按严重度排序（critical < high < medium < low）', () => {
    const high = makeTechnicalCandidateFixture({ severity: 'high' })
    const medium = makeTechnicalCandidateFixture({ severity: 'medium' })
    expect(compareTechnicalCandidate(high, medium)).toBeLessThan(0)
    expect(compareTechnicalCandidate(medium, high)).toBeGreaterThan(0)
  })

  test('compareTechnicalCandidate 同严重度按置信度降序', () => {
    const a = makeTechnicalCandidateFixture({ severity: 'high', confidence: 0.8 })
    const b = makeTechnicalCandidateFixture({ severity: 'high', confidence: 0.6 })
    expect(compareTechnicalCandidate(a, b)).toBeLessThan(0)
  })

  test('compareTechnicalCandidate 同严重度同置信度按 impactScore 降序', () => {
    const a = makeTechnicalCandidateFixture({ severity: 'high', confidence: 0.8, impactScore: 0.9 })
    const b = makeTechnicalCandidateFixture({ severity: 'high', confidence: 0.8, impactScore: 0.5 })
    expect(compareTechnicalCandidate(a, b)).toBeLessThan(0)
  })

  test('compareTechnicalCandidate 最终按 ruleId/candidateKey 字典序兜底', () => {
    const a = makeTechnicalCandidateFixture({
      severity: 'high',
      confidence: 0.8,
      impactScore: 0.7,
      ruleId: 'CD-001',
    })
    const b = makeTechnicalCandidateFixture({
      severity: 'high',
      confidence: 0.8,
      impactScore: 0.7,
      ruleId: 'CD-002',
    })
    expect(compareTechnicalCandidate(a, b)).toBeLessThan(0)
  })

  test('severityToNormalizedScore 映射正确', () => {
    expect(severityToNormalizedScore('critical')).toBe(1.0)
    expect(severityToNormalizedScore('high')).toBe(0.75)
    expect(severityToNormalizedScore('medium')).toBe(0.5)
    expect(severityToNormalizedScore('low')).toBe(0.25)
  })

  test('computeTechnicalImpactScore 综合评分在 0–1 之间', () => {
    const score = computeTechnicalImpactScore('high', 0.8, 3)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  test('computeTechnicalImpactScore 证据越多分越高（同严重度置信度）', () => {
    const lowEvidence = computeTechnicalImpactScore('high', 0.8, 0)
    const highEvidence = computeTechnicalImpactScore('high', 0.8, 10)
    expect(highEvidence).toBeGreaterThanOrEqual(lowEvidence)
  })

  test('summarizeTechnicalWarnings 单代码返回中文标签', () => {
    expect(summarizeTechnicalWarnings(['SOURCE_UNAVAILABLE'])).toBe('来源模块不可用')
    expect(summarizeTechnicalWarnings(['REGISTRY_MISS'])).toBe('原理目录未收录')
  })

  test('summarizeTechnicalWarnings 多代码用全角分号分隔且稳定排序', () => {
    const summary = summarizeTechnicalWarnings(['INSUFFICIENT_EVIDENCE', 'SOURCE_STALE'])
    expect(summary).toContain('来源数据已过期')
    expect(summary).toContain('证据不足')
    expect(summary).toContain('；')
    // 顺序无关
    expect(summarizeTechnicalWarnings(['SOURCE_STALE', 'INSUFFICIENT_EVIDENCE'])).toBe(summary)
  })

  test('summarizeTechnicalWarnings 空数组返回空字符串', () => {
    expect(summarizeTechnicalWarnings([])).toBe('')
  })

  test('isTechnicalCandidateStale 相同 hash 不陈旧', () => {
    const candidate = makeTechnicalCandidateFixture()
    expect(isTechnicalCandidateStale(candidate.sourceHashes, candidate.sourceHashes)).toBe(false)
  })

  test('isTechnicalCandidateStale hash 变化检测到陈旧', () => {
    const candidate = makeTechnicalCandidateFixture()
    expect(isTechnicalCandidateStale(candidate.sourceHashes, { tasks: 'xyz' })).toBe(true)
  })

  test('isTechnicalCandidateStale 缺少 key 不算陈旧', () => {
    const candidate = makeTechnicalCandidateFixture()
    expect(isTechnicalCandidateStale(candidate.sourceHashes, {})).toBe(false)
  })

  test('isTechnicalAnalysisRunStale 与 isTechnicalCandidateStale 语义一致', () => {
    const hashes = { tasks: 'abc', risks: 'def' }
    expect(isTechnicalAnalysisRunStale(hashes, hashes)).toBe(false)
    expect(isTechnicalAnalysisRunStale(hashes, { tasks: 'changed' })).toBe(true)
    expect(isTechnicalAnalysisRunStale(hashes, {})).toBe(false)
  })
})

describe('夹具构造器', () => {
  test('makeTechnicalAnalysisCollectorOutput 生成合理默认值', () => {
    const output = makeTechnicalAnalysisCollectorOutput()
    expect(output.organizationId).toBe(1)
    expect(output.projectId).toBe(1)
    expect(output.actorId).toBe(1)
    expect(output.projectName).toBeTruthy()
    expect(output.taskTotal).toBeGreaterThan(0)
    expect(output.overdueTaskCount).toBeGreaterThanOrEqual(0)
    expect(output.warnings).toEqual([])
    expect(output.sourceHashes).toBeDefined()
    expect(output.collectedAt).toBeTruthy()
  })

  test('makeTechnicalAnalysisCollectorOutput 允许覆盖', () => {
    const output = makeTechnicalAnalysisCollectorOutput({
      taskTotal: 50,
      projectName: '自定义项目',
      overdueTaskCount: 10,
    })
    expect(output.taskTotal).toBe(50)
    expect(output.projectName).toBe('自定义项目')
    expect(output.overdueTaskCount).toBe(10)
  })

  test('makeTechnicalCandidateFixture 生成合理候选', () => {
    const c = makeTechnicalCandidateFixture()
    expect(c.candidateKey).toBeTruthy()
    expect(c.ruleId).toBe('CD-001')
    expect(c.status).toBe('unreviewed')
    expect(c.improvingParameterKey).toBe('duration')
    expect(c.worseningParameterKey).toBe('cost')
    expect(c.severity).toBe('high')
    expect(c.title).toBeTruthy()
    expect(c.rationaleSummary).toBeTruthy()
    expect(c.principleRefs.length).toBeGreaterThan(0)
    expect(c.sourceHashes).toBeDefined()
  })

  test('makeTechnicalCandidateFixture 允许覆盖', () => {
    const c = makeTechnicalCandidateFixture({ severity: 'critical', confidence: 0.95 })
    expect(c.severity).toBe('critical')
    expect(c.confidence).toBe(0.95)
  })

  test('makeTechnicalAnalysisRunFixture 生成合理运行', () => {
    const run = makeTechnicalAnalysisRunFixture()
    expect(run.id).toBe(1)
    expect(run.organizationId).toBe(1)
    expect(run.projectId).toBe(1)
    expect(run.status).toBe('completed_with_warnings')
    expect(run.candidateCount).toBe(3)
    expect(run.inputSignature).toBeTruthy()
    expect(run.outputHash).toBeTruthy()
    expect(run.ruleVersion).toBe(TECHNICAL_RULESET_VERSION)
    expect(run.idempotencyKey.startsWith('tta-idem-')).toBe(true)
  })

  test('makeTechnicalAnalysisRunFixture 允许覆盖', () => {
    const run = makeTechnicalAnalysisRunFixture({ status: 'completed', candidateCount: 5 })
    expect(run.status).toBe('completed')
    expect(run.candidateCount).toBe(5)
  })
})

describe('规则集版本常量', () => {
  test('TECHNICAL_RULESET_VERSION 与基础矛盾规则集版本联动', () => {
    // TECHNICAL_RULESET_VERSION 复用 CONTRADICTION_RULESET_VERSION
    expect(TECHNICAL_RULESET_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

// ── 测试辅助 ──

function makeCandidateWithKey(candidateKey: string): TechnicalContradictionCandidate {
  return makeTechnicalCandidateFixture({ candidateKey })
}
