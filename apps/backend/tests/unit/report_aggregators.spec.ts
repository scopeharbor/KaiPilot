import Milestone from '#models/milestone'
import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
import WbsNode from '#models/wbs_node'
import { ProjectRoleName } from '#rbac'
import DelayAggregator from '#services/report_aggregators/delay_aggregator'
import MilestoneAggregator from '#services/report_aggregators/milestone_aggregator'
import ProgressAggregator from '#services/report_aggregators/progress_aggregator'
import WorkloadAggregator from '#services/report_aggregators/workload_aggregator'
import type { AggregatorContext } from '#services/report_aggregators/aggregator_context'
import type Project from '#models/project'
import type User from '#models/user'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import type { ReportGenerateFilters, ReportWarning } from '@aiproj/types'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

/**
 * preset-project-reports Task 3.7 —— 四类聚合器单元测试。
 *
 * 覆盖：
 *   - 正常项目（含 tasks / wbs / milestones / dependencies）
 *   - 空项目（零任务、零里程碑）
 *   - 缺失可选字段（无 end_date / 无 assignee / 无 planned_date / 无 WBS）
 *   - 统计口径边界：延期率、平均延期天数、加权进度、overloadHint 阈值、里程碑风险
 *
 * 组织隔离由 `ReportService.assertProjectInOrg` 负责（另有集成测试覆盖）；
 * 聚合器本身只按 project_id 过滤，不做跨组织判定，故此文件不重复测试组织维度。
 */

function makeContext(
  project: Project,
  organizationId: number,
  now: Date,
  filters: ReportGenerateFilters = {},
): { ctx: AggregatorContext; warnings: ReportWarning[] } {
  const warnings: ReportWarning[] = []
  return {
    warnings,
    ctx: { organizationId, project, filters, now, warnings },
  }
}

