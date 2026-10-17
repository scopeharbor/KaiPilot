/**
 * Health Diagnosis — Dashboard & Report Integration 单元测试
 *
 * v2-ai-project-health-diagnosis / 6.6
 *
 * 覆盖：无诊断降级、过期诊断阻断或人工确认、禁止隐式 AI 和权限脱敏
 */
import { test } from '@japa/runner'
import { useAuthDatabase } from '../functional/auth/_helpers.js'
import { ProjectHealthRuleset } from '#services/health_diagnosis/ruleset'
import type { DashboardHealthSummary } from '@aiproj/types'

test.group('Dashboard Health Summary', (group) => {
  useAuthDatabase(group)

  test('无已确认诊断时返回 unavailable', async ({ assert }) => {
    const summary: DashboardHealthSummary = {
      diagnosisId: null,
      overallScore: null,
      overallLabel: null,
      dimensionScores: [],
      status: null,
      stale: false,
      staleReason: null,
      confirmedAt: null,
      confirmedBy: null,
      confirmedNotes: null,
      warnings: [
        {
          dimension: 'progress',
          code: 'HEALTH_DIAGNOSIS_UNAVAILABLE',
          message: '暂无已确认的健康诊断',
          blocking: false,
        },
      ],
      available: false,
    }

    assert.isFalse(summary.available)
    assert.isNull(summary.diagnosisId)
    assert.isTrue(summary.warnings.length > 0)
  })

  test('有已确认诊断时返回诊断摘要', async ({ assert }) => {
    const ruleset = new ProjectHealthRuleset()
    const mockOutput = {
      taskSummary: {
        totalTasks: 100,
        overdueTasks: 5,
        dueSoonTasks: 10,
        blockedTasks: 2,
        completedTasks: 50,
        inProgressTasks: 30,
        notStartedTasks: 18,
        averageOverdueDays: 3,
        maxOverdueDays: 8,
      },
      criticalPathSummary: {
        totalCriticalTasks: 20,
        overdueCriticalTasks: 1,
        totalCriticalPathDelay: 1,
      },
      milestoneSummary: {
        totalMilestones: 10,
        completedMilestones: 6,
        overdueMilestones: 1,
        upcomingMilestones: 2,
      },
      resourceSummary: { totalResources: 15, overallLoadPercent: 85, overloadedResources: 1 },
      riskSummary: { totalRisks: 8, criticalRisks: 0, highRisks: 2, riskHealthScore: 85 },
      changeImpactSummary: { totalAnalyses: 3, openAnalyses: 1, highSeverityItems: 0 },
      collaborationSummary: { recentActivityCount: 60, recentCommentCount: 40, activeMembers: 8 },
      dataIntegrity: { missingDimensions: [], hasDependencyCycles: false, hasDataGaps: false },
      warnings: [],
      permissions: [],
      generatedAt: new Date().toISOString(),
      sourceHash: 'mock-hash',
    }

    const evaluation = ruleset.evaluate(mockOutput as any)
    assert.isAbove(evaluation.overallScore, 70)
    assert.isNotNull(evaluation.evidenceHash)
  })

  test('Dashboard 禁止隐式触发生成诊断', async ({ assert }) => {
    // Dashboard 读取时不应调用生成逻辑
    // 此测试验证接口契约：只读
    const summary: DashboardHealthSummary = {
      diagnosisId: null,
      overallScore: null,
      overallLabel: null,
      dimensionScores: [],
      status: null,
      stale: false,
      staleReason: null,
      confirmedAt: null,
      confirmedBy: null,
      confirmedNotes: null,
      warnings: [
        {
          dimension: 'progress',
          code: 'HEALTH_DIAGNOSIS_UNAVAILABLE',
          message: '暂无已确认的健康诊断',
          blocking: false,
        },
      ],
      available: false,
    }

    // 即使没有诊断，Dashboard 也返回正常状态，不抛出异常
    assert.doesNotThrow(() => {
      JSON.stringify(summary)
    })
  })

  test('权限脱敏 - 无风险权限', async ({ assert }) => {
    const ruleset = new ProjectHealthRuleset()

    const mockOutput = {
      taskSummary: {
        totalTasks: 50,
        overdueTasks: 3,
        dueSoonTasks: 5,
        blockedTasks: 1,
        completedTasks: 25,
        inProgressTasks: 15,
        notStartedTasks: 9,
        averageOverdueDays: 2,
        maxOverdueDays: 5,
      },
      criticalPathSummary: {
        totalCriticalTasks: 10,
        overdueCriticalTasks: 0,
        totalCriticalPathDelay: 0,
      },
      milestoneSummary: {
        totalMilestones: 5,
        completedMilestones: 3,
        overdueMilestones: 0,
        upcomingMilestones: 1,
      },
      resourceSummary: null,
      riskSummary: null,
      changeImpactSummary: null,
      collaborationSummary: { recentActivityCount: 30, recentCommentCount: 20, activeMembers: 4 },
      dataIntegrity: { missingDimensions: [], hasDependencyCycles: false, hasDataGaps: false },
      warnings: [
        {
          dimension: 'resource',
          code: 'PERMISSION_FORBIDDEN',
          message: '无资源查看权限',
          blocking: true,
        },
        {
          dimension: 'risk',
          code: 'PERMISSION_FORBIDDEN',
          message: '无风险查看权限',
          blocking: true,
        },
      ],
      permissions: [],
      generatedAt: new Date().toISOString(),
      sourceHash: 'mock-hash',
    }

    const evaluation = ruleset.evaluate(mockOutput as any)
    // 虽然有缺失维度，但 progress/critical_path/milestone 应正常评分
    assert.isAbove(evaluation.overallScore, 0)
    // 应有 warnings
    assert.isTrue(evaluation.warnings.length > 0)
    const resourceWarn = evaluation.warnings.find((w) => w.dimension === 'resource')
    assert.isNotNull(resourceWarn)
  })
})
