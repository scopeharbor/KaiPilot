import { describe, test, expect } from 'vitest'
import {
  computePhysicalAnalysisInputSignature,
  computePhysicalAnalysisIdempotencyKey,
  computePhysicalCandidateKey,
  computePhysicalCandidatesOutputHash,
  comparePhysicalCandidate,
  scoreSeparationPrincipleRelevance,
  summarizePhysicalWarnings,
  isPhysicalCandidateStale,
  getSeparationPrinciple,
  isSeparationPrincipleKey,
  SEPARATION_PRINCIPLES,
  SEPARATION_AXES,
  PHYSICAL_RULESET_VERSION,
  makePhysicalAnalysisCollectorOutput,
  makePhysicalCandidateFixture,
  makePhysicalAnalysisRunFixture,
  type PhysicalContradictionCandidate,
} from './triz-physical-contradiction.js'

describe('分离原则 Registry', () => {
  test('每个分离维度都在常量数组中', () => {
    expect(SEPARATION_AXES).toContain('time')
    expect(SEPARATION_AXES).toContain('space')
    expect(SEPARATION_AXES).toContain('condition')
    expect(SEPARATION_AXES).toContain('stakeholder')
  })

  test('每个注册的原则都有中文名和 PM 指导', () => {
    for (const p of SEPARATION_PRINCIPLES) {
      expect(p.principleKey).toBeTruthy()
      expect(p.name).toBeTruthy()
      expect(p.pmGuidance).toBeTruthy()
      expect(p.applicabilityConditions).toBeTruthy()
      expect(p.nonApplicabilityConditions).toBeTruthy()
    }
  })

  test('getSeparationPrinciple 返回正确的原则', () => {
    const entry = getSeparationPrinciple('time_separation')
    expect(entry).toBeDefined()
    expect(entry!.name).toBe('时间分离')
  })

  test('getSeparationPrinciple 对未知 key 返回 undefined', () => {
    expect(getSeparationPrinciple('unknown_key')).toBeUndefined()
  })

  test('isSeparationPrincipleKey 正确识别已注册 key', () => {
    expect(isSeparationPrincipleKey('time_separation')).toBe(true)
    expect(isSeparationPrincipleKey('unknown_key')).toBe(false)
  })
})

