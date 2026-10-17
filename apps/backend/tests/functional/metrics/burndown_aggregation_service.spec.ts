/**
 * v3-chart-gallery-data-foundation —— W4.4 BurndownAggregationService 功能测试。
 *
 * 确定性场景（手工核算）：
 * - 项目窗口 2026-07-01..07-10；T1 8h 审计完成于 07-05；T2 16h 进行中；
 *   T3 24h 于 07-04 中途新增（范围蔓延）；T4 12h 在窗口前已完工。
 * - 断言理想线线性递减、剩余任务/工时曲线下降、范围基线 07-04 阶跃、
 *   燃起（completed）曲线 07-05 阶跃、软删除任务退出范围、周粒度与跨组织 404。
 */
import AuditLog from '#models/audit_log'
import Task from '#models/task'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import BurndownAggregationService from '#services/burndown_aggregation_service'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

test.group('BurndownAggregationService', (group) => {
  useAuthDatabase(group)

  let burndownSvc: BurndownAggregationService
  group.each.setup(() => {
    burndownSvc = new BurndownAggregationService()
  })

  async function setupProject(dates?: { start: string; end: string }) {
    const owner = await createUser({ email: uniqueEmail('burn-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'Project Manager')
    if (dates) {
      project.startDate = DateTime.fromISO(dates.start)
      project.endDate = DateTime.fromISO(dates.end)
      await project.save()
    }
    return { owner, org, project }
  }

  async function createTask(
    projectId: number,
    input: {
      name: string
      status: string
      estimatedHours?: number
      createdAt: string
      actualEnd?: string
    },
  ) {
    return Task.create({
      projectId,
      name: input.name,
      status: input.status,
      estimatedHours: input.estimatedHours ?? 0,
      createdAt: DateTime.fromISO(input.createdAt),
      ...(input.actualEnd ? { actualEndDate: DateTime.fromISO(input.actualEnd) } : {}),
    })
  }

  /** 主场景任务种子（返回 taskId 便于审计事件落库）。 */
  async function seedTasks(projectId: number) {
    const t1 = await createTask(projectId, {
      name: 'T1 已完工',
      status: 'completed',
      estimatedHours: 8,
      createdAt: '2026-07-01T09:00:00',
      actualEnd: '2026-07-05',
    })
    const t2 = await createTask(projectId, {
      name: 'T2 进行中',
      status: 'in_progress',
      estimatedHours: 16,
      createdAt: '2026-07-01T10:00:00',
    })
    const t3 = await createTask(projectId, {
      name: 'T3 中途新增',
      status: 'not_started',
      estimatedHours: 24,
      createdAt: '2026-07-04T09:00:00',
    })
    const t4 = await createTask(projectId, {
      name: 'T4 窗口前完工',
      status: 'completed',
      estimatedHours: 12,
      createdAt: '2026-06-25T09:00:00',
      actualEnd: '2026-06-28',
    })
    return { t1, t2, t3, t4 }
  }

  async function logStatusChange(
    organizationId: number,
    projectId: number,
    taskId: number,
    at: string,
    from: string,
    to: string,
  ) {
    await AuditLog.create({
      action: 'update',
      severity: 'info',
      organizationId,
      projectId,
      entityType: 'task',
      entityId: taskId,
      createdAt: DateTime.fromISO(at),
      updatedAt: DateTime.fromISO(at),
      metadata: { event: 'TASK_STATUS_CHANGED', from, to },
    })
  }

  test('日粒度主场景：理想线递减、剩余下降、范围 07-04 阶跃、燃起 07-05 阶跃', async ({
    assert,
  }) => {
    const { org, project } = await setupProject({ start: '2026-07-01', end: '2026-07-10' })
    const { t1, t4 } = await seedTasks(project.id)
    await logStatusChange(
      org.id,
      project.id,
      t4.id,
      '2026-06-28T10:00:00',
      'in_progress',
      'completed',
    )
    await logStatusChange(
      org.id,
      project.id,
      t1.id,
      '2026-07-05T10:00:00',
      'in_progress',
      'completed',
    )

    const result = await burndownSvc.getBurndown(org.id, project.id, {
      granularity: 'day',
      metric: 'task',
    })

    assert.equal(result.granularity, 'day')
    assert.equal(result.metric, 'task')
    assert.equal(result.startDate, '2026-07-01')
    assert.equal(result.endDate, '2026-07-10')
    assert.equal(result.points.length, 10) // 07-01..07-10 每日共 10 天
    assert.equal(result.initialScopeTasks, 3)
    assert.equal(result.initialScopeHours, 36)

    const byDate = new Map(result.points.map((p) => [p.date, p]))

    // 07-01：T1/T2/T4 在范围；T4 已完成 → 剩余 2
    const d1 = byDate.get('2026-07-01')!
    assert.equal(d1.idealRemaining, 3)
    assert.equal(d1.totalScopeTasks, 3)
    assert.equal(d1.completedTasks, 1)
    assert.equal(d1.remainingTasks, 2)
    assert.equal(d1.totalScopeHours, 36)
    assert.equal(d1.completedHours, 12)
    assert.equal(d1.remainingHours, 24)

    // 理想线：07-05 = 3 × (1 - 4/9) = 1.67；终点 07-10 = 0
    const d5 = byDate.get('2026-07-05')!
    assert.equal(d5.idealRemaining, 1.67)
    const dEnd = byDate.get('2026-07-10')!
    assert.equal(dEnd.idealRemaining, 0)

    // 07-03：T3 尚未创建 → 范围 3
    const d3 = byDate.get('2026-07-03')!
    assert.equal(d3.totalScopeTasks, 3)
    assert.equal(d3.remainingTasks, 2)

    // 07-04：T3 新增 → 范围阶跃到 4、剩余上抬到 3（范围蔓延）
    const d4 = byDate.get('2026-07-04')!
    assert.equal(d4.totalScopeTasks, 4)
    assert.equal(d4.totalScopeHours, 60)
    assert.equal(d4.remainingTasks, 3)
    assert.equal(d4.remainingHours, 48)

    // 07-05：T1 审计完成 → 燃起阶跃 2/4；剩余回落 2
    assert.equal(d5.completedTasks, 2)
    assert.equal(d5.completedHours, 20)
    assert.equal(d5.remainingTasks, 2)
    assert.equal(d5.remainingHours, 40)

    // 终点守恒：totalScope 4 / completed 2 / remaining 2
    assert.equal(dEnd.totalScopeTasks, 4)
    assert.equal(dEnd.completedTasks, 2)
    assert.equal(dEnd.remainingTasks, 2)
    assert.equal(dEnd.remainingHours, 40)

    // 连续性：date 升序且无重复
    const dates = result.points.map((p) => p.date)
    assert.deepEqual(dates, [...dates].sort())
    assert.equal(new Set(dates).size, dates.length)
  })

  test('hour 口径：ideal 按初始工时缩放、remainingHours 同步', async ({ assert }) => {
    const { org, project } = await setupProject({ start: '2026-07-01', end: '2026-07-10' })
    const { t1, t4 } = await seedTasks(project.id)
    await logStatusChange(
      org.id,
      project.id,
      t4.id,
      '2026-06-28T10:00:00',
      'in_progress',
      'completed',
    )
    await logStatusChange(
      org.id,
      project.id,
      t1.id,
      '2026-07-05T10:00:00',
      'in_progress',
      'completed',
    )

    const result = await burndownSvc.getBurndown(org.id, project.id, {
      granularity: 'day',
      metric: 'hour',
    })

    assert.equal(result.metric, 'hour')
    assert.equal(result.initialScopeHours, 36)
    const byDate = new Map(result.points.map((p) => [p.date, p]))

    const d1 = byDate.get('2026-07-01')!
    assert.equal(d1.idealRemaining, 36) // 36 × (1-0)
    const d5 = byDate.get('2026-07-05')!
    assert.equal(d5.idealRemaining, 20) // 36 × 5/9 = 20
    const dEnd = byDate.get('2026-07-10')!
    assert.equal(dEnd.idealRemaining, 0)
  })

  test('无审计流回退：completed 任务按 actual_end_date 完成时点计算', async ({ assert }) => {
    const { org, project } = await setupProject({ start: '2026-07-01', end: '2026-07-06' })
    await createTask(project.id, {
      name: '直接完成',
      status: 'completed',
      estimatedHours: 10,
      createdAt: '2026-07-01T09:00:00',
      actualEnd: '2026-07-03',
    })
    await createTask(project.id, {
      name: '仍在进行',
      status: 'in_progress',
      estimatedHours: 10,
      createdAt: '2026-07-01T09:00:00',
    })

    const result = await burndownSvc.getBurndown(org.id, project.id, { metric: 'task' })
    const byDate = new Map(result.points.map((p) => [p.date, p]))

    assert.equal(byDate.get('2026-07-02')!.completedTasks, 0)
    assert.equal(byDate.get('2026-07-03')!.completedTasks, 1)
    assert.equal(byDate.get('2026-07-03')!.remainingTasks, 1)
    assert.equal(byDate.get('2026-07-06')!.remainingTasks, 1)
  })

  test('范围蔓延与软删除：删除任务退出范围、燃起曲线不回落、剩余不下穿 0', async ({ assert }) => {
    const { org, project } = await setupProject({ start: '2026-07-01', end: '2026-07-10' })
    const a = await createTask(project.id, {
      name: 'A 进行中',
      status: 'in_progress',
      estimatedHours: 10,
      createdAt: '2026-07-01T09:00:00',
    })
    const b = await createTask(project.id, {
      name: 'B 完成',
      status: 'completed',
      estimatedHours: 20,
      createdAt: '2026-07-05T09:00:00',
      actualEnd: '2026-07-07',
    })
    await logStatusChange(
      org.id,
      project.id,
      b.id,
      '2026-07-07T09:00:00',
      'in_progress',
      'completed',
    )
    // 07-08 软删除已完工任务 B
    b.deletedAt = DateTime.fromISO('2026-07-08T09:00:00')
    await b.save()
    void a

    const result = await burndownSvc.getBurndown(org.id, project.id, { metric: 'task' })
    const byDate = new Map(result.points.map((p) => [p.date, p]))

    // B 加入范围
    assert.equal(byDate.get('2026-07-05')!.totalScopeTasks, 2)
    // B 完成（07-07）：completed 2
    assert.equal(byDate.get('2026-07-07')!.completedTasks, 1)
    // B 删除（07-08）：范围回落 1，但 completed 保持（燃起不回落），剩余钳制 0
    const d8 = byDate.get('2026-07-08')!
    assert.equal(d8.totalScopeTasks, 1)
    assert.equal(d8.completedTasks, 1)
    assert.equal(d8.remainingTasks, 0)
    const dEnd = byDate.get('2026-07-10')!
    assert.equal(dEnd.totalScopeTasks, 1)
    assert.equal(dEnd.completedTasks, 1)
    assert.equal(dEnd.remainingTasks, 0)
  })

  test('week 粒度：7 天步进锚定起点并收尾对齐窗口终点', async ({ assert }) => {
    const { org, project } = await setupProject()

    const result = await burndownSvc.getBurndown(org.id, project.id, {
      granularity: 'week',
      startDate: '2026-07-01',
      endDate: '2026-08-31',
    })

    assert.equal(result.points[0].date, '2026-07-01')
    assert.equal(result.points[1].date, '2026-07-08')
    assert.equal(result.points[result.points.length - 1].date, '2026-08-31')
    assert.isAtMost(result.points.length, 150)
  })

  test('空项目（无日期无任务）：返回空点阵；显式窗口则零值序列', async ({ assert }) => {
    const { org, project } = await setupProject()

    const empty = await burndownSvc.getBurndown(org.id, project.id)
    assert.equal(empty.points.length, 0)
    assert.equal(empty.startDate, '')
    assert.equal(empty.endDate, '')

    const explicit = await burndownSvc.getBurndown(org.id, project.id, {
      startDate: '2026-07-01',
      endDate: '2026-07-03',
    })
    assert.equal(explicit.points.length, 3)
    for (const point of explicit.points) {
      assert.equal(point.idealRemaining, 0)
      assert.equal(point.remainingTasks, 0)
      assert.equal(point.totalScopeTasks, 0)
      assert.equal(point.completedTasks, 0)
    }
  })

  test('跨组织访问返回 404（ResourceNotFoundException）', async ({ assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('burn-owner-a') })
    const orgA = await createOrganization(ownerA)
    const { project } = await createProjectWithMember(orgA, ownerA, ownerA, 'Project Manager')
    project.startDate = DateTime.fromISO('2026-07-01')
    project.endDate = DateTime.fromISO('2026-07-10')
    await project.save()
    await seedTasks(project.id)

    const userB = await createUser({ email: uniqueEmail('burn-user-b') })
    const orgB = await createOrganization(userB)

    let caught: unknown
    try {
      await burndownSvc.getBurndown(orgB.id, project.id)
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ResourceNotFoundException)
  })
})
