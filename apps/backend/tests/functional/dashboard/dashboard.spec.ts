import Milestone from '#models/milestone'
import Task from '#models/task'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  STRONG_PASSWORD,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function login(client: any, user: any, organizationId?: number) {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  const accessToken = res.body().data.accessToken as string
  if (organizationId === undefined) return accessToken

  const refreshRes = await client.post('/api/v1/auth/refresh').json({
    refreshToken: res.body().data.refreshToken,
    organizationId,
  })
  return refreshRes.body().data.accessToken as string
}

test.group('Dashboard 指标对账 API', (group) => {
  useAuthDatabase(group)

  test('项目成员可读取 Dashboard 并返回 metrics/meta/warnings', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner, org.id)

    const res = await client
      .get(`/api/v1/projects/${project.id}/dashboard`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const body = res.body().data

    // stats 保留兼容
    assert.exists(body.stats)
    assert.exists(body.stats.healthStatus)

    // 新增 metrics/meta/warnings
    assert.isArray(body.metrics)
    assert.isNotEmpty(body.metrics)

    assert.exists(body.meta)
    assert.strictEqual(body.meta.metricVersion, 'project-dashboard.v1')
    assert.strictEqual(body.meta.projectId, project.id)
    assert.strictEqual(body.meta.organizationId, org.id)
    assert.exists(body.meta.calculatedAt)

    assert.isArray(body.warnings)

    // 指标包含关键 key
    const keys = body.metrics.map((m: any) => m.key)
    assert.include(keys, 'progress_percent')
    assert.include(keys, 'health_status')
    assert.include(keys, 'task_total')
    assert.include(keys, 'member_count')
    assert.include(keys, 'milestone_total')
    assert.include(keys, 'remaining_days')
    assert.include(keys, 'overdue_task_count')
    assert.include(keys, 'soon_due_task_count')
  })

  test('空任务/空里程碑返回 empty warning', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner, org.id)

    const res = await client
      .get(`/api/v1/projects/${project.id}/dashboard`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const body = res.body().data

    // task_total 应为 0
    const taskTotal = body.metrics.find((m: any) => m.key === 'task_total')
    assert.strictEqual(taskTotal.value, 0)
    assert.strictEqual(taskTotal.status, 'empty')

    // milestone_total 应为 0
    const milestoneTotal = body.metrics.find((m: any) => m.key === 'milestone_total')
    assert.strictEqual(milestoneTotal.value, 0)
    assert.strictEqual(milestoneTotal.status, 'empty')

    // 应有空数据 warning
    const warningCodes = body.warnings.map((w: any) => w.code)
    assert.include(warningCodes, 'TASK_METRIC_EMPTY')
    assert.include(warningCodes, 'MILESTONE_METRIC_EMPTY')
  })

  test('日期缺失返回 PROJECT_DATE_MISSING warning', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner, org.id)

    const res = await client
      .get(`/api/v1/projects/${project.id}/dashboard`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const body = res.body().data

    // remaining_days 应为 null（unavailable）
    const remainingDays = body.metrics.find((m: any) => m.key === 'remaining_days')
    assert.isNull(remainingDays.value)
    assert.strictEqual(remainingDays.status, 'unavailable')

    // 应有日期缺失 warning
    const warningCodes = body.warnings.map((w: any) => w.code)
    assert.include(warningCodes, 'PROJECT_DATE_MISSING')
  })

  test('逾期与即将到期任务正确统计', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner, org.id)

    const now = new Date()
    const yesterday = DateTime.fromJSDate(
      new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
    ).toFormat('yyyy-MM-dd')
    const inThreeDays = DateTime.fromJSDate(
      new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
    ).toFormat('yyyy-MM-dd')
    const inTenDays = DateTime.fromJSDate(
      new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
    ).toFormat('yyyy-MM-dd')

    // 创建逾期任务（已过期，非 completed/cancelled）
    await Task.create({
      projectId: project.id,
      name: '逾期任务',
      status: 'in_progress',
      startDate: DateTime.fromFormat(yesterday, 'yyyy-MM-dd'),
      endDate: DateTime.fromFormat(yesterday, 'yyyy-MM-dd'),
    })

    // 创建即将到期任务（3 天内）
    await Task.create({
      projectId: project.id,
      name: '即将到期任务',
      status: 'not_started',
      startDate: DateTime.fromFormat(yesterday, 'yyyy-MM-dd'),
      endDate: DateTime.fromFormat(inThreeDays, 'yyyy-MM-dd'),
    })

    // 创建正常任务（10 天后，不逾期也不即将到期）
    await Task.create({
      projectId: project.id,
      name: '正常任务',
      status: 'in_progress',
      startDate: DateTime.fromFormat(yesterday, 'yyyy-MM-dd'),
      endDate: DateTime.fromFormat(inTenDays, 'yyyy-MM-dd'),
    })

    // 创建已完成任务（不计入逾期）
    await Task.create({
      projectId: project.id,
      name: '已完成任务',
      status: 'completed',
      startDate: DateTime.fromFormat(yesterday, 'yyyy-MM-dd'),
      endDate: DateTime.fromFormat(yesterday, 'yyyy-MM-dd'),
    })

    const res = await client
      .get(`/api/v1/projects/${project.id}/dashboard`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const body = res.body().data

    const overdue = body.metrics.find((m: any) => m.key === 'overdue_task_count')
    assert.strictEqual(overdue.value, 1)

    const soonDue = body.metrics.find((m: any) => m.key === 'soon_due_task_count')
    assert.strictEqual(soonDue.value, 1)

    const taskTotal = body.metrics.find((m: any) => m.key === 'task_total')
    assert.strictEqual(taskTotal.value, 4) // 包括已完成
  })

  test('里程碑数据正确聚合', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner, org.id)

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

    const res = await client
      .get(`/api/v1/projects/${project.id}/dashboard`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const body = res.body().data

    const milestoneTotal = body.metrics.find((m: any) => m.key === 'milestone_total')
    assert.strictEqual(milestoneTotal.value, 2)
    assert.strictEqual(milestoneTotal.status, 'ok')

    const milestoneDist = body.metrics.find((m: any) => m.key === 'milestone_status_distribution')
    assert.strictEqual(milestoneDist.breakdown.planned, 1)
    assert.strictEqual(milestoneDist.breakdown.achieved, 1)

    // 无空数据 warning
    const warningCodes = body.warnings.map((w: any) => w.code)
    assert.notInclude(warningCodes, 'MILESTONE_METRIC_EMPTY')
  })

  test('非项目成员返回 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const other = await createUser({ email: uniqueEmail('other') })
    const org = await createOrganization(owner)
    await addOrgMember(org, other, 'member')
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, other, org.id)

    const res = await client
      .get(`/api/v1/projects/${project.id}/dashboard`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(403)
  })

  test('跨组织访问返回 404', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const otherOrgOwner = await createUser({ email: uniqueEmail('org2owner') })
    const org = await createOrganization(owner)
    const org2 = await createOrganization(otherOrgOwner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, otherOrgOwner, org2.id)

    const res = await client
      .get(`/api/v1/projects/${project.id}/dashboard`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(404)
  })
})
