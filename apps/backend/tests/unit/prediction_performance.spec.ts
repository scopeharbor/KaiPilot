/**
 * v2-ai-risk-progress-prediction 10.1-10.2 —— 性能夹具与测试。
 */
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { ProjectPredictionRuleset } from '#services/prediction/ruleset'
import ProjectPredictionInputCollector from '#services/prediction/input_collector'
import Task from '#models/task'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

const PM_ROLE = 'project_manager' as const

test.group('Prediction performance', (group) => {
  useAuthDatabase(group)

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('pred-perf') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, PM_ROLE as any)
    return { owner, org, project }
  }

  test('规则集空输入 < 50ms', async ({ assert }) => {
    const ruleset = new ProjectPredictionRuleset()
    const input = {
      taskData: null,
      criticalPathData: null,
      milestoneData: null,
      resourceData: null,
      riskData: null,
      changeImpactData: null,
      activityData: null,
      warnings: [],
      generatedAt: new Date().toISOString(),
      sourceHash: 'perf-test',
    }
    const start = performance.now()
    const result = ruleset.evaluate(input)
    const elapsed = performance.now() - start
    assert.isArray(result.signals)
    assert.isBelow(elapsed, 50, `Ruleset empty: ${elapsed.toFixed(0)}ms`)
  })

  test('规则集全量输入 < 200ms', async ({ assert }) => {
    const ruleset = new ProjectPredictionRuleset()
    const input = {
      taskData: {
        totalTasks: 1000,
        overdueTasks: 100,
        dueSoonTasks: 50,
        blockedTasks: 30,
        completedTasks: 400,
        inProgressTasks: 470,
        averageOverdueDays: 10,
        maxOverdueDays: 30,
        overdueDetails: [],
      },
      criticalPathData: {
        totalCriticalTasks: 50,
        overdueCriticalTasks: 10,
        averageDelayDays: 5,
        delayedTasks: [],
      },
      milestoneData: {
        totalMilestones: 20,
        overdueMilestones: 3,
        upcomingMilestones: 5,
        overdueDetails: [],
        upcomingDetails: [],
      },
      resourceData: {
        totalResources: 100,
        overallLoadPercent: 120,
        overloadedResources: 20,
        overloadDetails: [],
      },
      riskData: { totalRisks: 100, criticalRisks: 5, highRisks: 15, overdueReviews: [] },
      changeImpactData: { totalAnalyses: 50, openAnalyses: 10, highSeverityItems: 3 },
      activityData: { recentActivityCount: 50, recentCommentCount: 20 },
      warnings: [],
      generatedAt: new Date().toISOString(),
      sourceHash: 'perf-full',
    }
    const start = performance.now()
    const result = ruleset.evaluate(input)
    const elapsed = performance.now() - start
    assert.isAbove(result.signals.length, 0)
    assert.isBelow(elapsed, 200, `Ruleset full: ${elapsed.toFixed(0)}ms`)
  })

  test('收集器 100 任务 < 1000ms', async ({ assert }) => {
    const { org, project } = await setupProject()
    const collector = new ProjectPredictionInputCollector()

    const now = new Date()
    for (let i = 0; i < 100; i++) {
      const isOverdue = i < 30
      await Task.create({
        projectId: Number(project.id),
        name: `性能任务${i}`,
        status: isOverdue ? 'in_progress' : 'completed',
        endDate: isOverdue
          ? DateTime.fromISO(
              new Date(now.getTime() - (i + 1) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            )
          : DateTime.fromISO(
              new Date(now.getTime() + (i + 1) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            ),
      })
    }

    const start = performance.now()
    const result = await collector.collect({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: 1,
      window: 30,
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })
    const elapsed = performance.now() - start
    assert.equal(result.taskData!.totalTasks, 100)
    assert.isBelow(elapsed, 1000, `Collector 100 tasks: ${elapsed.toFixed(0)}ms`)
  })
})
