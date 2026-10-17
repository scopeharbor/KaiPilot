// @aiproj/types — V3 TRIZ 进化趋势分析共享契约测试
// v3-triz-evolution-trend-analysis / §2.6–§2.8

import { describe, test, expect } from 'vitest'
import {
  EVOLUTION_TREND_RUN_STATUSES,
  TREND_RISK_STATUSES,
  EVOLUTION_TREND_SCOPE_TYPES,
  EVOLUTION_TREND_IDS,
  EVOLUTION_TREND_LABELS,
  EVOLUTION_TREND_STAGES,
  EVOLUTION_TREND_DIRECTIONS,
  TREND_RISK_TYPES,
  TREND_RISK_TYPE_TREND_MAP,
  TREND_RISK_TYPE_LABELS,
  EVOLUTION_TREND_SOURCE_KINDS,
  EVOLUTION_TREND_WARNING_CODES,
  TREND_SEVERITIES,
  EVOLUTION_TREND_RULESET_VERSION,
  EVOLUTION_TREND_TAXONOMY_VERSION,
  EVOLUTION_TREND_SORT_FIELDS,
  HISTORY_COMPARISON_MODES,
  MIN_HISTORY_SAMPLES_FOR_FORECAST,
  computeTrendKey,
  computeTrendRiskKey,
  computeEvolutionTrendInputSignature,
  computeEvolutionTrendIdempotencyKey,
  computeTrendScoresOutputHash,
  computeTrendRisksOutputHash,
  computeTrendRiskOutputHash,
  compareTrendRiskCandidate,
  compareTrendScore,
  summarizeEvolutionTrendWarnings,
  isTrendRiskStale,
  isEvolutionTrendRunStale,
  normalizeTrendScore,
  computeTrendStage,
  classifyTrendDirection,
  trendScoreToSeverity,
  trendSeverityToScore,
  computeSourceCoverage,
  adjustConfidenceForCoverage,
  warningCodesToSeverity,
  computeTrendRiskImpactScore,
  computeTrendDeltas,
  computeTrendRiskDeltaSummary,
  compareSourceHashes,
  shouldSuppressForecast,
  makeEvolutionTrendCollectorOutput,
  makeSubsystemImbalanceCollectorOutput,
  makeRoleGapCollectorOutput,
  makeExternalDependencyBottleneckCollectorOutput,
  makeIdealityDeclineCollectorOutput,
  makeMissingSourceCollectorOutput,
  makeStaleSourceCollectorOutput,
  makeHiddenSourceCollectorOutput,
  makeTrendScoreFixture,
  makeTrendRiskCandidateFixture,
  makeEvolutionTrendAnalysisRunFixture,
  makeHistoryComparisonFixture,
} from './triz-evolution-trend-analysis.js'
import type {
  EvolutionTrendScore,
  EvolutionTrendRiskCandidate,
  EvolutionTrendWarningCode,
} from './triz-evolution-trend-analysis.js'

