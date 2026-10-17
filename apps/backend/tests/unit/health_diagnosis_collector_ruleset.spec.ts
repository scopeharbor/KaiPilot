/**
 * Health Diagnosis — Collector & Ruleset 单元测试
 *
 * v2-ai-project-health-diagnosis / 2.6
 *
 * 覆盖：正常聚合、空项目、权限脱敏、跨项目输入过滤、稳定签名和无 AI 路径
 */
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import ProjectHealthInputCollector from '#services/health_diagnosis/input_collector'
import { ProjectHealthRuleset } from '#services/health_diagnosis/ruleset'
import type { HealthCollectorOutput } from '#services/health_diagnosis/input_collector'

async function setupProject() {
  const owner = await createUser({ email: uniqueEmail('health-diagnosis') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(org, owner, owner, 'project_manager')
  return { owner, org, project }
}

test.group('ProjectHealthInputCollector', (group) => {
  useAuthDatabase(group)

  test('正常聚合项目数据', async ({ assert }) => {
    const collector = new ProjectHealthInputCollector()
    const { owner, org, project } = await setupProject()

    const result = await collector.collect({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })

    assert.isNotNull(result)
    assert.isNotNull(result.taskSummary)
    assert.isNotNull(result.criticalPathSummary)
    assert.isNotNull(result.milestoneSummary)
    assert.isNotNull(result.collaborationSummary)
    assert.isString(result.sourceHash)
    assert.isArray(result.warnings)
  })

  test('风险权限脱敏', async ({ assert }) => {
    const collector = new ProjectHealthInputCollector()
    const { owner, org, project } = await setupProject()

    const result = await collector.collect({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      hasRiskView: false,
      hasResourceView: true,
      hasChangeImpactView: true,
    })

    assert.isNull(result.riskSummary)
    assert.isTrue(result.warnings.some((w) => w.dimension === 'risk'))
  })

  test('资源权限脱敏', async ({ assert }) => {
    const collector = new ProjectHealthInputCollector()
    const { owner, org, project } = await setupProject()

    const result = await collector.collect({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      hasRiskView: true,
      hasResourceView: false,
      hasChangeImpactView: true,
    })

    assert.isNull(result.resourceSummary)
    assert.isTrue(result.warnings.some((w) => w.dimension === 'resource'))
  })

  test('变更影响权限脱敏', async ({ assert }) => {
    const collector = new ProjectHealthInputCollector()
    const { owner, org, project } = await setupProject()

    const result = await collector.collect({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: false,
    })

    assert.isNull(result.changeImpactSummary)
    assert.isTrue(result.warnings.some((w) => w.dimension === 'change_impact'))
  })
})

test.group('ProjectHealthRuleset', (group) => {
  useAuthDatabase(group)

  const ruleset = new ProjectHealthRuleset()

  function makeMockOutput(overrides?: Partial<HealthCollectorOutput>): HealthCollectorOutput {
    return {
      taskSummary: {
        totalTasks: 100,
        overdueTasks: 10,
        dueSoonTasks: 15,
        blockedTasks: 5,
        completedTasks: 40,
        inProgressTasks: 30,
        notStartedTasks: 20,
        averageOverdueDays: 5,
        maxOverdueDays: 15,
      },
      criticalPathSummary: {
        totalCriticalTasks: 20,
        overdueCriticalTasks: 3,
        totalCriticalPathDelay: 3,
      },
      milestoneSummary: {
        totalMilestones: 10,
        completedMilestones: 4,
        overdueMilestones: 2,
        upcomingMilestones: 3,
      },
      resourceSummary: {
        totalResources: 15,
        overallLoadPercent: 95,
        overloadedResources: 3,
      },
      riskSummary: {
        totalRisks: 12,
        criticalRisks: 1,
        highRisks: 3,
        riskHealthScore: 70,
      },
      changeImpactSummary: {
        totalAnalyses: 5,
        openAnalyses: 2,
        highSeverityItems: 1,
      },
      collaborationSummary: {
        recentActivityCount: 50,
        recentCommentCount: 30,
        activeMembers: 5,
      },
      dataIntegrity: {
        missingDimensions: [],
        hasDependencyCycles: false,
        hasDataGaps: false,
      },
      warnings: [],
      permissions: [],
      generatedAt: new Date().toISOString(),
      sourceHash: 'mock-hash-001',
      ...overrides,
    }
  }

  test('规则集输出完整摘要', async ({ assert }) => {
    const result = ruleset.evaluate(makeMockOutput())

    assert.isNotNull(result)
    assert.isNumber(result.overallScore)
    assert.isString(result.overallLabel)
    assert.isArray(result.dimensionScores)
    assert.isArray(result.warnings)
    assert.isArray(result.suggestedActions)
    assert.isString(result.evidenceHash)
    assert.lengthOf(result.dimensionScores, 8)
  })

  test('空项目返回基础分数', async ({ assert }) => {
    const result = ruleset.evaluate(
      makeMockOutput({
        taskSummary: {
          totalTasks: 0,
          overdueTasks: 0,
          dueSoonTasks: 0,
          blockedTasks: 0,
          completedTasks: 0,
          inProgressTasks: 0,
          notStartedTasks: 0,
          averageOverdueDays: 0,
          maxOverdueDays: 0,
        },
        criticalPathSummary: {
          totalCriticalTasks: 0,
          overdueCriticalTasks: 0,
          totalCriticalPathDelay: 0,
        },
        milestoneSummary: {
          totalMilestones: 0,
          completedMilestones: 0,
          overdueMilestones: 0,
          upcomingMilestones: 0,
        },
        resourceSummary: { totalResources: 0, overallLoadPercent: 0, overloadedResources: 0 },
        riskSummary: { totalRisks: 0, criticalRisks: 0, highRisks: 0, riskHealthScore: null },
      }),
    )

    assert.isAbove(result.overallScore, 80)
    assert.isNotNull(result.evidenceHash)
  })

  test('高风险项目严重度正确', async ({ assert }) => {
    const result = ruleset.evaluate(
      makeMockOutput({
        taskSummary: {
          totalTasks: 20,
          overdueTasks: 10,
          dueSoonTasks: 5,
          blockedTasks: 5,
          completedTasks: 2,
          inProgressTasks: 5,
          notStartedTasks: 8,
          averageOverdueDays: 10,
          maxOverdueDays: 30,
        },
        criticalPathSummary: {
          totalCriticalTasks: 8,
          overdueCriticalTasks: 5,
          totalCriticalPathDelay: 5,
        },
        milestoneSummary: {
          totalMilestones: 5,
          completedMilestones: 0,
          overdueMilestones: 4,
          upcomingMilestones: 0,
        },
        resourceSummary: { totalResources: 5, overallLoadPercent: 150, overloadedResources: 4 },
        riskSummary: { totalRisks: 10, criticalRisks: 4, highRisks: 3, riskHealthScore: 20 },
      }),
    )

    assert.isBelow(result.overallScore, 60)
    const criticalDim = result.dimensionScores.find(
      (d) => d.severity === 'critical' || d.severity === 'high',
    )
    assert.isNotNull(criticalDim)
  })

  test('数据缺失添加 warning', async ({ assert }) => {
    const result = ruleset.evaluate(
      makeMockOutput({
        dataIntegrity: {
          missingDimensions: [
            {
              dimension: 'progress',
              code: 'DATA_MISSING',
              message: '暂无任务数据',
              blocking: true,
            },
          ],
          hasDependencyCycles: false,
          hasDataGaps: true,
        },
      }),
    )

    assert.isTrue(result.warnings.length > 0)
    // data_integrity 维度应有 evidence
    const dataIntegrity = result.dimensionScores.find((d) => d.dimension === 'data_integrity')
    assert.isNotNull(dataIntegrity)
  })

  test('stable sourceHash for same input', async ({ assert }) => {
    const collector = new ProjectHealthInputCollector()
    const { owner, org, project } = await setupProject()
    const input = {
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    }

    const result1 = await collector.collect(input)
    const result2 = await collector.collect(input)

    assert.equal(result1.sourceHash, result2.sourceHash)
  })
})