describe('确定性纯函数', () => {
  test('computePhysicalAnalysisInputSignature 同输入产生同签名', () => {
    const a = makePhysicalAnalysisCollectorOutput()
    const b = makePhysicalAnalysisCollectorOutput()
    expect(computePhysicalAnalysisInputSignature(a)).toBe(computePhysicalAnalysisInputSignature(b))
  })

  test('computePhysicalAnalysisInputSignature 不同输入产生不同签名', () => {
    const a = makePhysicalAnalysisCollectorOutput()
    const b = makePhysicalAnalysisCollectorOutput({ overdueTaskCount: 10 })
    expect(computePhysicalAnalysisInputSignature(a)).not.toBe(
      computePhysicalAnalysisInputSignature(b),
    )
  })

  test('computePhysicalAnalysisIdempotencyKey 确定性', () => {
    const sig = computePhysicalAnalysisInputSignature(makePhysicalAnalysisCollectorOutput())
    const k1 = computePhysicalAnalysisIdempotencyKey(1, 1, 1, sig)
    const k2 = computePhysicalAnalysisIdempotencyKey(1, 1, 1, sig)
    expect(k1).toBe(k2)
  })

  test('computePhysicalAnalysisIdempotencyKey 用户提供 key 时使用', () => {
    const sig = computePhysicalAnalysisInputSignature(makePhysicalAnalysisCollectorOutput())
    const k1 = computePhysicalAnalysisIdempotencyKey(1, 1, 1, sig, 'my-key')
    expect(k1).toBeTruthy()
  })

  test('computePhysicalCandidateKey 确定性', () => {
    const k1 = computePhysicalCandidateKey('PD-001', 'scope', '完整覆盖', '快速交付')
    const k2 = computePhysicalCandidateKey('PD-001', 'scope', '快速交付', '完整覆盖')
    expect(k1).toBe(k2)
  })

  test('computePhysicalCandidateKey 不同参数产生不同 key', () => {
    const k1 = computePhysicalCandidateKey('PD-001', 'scope', 'A', 'B')
    const k2 = computePhysicalCandidateKey('PD-001', 'duration', 'A', 'B')
    expect(k1).not.toBe(k2)
  })

  test('computePhysicalCandidatesOutputHash 稳定性', () => {
    const c1 = makePhysicalCandidateFixture()
    const c2 = makePhysicalCandidateFixture()
    expect(computePhysicalCandidatesOutputHash([c1, c2])).toBe(
      computePhysicalCandidatesOutputHash([c2, c1]),
    )
  })

  test('computePhysicalCandidatesOutputHash 空数组处理', () => {
    const hash = computePhysicalCandidatesOutputHash([])
    expect(hash).toBeTruthy()
  })

  test('comparePhysicalCandidate 按严重度排序', () => {
    const high: PhysicalContradictionCandidate = makePhysicalCandidateFixture({ severity: 'high' })
    const medium: PhysicalContradictionCandidate = makePhysicalCandidateFixture({
      severity: 'medium',
    })
    expect(comparePhysicalCandidate(high, medium)).toBeLessThan(0)
    expect(comparePhysicalCandidate(medium, high)).toBeGreaterThan(0)
  })

  test('comparePhysicalCandidate 同严重度按置信度排序', () => {
    const a: PhysicalContradictionCandidate = makePhysicalCandidateFixture({
      severity: 'high',
      confidence: 0.8,
    })
    const b: PhysicalContradictionCandidate = makePhysicalCandidateFixture({
      severity: 'high',
      confidence: 0.6,
    })
    expect(comparePhysicalCandidate(a, b)).toBeLessThan(0)
  })

  test('comparePhysicalCandidate 同严重度同置信度按规则ID排序', () => {
    const a: PhysicalContradictionCandidate = makePhysicalCandidateFixture({ ruleId: 'PD-001' })
    const b: PhysicalContradictionCandidate = makePhysicalCandidateFixture({ ruleId: 'PD-002' })
    expect(comparePhysicalCandidate(a, b)).toBeLessThan(0)
  })

  test('scoreSeparationPrincipleRelevance 已知维度返回合理分数', () => {
    const score = scoreSeparationPrincipleRelevance('time', 'scope')
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  test('scoreSeparationPrincipleRelevance none 维度返回空', () => {
    const score = scoreSeparationPrincipleRelevance('none', 'scope')
    expect(score).toBe(0)
  })

  test('summarizePhysicalWarnings 单代码返回中文标签', () => {
    const summary = summarizePhysicalWarnings(['SOURCE_UNAVAILABLE'])
    expect(summary).toBe('来源模块不可用')
  })

  test('summarizePhysicalWarnings 多代码用全角分号分隔', () => {
    const summary = summarizePhysicalWarnings(['SOURCE_STALE', 'INSUFFICIENT_EVIDENCE'])
    expect(summary).toContain('来源数据已过期')
    expect(summary).toContain('证据不足')
    expect(summary).toContain('；')
  })

  test('summarizePhysicalWarnings 空数组返回空字符串', () => {
    expect(summarizePhysicalWarnings([])).toBe('')
  })

  test('isPhysicalCandidateStale 检测变更', () => {
    const candidate = makePhysicalCandidateFixture()
    expect(isPhysicalCandidateStale(candidate.sourceHashes, candidate.sourceHashes)).toBe(false)
    expect(isPhysicalCandidateStale(candidate.sourceHashes, { tasks: 'xyz' })).toBe(true)
  })

  test('isPhysicalCandidateStale 缺少 key 不算陈旧', () => {
    const candidate = makePhysicalCandidateFixture()
    expect(isPhysicalCandidateStale(candidate.sourceHashes, {})).toBe(false)
  })
})

describe('夹具构造器', () => {
  test('makePhysicalAnalysisCollectorOutput 生成合理默认值', () => {
    const output = makePhysicalAnalysisCollectorOutput()
    expect(output.organizationId).toBe(1)
    expect(output.projectId).toBe(1)
    expect(output.taskCount).toBeGreaterThan(0)
  })

  test('makePhysicalAnalysisCollectorOutput 允许覆盖', () => {
    const output = makePhysicalAnalysisCollectorOutput({ taskCount: 50, projectName: '自定义' })
    expect(output.taskCount).toBe(50)
    expect(output.projectName).toBe('自定义')
  })

  test('makePhysicalCandidateFixture 生成合理候选', () => {
    const c = makePhysicalCandidateFixture()
    expect(c.candidateKey).toBeTruthy()
    expect(c.ruleId).toBe('PD-001')
    expect(c.parameterKey).toBe('scope')
    expect(c.severity).toBe('high')
    expect(c.requirementA.summary).toBeTruthy()
    expect(c.requirementB.summary).toBeTruthy()
  })

  test('makePhysicalAnalysisRunFixture 生成合理运行', () => {
    const run = makePhysicalAnalysisRunFixture()
    expect(run.status).toBe('completed_with_warnings')
    expect(run.candidateCount).toBe(3)
  })
})

describe('规则集版本常量', () => {
  test('PHYSICAL_RULESET_VERSION 格式正确', () => {
    expect(PHYSICAL_RULESET_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

// ── §4.10 P1：大候选集性能探针 ──
// 验证高候选数下 hash 计算与稳定排序的确定性与性能不退化。
describe('大候选集性能探针（§4.10）', () => {
  /** 构造 N 个候选的 fixture（不同规则/参数/严重度以触发排序全路径）。 */
  function buildLargeCandidateSet(n: number): PhysicalContradictionCandidate[] {
    const severities = ['critical', 'high', 'medium', 'low'] as const
    const params = ['scope', 'duration', 'resource_load', 'quality', 'risk_level'] as const
    const axes = ['time', 'space', 'condition', 'stakeholder', 'phase'] as const
    const rules = ['PD-001', 'PD-002', 'PD-003', 'PD-004', 'PD-005', 'PD-006', 'PD-007'] as const
    const set: PhysicalContradictionCandidate[] = []
    for (let i = 0; i < n; i++) {
      set.push(
        makePhysicalCandidateFixture({
          candidateKey: `tpc-large-${i}`,
          ruleId: rules[i % rules.length],
          parameterKey: params[i % params.length],
          severity: severities[i % severities.length],
          separationAxis: axes[i % axes.length],
          confidence: 0.4 + (i % 60) / 100,
          impactScore: 0.3 + (i % 70) / 100,
        }),
      )
    }
    return set
  }

  test('500 候选集 outputHash 计算稳定且与顺序无关', () => {
    const set = buildLargeCandidateSet(500)
    const hashA = computePhysicalCandidatesOutputHash(set)
    const hashB = computePhysicalCandidatesOutputHash([...set].reverse())
    expect(hashA).toBe(hashB)
    expect(hashA.startsWith('tpo-')).toBe(true)
  })

  test('500 候选集排序确定：同输入两次排序结果完全一致', () => {
    const set = buildLargeCandidateSet(500)
    const sortedA = [...set].sort(comparePhysicalCandidate)
    const sortedB = [...set].sort(comparePhysicalCandidate)
    expect(sortedA.map((c) => c.candidateKey)).toEqual(sortedB.map((c) => c.candidateKey))
  })

  test('性能探针：大候选集 hash + 排序在合理耗时内完成', () => {
    const set = buildLargeCandidateSet(1000)
    const iterations = 20
    const start = Date.now()
    for (let i = 0; i < iterations; i++) {
      computePhysicalCandidatesOutputHash(set)
      ;[...set].sort(comparePhysicalCandidate)
    }
    const elapsed = Date.now() - start
    // 宽松上限：20 次 × 1000 候选的 hash+排序应远低于 2s；仅断言不出现数量级退化
    expect(elapsed).toBeLessThan(2000)
  })

  test('候选 key 唯一性在大集合下保持', () => {
    const set = buildLargeCandidateSet(300)
    const keys = set.map((c) => c.candidateKey)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
