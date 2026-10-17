import { describe, expect, it } from 'vitest'
import type {
  DraftOverallRiskLevel,
  DraftValidationDimension,
  DraftValidationIssue,
  DraftValidationReport,
} from '@aiproj/types'
import type { Task } from '@/lib/api/tasks'
import { extractKanbanMetrics, extractValidationMetrics } from '@/lib/next/share-card-metrics'

/** 构造一个合法的 Task 实体（未覆盖字段取安全默认值）。 */
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    projectId: 1,
    name: '测试任务',
    description: null,
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    startDate: null,
    endDate: null,
    actualStartDate: null,
    actualEndDate: null,
    durationDays: null,
    estimatedHours: null,
    actualHours: null,
    progressPercent: 0,
    assigneeId: null,
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

/** 相对今天的 ISO 日期（YYYY-MM-DD），与引擎口径（toISOString().slice(0,10)）一致。 */
function isoDaysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

describe('extractKanbanMetrics（看板 5 大核心指标）', () => {
  it('空任务列表全零，完成率 0', () => {
    expect(extractKanbanMetrics({})).toEqual({
      totalTasks: 0,
      inProgressTasks: 0,
      completedTasks: 0,
      overdueTasks: 0,
      progressRate: 0,
    })
    expect(
      extractKanbanMetrics({
        pendingTasks: [],
        inProgressTasks: [],
        completedTasks: [],
        otherTasks: [],
      }),
    ).toEqual({
      totalTasks: 0,
      inProgressTasks: 0,
      completedTasks: 0,
      overdueTasks: 0,
      progressRate: 0,
    })
  })

  it('四列分布：总数 / 进行中 / 已完成正确，完成率四舍五入（design §5 示例 46/52%）', () => {
    const pendingTasks = Array.from({ length: 12 }, (_, i) =>
      makeTask({ id: i + 1, status: 'not_started' }),
    )
    const inProgressTasks = Array.from({ length: 8 }, (_, i) =>
      makeTask({ id: 100 + i, status: 'in_progress' }),
    )
    const completedTasks = Array.from({ length: 24 }, (_, i) =>
      makeTask({ id: 200 + i, status: 'completed' }),
    )
    const otherTasks = Array.from({ length: 2 }, (_, i) =>
      makeTask({ id: 300 + i, status: 'blocked' }),
    )

    const metrics = extractKanbanMetrics({
      pendingTasks,
      inProgressTasks,
      completedTasks,
      otherTasks,
    })
    expect(metrics.totalTasks).toBe(46)
    expect(metrics.inProgressTasks).toBe(8)
    expect(metrics.completedTasks).toBe(24)
    expect(metrics.progressRate).toBe(52) // 24/46 ≈ 52.17 → 52
  })

  it('仅提供 allTasks 时按状态过滤派生进行中 / 已完成', () => {
    const allTasks = [
      makeTask({ status: 'not_started' }),
      makeTask({ status: 'in_progress' }),
      makeTask({ status: 'in_progress' }),
      makeTask({ status: 'completed' }),
      makeTask({ status: 'completed' }),
      makeTask({ status: 'completed' }),
      makeTask({ status: 'blocked' }),
    ]
    const metrics = extractKanbanMetrics({ allTasks })
    expect(metrics.totalTasks).toBe(7)
    expect(metrics.inProgressTasks).toBe(2)
    expect(metrics.completedTasks).toBe(3)
    expect(metrics.progressRate).toBe(43) // 3/7 ≈ 42.86 → 43
  })

  it('提供列数据时列长度优先于状态过滤（权威列），other 列不计入进行中/已完成', () => {
    const metrics = extractKanbanMetrics({
      inProgressTasks: [makeTask({ status: 'completed' })], // 列权威：即使状态不匹配也计 1
      completedTasks: [makeTask({ status: 'in_progress' })],
      otherTasks: [makeTask({ status: 'completed' }), makeTask({ status: 'in_progress' })],
    })
    expect(metrics.totalTasks).toBe(4)
    expect(metrics.inProgressTasks).toBe(1)
    expect(metrics.completedTasks).toBe(1)
  })

  it('逾期 = 截止日早于今日且未完成；已完成任务不计逾期', () => {
    const allTasks = [
      makeTask({ status: 'in_progress', endDate: isoDaysFromNow(-3) }), // 逾期
      makeTask({ status: 'not_started', endDate: isoDaysFromNow(-1) }), // 逾期
      makeTask({ status: 'blocked', endDate: isoDaysFromNow(-2) }), // 逾期（其他状态）
      makeTask({ status: 'completed', endDate: isoDaysFromNow(-10) }), // 已完成不计
      makeTask({ status: 'in_progress', endDate: isoDaysFromNow(2) }), // 未来不计
      makeTask({ status: 'in_progress', endDate: isoDaysFromNow(0) }), // 今天不计
      makeTask({ status: 'in_progress', endDate: null }), // 无截止日不计
      makeTask({ status: 'completed', endDate: null }),
    ]
    const metrics = extractKanbanMetrics({ allTasks })
    expect(metrics.totalTasks).toBe(8)
    expect(metrics.overdueTasks).toBe(3)

    // 全完成：逾期 0 且完成率 100
    const done = extractKanbanMetrics({
      allTasks: [
        makeTask({ status: 'completed', endDate: isoDaysFromNow(-5) }),
        makeTask({ status: 'completed', endDate: isoDaysFromNow(-1) }),
      ],
    })
    expect(done.overdueTasks).toBe(0)
    expect(done.completedTasks).toBe(2)
    expect(done.progressRate).toBe(100)
  })

  it('混合 allTasks 与显式列时，显式列长度优先、总数取 allTasks', () => {
    const metrics = extractKanbanMetrics({
      allTasks: [makeTask({ status: 'in_progress' }), makeTask({ status: 'completed' })],
      inProgressTasks: [makeTask({ status: 'in_progress' }), makeTask({ status: 'in_progress' })],
    })
    expect(metrics.totalTasks).toBe(2)
    expect(metrics.inProgressTasks).toBe(2)
  })
})

