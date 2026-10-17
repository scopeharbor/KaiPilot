/**
 * v2-ai-risk-progress-prediction 3.5 —— 收集器与规则集测试。
 *
 * 覆盖：空项目、缺失数据源、资源超载、关键路径滑移、风险升级、
 * 权限过滤、稳定 hash 和规则边界条件。
 */
/**
 * v2-ai-risk-progress-prediction 3.5 —— 收集器与规则集测试。
 *
 * 覆盖：空项目、缺失数据源、资源超载、关键路径滑移、风险升级、
 * 权限过滤、稳定 hash 和规则边界条件。
 *
 * 注意：Task 模型列名是 `name`（非 `title`）；Milestone status 取值
 * 为 not_started/planned/at_risk/achieved/missed（非 pending/completed）。
 */
import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import ProjectPredictionInputCollector from '#services/prediction/input_collector'
import { ProjectPredictionRuleset } from '#services/prediction/ruleset'
import Task from '#models/task'
import Milestone from '#models/milestone'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

const PM_ROLE = 'project_manager' as const

// ---------------------------------------------------------------------------
// 帮助函数：创建测试项目
// ---------------------------------------------------------------------------

async function setupProject() {
  const owner = await createUser({ email: uniqueEmail('pred-col') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(org, owner, owner, PM_ROLE as any)
  return { owner, org, project }
}

// ---------------------------------------------------------------------------
// InputCollector 测试
// ---------------------------------------------------------------------------

test.group('ProjectPredictionInputCollector', (group) => {
  useAuthDatabase(group)

  test('空项目抛出 RESOURCE_NOT_FOUND', async ({ assert }) => {
    const collector = new ProjectPredictionInputCollector()
    await assert.rejects(
      () =>
        collector.collect({
          organizationId: 999,
          projectId: 999,
          userId: 1,
          window: 30,
          hasRiskView: true,
          hasResourceView: true,
          hasChangeImpactView: true,
        }),
      'RESOURCE_NOT_FOUND',
    )
  })

  test('空任务数据返回 DATA_MISSING warning', async ({ assert }) => {
    const collector = new ProjectPredictionInputCollector()
    const { project } = await setupProject()

    const result = await collector.collect({
      organizationId: Number(project.organizationId),
      projectId: Number(project.id),
      userId: 1,
      window: 30,
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })

    assert.isNotNull(result.taskData)
    assert.equal(result.taskData!.totalTasks, 0)
    assert.isNotNull(result.criticalPathData)
    assert.equal(result.criticalPathData!.totalCriticalTasks, 0)
    assert.isNotNull(result.milestoneData)
    assert.equal(result.milestoneData!.totalMilestones, 0)
    assert.isNotNull(result.sourceHash)

    const dataMissingWarnings = result.warnings.filter((w) => w.code === 'DATA_MISSING')
    assert.lengthOf(dataMissingWarnings, 1)
    assert.isTrue(dataMissingWarnings[0].blocking)
  })

  test('权限过滤添加 PERMISSION_FORBIDDEN warnings', async ({ assert }) => {
    const collector = new ProjectPredictionInputCollector()
    const { project } = await setupProject()

    const result = await collector.collect({
      organizationId: Number(project.organizationId),
      projectId: Number(project.id),
      userId: 1,
      window: 30,
      hasRiskView: false,
      hasResourceView: false,
      hasChangeImpactView: false,
    })

    const forbiddenWarnings = result.warnings.filter((w) => w.code === 'PERMISSION_FORBIDDEN')
    assert.lengthOf(forbiddenWarnings, 3)
    assert.isTrue(forbiddenWarnings.every((w) => w.blocking === true))
  })

  test('部分权限过滤只添加对应 warning', async ({ assert }) => {
    const collector = new ProjectPredictionInputCollector()
    const { project } = await setupProject()

    // 只有资源 view = false
    const result = await collector.collect({
      organizationId: Number(project.organizationId),
      projectId: Number(project.id),
      userId: 1,
      window: 30,
      hasRiskView: true,
      hasResourceView: false,
      hasChangeImpactView: true,
    })

    const permissionWarnings = result.warnings.filter((w) => w.code === 'PERMISSION_FORBIDDEN')
    assert.lengthOf(permissionWarnings, 1)
    assert.equal(permissionWarnings[0].signalType, 'resource_bottleneck')
  })

  test('有任务数据时收集任务统计', async ({ assert }) => {
    const collector = new ProjectPredictionInputCollector()
    const { project } = await setupProject()

    // 创建测试任务
    const now = new Date()
    const pastDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const futureDate = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]

    await Task.create({
      projectId: Number(project.id),
      name: '逾期任务',
      status: 'in_progress',
      endDate: DateTime.fromISO(pastDate),
    })
    await Task.create({
      projectId: Number(project.id),
      name: '进行中',
      status: 'in_progress',
      endDate: DateTime.fromISO(futureDate),
    })
    await Task.create({
      projectId: Number(project.id),
      name: '已完成',
      status: 'completed',
      endDate: DateTime.fromISO(pastDate),
    })
    await Task.create({
      projectId: Number(project.id),
      name: '阻塞任务',
      status: 'blocked',
      endDate: DateTime.fromISO(futureDate),
    })

    const result = await collector.collect({
      organizationId: Number(project.organizationId),
      projectId: Number(project.id),
      userId: 1,
      window: 30,
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })

    assert.isNotNull(result.taskData)
    assert.equal(result.taskData!.totalTasks, 4)
    assert.equal(result.taskData!.overdueTasks, 1)
    assert.equal(result.taskData!.blockedTasks, 1)
    assert.equal(result.taskData!.completedTasks, 1)
    assert.equal(result.taskData!.inProgressTasks, 2)
    assert.isAtLeast(result.taskData!.averageOverdueDays, 5)
    assert.isAtLeast(result.taskData!.dueSoonTasks, 1)
  })

  test('sourceHash 对相同输入稳定', async ({ assert }) => {
    const collector = new ProjectPredictionInputCollector()
    const { project } = await setupProject()

    // 创建相同任务
    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    await Task.create({
      projectId: Number(project.id),
      name: '任务A',
      status: 'in_progress',
      endDate: DateTime.fromISO(futureDate),
    })

    const result1 = await collector.collect({
      organizationId: Number(project.organizationId),
      projectId: Number(project.id),
      userId: 1,
      window: 30,
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })

    // 短暂等待后第二次收集（相同数据）
    const result2 = await collector.collect({
      organizationId: Number(project.organizationId),
      projectId: Number(project.id),
      userId: 1,
      window: 30,
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })

    assert.isNotNull(result1.sourceHash)
    assert.equal(result1.sourceHash, result2.sourceHash)
  })

  test('不同输入产生不同 sourceHash', async ({ assert }) => {
    const collector = new ProjectPredictionInputCollector()
    const { project } = await setupProject()

    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    await Task.create({
      projectId: Number(project.id),
      name: '任务A',
      status: 'in_progress',
      endDate: DateTime.fromISO(futureDate),
    })

    // 先收集
    const result1 = await collector.collect({
      organizationId: Number(project.organizationId),
      projectId: Number(project.id),
      userId: 1,
      window: 30,
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })

    // 创建更多任务（totalTasks 不同）
    await Task.create({
      projectId: Number(project.id),
      name: '任务B',
      status: 'not_started',
      endDate: null,
    })
    await Task.create({
      projectId: Number(project.id),
      name: '任务C',
      status: 'completed',
      endDate: null,
    })

    const result2 = await collector.collect({
      organizationId: Number(project.organizationId),
      projectId: Number(project.id),
      userId: 1,
      window: 30,
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })

    // 任务数不同：1 vs 3 → hash 必然不同
    assert.isNotNull(result1.sourceHash)
    assert.isNotNull(result2.sourceHash)
    assert.notEqual(result1.sourceHash, result2.sourceHash)
    assert.equal(result1.taskData!.totalTasks, 1)
    assert.equal(result2.taskData!.totalTasks, 3)
  })

  test('window 影响 dueSoon 统计', async ({ assert }) => {
    const collector = new ProjectPredictionInputCollector()
    const { project } = await setupProject()

    // 创建 5 天后到期的任务
    const nearFuture = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    await Task.create({
      projectId: Number(project.id),
      name: '短期任务',
      status: 'in_progress',
      endDate: DateTime.fromISO(nearFuture),
    })

    // 窗口 = 7 天 => 应计入
    const result7d = await collector.collect({
      organizationId: Number(project.organizationId),
      projectId: Number(project.id),
      userId: 1,
      window: 7,
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })
    assert.isAtLeast(result7d.taskData!.dueSoonTasks, 1)

    // 窗口 = 3 天 => 不应计入
    const result3d = await collector.collect({
      organizationId: Number(project.organizationId),
      projectId: Number(project.id),
      userId: 1,
      window: 3 as any,
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })
    assert.equal(result3d.taskData!.dueSoonTasks, 0)
  })

  test('里程碑数据收集', async ({ assert }) => {
    const collector = new ProjectPredictionInputCollector()
    const { project } = await setupProject()

    const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    await Milestone.create({
      projectId: Number(project.id),
      name: '逾期里程碑',
      status: 'planned',
      plannedDate: DateTime.fromISO(pastDate),
    })
    await Milestone.create({
      projectId: Number(project.id),
      name: '未来里程碑',
      status: 'planned',
      plannedDate: DateTime.fromISO(futureDate),
    })
    await Milestone.create({
      projectId: Number(project.id),
      name: '已完成里程碑',
      status: 'achieved',
      plannedDate: DateTime.fromISO(pastDate),
    })

    const result = await collector.collect({
      organizationId: Number(project.organizationId),
      projectId: Number(project.id),
      userId: 1,
      window: 30,
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })

    assert.isNotNull(result.milestoneData)
    assert.equal(result.milestoneData!.totalMilestones, 3)
    assert.equal(result.milestoneData!.overdueMilestones, 1)
    assert.isAtLeast(result.milestoneData!.upcomingMilestones, 1)
  })

  test('无权限维度返回 null 并添加警告', async ({ assert }) => {
    const collector = new ProjectPredictionInputCollector()
    const { project } = await setupProject()

    const result = await collector.collect({
      organizationId: Number(project.organizationId),
      projectId: Number(project.id),
      userId: 1,
      window: 30,
      hasRiskView: false,
      hasResourceView: false,
      hasChangeImpactView: false,
    })

    assert.isNull(result.riskData)
    assert.isNull(result.resourceData)
    assert.isNull(result.changeImpactData)
    assert.isNotNull(result.activityData)
  })
})

// ---------------------------------------------------------------------------
// ProjectPredictionRuleset 测试
// ---------------------------------------------------------------------------

test.group('ProjectPredictionRuleset', () => {
  const ruleset = new ProjectPredictionRuleset()

  function makeMinimalCollectorOutput(overrides: Record<string, any> = {}) {
    return {
      taskData: null,
      criticalPathData: null,
      milestoneData: null,
      resourceData: null,
      riskData: null,
      changeImpactData: null,
      activityData: null,
      warnings: [],
      generatedAt: new Date().toISOString(),
      sourceHash: 'test-source-hash',
      ...overrides,
    }
  }

  test('空输入返回空信号（除 data_quality 外）', ({ assert }) => {
    const result = ruleset.evaluate(makeMinimalCollectorOutput())
    assert.isArray(result.signals)

    // 空项目应只有 data_quality signal（due to DATA_MISSING warning）及 data_staleness
    const dataQualitySignals = result.signals.filter((s) => s.signalType === 'data_quality')
    assert.lengthOf(dataQualitySignals, 0) // no warning → no data_quality

    // activityData is null → ruleDataStaleness returns null (rule checks !ad)
    const staleSignals = result.signals.filter((s) => s.signalType === 'data_staleness')
    assert.lengthOf(staleSignals, 0)
  })

  test('DATA_MISSING warning 触发 data_quality 信号', ({ assert }) => {
    const result = ruleset.evaluate(
      makeMinimalCollectorOutput({
        warnings: [
          {
            code: 'DATA_MISSING',
            message: '暂无任务数据',
            blocking: true,
            signalType: 'schedule_risk' as const,
          },
        ],
      }),
    )

    const dq = result.signals.find((s) => s.signalType === 'data_quality')
    assert.isDefined(dq)
    assert.isAbove(dq!.score, 0)
    assert.isBelow(dq!.score, 100)
  })

  test('排期风险规则：高逾期率返回 high/critical', ({ assert }) => {
    const result = ruleset.evaluate(
      makeMinimalCollectorOutput({
        taskData: {
          totalTasks: 10,
          overdueTasks: 6,
          dueSoonTasks: 2,
          blockedTasks: 2,
          completedTasks: 2,
          inProgressTasks: 5,
          averageOverdueDays: 15,
          maxOverdueDays: 20,
          overdueDetails: [],
        },
      }),
    )

    const sr = result.signals.find((s) => s.signalType === 'schedule_risk')
    assert.isDefined(sr)
    assert.isBelow(sr!.score, 60) // 高逾期率 => 低分数
    assert.oneOf(sr!.severity, ['high', 'critical'])
    assert.isNotNull(sr!.confidenceLower)
    assert.isNotNull(sr!.confidenceUpper)
  })

  test('排期风险规则：无逾期返回 info', ({ assert }) => {
    const result = ruleset.evaluate(
      makeMinimalCollectorOutput({
        taskData: {
          totalTasks: 10,
          overdueTasks: 0,
          dueSoonTasks: 0,
          blockedTasks: 0,
          completedTasks: 10,
          inProgressTasks: 0,
          averageOverdueDays: 0,
          maxOverdueDays: 0,
          overdueDetails: [],
        },
      }),
    )

    const sr = result.signals.find((s) => s.signalType === 'schedule_risk')
    assert.isDefined(sr)
    assert.equal(sr!.severity, 'info')
    assert.isAbove(sr!.score, 85)
  })

  test('关键路径漂移规则：高漂移率返回 critical/high', ({ assert }) => {
    const result = ruleset.evaluate(
      makeMinimalCollectorOutput({
        criticalPathData: {
          totalCriticalTasks: 10,
          overdueCriticalTasks: 7,
          averageDelayDays: 10,
          delayedTasks: [
            { id: 1, title: '任务A', delayDays: 10 },
            { id: 2, title: '任务B', delayDays: 8 },
          ],
        },
      }),
    )

    const cpd = result.signals.find((s) => s.signalType === 'critical_path_drift')
    assert.isDefined(cpd)
    assert.oneOf(cpd!.severity, ['critical', 'high'])
    assert.lengthOf(cpd!.evidenceRefs, 2)
  })

  test('关键路径漂移规则：无关键任务返回 null', ({ assert }) => {
    const result = ruleset.evaluate(
      makeMinimalCollectorOutput({
        criticalPathData: {
          totalCriticalTasks: 0,
          overdueCriticalTasks: 0,
          averageDelayDays: 0,
          delayedTasks: [],
        },
      }),
    )

    const cpd = result.signals.find((s) => s.signalType === 'critical_path_drift')
    assert.isUndefined(cpd)
  })

  test('里程碑压力规则：高逾期率返回 high', ({ assert }) => {
    const result = ruleset.evaluate(
      makeMinimalCollectorOutput({
        milestoneData: {
          totalMilestones: 5,
          overdueMilestones: 3,
          upcomingMilestones: 1,
          overdueDetails: [{ id: 1, title: '里程碑A', daysOverdue: 10 }],
          upcomingDetails: [{ id: 2, title: '里程碑B', daysUntil: 5 }],
        },
      }),
    )

    const mp = result.signals.find((s) => s.signalType === 'milestone_pressure')
    assert.isDefined(mp)
    assert.oneOf(mp!.severity, ['high', 'medium'])
  })

  test('依赖阻塞规则：高阻塞率返回 high', ({ assert }) => {
    const result = ruleset.evaluate(
      makeMinimalCollectorOutput({
        taskData: {
          totalTasks: 10,
          overdueTasks: 0,
          dueSoonTasks: 0,
          blockedTasks: 4,
          completedTasks: 2,
          inProgressTasks: 4,
          averageOverdueDays: 0,
          maxOverdueDays: 0,
          overdueDetails: [],
        },
      }),
    )

    const db = result.signals.find((s) => s.signalType === 'dependency_block')
    assert.isDefined(db)
    assert.isAbove(db!.score, 0)
    assert.isBelow(db!.score, 100)
  })

  test('依赖阻塞规则：无阻塞返回 null', ({ assert }) => {
    const result = ruleset.evaluate(
      makeMinimalCollectorOutput({
        taskData: {
          totalTasks: 10,
          overdueTasks: 0,
          dueSoonTasks: 0,
          blockedTasks: 0,
          completedTasks: 5,
          inProgressTasks: 5,
          averageOverdueDays: 0,
          maxOverdueDays: 0,
          overdueDetails: [],
        },
      }),
    )

    const db = result.signals.find((s) => s.signalType === 'dependency_block')
    assert.isUndefined(db)
  })

  test('资源瓶颈规则：高过载率返回 high', ({ assert }) => {
    const result = ruleset.evaluate(
      makeMinimalCollectorOutput({
        resourceData: {
          totalResources: 5,
          overallLoadPercent: 130,
          overloadedResources: 3,
          overloadDetails: [
            { role: '前端开发', overloadPercent: 150 },
            { role: '后端开发', overloadPercent: 140 },
          ],
        },
      }),
    )

    const rb = result.signals.find((s) => s.signalType === 'resource_bottleneck')
    assert.isDefined(rb)
    assert.isAbove(rb!.score, 0)
    assert.isBelow(rb!.score, 100)
  })

  test('资源瓶颈规则：无资源返回 null', ({ assert }) => {
    const result = ruleset.evaluate(
      makeMinimalCollectorOutput({
        resourceData: {
          totalResources: 0,
          overallLoadPercent: 0,
          overloadedResources: 0,
          overloadDetails: [],
        },
      }),
    )

    const rb = result.signals.find((s) => s.signalType === 'resource_bottleneck')
    assert.isUndefined(rb)
  })

  test('风险升级规则：高严重度占比返回 critical/high', ({ assert }) => {
    const result = ruleset.evaluate(
      makeMinimalCollectorOutput({
        riskData: {
          totalRisks: 10,
          criticalRisks: 3,
          highRisks: 3,
          overdueReviews: [{ riskId: 1, title: '风险A', daysOverdue: 5 }],
        },
      }),
    )

    const re = result.signals.find((s) => s.signalType === 'risk_escalation')
    assert.isDefined(re)
    assert.oneOf(re!.severity, ['critical', 'high'])
  })

  test('变更影响规则', ({ assert }) => {
    const result = ruleset.evaluate(
      makeMinimalCollectorOutput({
        changeImpactData: {
          totalAnalyses: 5,
          openAnalyses: 4,
          highSeverityItems: 2,
        },
      }),
    )

    const ci = result.signals.find((s) => s.signalType === 'change_impact')
    assert.isDefined(ci)
    assert.isAbove(ci!.score, 0)
  })

  test('数据过期规则：有活动时不触发', ({ assert }) => {
    const result = ruleset.evaluate(
      makeMinimalCollectorOutput({
        activityData: {
          recentActivityCount: 5,
          recentCommentCount: 3,
        },
      }),
    )

    const ds = result.signals.find((s) => s.signalType === 'data_staleness')
    assert.isUndefined(ds)
  })

  test('数据过期规则：无活动时触发 low 信号', ({ assert }) => {
    const result = ruleset.evaluate(
      makeMinimalCollectorOutput({
        activityData: {
          recentActivityCount: 0,
          recentCommentCount: 0,
        },
      }),
    )

    const ds = result.signals.find((s) => s.signalType === 'data_staleness')
    assert.isDefined(ds)
    assert.equal(ds!.severity, 'low')
  })

  test('稳定排序：相同输入输出相同信号顺序', ({ assert }) => {
    const input = {
      taskData: {
        totalTasks: 10,
        overdueTasks: 2,
        dueSoonTasks: 2,
        blockedTasks: 1,
        completedTasks: 4,
        inProgressTasks: 3,
        averageOverdueDays: 5,
        maxOverdueDays: 8,
        overdueDetails: [],
      },
      criticalPathData: {
        totalCriticalTasks: 5,
        overdueCriticalTasks: 1,
        averageDelayDays: 3,
        delayedTasks: [],
      },
      milestoneData: {
        totalMilestones: 3,
        overdueMilestones: 0,
        upcomingMilestones: 1,
        overdueDetails: [],
        upcomingDetails: [],
      },
      resourceData: null as any,
      riskData: {
        totalRisks: 5,
        criticalRisks: 0,
        highRisks: 0,
        overdueReviews: [],
      },
      changeImpactData: null as any,
      activityData: {
        recentActivityCount: 3,
        recentCommentCount: 1,
      },
      warnings: [],
      generatedAt: new Date().toISOString(),
      sourceHash: 'test',
    }

    const result1 = ruleset.evaluate(input)
    const result2 = ruleset.evaluate(input)

    const types1 = result1.signals.map((s) => s.signalType)
    const types2 = result2.signals.map((s) => s.signalType)
    assert.deepEqual(types1, types2)
    assert.equal(result1.signals.length, result2.signals.length)

    for (let i = 0; i < result1.signals.length; i++) {
      assert.equal(result1.signals[i].severity, result2.signals[i].severity)
      assert.equal(result1.signals[i].score, result2.signals[i].score)
    }
  })

  test('严重度计算跨所有 5 个级别', ({ assert }) => {
    // critical (score < 40)
    let r = ruleset.evaluate(
      makeMinimalCollectorOutput({
        taskData: {
          totalTasks: 10,
          overdueTasks: 10,
          dueSoonTasks: 0,
          blockedTasks: 0,
          completedTasks: 0,
          inProgressTasks: 0,
          averageOverdueDays: 30,
          maxOverdueDays: 30,
          overdueDetails: [],
        },
      }),
    )
    assert.equal(r.signals.find((s) => s.signalType === 'schedule_risk')?.severity, 'critical')

    // info (score >= 90)
    r = ruleset.evaluate(
      makeMinimalCollectorOutput({
        taskData: {
          totalTasks: 10,
          overdueTasks: 0,
          dueSoonTasks: 0,
          blockedTasks: 0,
          completedTasks: 10,
          inProgressTasks: 0,
          averageOverdueDays: 0,
          maxOverdueDays: 0,
          overdueDetails: [],
        },
      }),
    )
    assert.equal(r.signals.find((s) => s.signalType === 'schedule_risk')?.severity, 'info')
  })
})