describe('常量与 taxonomy（§2.1 / §2.6）', () => {
  test('8 大趋势 taxonomy 完整且唯一', () => {
    expect(EVOLUTION_TREND_IDS).toHaveLength(8)
    expect(new Set(EVOLUTION_TREND_IDS).size).toBe(8)
    expect(EVOLUTION_TREND_IDS).toContain('completeness')
    expect(EVOLUTION_TREND_IDS).toContain('energy_information_transmission')
    expect(EVOLUTION_TREND_IDS).toContain('dynamization')
    expect(EVOLUTION_TREND_IDS).toContain('uneven_subsystem_evolution')
    expect(EVOLUTION_TREND_IDS).toContain('transition_to_supersystem')
    expect(EVOLUTION_TREND_IDS).toContain('micro_level_transition')
    expect(EVOLUTION_TREND_IDS).toContain('ideality_increase')
    expect(EVOLUTION_TREND_IDS).toContain('coordination')
    // 每个趋势都有中文标签
    for (const id of EVOLUTION_TREND_IDS) {
      expect(EVOLUTION_TREND_LABELS[id]).toBeTruthy()
    }
  })

  test('8 种风险类型与 8 大趋势一一映射', () => {
    expect(TREND_RISK_TYPES).toHaveLength(8)
    for (const riskType of TREND_RISK_TYPES) {
      const trendId = TREND_RISK_TYPE_TREND_MAP[riskType]
      expect(EVOLUTION_TREND_IDS).toContain(trendId)
      expect(TREND_RISK_TYPE_LABELS[riskType]).toBeTruthy()
    }
    // 映射覆盖全部 8 趋势
    const mappedTrends = new Set(Object.values(TREND_RISK_TYPE_TREND_MAP))
    expect(mappedTrends.size).toBe(8)
  })

  test('运行/风险状态、scope、阶段、方向、来源、排序、对比模式枚举稳定', () => {
    expect(EVOLUTION_TREND_RUN_STATUSES).toContain('completed_with_warnings')
    expect(EVOLUTION_TREND_RUN_STATUSES).toContain('stale')
    expect(TREND_RISK_STATUSES).toContain('blocked_stale')
    expect(EVOLUTION_TREND_SCOPE_TYPES).toEqual([
      'project',
      'subsystem',
      'technology_stack',
      'custom',
    ])
    expect(EVOLUTION_TREND_STAGES).toEqual(['nascent', 'developing', 'established', 'advanced'])
    expect(EVOLUTION_TREND_DIRECTIONS).toContain('unknown')
    expect(EVOLUTION_TREND_SOURCE_KINDS).toContain('manual_signal')
    expect(EVOLUTION_TREND_SOURCE_KINDS).toContain('resource_analysis')
    expect(TREND_SEVERITIES).toEqual(['critical', 'high', 'medium', 'low'])
    expect(EVOLUTION_TREND_SORT_FIELDS).toContain('impactScore')
    expect(HISTORY_COMPARISON_MODES).toEqual(['latest_prior', 'explicit_baseline'])
    expect(EVOLUTION_TREND_RULESET_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(EVOLUTION_TREND_TAXONOMY_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test('警告代码覆盖来源缺失/脱敏/历史不足/AI 降级/stale 阻断', () => {
    const required: EvolutionTrendWarningCode[] = [
      'DATA_SOURCE_UNAVAILABLE',
      'INSUFFICIENT_TREND_SOURCE',
      'PERMISSION_RESTRICTED',
      'SOURCE_STALE',
      'SOURCE_HIDDEN',
      'EXTERNAL_SOURCE_NOT_AUTHORIZED',
      'INSUFFICIENT_HISTORY',
      'FORECAST_SUPPRESSED',
      'AI_EXPLANATION_FALLBACK',
      'AI_EXPLANATION_BLOCKED',
      'HANDOFF_BLOCKED_STALE',
    ]
    for (const code of required) {
      expect(EVOLUTION_TREND_WARNING_CODES).toContain(code)
    }
  })
})

describe('稳定 key 与 hash（§2.2）', () => {
  test('computeTrendKey 确定性且随输入变化', () => {
    const k1 = computeTrendKey(1, 'completeness', 'project')
    const k2 = computeTrendKey(1, 'completeness', 'project')
    const k3 = computeTrendKey(1, 'coordination', 'project')
    const k4 = computeTrendKey(2, 'completeness', 'project')
    const k5 = computeTrendKey(1, 'completeness', 'subsystem')
    expect(k1).toBe(k2)
    expect(k1).toMatch(/^trk-/)
    expect(k1).not.toBe(k3)
    expect(k1).not.toBe(k4)
    expect(k1).not.toBe(k5)
  })

  test('computeTrendRiskKey 对 trend/target 顺序不敏感', () => {
    const a = computeTrendRiskKey('role_gap', 'ET-001', ['trk-a', 'trk-b'], ['h1', 'h2'])
    const b = computeTrendRiskKey('role_gap', 'ET-001', ['trk-b', 'trk-a'], ['h2', 'h1'])
    const c = computeTrendRiskKey('process_rigidity', 'ET-001', ['trk-a', 'trk-b'], ['h1', 'h2'])
    expect(a).toBe(b)
    expect(a).toMatch(/^trr-/)
    expect(a).not.toBe(c)
  })

  test('相同输入产生相同 input signature 与 idempotency key', () => {
    const collected = makeEvolutionTrendCollectorOutput()
    const s1 = computeEvolutionTrendInputSignature(collected)
    const s2 = computeEvolutionTrendInputSignature(makeEvolutionTrendCollectorOutput())
    expect(s1).toBe(s2)
    expect(s1).toMatch(/^tet-/)

    const idem1 = computeEvolutionTrendIdempotencyKey(1, 1, 1, s1)
    const idem2 = computeEvolutionTrendIdempotencyKey(1, 1, 1, s2)
    expect(idem1).toBe(idem2)
    expect(idem1).toMatch(/^tet-idem-/)
    // 用户提供 key 优先且被 hash 化
    const userIdem = computeEvolutionTrendIdempotencyKey(1, 1, 1, s1, 'user-key-1')
    expect(userIdem).not.toBe(idem1)
  })

  test('input signature 随事实变化而变化', () => {
    const base = makeEvolutionTrendCollectorOutput()
    const changed = makeEvolutionTrendCollectorOutput({ blockedTaskCount: 9 })
    expect(computeEvolutionTrendInputSignature(base)).not.toBe(
      computeEvolutionTrendInputSignature(changed),
    )
  })

  test('output hash 对集合顺序不敏感', () => {
    const t1 = makeTrendScoreFixture({ trendKey: 'trk-a' })
    const t2 = makeTrendScoreFixture({ trendKey: 'trk-b' })
    expect(computeTrendScoresOutputHash([t1, t2])).toBe(computeTrendScoresOutputHash([t2, t1]))
    const r1 = makeTrendRiskCandidateFixture({ riskKey: 'trr-a' })
    const r2 = makeTrendRiskCandidateFixture({ riskKey: 'trr-b' })
    expect(computeTrendRisksOutputHash([r1, r2])).toBe(computeTrendRisksOutputHash([r2, r1]))
    expect(computeTrendRiskOutputHash(r1)).toMatch(/^tet-ro-/)
  })
})

describe('确定性排序与 tie-breaker（§2.2 / §2.6）', () => {
  test('风险候选排序：严重度 → 置信度 → 影响 → 类型 → key', () => {
    const low = makeTrendRiskCandidateFixture({
      riskKey: 'trr-1',
      severity: 'low',
      confidence: 0.9,
      impactScore: 0.9,
    })
    const critical = makeTrendRiskCandidateFixture({
      riskKey: 'trr-2',
      severity: 'critical',
      confidence: 0.1,
      impactScore: 0.1,
    })
    const highA = makeTrendRiskCandidateFixture({
      riskKey: 'trr-a',
      riskType: 'role_gap',
      severity: 'high',
      confidence: 0.8,
      impactScore: 0.8,
    })
    const highB = makeTrendRiskCandidateFixture({
      riskKey: 'trr-b',
      riskType: 'role_gap',
      severity: 'high',
      confidence: 0.8,
      impactScore: 0.8,
    })
    const sorted = [low, highB, critical, highA].sort(compareTrendRiskCandidate)
    expect(sorted.map((r) => r.riskKey)).toEqual(['trr-2', 'trr-a', 'trr-b', 'trr-1'])
  })

  test('趋势评分排序：严重度 → 低分优先 → trendId → key', () => {
    const a = makeTrendScoreFixture({
      trendKey: 'trk-1',
      trendId: 'coordination',
      severity: 'medium',
      score: 0.9,
    })
    const b = makeTrendScoreFixture({
      trendKey: 'trk-2',
      trendId: 'completeness',
      severity: 'medium',
      score: 0.3,
    })
    const c = makeTrendScoreFixture({
      trendKey: 'trk-3',
      trendId: 'ideality_increase',
      severity: 'critical',
      score: 0.99,
    })
    const sorted = [a, b, c].sort(compareTrendScore)
    expect(sorted.map((t) => t.trendKey)).toEqual(['trk-3', 'trk-2', 'trk-1'])
  })
})

describe('评分 helpers（§2.3）', () => {
  test('normalizeTrendScore 边界与钳制', () => {
    expect(normalizeTrendScore(0.5)).toBe(0.5)
    expect(normalizeTrendScore(-1)).toBe(0)
    expect(normalizeTrendScore(2)).toBe(1)
    expect(normalizeTrendScore(1, 0, 0)).toBe(0)
  })

  test('computeTrendStage 分段', () => {
    expect(computeTrendStage(0.1)).toBe('nascent')
    expect(computeTrendStage(0.25)).toBe('developing')
    expect(computeTrendStage(0.5)).toBe('established')
    expect(computeTrendStage(0.75)).toBe('advanced')
    expect(computeTrendStage(1)).toBe('advanced')
  })

  test('classifyTrendDirection 阈值与 unknown', () => {
    expect(classifyTrendDirection(null)).toBe('unknown')
    expect(classifyTrendDirection(Number.NaN)).toBe('unknown')
    expect(classifyTrendDirection(0.1)).toBe('improving')
    expect(classifyTrendDirection(-0.1)).toBe('declining')
    expect(classifyTrendDirection(0.02)).toBe('stable')
    expect(classifyTrendDirection(0)).toBe('stable')
  })

  test('trendScoreToSeverity 与 trendSeverityToScore 对齐', () => {
    expect(trendScoreToSeverity(0.1)).toBe('critical')
    expect(trendScoreToSeverity(0.3)).toBe('high')
    expect(trendScoreToSeverity(0.5)).toBe('medium')
    expect(trendScoreToSeverity(0.9)).toBe('low')
    expect(trendSeverityToScore('critical')).toBeGreaterThan(trendSeverityToScore('low'))
  })

  test('computeSourceCoverage 与 adjustConfidenceForCoverage 降级', () => {
    expect(computeSourceCoverage(3, 4)).toBe(0.75)
    expect(computeSourceCoverage(0, 4)).toBe(0)
    expect(computeSourceCoverage(1, 0)).toBe(0)
    const adjusted = adjustConfidenceForCoverage(0.9, 0.5)
    expect(adjusted).toBeLessThan(0.9)
    expect(adjusted).toBeCloseTo(0.63, 2)
    expect(adjustConfidenceForCoverage(0.9, 0)).toBeCloseTo(0.36, 2)
  })

  test('warningCodesToSeverity 取最严重级别', () => {
    expect(warningCodesToSeverity([])).toBe('low')
    expect(warningCodesToSeverity(['FORECAST_SUPPRESSED'])).toBe('low')
    expect(warningCodesToSeverity(['INSUFFICIENT_TREND_SOURCE'])).toBe('medium')
    expect(warningCodesToSeverity(['FORECAST_SUPPRESSED', 'DATA_SOURCE_UNAVAILABLE'])).toBe('high')
  })

  test('computeTrendRiskImpactScore 权重合成且在 0-1', () => {
    const score = computeTrendRiskImpactScore('critical', 1, 0, 5)
    expect(score).toBeCloseTo(1, 2)
    const low = computeTrendRiskImpactScore('low', 0.2, 0.9, 0)
    expect(low).toBeGreaterThanOrEqual(0)
    expect(low).toBeLessThan(score)
  })
})

describe('历史对比 helpers（§2.4）', () => {
  test('computeTrendDeltas 覆盖 8 趋势并对齐 baseline', () => {
    const current = EVOLUTION_TREND_IDS.map((trendId) =>
      makeTrendScoreFixture({ trendId, trendKey: `trk-${trendId}`, score: 0.6 }),
    )
    const baseline = EVOLUTION_TREND_IDS.map((trendId) =>
      makeTrendScoreFixture({ trendId, trendKey: `trk-${trendId}`, score: 0.5 }),
    )
    const deltas = computeTrendDeltas(current, baseline)
    expect(deltas).toHaveLength(8)
    for (const d of deltas) {
      expect(d.scoreDelta).toBeCloseTo(0.1, 4)
      expect(d.direction).toBe('improving')
      expect(d.stageChanged).toBe(false)
    }
  })

  test('computeTrendDeltas 缺失 baseline 趋势时方向 unknown', () => {
    const current = [makeTrendScoreFixture({ trendId: 'completeness' })]
    const deltas = computeTrendDeltas(current, [])
    expect(deltas).toHaveLength(1)
    expect(deltas[0].direction).toBe('unknown')
    expect(deltas[0].scoreDelta).toBe(0)
  })

  test('computeTrendRiskDeltaSummary 识别新增/解决/持续/升降级', () => {
    const persistent = makeTrendRiskCandidateFixture({
      riskKey: 'trr-keep',
      severity: 'critical',
    })
    const baseline = [
      makeTrendRiskCandidateFixture({ riskKey: 'trr-keep', severity: 'high' }),
      makeTrendRiskCandidateFixture({ riskKey: 'trr-gone' }),
    ]
    const current = [persistent, makeTrendRiskCandidateFixture({ riskKey: 'trr-new' })]
    const summary = computeTrendRiskDeltaSummary(current, baseline)
    expect(summary.newRiskKeys).toEqual(['trr-new'])
    expect(summary.resolvedRiskKeys).toEqual(['trr-gone'])
    expect(summary.persistentRiskCount).toBe(1)
    expect(summary.severityUpgradedCount).toBe(1)
    expect(summary.severityDowngradedCount).toBe(0)
  })

  test('compareSourceHashes 分类 matched/changed/added/removed', () => {
    const result = compareSourceHashes({ a: '1', b: '2', c: '3' }, { a: '1', b: 'x', d: '4' })
    expect(result.matched).toEqual(['a'])
    expect(result.changed).toEqual(['b'])
    expect(result.added).toEqual(['c'])
    expect(result.removed).toEqual(['d'])
  })

  test('shouldSuppressForecast 阈值', () => {
    expect(shouldSuppressForecast(0)).toBe(true)
    expect(shouldSuppressForecast(MIN_HISTORY_SAMPLES_FOR_FORECAST - 1)).toBe(true)
    expect(shouldSuppressForecast(MIN_HISTORY_SAMPLES_FOR_FORECAST)).toBe(false)
    expect(shouldSuppressForecast(10)).toBe(false)
  })
})

describe('警告聚合与 stale 检测（§2.2）', () => {
  test('summarizeEvolutionTrendWarnings 中文聚合且排序', () => {
    expect(summarizeEvolutionTrendWarnings([])).toBe('')
    const text = summarizeEvolutionTrendWarnings(['SOURCE_STALE', 'DATA_SOURCE_UNAVAILABLE'])
    expect(text).toContain('数据来源不可用')
    expect(text).toContain('来源数据已过期')
    expect(text.indexOf('；')).toBeGreaterThan(-1)
  })

  test('isTrendRiskStale / isEvolutionTrendRunStale 仅在当前 hash 存在且不同才 stale', () => {
    const snapshot = { tasks_wbs: 'abc', risks: 'def' }
    expect(isTrendRiskStale(snapshot, { tasks_wbs: 'abc' })).toBe(false)
    expect(isTrendRiskStale(snapshot, { tasks_wbs: 'xyz' })).toBe(true)
    expect(isTrendRiskStale(snapshot, {})).toBe(false)
    expect(isEvolutionTrendRunStale(snapshot, { risks: 'zzz' })).toBe(true)
  })
})

describe('fixtures 与脱敏（§2.5 / §2.7）', () => {
  test('8 种场景 fixture builder 可构造且低敏', () => {
    const healthy = makeEvolutionTrendCollectorOutput()
    expect(healthy.warnings).toHaveLength(0)

    const imbalance = makeSubsystemImbalanceCollectorOutput()
    expect(imbalance.subsystemProgressSpread).toBeGreaterThan(0.5)

    const roleGap = makeRoleGapCollectorOutput()
    expect(roleGap.distinctRoleCount).toBe(1)
    expect(roleGap.singlePersonRoleCount).toBeGreaterThan(0)

    const bottleneck = makeExternalDependencyBottleneckCollectorOutput()
    expect(bottleneck.unhealthyExternalDependencyCount).toBeGreaterThan(0)

    const decline = makeIdealityDeclineCollectorOutput()
    expect(decline.costGrowthSignals).toBeGreaterThan(decline.deliveredValueItemCount)

    const missing = makeMissingSourceCollectorOutput()
    expect(missing.warnings.some((w) => w.code === 'DATA_SOURCE_UNAVAILABLE')).toBe(true)
    expect(missing.resourceUtilization).toBeNull()

    const stale = makeStaleSourceCollectorOutput()
    expect(stale.warnings.some((w) => w.code === 'SOURCE_STALE')).toBe(true)

    const hidden = makeHiddenSourceCollectorOutput()
    expect(hidden.warnings.some((w) => w.code === 'PERMISSION_RESTRICTED')).toBe(true)
  })

  test('hidden 来源不泄露计数/标签/hash/成员详情（§2.7）', () => {
    const hidden = makeHiddenSourceCollectorOutput()
    // 成员角色摘要被完全省略，不泄露角色计数与 hash
    expect(hidden.memberRoleSummaries).toHaveLength(0)
    expect(hidden.distinctRoleCount).toBe(0)
    expect(hidden.singlePersonRoleCount).toBe(0)
    // 风险计数被省略（不可见 → 0 且不产生风险标签）
    expect(hidden.activeRiskCount).toBe(0)
    expect(hidden.highRiskCount).toBe(0)
    // sourceHashes 不含有权限来源的 hash 键
    expect(Object.keys(hidden.sourceHashes)).not.toContain('members')
    expect(Object.keys(hidden.sourceHashes)).not.toContain('risks')
    // PERMISSION_RESTRICTED 警告本身不携带来源细节
    const restricted = hidden.warnings.find((w) => w.code === 'PERMISSION_RESTRICTED')
    expect(restricted?.source).toBeNull()
    expect(restricted?.message).not.toMatch(/\d+/)
  })

  test('baseline 细节在非授权上下文中不出现（§2.7）', () => {
    const comparison = makeHistoryComparisonFixture({ baselineRunId: null })
    expect(comparison.baselineRunId).toBeNull()
    // fixture 的 trendDeltas 只携带趋势枚举与数值，不含来源正文
    const json = JSON.stringify(comparison)
    expect(json).not.toContain('张三')
    expect(json).not.toContain('Authorization')
  })

  test('run fixture 默认趋势数为 8', () => {
    const run = makeEvolutionTrendAnalysisRunFixture()
    expect(run.trendCount).toBe(8)
    expect(run.ruleVersion).toBe(EVOLUTION_TREND_RULESET_VERSION)
  })
})

describe('大 fixture 性能探针（§2.8 / P1）', () => {
  test('1000 项目事实 + 8 趋势维度 + 500 风险来源 refs 在本地预算内完成', () => {
    const start = Date.now()

    // 1000 项目事实：成员角色摘要 200 + 依赖 400 + 变更 400
    const memberRoleSummaries = Array.from({ length: 200 }, (_, i) => ({
      roleKey: `role-${i}`,
      memberCount: (i % 5) + 1,
      hash: `role-h${i}`,
    }))
    const collected = makeEvolutionTrendCollectorOutput({
      memberRoleSummaries,
      dependencyCount: 400,
      changeRequestCount: 400,
      taskTotal: 1000,
    })
    const signature = computeEvolutionTrendInputSignature(collected)
    expect(signature).toMatch(/^tet-/)

    // 8 趋势维度评分
    const trends: EvolutionTrendScore[] = EVOLUTION_TREND_IDS.map((trendId) =>
      makeTrendScoreFixture({
        trendId,
        trendKey: computeTrendKey(1, trendId, 'project'),
      }),
    )
    expect(computeTrendScoresOutputHash(trends)).toMatch(/^tet-t-/)

    // 500 风险来源 refs
    const targetRefs = Array.from({ length: 500 }, (_, i) => ({
      sourceKind: 'tasks_wbs' as const,
      entityType: 'task',
      entityId: i,
      lowSensitiveTitle: `任务摘要-${i}`,
      hash: `task-h${i}`,
    }))
    const risks: EvolutionTrendRiskCandidate[] = TREND_RISK_TYPES.map((riskType, i) =>
      makeTrendRiskCandidateFixture({
        riskType,
        trendId: TREND_RISK_TYPE_TREND_MAP[riskType],
        riskKey: computeTrendRiskKey(riskType, `ET-00${i + 1}`, ['trk-x'], [`task-h${i}`]),
        targetRefs: targetRefs.slice(i * 60, i * 60 + 62),
      }),
    )
    const sorted = [...risks].sort(compareTrendRiskCandidate)
    expect(sorted).toHaveLength(8)
    expect(computeTrendRisksOutputHash(sorted)).toMatch(/^tet-r-/)

    // 历史对比（8 趋势 delta + 500 ref hash 比较）
    const baselineHashes = Object.fromEntries(targetRefs.slice(0, 250).map((r) => [r.hash, r.hash]))
    const currentHashes = Object.fromEntries(
      targetRefs.slice(100, 500).map((r) => [r.hash, r.hash]),
    )
    const comparison = compareSourceHashes(currentHashes, baselineHashes)
    expect(comparison.matched.length).toBe(150)
    expect(comparison.added.length).toBe(250)
    expect(comparison.removed.length).toBe(100)
    const deltas = computeTrendDeltas(trends, trends)
    expect(deltas).toHaveLength(8)

    const elapsed = Date.now() - start
    // 本地预算：确定性组装/评分/排序/对比 1000 事实 < 2000ms
    expect(elapsed).toBeLessThan(2000)
  })
})
