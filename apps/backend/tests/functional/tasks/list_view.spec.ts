import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import Task from '#models/task'
import type Organization from '#models/organization'
import type User from '#models/user'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import {
  STRONG_PASSWORD,
  addOrgMember,
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

async function setupProject(organization: Organization, owner: User, extraMembers: User[] = []) {
  const { project } = await createProjectWithMember(
    organization,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  for (const user of extraMembers) {
    await addOrgMember(organization, user, 'member')
    const role = await ProjectRole.create({
      projectId: project.id,
      name: `member-${user.id}`,
      description: '列表测试成员',
      permissions: [],
      isSystem: false,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: user.id,
      projectRoleId: role.id,
      isActive: true,
    })
  }
  return project
}

function createTask(
  projectId: number,
  name: string,
  options: Partial<{
    status: string
    priority: string
    assigneeId: number | null
    progressPercent: number
    endDate: DateTime | null
    estimatedHours: number | null
    actualHours: number | null
    deletedAt: DateTime | null
  }> = {},
) {
  return Task.create({
    projectId,
    name,
    status: options.status ?? 'not_started',
    priority: options.priority ?? 'medium',
    taskType: 'task',
    assigneeId: options.assigneeId ?? null,
    progressPercent: options.progressPercent ?? 0,
    endDate: options.endDate ?? null,
    estimatedHours: options.estimatedHours ?? null,
    actualHours: options.actualHours ?? null,
    deletedAt: options.deletedAt ?? null,
  })
}

test.group('Task list view API', (group) => {
  useAuthDatabase(group)

  test('returns only active project tasks with assignee and stable pagination', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('list-owner') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const otherProject = await setupProject(organization, owner)
    const first = await createTask(project.id, '同名任务')
    const second = await createTask(project.id, '同名任务', { assigneeId: owner.id })
    await createTask(project.id, '已删除任务', { deletedAt: DateTime.now() })
    await createTask(otherProject.id, '其他项目任务')
    const token = await login(client, owner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/list?sort=%2Bname&page=1&perPage=1`)
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)
    assert.deepEqual(
      response.body().data.map((task: { id: number }) => task.id),
      [first.id],
    )
    assert.deepInclude(response.body().meta, {
      total: 2,
      page: 1,
      perPage: 1,
      totalPages: 2,
    })

    const next = await client
      .get(`/api/v1/projects/${project.id}/list?sort=%2Bname&page=2&perPage=1`)
      .header('Authorization', `Bearer ${token}`)
    next.assertStatus(200)
    assert.equal(next.body().data[0].id, second.id)
    assert.equal(next.body().data[0].assignee.id, owner.id)
  })

  test('combines multi-value filters, id search and due-date range', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('list-filter') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const match = await createTask(project.id, '发布检查', {
      status: 'in_progress',
      priority: 'high',
      assigneeId: owner.id,
      endDate: DateTime.fromISO('2026-07-10'),
    })
    await createTask(project.id, '范围外任务', {
      status: 'completed',
      priority: 'low',
      endDate: DateTime.fromISO('2026-08-01'),
    })
    const token = await login(client, owner)

    const response = await client
      .get(
        `/api/v1/projects/${project.id}/list?search=${match.id}&status=not_started,in_progress&priority=high,highest&assigneeId=${owner.id},999999&dateFrom=2026-07-01&dateTo=2026-07-31`,
      )
      .header('Authorization', `Bearer ${token}`)
    assert.equal(response.status(), 200, JSON.stringify(response.body()))
    assert.deepEqual(
      response.body().data.map((task: { id: number }) => task.id),
      [match.id],
    )
  })

  test('applies business enum order, multi-sort and nulls-last ordering', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('list-sort') })
    const assignee = await createUser({
      email: uniqueEmail('list-assignee'),
      fullName: '甲成员',
    })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner, [assignee])
    await createTask(project.id, '中优先乙', { priority: 'medium' })
    await createTask(project.id, '高优先', {
      priority: 'high',
      assigneeId: assignee.id,
    })
    await createTask(project.id, '中优先甲', { priority: 'medium', assigneeId: owner.id })
    const token = await login(client, owner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/list?sort=%2Bpriority,%2Bname`)
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)
    assert.deepEqual(
      response.body().data.map((task: { name: string }) => task.name),
      ['中优先乙', '中优先甲', '高优先'],
    )

    const assigneeSort = await client
      .get(`/api/v1/projects/${project.id}/list?sort=%2Bassignee`)
      .header('Authorization', `Bearer ${token}`)
    assigneeSort.assertStatus(200)
    assert.isNull(assigneeSort.body().data.at(-1).assigneeId)
  })

  test('groups by status over the full filtered result and returns sums', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('list-group') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    await createTask(project.id, 'a1', {
      status: 'in_progress',
      progressPercent: 20,
      estimatedHours: 2,
      actualHours: 1,
    })
    await createTask(project.id, 'a2', {
      status: 'in_progress',
      progressPercent: 40,
      estimatedHours: 3,
    })
    await createTask(project.id, 'a3', {
      status: 'in_progress',
      progressPercent: 60,
      actualHours: 0.5,
    })
    await createTask(project.id, 'b', { status: 'not_started', estimatedHours: 5 })
    await createTask(project.id, 'c', {
      status: 'completed',
      progressPercent: 100,
      estimatedHours: 1.5,
      actualHours: 1,
    })
    await createTask(project.id, '已删除', {
      status: 'in_progress',
      estimatedHours: 100,
      deletedAt: DateTime.now(),
    })
    const token = await login(client, owner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/list?groupBy=status&sums=1&sort=-name&perPage=2`)
      .header('Authorization', `Bearer ${token}`)
    assert.equal(response.status(), 200, JSON.stringify(response.body()))
    // 分组字段成为首要排序（状态流程顺序），组内再按用户排序（名称倒序）
    assert.deepEqual(
      response.body().data.map((task: { name: string }) => task.name),
      ['b', 'a3'],
    )
    const meta = response.body().meta
    assert.equal(meta.total, 5)
    assert.deepEqual(meta.groups, [
      { key: 'not_started', count: 1, estimatedHours: 5, actualHours: 0 },
      { key: 'in_progress', count: 3, estimatedHours: 5, actualHours: 1.5 },
      { key: 'completed', count: 1, estimatedHours: 1.5, actualHours: 1 },
    ])
    assert.deepEqual(meta.sums, {
      count: 5,
      estimatedHours: 11.5,
      actualHours: 2.5,
      progressPercent: 44,
    })

    const filtered = await client
      .get(`/api/v1/projects/${project.id}/list?groupBy=status&sums=true&status=in_progress`)
      .header('Authorization', `Bearer ${token}`)
    filtered.assertStatus(200)
    assert.deepEqual(filtered.body().meta.groups, [
      { key: 'in_progress', count: 3, estimatedHours: 5, actualHours: 1.5 },
    ])
    assert.equal(filtered.body().meta.sums.count, 3)

    const plain = await client
      .get(`/api/v1/projects/${project.id}/list`)
      .header('Authorization', `Bearer ${token}`)
    plain.assertStatus(200)
    assert.notProperty(plain.body().meta, 'groups')
    assert.notProperty(plain.body().meta, 'sums')
  })

  test('groups by assignee with the unassigned group last', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('list-group-owner'), fullName: '乙负责人' })
    const assignee = await createUser({
      email: uniqueEmail('list-group-assignee'),
      fullName: 'A 成员',
    })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner, [assignee])
    await createTask(project.id, '未分配任务')
    await createTask(project.id, '成员任务一', { assigneeId: assignee.id })
    await createTask(project.id, '成员任务二', { assigneeId: assignee.id })
    const token = await login(client, owner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/list?groupBy=assignee`)
      .header('Authorization', `Bearer ${token}`)
    assert.equal(response.status(), 200, JSON.stringify(response.body()))
    assert.deepEqual(
      response
        .body()
        .meta.groups.map((summary: { key: number | null; count: number }) => [
          summary.key,
          summary.count,
        ]),
      [
        [assignee.id, 2],
        [null, 1],
      ],
    )
    assert.isNull(response.body().data.at(-1).assigneeId)
  })

  test('rejects invalid filters, dates, sort fields and oversized pages', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('list-validation') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const token = await login(client, owner)
    const invalidQueries = [
      'status=unknown',
      'sort=+name,+priority,+status,+createdAt',
      'sort=+deletedAt',
      'dateFrom=2026-99-99',
      'dateFrom=2026-08-01&dateTo=2026-07-01',
      'perPage=101',
      'groupBy=name',
      'sums=maybe',
    ]

    for (const query of invalidQueries) {
      const response = await client
        .get(`/api/v1/projects/${project.id}/list?${query}`)
        .header('Authorization', `Bearer ${token}`)
      response.assertStatus(422)
    }
  })

  test('requires authentication and conceals projects across organizations', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('list-private-owner') })
    const outsider = await createUser({ email: uniqueEmail('list-private-outsider') })
    const organization = await createOrganization(owner)
    const outsiderOrganization = await createOrganization(outsider)
    const project = await setupProject(organization, owner)
    await setupProject(outsiderOrganization, outsider)
    await createTask(project.id, '私有任务')

    const unauthenticated = await client.get(`/api/v1/projects/${project.id}/list`)
    unauthenticated.assertStatus(401)

    const outsiderToken = await login(client, outsider)
    const forbidden = await client
      .get(`/api/v1/projects/${project.id}/list`)
      .header('Authorization', `Bearer ${outsiderToken}`)
    forbidden.assertStatus(404)

    const forbiddenSummary = await client
      .get(`/api/v1/projects/${project.id}/list?groupBy=status&sums=1`)
      .header('Authorization', `Bearer ${outsiderToken}`)
    forbiddenSummary.assertStatus(404)
    assert.notProperty(forbiddenSummary.body(), 'meta')
  })
})
