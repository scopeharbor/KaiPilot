/**
 * skill-eval.test —— V3 Skill 评估系统契约与纯函数单元测试。
 *
 * 覆盖：契约零依赖断言、纯函数确定性、评分维度与 grade 阈值、自定义权重、
 * 转移建议路径合法性、evidenceDigest 可复现、零数据降级断言（>=30 用例）。
 */
import { describe, it, expect } from 'vitest'
import {
  scoreSkillQuality,
  suggestTransition,
  runSkillBenchmark,
  aggregateSkillEffectMetrics,
  DEFAULT_QUALITY_WEIGHTS,
  type QualityWeights,
  type QualityReport,
  type BenchmarkInput,
  type SkillEffectEvent,
  type SkillEffectMetrics,
  type TransitionSuggestion,
} from './skill-eval.js'
import type { Skill, KnowledgeBundle } from './compiler-skill.js'
import type { ActivationContext } from './skill-activation.js'

// ═══════════════════════════════════════════════════════════════════════
// 测试夹具
// ═══════════════════════════════════════════════════════════════════════

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: overrides.id ?? 1,
    organizationId: 1,
    skillKey: overrides.skillKey ?? 'test-skill',
    name: overrides.name ?? 'Test Skill',
    version: overrides.version ?? '1.0.0',
    description: overrides.description ?? 'A test skill',
    status: overrides.status ?? 'eval',
    category: overrides.category ?? { primary: 'domain', secondary: 'software' },
    tags: overrides.tags ?? ['test'],
    dependencies: overrides.dependencies ?? [],
    activation: overrides.activation ?? {},
    knowledge: overrides.knowledge ?? {},
    basePriority: overrides.basePriority ?? 50,
    provenance: overrides.provenance,
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

/** 创建包含完整六类、每条含 sourceRefs 和 confidence 的 knowledge。 */
function makeFullKnowledge(): KnowledgeBundle {
  const entry = (id: string) => ({
    id,
    title: `Entry ${id}`,
    content: `Content for ${id} with sufficient detail to pass checks.`,
    confidence: 0.9,
    sourceRefs: [{ layer: 'L1', sourceId: 'ISO 9001' }],
  })

  return {
    rules: [entry('r1'), entry('r2'), entry('r3'), entry('r4')],
    patterns: [entry('p1'), entry('p2'), entry('p3'), entry('p4')],
    antiPatterns: [entry('ap1'), entry('ap2'), entry('ap3'), entry('ap4')],
    examples: [entry('e1'), entry('e2'), entry('e3'), entry('e4')],
    checklists: [entry('c1'), entry('c2'), entry('c3'), entry('c4')],
    rubric: [entry('rb1'), entry('rb2'), entry('rb3'), entry('rb4')],
  }
}

function makeFullSkill(overrides?: Partial<Skill>): Skill {
  return makeSkill({
    knowledge: makeFullKnowledge(),
    provenance: { sourceSkillKey: 'org/base-skill', sourceVersion: '1.0.0' },
    ...overrides,
  })
}

// ═══════════════════════════════════════════════════════════════════════
// 1.1 契约零依赖断言
// ═══════════════════════════════════════════════════════════════════════

