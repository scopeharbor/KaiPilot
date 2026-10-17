import Milestone from '#models/milestone'
import Task from '#models/task'
import { ProjectRoleName } from '#rbac'
import ProjectDashboardService from '#services/project_dashboard_service'
import RiskWorkbenchService from '#services/risk_workbench_service'
import type InnovationDashboardAdapter from '#services/triz_innovation/innovation_dashboard_adapter'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

const DASHBOARD_METRIC_KEYS = {
  PROGRESS_PERCENT: 'progress_percent',
  HEALTH_STATUS: 'health_status',
  TASK_STATUS_DISTRIBUTION: 'task_status_distribution',
  TASK_TOTAL: 'task_total',
  OVERDUE_TASK_COUNT: 'overdue_task_count',
  SOON_DUE_TASK_COUNT: 'soon_due_task_count',
  MEMBER_COUNT: 'member_count',
  MILESTONE_STATUS_DISTRIBUTION: 'milestone_status_distribution',
  MILESTONE_TOTAL: 'milestone_total',
  REMAINING_DAYS: 'remaining_days',
  RECENT_ACTIVITY_SUMMARY: 'recent_activity_summary',
} as const

function createDashboardService() {
  const innovationDashboard = {
    getSummary: async () => ({ summary: null, hasViewPermission: false }),
  } as unknown as InnovationDashboardAdapter

  return new ProjectDashboardService(new RiskWorkbenchService(), innovationDashboard)
}

