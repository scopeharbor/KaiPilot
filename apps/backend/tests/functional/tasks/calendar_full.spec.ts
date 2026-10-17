import Task from '#models/task'
import Milestone from '#models/milestone'
import type Organization from '#models/organization'
import type User from '#models/user'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function login(client: ApiClient, user: User) {
  const response = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return response.body().data.accessToken as string
}

async function setupProject(organization: Organization, owner: User) {
  const { project } = await createProjectWithMember(organization, owner, owner, 'project_manager')
  return project
}

function createTask(
  projectId: number,
  name: string,
  options: Partial<{
    status: string
    priority: string
    assigneeId: number | null
    startDate: DateTime | null
    endDate: DateTime | null
  }> = {},
) {
  return Task.create({
    projectId,
    name,
    status: options.status ?? 'not_started',
    priority: options.priority ?? 'medium',
    taskType: 'task',
    assigneeId: options.assigneeId ?? null,
    progressPercent: 0,
    startDate: options.startDate ?? null,
    endDate: options.endDate ?? null,
  })
}

function createMilestone(
  projectId: number,
  name: string,
  options: Partial<{
    status: string
    plannedDate: DateTime | null
  }> = {},
) {
  return Milestone.create({
    projectId,
    name,
    status: options.status ?? 'not_started',
    plannedDate: options.plannedDate ?? null,
    displayOrder: 1,
    autoCalculated: false,
  })
}

