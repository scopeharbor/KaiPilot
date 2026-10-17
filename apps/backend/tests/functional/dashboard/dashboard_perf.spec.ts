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
} from '../auth/_helpers.js'

const TASK_COUNT = 1000

function createDashboardService() {
  const innovationDashboard = {
    getSummary: async () => ({ summary: null, hasViewPermission: false }),
  } as unknown as InnovationDashboardAdapter

  return new ProjectDashboardService(new RiskWorkbenchService(), innovationDashboard)
}

test.group('Dashboard 聚合性能', (group) => {
  useAuthDatabase(group)

  test(`Dashboard 聚合 ${TASK_COUNT} 任务量级响应时间`, async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('perf-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    project.startDate = DateTime.fromISO('2026-01-01')
    project.endDate = DateTime.fromISO('2026-12-31')
    await project.save()

    const statuses = ['not_started', 'in_progress', 'completed', 'blocked', 'on_hold', 'cancelled']
    const tasks = []
    for (let i = 0; i < TASK_COUNT; i++) {
      tasks.push({
        projectId: project.id,
        name: `性能测试任务 ${i}`,
        status: statuses[i % statuses.length],
        taskType: 'task',
        priority: 'medium',
        startDate: DateTime.fromISO('2026-01-01'),
        endDate: DateTime.fromISO('2026-06-30'),
      })
    }
    await Task.createMany(tasks)

    const service = createDashboardService()
    const start = performance.now()
    const result = await service.get(org.id, project.id, owner.id)
    const elapsed = performance.now() - start

    assert.isBelow(
      elapsed,
      5000,
      `Dashboard 聚合 ${TASK_COUNT} 任务应 < 5s，实际 ${elapsed.toFixed(0)}ms`,
    )
    assert.strictEqual(result.metrics.length, 11)
    const taskTotal = result.metrics.find((m) => m.key === 'task_total')
    assert.strictEqual(taskTotal?.value, TASK_COUNT)
  })

  test('大量任务无 N+1 统计查询（单次聚合）', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('perf-nplus1') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    // 创建任务但不设 endDate（测试 overdue/soon-due 分支）
    const tasks = []
    for (let i = 0; i < TASK_COUNT; i++) {
      tasks.push({
        projectId: project.id,
        name: `N+1 测试任务 ${i}`,
        status: 'not_started',
        taskType: 'task',
        priority: 'medium',
      })
    }
    await Task.createMany(tasks)

    const service = createDashboardService()
    const start = performance.now()
    const result = await service.get(org.id, project.id, owner.id)
    const elapsed = performance.now() - start

    assert.isBelow(
      elapsed,
      5000,
      `无 endDate 聚合 ${TASK_COUNT} 任务应 < 5s，实际 ${elapsed.toFixed(0)}ms`,
    )
    assert.strictEqual(result.metrics.length, 11)
  })
})