test.group('ProjectDashboardService', (group) => {
  useAuthDatabase(group)

  async function setup(withDates = false) {
    const owner = await createUser({ email: uniqueEmail('dash-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    if (withDates) {
      project.startDate = DateTime.fromISO('2026-01-01')
      project.endDate = DateTime.fromISO('2026-12-31')
      await project.save()
    }
    return {
      owner,
      org,
      project,
      service: createDashboardService(),
    }
  }

  test('正常聚合：任务+里程碑数据正确返回', async ({ assert }) => {
    const { owner, org, project, service } = await setup(true)

    await Task.create({
      projectId: project.id,
      name: '任务1',
      status: 'in_progress',
      taskType: 'task',
      priority: 'medium',
      endDate: DateTime.fromISO('2026-06-01'),
    })
    await Task.create({
      projectId: project.id,
      name: '任务2',
      status: 'completed',
      taskType: 'task',
      priority: 'medium',
    })
    await Milestone.create({
      projectId: project.id,
      name: '里程碑1',
      status: 'planned',
    })

    const result = await service.get(org.id, project.id, owner.id)

    assert.exists(result.stats)
    assert.exists(result.meta)
    assert.isArray(result.metrics)
    assert.isArray(result.warnings)

    assert.strictEqual(result.meta.metricVersion, 'project-dashboard.v1')
    assert.strictEqual(result.meta.projectId, project.id)
    assert.strictEqual(result.meta.organizationId, org.id)

    const taskTotal = result.metrics.find((m) => m.key === DASHBOARD_METRIC_KEYS.TASK_TOTAL)
    assert.strictEqual(taskTotal?.value, 2)

    const milestoneTotal = result.metrics.find(
      (m) => m.key === DASHBOARD_METRIC_KEYS.MILESTONE_TOTAL,
    )
    assert.strictEqual(milestoneTotal?.value, 1)

    const memberCount = result.metrics.find((m) => m.key === DASHBOARD_METRIC_KEYS.MEMBER_COUNT)
    assert.strictEqual(memberCount?.value, 1)

    const remainingDays = result.metrics.find((m) => m.key === DASHBOARD_METRIC_KEYS.REMAINING_DAYS)
    assert.isNotNull(remainingDays?.value)
    assert.strictEqual(remainingDays?.status, 'ok')
  })

  test('空任务/空里程碑返回 status=empty 和对应 warning', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const result = await service.get(org.id, project.id, owner.id)

    const taskTotal = result.metrics.find((m) => m.key === DASHBOARD_METRIC_KEYS.TASK_TOTAL)
    assert.strictEqual(taskTotal?.value, 0)
    assert.strictEqual(taskTotal?.status, 'empty')

    const milestoneTotal = result.metrics.find(
      (m) => m.key === DASHBOARD_METRIC_KEYS.MILESTONE_TOTAL,
    )
    assert.strictEqual(milestoneTotal?.value, 0)
    assert.strictEqual(milestoneTotal?.status, 'empty')

    const warningCodes = result.warnings.map((w) => w.code)
    assert.include(warningCodes, 'TASK_METRIC_EMPTY')
    assert.include(warningCodes, 'MILESTONE_METRIC_EMPTY')
  })

  test('日期缺失返回 remaining_days=null 与 PROJECT_DATE_MISSING warning', async ({ assert }) => {
    const { owner, org, project, service } = await setup(false)

    const result = await service.get(org.id, project.id, owner.id)

    const remainingDays = result.metrics.find((m) => m.key === DASHBOARD_METRIC_KEYS.REMAINING_DAYS)
    assert.isNull(remainingDays?.value)
    assert.strictEqual(remainingDays?.status, 'unavailable')

    const warningCodes = result.warnings.map((w) => w.code)
    assert.include(warningCodes, 'PROJECT_DATE_MISSING')
  })

  test('逾期与即将到期任务正确统计', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const now = new Date()
    const yesterday = DateTime.fromJSDate(new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000))
    const inThreeDays = DateTime.fromJSDate(new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000))
    const inTenDays = DateTime.fromJSDate(new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000))

    await Task.create({
      projectId: project.id,
      name: '逾期任务',
      status: 'in_progress',
      taskType: 'task',
      priority: 'medium',
      endDate: yesterday,
    })
    await Task.create({
      projectId: project.id,
      name: '即将到期任务',
      status: 'not_started',
      taskType: 'task',
      priority: 'medium',
      endDate: inThreeDays,
    })
    await Task.create({
      projectId: project.id,
      name: '正常任务',
      status: 'in_progress',
      taskType: 'task',
      priority: 'medium',
      endDate: inTenDays,
    })
    await Task.create({
      projectId: project.id,
      name: '已完成任务',
      status: 'completed',
      taskType: 'task',
      priority: 'medium',
      endDate: yesterday,
    })

    const result = await service.get(org.id, project.id, owner.id)

    const overdue = result.metrics.find((m) => m.key === DASHBOARD_METRIC_KEYS.OVERDUE_TASK_COUNT)
    assert.strictEqual(overdue?.value, 1)

    const soonDue = result.metrics.find((m) => m.key === DASHBOARD_METRIC_KEYS.SOON_DUE_TASK_COUNT)
    assert.strictEqual(soonDue?.value, 1)

    const taskTotal = result.metrics.find((m) => m.key === DASHBOARD_METRIC_KEYS.TASK_TOTAL)
    assert.strictEqual(taskTotal?.value, 4)
  })

  test('无 endDate 的任务不计入逾期', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    await Task.create({
      projectId: project.id,
      name: '无截止日任务',
      status: 'in_progress',
      taskType: 'task',
      priority: 'medium',
    })

    const result = await service.get(org.id, project.id, owner.id)

    const overdue = result.metrics.find((m) => m.key === DASHBOARD_METRIC_KEYS.OVERDUE_TASK_COUNT)
    assert.strictEqual(overdue?.value, 0)

    const soonDue = result.metrics.find((m) => m.key === DASHBOARD_METRIC_KEYS.SOON_DUE_TASK_COUNT)
    assert.strictEqual(soonDue?.value, 0)
  })

  test('跨组织查询抛 ResourceNotFoundException', async ({ assert }) => {
    const { project, service } = await setup()
    const otherOwner = await createUser({ email: uniqueEmail('other-org-owner') })
    const otherOrg = await createOrganization(otherOwner)

    await assert.rejects(() => service.get(otherOrg.id, project.id, otherOwner.id), /项目不存在/)
  })

  test('里程碑数据正确聚合', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    await Milestone.create({
      projectId: project.id,
      name: '里程碑1',
      status: 'planned',
    })
    await Milestone.create({
      projectId: project.id,
      name: '里程碑2',
      status: 'achieved',
    })

    const result = await service.get(org.id, project.id, owner.id)

    const milestoneTotal = result.metrics.find(
      (m) => m.key === DASHBOARD_METRIC_KEYS.MILESTONE_TOTAL,
    )
    assert.strictEqual(milestoneTotal?.value, 2)
    assert.strictEqual(milestoneTotal?.status, 'ok')

    const milestoneDist = result.metrics.find(
      (m) => m.key === DASHBOARD_METRIC_KEYS.MILESTONE_STATUS_DISTRIBUTION,
    )
    assert.strictEqual(milestoneDist?.breakdown?.planned, 1)
    assert.strictEqual(milestoneDist?.breakdown?.achieved, 1)

    const warningCodes = result.warnings.map((w) => w.code)
    assert.notInclude(warningCodes, 'MILESTONE_METRIC_EMPTY')
  })

  test('任务状态分布正确统计', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    await Task.create({
      projectId: project.id,
      name: '未开始',
      status: 'not_started',
      taskType: 'task',
      priority: 'medium',
    })
    await Task.create({
      projectId: project.id,
      name: '进行中',
      status: 'in_progress',
      taskType: 'task',
      priority: 'medium',
    })
    await Task.create({
      projectId: project.id,
      name: '已完成',
      status: 'completed',
      taskType: 'task',
      priority: 'medium',
    })

    const result = await service.get(org.id, project.id, owner.id)

    const taskDist = result.metrics.find(
      (m) => m.key === DASHBOARD_METRIC_KEYS.TASK_STATUS_DISTRIBUTION,
    )
    assert.strictEqual(taskDist?.breakdown?.not_started, 1)
    assert.strictEqual(taskDist?.breakdown?.in_progress, 1)
    assert.strictEqual(taskDist?.breakdown?.completed, 1)
    assert.strictEqual(taskDist?.breakdown?.blocked, 0)
  })
})