test.group('Calendar full view API', (group) => {
  useAuthDatabase(group)

  test('schedule mode returns task intervals within month window', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cal-full-month') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    // 跨度任务（区间相交）
    const spanning = await createTask(project.id, '跨度任务', {
      startDate: DateTime.fromISO('2026-07-28'),
      endDate: DateTime.fromISO('2026-08-03'),
    })
    // 窗口内任务
    const inRange = await createTask(project.id, '窗口内', {
      startDate: DateTime.fromISO('2026-07-10'),
      endDate: DateTime.fromISO('2026-07-20'),
    })
    // 窗口外任务
    await createTask(project.id, '窗口外', {
      startDate: DateTime.fromISO('2026-08-05'),
      endDate: DateTime.fromISO('2026-08-10'),
    })
    const token = await login(client, owner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/calendar?mode=schedule&view=month&anchorDate=2026-07-15`)
      .header('Authorization', `Bearer ${token}`)

    response.assertStatus(200)
    const ids = response.body().data.map((t: { sourceId: number }) => t.sourceId)
    assert.include(ids, spanning.id)
    assert.include(ids, inRange.id)
    assert.notInclude(ids, 0)
    assert.property(response.body(), 'workingCalendar')
    assert.property(response.body(), 'meta')
  })

  test('schedule mode includes milestones within window', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cal-full-milestone') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const inWindow = await createMilestone(project.id, '七月里程碑', {
      plannedDate: DateTime.fromISO('2026-07-20'),
    })
    await createMilestone(project.id, '八月里程碑', {
      plannedDate: DateTime.fromISO('2026-08-15'),
    })
    const token = await login(client, owner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/calendar?mode=schedule&view=month&anchorDate=2026-07-15`)
      .header('Authorization', `Bearer ${token}`)

    response.assertStatus(200)
    const items = response.body().data
    const milestones = items.filter((t: { kind: string }) => t.kind === 'milestone')
    assert.equal(milestones.length, 1)
    assert.equal(milestones[0].sourceId, inWindow.id)
  })

  test('schedule mode filters by itemTypes=milestone', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cal-full-itemtype') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    await createTask(project.id, '任务', {
      startDate: DateTime.fromISO('2026-07-10'),
      endDate: DateTime.fromISO('2026-07-20'),
    })
    await createMilestone(project.id, '里程碑', {
      plannedDate: DateTime.fromISO('2026-07-15'),
    })
    const token = await login(client, owner)

    const response = await client
      .get(
        `/api/v1/projects/${project.id}/calendar?mode=schedule&view=month&anchorDate=2026-07-15&itemTypes=milestone`,
      )
      .header('Authorization', `Bearer ${token}`)

    response.assertStatus(200)
    for (const item of response.body().data) {
      assert.equal(item.kind, 'milestone')
    }
  })

  test('schedule mode returns unscheduledCount in meta', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cal-full-unscheduled') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    await createTask(project.id, '无日期任务')
    await createTask(project.id, '有日期任务', {
      startDate: DateTime.fromISO('2026-07-10'),
      endDate: DateTime.fromISO('2026-07-20'),
    })
    const token = await login(client, owner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/calendar?mode=schedule&view=month&anchorDate=2026-07-15`)
      .header('Authorization', `Bearer ${token}`)

    response.assertStatus(200)
    assert.equal(response.body().meta.unscheduledCount, 1)
  })

  test('当月没有排期：meta 给出前后最近的排期日期', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cal-full-nearest') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    await createTask(project.id, '五月任务', {
      startDate: DateTime.fromISO('2026-05-04'),
      endDate: DateTime.fromISO('2026-05-08'),
    })
    await createTask(project.id, '九月任务', {
      startDate: DateTime.fromISO('2026-09-21'),
      endDate: DateTime.fromISO('2026-09-25'),
    })
    const token = await login(client, owner)

    const empty = await client
      .get(`/api/v1/projects/${project.id}/calendar?mode=schedule&view=month&anchorDate=2026-07-15`)
      .header('Authorization', `Bearer ${token}`)
    empty.assertStatus(200)
    assert.deepEqual(empty.body().meta.nearestScheduled, {
      before: '2026-05-08',
      after: '2026-09-21',
    })

    const busy = await client
      .get(`/api/v1/projects/${project.id}/calendar?mode=schedule&view=month&anchorDate=2026-09-15`)
      .header('Authorization', `Bearer ${token}`)
    assert.isUndefined(busy.body().meta.nearestScheduled)
  })

  test('跨月任务在前后两个窗口都可见', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cal-full-crossmonth') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const crossMonth = await createTask(project.id, '跨月', {
      startDate: DateTime.fromISO('2026-07-28'),
      endDate: DateTime.fromISO('2026-08-03'),
    })
    const token = await login(client, owner)

    // 7月窗口
    const r1 = await client
      .get(`/api/v1/projects/${project.id}/calendar?mode=schedule&view=month&anchorDate=2026-07-15`)
      .header('Authorization', `Bearer ${token}`)
    r1.assertStatus(200)
    assert.include(
      r1.body().data.map((t: { sourceId: number }) => t.sourceId),
      crossMonth.id,
    )

    // 8月窗口
    const r2 = await client
      .get(`/api/v1/projects/${project.id}/calendar?mode=schedule&view=month&anchorDate=2026-08-15`)
      .header('Authorization', `Bearer ${token}`)
    r2.assertStatus(200)
    assert.include(
      r2.body().data.map((t: { sourceId: number }) => t.sourceId),
      crossMonth.id,
    )
  })

  test('仅有截止日的任务在 schedule 模式显示为单点', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cal-full-deadline') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const deadlineOnly = await createTask(project.id, '仅截止日', {
      endDate: DateTime.fromISO('2026-07-15'),
    })
    const token = await login(client, owner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/calendar?mode=schedule&view=month&anchorDate=2026-07-15`)
      .header('Authorization', `Bearer ${token}`)

    response.assertStatus(200)
    const item = response
      .body()
      .data.find((t: { sourceId: number }) => t.sourceId === deadlineOnly.id)
    assert.isTrue(item?.dateRange?.missingStart)
  })

  test('稳定排序：日期、kind 和 ID', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cal-full-sort') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    await createMilestone(project.id, 'M1', { plannedDate: DateTime.fromISO('2026-07-15') })
    await createTask(project.id, 'T1', {
      startDate: DateTime.fromISO('2026-07-10'),
      endDate: DateTime.fromISO('2026-07-15'),
    })
    await createTask(project.id, 'T2', {
      startDate: DateTime.fromISO('2026-07-08'),
      endDate: DateTime.fromISO('2026-07-08'),
    })
    const token = await login(client, owner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/calendar?mode=schedule&view=month&anchorDate=2026-07-15`)
      .header('Authorization', `Bearer ${token}`)

    response.assertStatus(200)
    const items = response.body().data
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1]
      const curr = items[i]
      const prevDate = prev.dateRange.start ?? prev.dateRange.end ?? '9999-12-31'
      const currDate = curr.dateRange.start ?? curr.dateRange.end ?? '9999-12-31'
      if (prevDate < currDate) continue
      if (prevDate > currDate) assert.fail('日期顺序错误')
      // 同日期 task 先于 milestone
      if (prev.kind === 'task' && curr.kind === 'milestone') continue
      if (prev.kind === 'milestone' && curr.kind === 'task')
        assert.fail('排序：task 应优先于 milestone')
      // 同日期同类型按 sourceId
      assert.isAtMost(prev.sourceId, curr.sourceId)
    }
  })

  test('schedule mode 返回工作日历上下文', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cal-full-wc') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const token = await login(client, owner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/calendar?mode=schedule&view=month&anchorDate=2026-07-15`)
      .header('Authorization', `Bearer ${token}`)

    response.assertStatus(200)
    const wc = response.body().workingCalendar
    assert.isArray(wc.workdays)
    assert.isArray(wc.holidays)
    assert.isArray(wc.extraWorkdays)
  })

  test('跨组织隔离：schedule 模式拒绝其他组织', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('cal-full-org-owner') })
    const outsider = await createUser({ email: uniqueEmail('cal-full-org-out') })
    const organization = await createOrganization(owner)
    const outsiderOrg = await createOrganization(outsider)
    const project = await setupProject(organization, owner)
    await setupProject(outsiderOrg, outsider)
    await createTask(project.id, '私有任务', {
      startDate: DateTime.fromISO('2026-07-10'),
      endDate: DateTime.fromISO('2026-07-15'),
    })

    const outsiderToken = await login(client, outsider)
    const response = await client
      .get(`/api/v1/projects/${project.id}/calendar?mode=schedule&view=day&anchorDate=2026-07-15`)
      .header('Authorization', `Bearer ${outsiderToken}`)
    response.assertStatus(404)
  })

  test('requires authentication for schedule mode', async ({ client }) => {
    const response = await client.get(
      '/api/v1/projects/1/calendar?mode=schedule&view=day&anchorDate=2026-07-15',
    )
    response.assertStatus(401)
  })

  test('rejects too large window', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('cal-full-largewindow') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const token = await login(client, owner)

    const response = await client
      .get(
        `/api/v1/projects/${project.id}/calendar?mode=schedule&view=month&anchorDate=2026-07-15&dateFrom=2025-01-01&dateTo=2027-12-31`,
      )
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(422)
  })

  test('rejects invalid mode value', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('cal-full-invalidmode') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const token = await login(client, owner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/calendar?mode=invalid&view=month&anchorDate=2026-07-15`)
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(422)
  })
})