describe('extractValidationMetrics（反幻觉自检报告度量映射）', () => {
  function makeIssue(
    ruleId: string,
    severity: DraftValidationIssue['severity'],
  ): DraftValidationIssue {
    return { ruleId, severity, message: `${ruleId} 违规`, path: null }
  }

  function makeValidation(overrides: Partial<DraftValidationReport> = {}): DraftValidationReport {
    const scores = {
      factualAccuracy: 90,
      logicalConsistency: 88,
      assumptionClarity: 85,
      completeness: 80,
      numericPlausibility: 92,
    } satisfies Record<DraftValidationDimension, number>
    return {
      overallRiskLevel: 'low',
      confidenceScore: 94,
      dimensionScores: scores,
      blocking: [],
      warning: [],
      info: [],
      ruleResults: [],
      autoFixDiffs: [],
      canConfirm: true,
      ...overrides,
    }
  }

  it('满分场景：置信度四舍五入、五维得分与权威权重完整透传', () => {
    const metrics = extractValidationMetrics(makeValidation())
    expect(metrics.confidenceScore).toBe(94)
    expect(metrics.overallRiskLevel).toBe('low')
    expect(metrics.dimensionScores).toEqual({
      factualAccuracy: 90,
      logicalConsistency: 88,
      assumptionClarity: 85,
      completeness: 80,
      numericPlausibility: 92,
    })
    expect(metrics.dimensionWeights).toEqual({
      factualAccuracy: 0.3,
      logicalConsistency: 0.25,
      assumptionClarity: 0.2,
      completeness: 0.1,
      numericPlausibility: 0.15,
    })
    expect(metrics.blockingCount).toBe(0)
    expect(metrics.warningCount).toBe(0)
    expect(metrics.blockingRuleIds).toEqual([])
  })

  it('存在阻断级违规：计数与规则编号按报告顺序映射', () => {
    const validation = makeValidation({
      overallRiskLevel: 'critical' as DraftOverallRiskLevel,
      blocking: [makeIssue('HL-001', 'blocking'), makeIssue('VE-010', 'blocking')],
      warning: [makeIssue('HL-004', 'warning')],
      info: [makeIssue('HL-005', 'info')],
    })
    const metrics = extractValidationMetrics(validation)
    expect(metrics.overallRiskLevel).toBe('critical')
    expect(metrics.blockingCount).toBe(2)
    expect(metrics.warningCount).toBe(1)
    expect(metrics.infoCount).toBe(1)
    expect(metrics.blockingRuleIds).toEqual(['HL-001', 'VE-010'])
    expect(metrics.warningRuleIds).toEqual(['HL-004'])
  })

  it('置信度含小数时按四舍五入展示（94.4 → 94，94.6 → 95）', () => {
    expect(
      extractValidationMetrics(makeValidation({ confidenceScore: 94.4 })).confidenceScore,
    ).toBe(94)
    expect(
      extractValidationMetrics(makeValidation({ confidenceScore: 94.6 })).confidenceScore,
    ).toBe(95)
  })

  it('未全部覆盖维度时缺失维度回退为 0 且不抛错', () => {
    const validation = makeValidation()
    const metrics = extractValidationMetrics(validation)
    expect(metrics.dimensionScores.factualAccuracy).toBeGreaterThanOrEqual(0)
    expect(metrics.blockingRuleIds).toHaveLength(0)
  })
})
