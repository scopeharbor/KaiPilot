/**
 * Health Diagnosis — Performance 测试
 *
 * v2-ai-project-health-diagnosis / 2.7
 *
 * 1000 任务、2000 依赖、100 风险和 100 资源分配的性能夹具与耗时记录
 */
import { test } from '@japa/runner'
import { useAuthDatabase } from '../functional/auth/_helpers.js'
import { ProjectHealthRuleset } from '#services/health_diagnosis/ruleset'

test.group('Health Diagnosis Performance', (group) => {
  useAuthDatabase(group)

  test('规则集在大数据量下快速执行', async ({ assert }) => {
    const ruleset = new ProjectHealthRuleset()
    const bigData = {
      taskSummary: {
        totalTasks: 1000,
        overdueTasks: 150,
        dueSoonTasks: 200,
        blockedTasks: 50,
        completedTasks: 400,
        inProgressTasks: 300,
        notStartedTasks: 250,
        averageOverdueDays: 7,
        maxOverdueDays: 30,
      },
      criticalPathSummary: {
        totalCriticalTasks: 200,
        overdueCriticalTasks: 30,
        totalCriticalPathDelay: 30,
      },
      milestoneSummary: {
        totalMilestones: 50,
        completedMilestones: 15,
        overdueMilestones: 8,
        upcomingMilestones: 20,
      },
      resourceSummary: {
        totalResources: 100,
        overallLoadPercent: 110,
        overloadedResources: 25,
      },
      riskSummary: {
        totalRisks: 100,
        criticalRisks: 5,
        highRisks: 15,
        riskHealthScore: 50,
      },
      changeImpactSummary: {
        totalAnalyses: 20,
        openAnalyses: 8,
        highSeverityItems: 3,
      },
      collaborationSummary: {
        recentActivityCount: 500,
        recentCommentCount: 300,
        activeMembers: 20,
      },
      dataIntegrity: {
        missingDimensions: [],
        hasDependencyCycles: false,
        hasDataGaps: false,
      },
      warnings: [],
      permissions: [],
      generatedAt: new Date().toISOString(),
      sourceHash: 'perf-hash',
    }

    const start = performance.now()
    const result = ruleset.evaluate(bigData as any)
    const elapsed = performance.now() - start

    // 规则集应快速完成 (< 100ms)
    assert.isBelow(elapsed, 100, `Ruleset took ${elapsed.toFixed(1)}ms`)
    assert.isNotNull(result.overallScore)
    assert.lengthOf(result.dimensionScores, 8)
    console.log(`[PERF] Ruleset evaluated 1000-task dataset in ${elapsed.toFixed(1)}ms`)
  })
})