async function setupProject(): Promise<{ owner: User; org: { id: number }; project: Project }> {
  const owner = await createUser({ email: uniqueEmail('report-agg') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { owner, org: { id: org.id }, project }
}

/**
 * 语法糖：直接建 task，隐藏 DateTime 与 field 名重复。
 */
async function makeTask(
  projectId: number,
  partial: Partial<{
    name: string
    status: string
    priority: string
    taskType: string
    assigneeId: number | null
    endDate: string | null
    actualEndDate: string | null
    progressPercent: number
    estimatedHours: number
    actualHours: number
    isCriticalPath: boolean
    wbsNodeId: number | null
    milestoneId: number | null
  }> = {},
): Promise<Task> {
  return Task.create({
    projectId,
    name: partial.name ?? '任务',
    status: partial.status ?? 'not_started',
    priority: partial.priority ?? 'medium',
    taskType: partial.taskType ?? 'task',
    assigneeId: partial.assigneeId ?? null,
    endDate: partial.endDate ? DateTime.fromISO(partial.endDate) : null,
    actualEndDate: partial.actualEndDate ? DateTime.fromISO(partial.actualEndDate) : null,
    progressPercent: partial.progressPercent ?? 0,
    estimatedHours: partial.estimatedHours ?? null,
    actualHours: partial.actualHours ?? null,
    isCriticalPath: partial.isCriticalPath ?? false,
    isOnLongestPath: partial.isCriticalPath ?? false,
    wbsNodeId: partial.wbsNodeId ?? null,
    milestoneId: partial.milestoneId ?? null,
  })
}

// ---------------- ProgressAggregator ----------------

test.group('ProgressAggregator', (group) => {
  useAuthDatabase(group)

  test('空项目：totalTasks=0、overallProgress=0、并落 WBS/关键路径 info warning', async ({
    assert,
  }) => {
    const { org, project } = await setupProject()
    const { ctx, warnings } = makeContext(project, org.id, new Date('2026-07-08T00:00:00Z'))

    const snapshot = await new ProgressAggregator().aggregate(ctx)

    assert.equal(snapshot.template, 'progress')
    assert.equal(snapshot.summary.totalTasks, 0)
    assert.equal(snapshot.summary.overallProgressPercent, 0)
    // 六态全 0
    assert.equal(snapshot.statusDistribution.length, 6)
    for (const bucket of snapshot.statusDistribution) {
      assert.equal(bucket.count, 0)
      assert.equal(bucket.ratio, 0)
    }
    assert.lengthOf(snapshot.wbsSummaries, 0)
    assert.lengthOf(snapshot.criticalTasks, 0)
    assert.lengthOf(snapshot.blockers, 0)
    // 至少含 WBS 空 + 关键路径空两条 info
    assert.isTrue(warnings.some((w) => w.message.includes('WBS')))
    assert.isTrue(warnings.some((w) => w.message.includes('关键路径')))
  })

  test('六态分布 + 加权进度 + 阻塞项 = blocked+on_hold 合计', async ({ assert }) => {
    const { org, project } = await setupProject()
    // 六态各 1 条，progress_percent 依次 0/50/100/20/30/0
    await makeTask(Number(project.id), { name: 't1', status: 'not_started', progressPercent: 0 })
    await makeTask(Number(project.id), { name: 't2', status: 'in_progress', progressPercent: 50 })
    await makeTask(Number(project.id), { name: 't3', status: 'completed', progressPercent: 100 })
    await makeTask(Number(project.id), { name: 't4', status: 'blocked', progressPercent: 20 })
    await makeTask(Number(project.id), { name: 't5', status: 'on_hold', progressPercent: 30 })
    await makeTask(Number(project.id), { name: 't6', status: 'cancelled', progressPercent: 0 })

    const { ctx } = makeContext(project, org.id, new Date('2026-07-08T00:00:00Z'))
    const snapshot = await new ProgressAggregator().aggregate(ctx)

    assert.equal(snapshot.summary.totalTasks, 6)
    // (0+50+100+20+30+0)/6 = 33.33...
    assert.approximately(snapshot.summary.overallProgressPercent, 33.33, 0.02)
    assert.equal(snapshot.summary.completedTasks, 1)
    assert.equal(snapshot.summary.inProgressTasks, 1)
    assert.equal(snapshot.summary.notStartedTasks, 1)
    // blockedTasks 定义 = blocked + on_hold
    assert.equal(snapshot.summary.blockedTasks, 2)
    // ratio 归一
    for (const bucket of snapshot.statusDistribution) {
      assert.equal(bucket.count, 1)
      assert.approximately(bucket.ratio, 1 / 6, 0.01)
    }
    // 阻塞项列表 2 条
    assert.lengthOf(snapshot.blockers, 2)
  })

  test('关键任务：is_critical_path=true 且未完成的按截止日期升序取前 10', async ({ assert }) => {
    const { org, project } = await setupProject()
    // 3 条关键路径任务，1 条已完成应剔除
    await makeTask(Number(project.id), {
      name: 'critical-A',
      status: 'in_progress',
      isCriticalPath: true,
      endDate: '2026-08-01',
    })
    await makeTask(Number(project.id), {
      name: 'critical-B',
      status: 'not_started',
      isCriticalPath: true,
      endDate: '2026-07-15',
    })
    await makeTask(Number(project.id), {
      name: 'critical-done',
      status: 'completed',
      isCriticalPath: true,
      endDate: '2026-06-01',
    })
    // 非关键路径任务不进入
    await makeTask(Number(project.id), {
      name: 'non-critical',
      status: 'in_progress',
      endDate: '2026-07-01',
    })

    const { ctx } = makeContext(project, org.id, new Date('2026-07-08T00:00:00Z'))
    const snapshot = await new ProgressAggregator().aggregate(ctx)

    assert.lengthOf(snapshot.criticalTasks, 2)
    assert.equal(snapshot.criticalTasks[0].title, 'critical-B') // 07-15 < 08-01
    assert.equal(snapshot.criticalTasks[1].title, 'critical-A')
  })

  test('WBS 摘要：叶节点聚合任务数与完成数', async ({ assert }) => {
    const { org, project } = await setupProject()
    const leaf = await WbsNode.create({
      projectId: Number(project.id),
      name: '需求',
      code: '1',
      depth: 0,
      displayOrder: 0,
      isLeaf: true,
      collapsed: false,
    })
    await makeTask(Number(project.id), {
      name: '需求任务1',
      status: 'completed',
      progressPercent: 100,
      wbsNodeId: Number(leaf.id),
    })
    await makeTask(Number(project.id), {
      name: '需求任务2',
      status: 'in_progress',
      progressPercent: 40,
      wbsNodeId: Number(leaf.id),
    })

    const { ctx, warnings } = makeContext(project, org.id, new Date('2026-07-08T00:00:00Z'))
    const snapshot = await new ProgressAggregator().aggregate(ctx)

    assert.lengthOf(snapshot.wbsSummaries, 1)
    assert.equal(snapshot.wbsSummaries[0].totalTasks, 2)
    assert.equal(snapshot.wbsSummaries[0].completedTasks, 1)
    assert.equal(snapshot.wbsSummaries[0].code, '1')
    // 有 WBS 时不应落"WBS 为空" warning
    assert.isFalse(warnings.some((w) => w.message.includes('暂无 WBS')))
  })
})

// ---------------- DelayAggregator ----------------

test.group('DelayAggregator', (group) => {
  useAuthDatabase(group)

  test('空项目：无带截止的任务 → warning，overdue/upcoming 均空', async ({ assert }) => {
    const { org, project } = await setupProject()
    const { ctx, warnings } = makeContext(project, org.id, new Date('2026-07-08T00:00:00Z'))

    const snapshot = await new DelayAggregator().aggregate(ctx)

    assert.equal(snapshot.summary.totalTasksWithDueDate, 0)
    assert.equal(snapshot.summary.overdueTasks, 0)
    assert.equal(snapshot.summary.upcomingTasks, 0)
    assert.equal(snapshot.summary.delayRatePercent, 0)
    assert.isTrue(warnings.some((w) => w.message.includes('暂无带截止')))
  })

  test('已延期 + 即将到期 分类正确；已完成延期计入 overdue', async ({ assert }) => {
    const { org, project } = await setupProject()
    const now = new Date('2026-07-08T00:00:00Z')

    // 已过期未完成 → overdue（now-planned 差为正）
    await makeTask(Number(project.id), {
      name: 'overdue-open',
      status: 'in_progress',
      endDate: '2026-07-01', // 7 天前
    })
    // 即将到期（今起 7 天内）
    await makeTask(Number(project.id), {
      name: 'upcoming',
      status: 'not_started',
      endDate: '2026-07-12',
    })
    // 已完成但超期
    await makeTask(Number(project.id), {
      name: 'overdue-done',
      status: 'completed',
      endDate: '2026-06-01',
      actualEndDate: '2026-06-15', // 晚 14 天
    })
    // 已完成按期
    await makeTask(Number(project.id), {
      name: 'ontime-done',
      status: 'completed',
      endDate: '2026-06-01',
      actualEndDate: '2026-05-31',
    })
    // cancelled 忽略
    await makeTask(Number(project.id), {
      name: 'cancelled',
      status: 'cancelled',
      endDate: '2026-05-01',
    })

    const { ctx } = makeContext(project, org.id, now)
    const snapshot = await new DelayAggregator().aggregate(ctx)

    assert.equal(snapshot.summary.totalTasksWithDueDate, 5)
    assert.equal(snapshot.summary.overdueTasks, 2)
    assert.equal(snapshot.summary.upcomingTasks, 1)
    // maxOverdueDays 应等于 14（overdue-done 超期 14 天）与 7（overdue-open）中的最大值
    assert.equal(snapshot.summary.maxOverdueDays, 14)
    // delayRatePercent = 2/5 = 40
    assert.equal(snapshot.summary.delayRatePercent, 40)
    // averageOverdueDays = (7 + 14)/2 = 10.5
    assert.approximately(snapshot.summary.averageOverdueDays, 10.5, 0.01)
  })

  test('依赖 warning：前置延期且后置未完成，命中；后置已完成则忽略', async ({ assert }) => {
    const { org, project } = await setupProject()
    const pred = await makeTask(Number(project.id), {
      name: 'pred',
      status: 'in_progress',
      endDate: '2026-07-01',
    })
    const succOpen = await makeTask(Number(project.id), {
      name: 'succ-open',
      status: 'not_started',
      endDate: '2026-08-01',
    })
    const succDone = await makeTask(Number(project.id), {
      name: 'succ-done',
      status: 'completed',
      endDate: '2026-07-30',
    })
    await TaskDependency.create({
      predecessorId: Number(pred.id),
      successorId: Number(succOpen.id),
      type: 'fs',
      lagDays: 0,
    })
    await TaskDependency.create({
      predecessorId: Number(pred.id),
      successorId: Number(succDone.id),
      type: 'fs',
      lagDays: 0,
    })

    const { ctx } = makeContext(project, org.id, new Date('2026-07-08T00:00:00Z'))
    const snapshot = await new DelayAggregator().aggregate(ctx)

    assert.lengthOf(snapshot.dependencyWarnings, 1)
    assert.equal(snapshot.dependencyWarnings[0].fromTaskId, Number(pred.id))
    assert.equal(snapshot.dependencyWarnings[0].toTaskId, Number(succOpen.id))
  })
})

// ---------------- WorkloadAggregator ----------------

test.group('WorkloadAggregator', (group) => {
  useAuthDatabase(group)

  test('空项目：byAssignee/unassigned 均空 + 空项目 warning', async ({ assert }) => {
    const { org, project } = await setupProject()
    const { ctx, warnings } = makeContext(project, org.id, new Date('2026-07-08T00:00:00Z'))

    const snapshot = await new WorkloadAggregator().aggregate(ctx)

    assert.equal(snapshot.summary.totalAssignees, 0)
    assert.equal(snapshot.summary.totalPlannedHours, 0)
    assert.equal(snapshot.summary.unassigned.totalTasks, 0)
    assert.lengthOf(snapshot.byAssignee, 0)
    assert.isTrue(warnings.some((w) => w.message.includes('暂无任务')))
  })

  test('分桶：按 assignee 聚合，未分配单独汇总，overloadHint 阈值 > 160h', async ({ assert }) => {
    const { owner, org, project } = await setupProject()
    const alice = await createUser({ email: uniqueEmail('alice'), fullName: 'Alice' })
    // alice 3 条任务，planned = 60 + 80 + 40 = 180h → overloadHint=true
    await makeTask(Number(project.id), {
      name: 'a1',
      assigneeId: Number(alice.id),
      status: 'completed',
      estimatedHours: 60,
      actualHours: 55,
    })
    await makeTask(Number(project.id), {
      name: 'a2',
      assigneeId: Number(alice.id),
      status: 'in_progress',
      estimatedHours: 80,
      actualHours: 40,
    })
    await makeTask(Number(project.id), {
      name: 'a3',
      assigneeId: Number(alice.id),
      status: 'not_started',
      estimatedHours: 40,
    })
    // owner 1 条 40h → overloadHint=false
    await makeTask(Number(project.id), {
      name: 'o1',
      assigneeId: Number(owner.id),
      status: 'in_progress',
      estimatedHours: 40,
    })
    // 2 条未分配（10h）
    await makeTask(Number(project.id), { name: 'u1', estimatedHours: 5 })
    await makeTask(Number(project.id), { name: 'u2', estimatedHours: 5 })

    const { ctx, warnings } = makeContext(project, org.id, new Date('2026-07-08T00:00:00Z'))
    const snapshot = await new WorkloadAggregator().aggregate(ctx)

    assert.equal(snapshot.summary.totalAssignees, 2)
    // 180 + 40 + 10 = 230
    assert.equal(snapshot.summary.totalPlannedHours, 230)
    assert.equal(snapshot.summary.unassigned.totalTasks, 2)
    assert.equal(snapshot.summary.unassigned.plannedHours, 10)

    // 按 totalTasks 降序，alice 排前
    assert.equal(snapshot.byAssignee[0].displayName, 'Alice')
    assert.equal(snapshot.byAssignee[0].totalTasks, 3)
    assert.equal(snapshot.byAssignee[0].plannedHours, 180)
    assert.isTrue(snapshot.byAssignee[0].overloadHint)
    assert.equal(snapshot.byAssignee[1].totalTasks, 1)
    assert.isFalse(snapshot.byAssignee[1].overloadHint)

    // 未分配 warning + V2 资源模块提示均在
    assert.isTrue(warnings.some((w) => w.message.includes('未分配负责人')))
    assert.isTrue(warnings.some((w) => w.message.includes('资源分配')))
  })

  test('assigneeIds 过滤：仅返回指定人员', async ({ assert }) => {
    const { owner, org, project } = await setupProject()
    const bob = await createUser({ email: uniqueEmail('bob'), fullName: 'Bob' })
    await makeTask(Number(project.id), { assigneeId: Number(owner.id), estimatedHours: 10 })
    await makeTask(Number(project.id), { assigneeId: Number(bob.id), estimatedHours: 20 })

    const { ctx } = makeContext(project, org.id, new Date('2026-07-08T00:00:00Z'), {
      assigneeIds: [Number(bob.id)],
    })
    const snapshot = await new WorkloadAggregator().aggregate(ctx)

    assert.equal(snapshot.summary.totalAssignees, 1)
    assert.equal(snapshot.byAssignee[0].displayName, 'Bob')
  })
})

// ---------------- MilestoneAggregator ----------------

test.group('MilestoneAggregator', (group) => {
  useAuthDatabase(group)

  test('空项目：milestones=[]，落 info warning', async ({ assert }) => {
    const { org, project } = await setupProject()
    const { ctx, warnings } = makeContext(project, org.id, new Date('2026-07-08T00:00:00Z'))

    const snapshot = await new MilestoneAggregator().aggregate(ctx)

    assert.equal(snapshot.summary.totalMilestones, 0)
    assert.lengthOf(snapshot.milestones, 0)
    assert.isTrue(warnings.some((w) => w.message.includes('暂无里程碑')))
  })

  test('分类：achieved / overdue / upcoming / at_risk + 关联任务进度', async ({ assert }) => {
    const { org, project } = await setupProject()
    const now = new Date('2026-07-08T00:00:00Z')

    const achieved = await Milestone.create({
      projectId: Number(project.id),
      name: '已达成',
      status: 'achieved',
      plannedDate: DateTime.fromISO('2026-01-01'),
      autoCalculated: false,
      displayOrder: 0,
    })
    const overdue = await Milestone.create({
      projectId: Number(project.id),
      name: '已延期',
      status: 'planned',
      plannedDate: DateTime.fromISO('2026-06-01'), // 37 天前
      autoCalculated: false,
      displayOrder: 1,
    })
    const upcomingHalf = await Milestone.create({
      projectId: Number(project.id),
      name: '即将到期但进度不足',
      status: 'planned',
      plannedDate: DateTime.fromISO('2026-07-15'), // 7 天后（< 14 天）
      autoCalculated: false,
      displayOrder: 2,
    })
    const atRisk = await Milestone.create({
      projectId: Number(project.id),
      name: '风险',
      status: 'at_risk',
      plannedDate: DateTime.fromISO('2026-09-01'),
      autoCalculated: false,
      displayOrder: 3,
    })

    // 关联任务：upcomingHalf 挂 2 个，平均进度 40（不足 50 → 触发 risk）
    await makeTask(Number(project.id), {
      milestoneId: Number(upcomingHalf.id),
      status: 'in_progress',
      progressPercent: 40,
    })
    await makeTask(Number(project.id), {
      milestoneId: Number(upcomingHalf.id),
      status: 'in_progress',
      progressPercent: 40,
    })

    const { ctx } = makeContext(project, org.id, now)
    const snapshot = await new MilestoneAggregator().aggregate(ctx)

    assert.equal(snapshot.summary.totalMilestones, 4)
    assert.equal(snapshot.summary.completedMilestones, 1)
    assert.equal(snapshot.summary.overdueMilestones, 1)
    // 即将到期只统计未达成 & 未过期 & 在 14 天窗口内
    assert.equal(snapshot.summary.upcomingMilestones, 1)

    // 三条风险：atRisk 状态 + upcomingHalf 进度<50 + overdue 已过期未达成
    assert.equal(snapshot.risks.length, 3)
    const ids = snapshot.risks.map((r) => r.milestoneId).sort()
    assert.deepEqual(ids, [Number(overdue.id), Number(upcomingHalf.id), Number(atRisk.id)].sort())

    // achieved 里程碑的 overdueDays 应为 0（即便 planned 日期已过）
    const achievedEntry = snapshot.milestones.find((m) => m.milestoneId === Number(achieved.id))!
    assert.equal(achievedEntry.overdueDays, 0)
  })

  test('缺 planned_date：跳过并落 warning', async ({ assert }) => {
    const { org, project } = await setupProject()
    const badMilestone = await Milestone.create({
      projectId: Number(project.id),
      name: '无目标日期',
      status: 'planned',
      plannedDate: null,
      autoCalculated: false,
      displayOrder: 0,
    })

    const { ctx, warnings } = makeContext(project, org.id, new Date('2026-07-08T00:00:00Z'))
    const snapshot = await new MilestoneAggregator().aggregate(ctx)

    assert.lengthOf(snapshot.milestones, 0)
    assert.isTrue(
      warnings.some(
        (w) =>
          w.level === 'warning' &&
          w.context?.milestoneId === Number(badMilestone.id) &&
          w.message.includes('缺少目标日期'),
      ),
    )
  })
})