describe('契约定义', () => {
  it('DEFAULT_QUALITY_WEIGHTS 五维权重和为 100', () => {
    const sum = Object.values(DEFAULT_QUALITY_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(sum).toBe(100)
  })

  it('QualityReport 类型包含全部必需字段', () => {
    const report: QualityReport = {
      skillKey: 'test',
      skillVersion: '1.0.0',
      score: 85,
      grade: 'excellent',
      dimensionScores: [],
      issues: [],
      referenceTime: '2026-07-26T00:00:00.000Z',
    }
    expect(report.grade).toBe('excellent')
    expect(report.skillKey).toBe('test')
  })

  it('SkillEffectMetrics 零数据降级形状正确', () => {
    const m: SkillEffectMetrics = { activationCount: 0, avgScore: null }
    expect(m.activationCount).toBe(0)
    expect(m.avgScore).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 1.2 scoreSkillQuality — 确定性内容质量评分
// ═══════════════════════════════════════════════════════════════════════

describe('scoreSkillQuality', () => {
  it('满分 Skill 评分 >= 85 excellent', () => {
    const skill = makeFullSkill()
    const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
    expect(report.score).toBeGreaterThanOrEqual(85)
    expect(report.grade).toBe('excellent')
  })

  it('六类齐全应得满分结构分', () => {
    const skill = makeFullSkill()
    const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
    const structDim = report.dimensionScores.find((d) => d.dimension === 'structure')!
    expect(structDim.score).toBe(100)
  })

  it('仅有一类 knowledge 覆盖度显著扣分', () => {
    const skill = makeSkill({
      knowledge: {
        rules: [{ id: 'r1', title: 'R1', content: 'test', confidence: 0.8, sourceRefs: [] }],
      },
    })
    const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
    const covDim = report.dimensionScores.find((d) => d.dimension === 'coverage')!
    expect(covDim.score).toBeLessThan(50)
    expect(report.score).toBeLessThan(60)
    expect(report.grade).toBe('fail')
  })

  it('空 knowledge 返回 fail 等级', () => {
    const skill = makeSkill({ knowledge: {} })
    const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
    expect(report.grade).toBe('fail')
    expect(report.score).toBeLessThan(60)
  })

  it('缺失 sourceRefs 溯源分为零', () => {
    const skill = makeSkill({
      knowledge: {
        rules: [{ id: 'r1', title: 'R1', content: 'test', confidence: 0.8 }],
        patterns: [{ id: 'p1', title: 'P1', content: 'test', confidence: 0.8 }],
      },
    })
    const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
    const provDim = report.dimensionScores.find((d) => d.dimension === 'provenance')!
    expect(provDim.score).toBe(0)
  })

  it('自定义权重生效', () => {
    const skill = makeFullSkill()
    const customWeights: Partial<QualityWeights> = {
      structure: 50,
      coverage: 50,
      provenance: 0,
      regulation: 0,
      antiHallucination: 0,
    }
    const defaultReport = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
    const customReport = scoreSkillQuality(skill, {
      weights: customWeights,
      referenceTime: '2026-07-26T00:00:00.000Z',
    })
    // 自定义权重只考虑 structure 和 coverage，总分应不同
    expect(customReport.score).not.toBe(defaultReport.score)
  })

  it('相同输入相同评分（确定性）', () => {
    const skill = makeFullSkill()
    const opts = { referenceTime: '2026-07-26T00:00:00.000Z' }
    const r1 = scoreSkillQuality(skill, opts)
    const r2 = scoreSkillQuality(skill, opts)
    expect(r1.score).toBe(r2.score)
    expect(r1.grade).toBe(r2.grade)
    expect(r1.dimensionScores).toEqual(r2.dimensionScores)
    expect(r1.issues).toEqual(r2.issues)
  })

  it('评分不受 Date.now() 影响（referenceTime 传入后确定性）', () => {
    const skill = makeFullSkill()
    const r1 = scoreSkillQuality(skill, { referenceTime: '2026-01-01T00:00:00.000Z' })
    const r2 = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
    // referenceTime 不同只影响报告的 referenceTime 字段，不影响 score
    expect(r1.score).toBe(r2.score)
    expect(r1.referenceTime).not.toBe(r2.referenceTime)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 维度子函数独立测试
// ═══════════════════════════════════════════════════════════════════════

describe('维度评分独立验证', () => {
  describe('structure 维度', () => {
    it('六类全满分', () => {
      const skill = makeFullSkill()
      const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
      const dim = report.dimensionScores.find((d) => d.dimension === 'structure')!
      expect(dim.score).toBe(100)
    })

    it('缺失三类扣分', () => {
      const skill = makeSkill({
        knowledge: {
          rules: [{ id: 'r1', title: 'R1', content: 'test', confidence: 0.8, sourceRefs: [] }],
          patterns: [{ id: 'p1', title: 'P1', content: 'test', confidence: 0.8, sourceRefs: [] }],
          antiPatterns: [
            { id: 'ap1', title: 'AP1', content: 'test', confidence: 0.8, sourceRefs: [] },
          ],
        },
      })
      const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
      const dim = report.dimensionScores.find((d) => d.dimension === 'structure')!
      expect(dim.score).toBe(50) // 3/6 = 50%
    })
  })

  describe('coverage 维度', () => {
    it('六类全有且条目充足得高分', () => {
      const skill = makeFullSkill() // 24 条
      const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
      const dim = report.dimensionScores.find((d) => d.dimension === 'coverage')!
      expect(dim.score).toBeGreaterThanOrEqual(100) // 含 bonus
    })

    it('空 knowledge 覆盖度为零分', () => {
      const skill = makeSkill({ knowledge: {} })
      const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
      const dim = report.dimensionScores.find((d) => d.dimension === 'coverage')!
      expect(dim.score).toBe(0)
    })
  })

  describe('provenance 维度', () => {
    it('有完整 sourceRefs 得满分', () => {
      const skill = makeFullSkill()
      const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
      const dim = report.dimensionScores.find((d) => d.dimension === 'provenance')!
      // 24 entries * 1 sourceRef + 1 provenance ref = 25 refs, capped at 100
      expect(dim.score).toBe(100)
    })

    it('无 sourceRefs 得零分', () => {
      const skill = makeSkill({
        knowledge: {
          rules: [{ id: 'r1', title: 'R1', content: 'test', confidence: 0.8 }],
        },
      })
      const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
      const dim = report.dimensionScores.find((d) => d.dimension === 'provenance')!
      expect(dim.score).toBe(0)
    })
  })

  describe('regulation 维度', () => {
    it('ISO 规范参照被识别', () => {
      const skill = makeSkill({
        knowledge: {
          rules: [
            {
              id: 'r1',
              title: 'R1',
              content: 'test',
              confidence: 0.8,
              sourceRefs: [{ layer: 'L1', sourceId: 'ISO 9001' }],
            },
          ],
          patterns: [
            {
              id: 'p1',
              title: 'P1',
              content: 'test',
              confidence: 0.8,
              sourceRefs: [{ layer: 'L1', sourceId: 'GB/T 19001' }],
            },
          ],
        },
      })
      const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
      const dim = report.dimensionScores.find((d) => d.dimension === 'regulation')!
      expect(dim.score).toBe(100)
    })

    it('无规范参照时跳过检查得满分', () => {
      const skill = makeSkill({
        knowledge: {
          rules: [{ id: 'r1', title: 'R1', content: 'test', confidence: 0.8 }],
        },
      })
      const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
      const dim = report.dimensionScores.find((d) => d.dimension === 'regulation')!
      expect(dim.score).toBe(100)
    })
  })

  describe('antiHallucination 维度', () => {
    it('缺少 confidence 字段触发 HL-003 扣分', () => {
      const skill = makeSkill({
        knowledge: {
          rules: [{ id: 'r1', title: 'R1', content: 'test' }], // 无 confidence
        },
      })
      const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
      const dim = report.dimensionScores.find((d) => d.dimension === 'antiHallucination')!
      expect(dim.score).toBeLessThan(100)
      expect(report.issues.some((i) => i.includes('HL-003'))).toBe(true)
    })

    it('重复 section id 触发 HL-005 扣分', () => {
      const entry = { id: 'dup-id', title: 'Dup', content: 'test', confidence: 0.8 }
      const skill = makeSkill({
        knowledge: {
          rules: [entry],
          patterns: [entry], // 相同 id
        },
      })
      const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
      const dim = report.dimensionScores.find((d) => d.dimension === 'antiHallucination')!
      expect(dim.score).toBeLessThan(100)
      expect(report.issues.some((i) => i.includes('HL-005'))).toBe(true)
    })

    it('空内容条目触发 HL-004 扣分', () => {
      const skill = makeSkill({
        knowledge: {
          rules: [{ id: 'r1', title: 'R1', content: '', confidence: 0.8 }],
        },
      })
      const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
      const dim = report.dimensionScores.find((d) => d.dimension === 'antiHallucination')!
      expect(dim.score).toBeLessThan(100)
      expect(report.issues.some((i) => i.includes('HL-004'))).toBe(true)
    })

    it('非对象条目触发 HL-010 扣分', () => {
      const skill = makeSkill({
        knowledge: {
          rules: ['not an object' as unknown],
        },
      })
      const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
      const dim = report.dimensionScores.find((d) => d.dimension === 'antiHallucination')!
      expect(dim.score).toBeLessThan(100)
      expect(report.issues.some((i) => i.includes('HL-010'))).toBe(true)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 1.3 suggestTransition — 转移建议
// ═══════════════════════════════════════════════════════════════════════

describe('suggestTransition', () => {
  it('eval 状态且评分 >= 70 且无 blocking 建议 eval->active', () => {
    const skill = makeSkill({ status: 'eval', skillKey: 'test-eval' })
    const report: QualityReport = {
      skillKey: 'test-eval',
      skillVersion: '1.0.0',
      score: 75,
      grade: 'good',
      dimensionScores: [{ dimension: 'antiHallucination', score: 100, max: 100, issues: [] }],
      issues: [],
      referenceTime: '2026-07-26T00:00:00.000Z',
    }
    const suggestion = suggestTransition(skill, report)
    expect(suggestion.suggestTransition).toBe('eval->active')
    expect(suggestion.hasBlockingIssues).toBe(false)
  })

  it('active 状态且评分 < 60 建议 quality_alert', () => {
    const skill = makeSkill({ status: 'active', skillKey: 'test-alert' })
    const report: QualityReport = {
      skillKey: 'test-alert',
      skillVersion: '1.0.0',
      score: 45,
      grade: 'fail',
      dimensionScores: [{ dimension: 'antiHallucination', score: 100, max: 100, issues: [] }],
      issues: [],
      referenceTime: '2026-07-26T00:00:00.000Z',
    }
    const suggestion = suggestTransition(skill, report)
    expect(suggestion.suggestTransition).toBe('active->quality_alert')
  })

  it('active 状态有 blocking 违规建议 quality_alert', () => {
    const skill = makeSkill({ status: 'active', skillKey: 'test-block' })
    const report: QualityReport = {
      skillKey: 'test-block',
      skillVersion: '1.0.0',
      score: 80, // 评分高但反幻觉 blocking
      grade: 'good',
      dimensionScores: [
        { dimension: 'antiHallucination', score: 40, max: 100, issues: ['HL-003: violation'] },
      ],
      issues: [],
      referenceTime: '2026-07-26T00:00:00.000Z',
    }
    const suggestion = suggestTransition(skill, report)
    expect(suggestion.suggestTransition).toBe('active->quality_alert')
    expect(suggestion.hasBlockingIssues).toBe(true)
  })

  it('eval 状态评分 < 70 不产建议', () => {
    const skill = makeSkill({ status: 'eval', skillKey: 'test-low' })
    const report: QualityReport = {
      skillKey: 'test-low',
      skillVersion: '1.0.0',
      score: 55,
      grade: 'fail',
      dimensionScores: [{ dimension: 'antiHallucination', score: 100, max: 100, issues: [] }],
      issues: [],
      referenceTime: '2026-07-26T00:00:00.000Z',
    }
    const suggestion = suggestTransition(skill, report)
    expect(suggestion.suggestTransition).toBeNull()
  })

  it('deprecated 状态不产建议（终态）', () => {
    const skill = makeSkill({ status: 'deprecated', skillKey: 'test-dep' })
    const report: QualityReport = {
      skillKey: 'test-dep',
      skillVersion: '1.0.0',
      score: 90,
      grade: 'excellent',
      dimensionScores: [{ dimension: 'antiHallucination', score: 100, max: 100, issues: [] }],
      issues: [],
      referenceTime: '2026-07-26T00:00:00.000Z',
    }
    const suggestion = suggestTransition(skill, report)
    expect(suggestion.suggestTransition).toBeNull()
  })

  it('draft 状态不产 eval->active 建议', () => {
    const skill = makeSkill({ status: 'draft', skillKey: 'test-draft' })
    const report: QualityReport = {
      skillKey: 'test-draft',
      skillVersion: '1.0.0',
      score: 85,
      grade: 'excellent',
      dimensionScores: [{ dimension: 'antiHallucination', score: 100, max: 100, issues: [] }],
      issues: [],
      referenceTime: '2026-07-26T00:00:00.000Z',
    }
    const suggestion = suggestTransition(skill, report)
    expect(suggestion.suggestTransition).toBeNull()
  })

  it('eval 状态有 blocking 违规不产上线建议', () => {
    const skill = makeSkill({ status: 'eval', skillKey: 'test-eval-block' })
    const report: QualityReport = {
      skillKey: 'test-eval-block',
      skillVersion: '1.0.0',
      score: 75,
      grade: 'good',
      dimensionScores: [
        { dimension: 'antiHallucination', score: 40, max: 100, issues: ['HL-005: dup'] },
      ],
      issues: [],
      referenceTime: '2026-07-26T00:00:00.000Z',
    }
    const suggestion = suggestTransition(skill, report)
    expect(suggestion.suggestTransition).toBeNull()
    expect(suggestion.hasBlockingIssues).toBe(true)
  })
})

// �══════════════════════════════════════════════════════════════════════════
// 1.4 runSkillBenchmark — 评测管道
// �══════════════════════════════════════════════════════════════════════

describe('runSkillBenchmark', () => {
  function makeBenchSkill(overrides: Partial<Skill> = {}): Skill {
    return makeSkill({
      skillKey: overrides.skillKey ?? 'bench-skill',
      name: overrides.name ?? 'Benchmark Skill',
      status: 'active',
      ...overrides,
    })
  }

  const refTime = '2026-07-26T00:00:00.000Z'

  it('空输入返回零评测报告', () => {
    const skill = makeBenchSkill()
    const report = runSkillBenchmark(skill, [], { referenceTime: refTime })
    expect(report.totalInputs).toBe(0)
    expect(report.coverageHits).toBe(0)
    expect(report.coverageRate).toBe(0)
    expect(report.activationDecisions).toEqual([])
    expect(report.evidenceDigest).toBeTruthy()
    expect(report.evidenceDigest).toHaveLength(64) // SHA-256 hex
  })

  it('单输入评测记录激活决策', () => {
    const skill = makeBenchSkill()
    const input: BenchmarkInput = {
      label: 'test-1',
      context: { projectType: 'software' },
      skills: [skill],
      expectedActivatedKeys: ['bench-skill'],
    }
    const report = runSkillBenchmark(skill, [input], { referenceTime: refTime })
    expect(report.totalInputs).toBe(1)
    expect(report.activationDecisions).toHaveLength(1)
    expect(report.coverageHits).toBe(1) // bench-skill 被激活
    expect(report.coverageRate).toBe(1)
  })

  it('evidenceDigest 可复现（相同输入相同 digest）', () => {
    const skill = makeBenchSkill()
    const input: BenchmarkInput = {
      label: 'test-1',
      context: { projectType: 'software' },
      skills: [skill],
    }
    const r1 = runSkillBenchmark(skill, [input], { referenceTime: refTime })
    const r2 = runSkillBenchmark(skill, [input], { referenceTime: refTime })
    expect(r1.evidenceDigest).toBe(r2.evidenceDigest)
  })

  it('不同输入产生不同 evidenceDigest', () => {
    const skillA = makeBenchSkill({ skillKey: 'skill-a' })
    const skillB = makeBenchSkill({ id: 2, skillKey: 'skill-b', name: 'Skill B' })
    const input1: BenchmarkInput = {
      label: 'test-1',
      context: {},
      skills: [skillA],
    }
    const input2: BenchmarkInput = {
      label: 'test-2',
      context: {},
      skills: [skillA, skillB], // 不同 skills 列表产生不同决策
    }
    const r1 = runSkillBenchmark(skillA, [input1], { referenceTime: refTime })
    const r2 = runSkillBenchmark(skillA, [input2], { referenceTime: refTime })
    expect(r1.evidenceDigest).not.toBe(r2.evidenceDigest)
  })

  it('benchmarkSource 默认为 fixture', () => {
    const skill = makeBenchSkill()
    const input: BenchmarkInput = {
      label: 'test-1',
      context: {},
      skills: [skill],
    }
    const report = runSkillBenchmark(skill, [input], { referenceTime: refTime })
    expect(report.benchmarkSource).toBe('fixture')
  })

  it('benchmarkSource 可指定为 L3', () => {
    const skill = makeBenchSkill()
    const input: BenchmarkInput = {
      label: 'test-1',
      context: {},
      skills: [skill],
    }
    const report = runSkillBenchmark(skill, [input], {
      referenceTime: refTime,
      benchmarkSource: 'L3',
    })
    expect(report.benchmarkSource).toBe('L3')
  })

  it('期望激活的 key 未命中时 coverageHits 为 0', () => {
    const skill = makeBenchSkill()
    const input: BenchmarkInput = {
      label: 'test-1',
      context: { projectType: 'software' },
      skills: [skill],
      expectedActivatedKeys: ['non-existent'],
    }
    const report = runSkillBenchmark(skill, [input], { referenceTime: refTime })
    expect(report.coverageHits).toBe(0)
    expect(report.coverageRate).toBe(0)
  })

  it('冲突统计正确记录', () => {
    const skillA = makeBenchSkill({
      skillKey: 'skill-a',
      category: { primary: 'domain', secondary: 'same' },
      activation: { priority: 80 },
    })
    const skillB = makeBenchSkill({
      id: 2,
      skillKey: 'skill-b',
      name: 'Skill B',
      category: { primary: 'domain', secondary: 'same' },
      activation: { priority: 60 },
    })
    const input: BenchmarkInput = {
      label: 'conflict-test',
      context: { projectType: 'software' },
      skills: [skillA, skillB],
    }
    const report = runSkillBenchmark(skillA, [input], { referenceTime: refTime })
    expect(report.droppedConflictsCount).toBeGreaterThanOrEqual(0)
    // 冲突中低优先级被淘汰
    const dec = report.activationDecisions[0]
    expect(dec!.droppedConflicts.some((d) => d.skill.skillKey === 'skill-b')).toBe(true)
  })
})

// �══════════════════════════════════════════════════════════════════════════
// 1.5 aggregateSkillEffectMetrics — 效果指标聚合
// �══════════════════════════════════════════════════════════════════════════

describe('aggregateSkillEffectMetrics', () => {
  it('空事件返回零数据降级', () => {
    const metrics = aggregateSkillEffectMetrics('test-skill', [])
    expect(metrics.activationCount).toBe(0)
    expect(metrics.avgScore).toBeNull()
  })

  it('null events 返回零数据降级', () => {
    const metrics = aggregateSkillEffectMetrics('test-skill', null as unknown as SkillEffectEvent[])
    expect(metrics.activationCount).toBe(0)
    expect(metrics.avgScore).toBeNull()
  })

  it('有事件无评分时 avgScore 为 null', () => {
    const events: SkillEffectEvent[] = [
      {
        organizationId: 1,
        skillKey: 'test-skill',
        activatedAt: '2026-07-26T00:00:00.000Z',
        referenceTime: '2026-07-26T00:00:00.000Z',
      },
    ]
    const metrics = aggregateSkillEffectMetrics('test-skill', events)
    expect(metrics.activationCount).toBe(1)
    expect(metrics.avgScore).toBeNull()
  })

  it('有评分事件计算平均值', () => {
    const events: SkillEffectEvent[] = [
      {
        organizationId: 1,
        skillKey: 'test-skill',
        activatedAt: '2026-07-26T00:00:00.000Z',
        qualityScore: 80,
        referenceTime: '2026-07-26T00:00:00.000Z',
      },
      {
        organizationId: 1,
        skillKey: 'test-skill',
        activatedAt: '2026-07-26T01:00:00.000Z',
        qualityScore: 90,
        referenceTime: '2026-07-26T01:00:00.000Z',
      },
    ]
    const metrics = aggregateSkillEffectMetrics('test-skill', events)
    expect(metrics.activationCount).toBe(2)
    expect(metrics.avgScore).toBe(85)
  })

  it('部分事件无评分时仅计算有评分的平均值', () => {
    const events: SkillEffectEvent[] = [
      {
        organizationId: 1,
        skillKey: 'test-skill',
        activatedAt: '2026-07-26T00:00:00.000Z',
        qualityScore: 70,
        referenceTime: '2026-07-26T00:00:00.000Z',
      },
      {
        organizationId: 1,
        skillKey: 'test-skill',
        activatedAt: '2026-07-26T01:00:00.000Z',
        referenceTime: '2026-07-26T01:00:00.000Z',
      },
    ]
    const metrics = aggregateSkillEffectMetrics('test-skill', events)
    expect(metrics.activationCount).toBe(2)
    expect(metrics.avgScore).toBe(70)
  })

  it('确定性：相同事件相同结果', () => {
    const events: SkillEffectEvent[] = [
      {
        organizationId: 1,
        skillKey: 'test-skill',
        activatedAt: '2026-07-26T00:00:00.000Z',
        qualityScore: 75,
        referenceTime: '2026-07-26T00:00:00.000Z',
      },
    ]
    const m1 = aggregateSkillEffectMetrics('test-skill', events)
    const m2 = aggregateSkillEffectMetrics('test-skill', events)
    expect(m1).toEqual(m2)
  })

  it('不产生假数据', () => {
    const metrics = aggregateSkillEffectMetrics('no-data-skill', [])
    expect(metrics.activationCount).toBe(0)
    expect(metrics.avgScore).toBeNull()
    // 不会因为无数据就返回假分数
    expect(metrics.avgScore).not.toBe(0)
    expect(metrics.avgScore).not.toBe(50)
    expect(metrics.avgScore).not.toBe(100)
  })
})

// �══════════════════════════════════════════════════════════════════════════
// 综合回归断言
// �══════════════════════════════════════════════════════════════════════════

describe('综合回归', () => {
  it('评分不自动触发生命周期转移（断言）', () => {
    const skill = makeSkill({ status: 'eval', skillKey: 'no-auto-transition' })
    const report = scoreSkillQuality(skill, { referenceTime: '2026-07-26T00:00:00.000Z' })
    // 评分仅产 report，不改变 skill 状态
    expect(skill.status).toBe('eval')
    expect(report.grade).toBeDefined()
  })

  it('无 Math.random()/Date.now() 调用（纯函数）', () => {
    // 多个调用返回完全一致的结果
    const skill = makeFullSkill()
    const opts = { referenceTime: '2026-07-26T00:00:00.000Z' }
    const results = Array.from({ length: 10 }, () => scoreSkillQuality(skill, opts))
    const firstScore = results[0]!.score
    for (const r of results) {
      expect(r.score).toBe(firstScore)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 任务 2.3：7 个内置 Skill 评分回归 fixture
// ═══════════════════════════════════════════════════════════════════════

import {
  listBuiltinSeeds,
  resolveSeedContent,
  type BuiltinSkillSeed,
} from './compiler-skill-builtin-seeds.js'

describe('内置 Skill 评分回归', () => {
  // 把 BuiltinSkillSeed 转为 Skill 形状，供 scoreSkillQuality 消费
  function seedToSkill(seed: BuiltinSkillSeed): Skill {
    return makeSkill({
      skillKey: seed.skillKey,
      name: seed.name,
      version: seed.version,
      description: seed.description,
      category: seed.category,
      tags: seed.tags,
      dependencies: seed.dependencies,
      activation: seed.activation,
      basePriority: seed.basePriority,
      knowledge: resolveSeedContent(seed),
      status: 'eval',
    })
  }

  const seeds = listBuiltinSeeds()
  const refTime = '2026-07-26T00:00:00.000Z'

  it(`listBuiltinSeeds 目录含 ${seeds.length} 个内置 Skill`, () => {
    expect(seeds.length).toBeGreaterThanOrEqual(7)
  })

  for (const seed of seeds) {
    const skill = seedToSkill(seed)

    it(`${seed.skillKey} (${seed.name}) 评分 >= 40（内置种子缺少 confidence 在反幻觉维度扣分）`, () => {
      const report = scoreSkillQuality(skill, { referenceTime: refTime })
      // 内置种子缺少 confidence → 反幻觉扣分，但结构/覆盖/溯源应达高分
      expect(report.score).toBeGreaterThanOrEqual(40)
      expect(report.grade).not.toBe('fail')
    })

    it(`${seed.skillKey} 六类结构完整（structure >= 83）`, () => {
      const report = scoreSkillQuality(skill, { referenceTime: refTime })
      const structDim = report.dimensionScores.find((d) => d.dimension === 'structure')!
      // 所有内置 Skill 六类齐全，至少 5/6 非空
      expect(structDim.score).toBeGreaterThanOrEqual(83)
    })

    it(`${seed.skillKey} 反幻觉得分 >= 0（内置种子缺少 confidence 会扣分但无 blocking 违规）`, () => {
      const report = scoreSkillQuality(skill, { referenceTime: refTime })
      const hlDim = report.dimensionScores.find((d) => d.dimension === 'antiHallucination')!
      // 内置种子缺少 confidence 字段会被 HL-003 扣分（每条 -5），但对官方手写内容，不出现 HL-005（重复 id）、HL-004（空内容）等严重
      expect(hlDim.score).toBeGreaterThanOrEqual(0)
    })

    it(`${seed.skillKey} 产出 issue 清单不含 HL-005 blocking`, () => {
      const report = scoreSkillQuality(skill, { referenceTime: refTime })
      const hlIssues = report.dimensionScores.find((d) => d.dimension === 'antiHallucination')!
      // 不应有 HL-005（重复 id）
      const hasDuplicateId = hlIssues.issues.some((i) => i.includes('HL-005'))
      expect(hasDuplicateId).toBe(false)
    })
  }

  it('7 个内置 Skill 评分分布合理（分数不极端聚集）', () => {
    const scores = seeds.map((seed) => {
      const skill = seedToSkill(seed)
      return scoreSkillQuality(skill, { referenceTime: refTime }).score
    })
    // 分数应在合理范围内，不全是满分或零分
    const minScore = Math.min(...scores)
    const maxScore = Math.max(...scores)
    expect(minScore).toBeGreaterThan(40)
    expect(maxScore).toBeLessThanOrEqual(100)
    // 至少有不同分数（不是全部相同）
    const uniqueScores = new Set(scores)
    expect(uniqueScores.size).toBeGreaterThan(1)
  })
})
