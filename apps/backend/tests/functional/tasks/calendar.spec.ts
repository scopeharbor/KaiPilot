import Task from '#models/task'
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
    endDate: DateTime | null
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
    progressPercent: 0,
    endDate: options.endDate ?? null,
    deletedAt: options.deletedAt ?? null,
  })
}

test.group('Task calendar API', (group) => {
  useAuthDatabase(group)

  test('returns tasks within month window filtered by end_date', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cal-month') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const inRange = await createTask(project.id, '七月任务', {
      endDate: DateTime.fromISO('2026-07-15'),
    })
    await createTask(project.id, '八月任务', {
      endDate: DateTime.fromISO('2026-08-05'),
    })
    await createTask(project.id, '无截止日')
    const token = await login(client, owner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/calendar?view=month&anchorDate=2026-07-15`)
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)
    const ids = response.body().data.map((t: { id: number }) => t.id)
    assert.include(ids, inRange.id)
    assert.notInclude(ids, 0)
    assert.ok(response.body().meta.total >= 1)
  })

  test('week view returns tasks in the week containing anchorDate', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cal-week') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const tuesday = await createTask(project.id, '周二', {
      endDate: DateTime.fromISO('2026-07-07'),
    })
    const nextWeek = await createTask(project.id, '下周', {
      endDate: DateTime.fromISO('2026-07-14'),
    })
    const token = await login(client, owner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/calendar?view=week&anchorDate=2026-07-07`)
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)
    const ids = response.body().data.map((t: { id: number }) => t.id)
    assert.include(ids, tuesday.id)
    assert.notInclude(ids, nextWeek.id)
  })

  test('day view returns only tasks on that exact date', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cal-day') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const target = await createTask(project.id, '当日', {
      endDate: DateTime.fromISO('2026-07-10'),
    })
    await createTask(project.id, '次日', {
      endDate: DateTime.fromISO('2026-07-11'),
    })
    const token = await login(client, owner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/calendar?view=day&anchorDate=2026-07-10`)
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)
    assert.deepEqual(
      response.body().data.map((t: { id: number }) => t.id),
      [target.id],
    )
  })

  test('combines search, status, priority and assignee filters', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cal-filter') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const match = await createTask(project.id, '发布审核', {
      status: 'in_progress',
      priority: 'high',
      assigneeId: owner.id,
      endDate: DateTime.fromISO('2026-07-20'),
    })
    await createTask(project.id, '已完成', {
      status: 'completed',
      endDate: DateTime.fromISO('2026-07-20'),
    })
    const token = await login(client, owner)

    const response = await client
      .get(
        `/api/v1/projects/${project.id}/calendar?view=month&anchorDate=2026-07-20&search=${encodeURIComponent('发布')}&status=in_progress&priority=high&assigneeId=${owner.id}`,
      )
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)
    assert.deepEqual(
      response.body().data.map((t: { id: number }) => t.id),
      [match.id],
    )
  })

  test('excludes soft-deleted tasks', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cal-softdel') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    await createTask(project.id, '已删除', {
      endDate: DateTime.fromISO('2026-07-15'),
      deletedAt: DateTime.now(),
    })
    const active = await createTask(project.id, '正常', {
      endDate: DateTime.fromISO('2026-07-15'),
    })
    const token = await login(client, owner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/calendar?view=day&anchorDate=2026-07-15`)
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)
    assert.deepEqual(
      response.body().data.map((t: { id: number }) => t.id),
      [active.id],
    )
  })

  test('rejects missing view or anchorDate', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('cal-validation') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const token = await login(client, owner)

    const invalid = [
      `view=month`,
      `view=month&anchorDate=not-a-date`,
      `view=unknown&anchorDate=2026-07-15`,
    ]
    for (const query of invalid) {
      const response = await client
        .get(`/api/v1/projects/${project.id}/calendar?${query}`)
        .header('Authorization', `Bearer ${token}`)
      response.assertStatus(422)
    }
  })

  test('rejects cross-organization access', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('cal-org') })
    const outsider = await createUser({ email: uniqueEmail('cal-org-out') })
    const organization = await createOrganization(owner)
    const outsiderOrg = await createOrganization(outsider)
    const project = await setupProject(organization, owner)
    await setupProject(outsiderOrg, outsider)
    await createTask(project.id, '私有', { endDate: DateTime.fromISO('2026-07-15') })

    const outsiderToken = await login(client, outsider)
    const response = await client
      .get(`/api/v1/projects/${project.id}/calendar?view=day&anchorDate=2026-07-15`)
      .header('Authorization', `Bearer ${outsiderToken}`)
    response.assertStatus(404)
  })

  test('requires authentication', async ({ client }) => {
    const response = await client.get('/api/v1/projects/1/calendar?view=day&anchorDate=2026-07-15')
    response.assertStatus(401)
  })
})
