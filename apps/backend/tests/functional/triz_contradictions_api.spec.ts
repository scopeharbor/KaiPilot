import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import Task from '#models/task'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const API_PREFIX = '/api/v1'

async function login(client: any, user: any) {
  const r = await client
    .post(`${API_PREFIX}/auth/login`)
    .json({ email: user.email, password: STRONG_PASSWORD })
  return (r.body() as { data: { accessToken: string } }).data.accessToken
}

async function addOverdueTask(projectId: number) {
  await Task.create({
    projectId,
    name: '逾期任务',
    status: 'in_progress',
    taskType: 'task',
    priority: 'medium',
    endDate: DateTime.now().minus({ days: 2 }),
  })
}

test.group('TRIZ contradictions API', (group) => {
  useAuthDatabase(group)

  async function setup(client: any) {
    const owner = await createUser({ email: uniqueEmail('triz-api-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await addOverdueTask(project.id)
    const token = await login(client, owner)
    return { owner, org, project, token }
  }

  test('未认证访问列表返回 401', async ({ client }) => {
    const { project } = await setup(client)
    const res = await client.get(`${API_PREFIX}/projects/${project.id}/contradictions`)
    res.assertStatus(401)
  })

  test('refresh/list/show/confirm/dismiss/explain 完整流程', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    const refresh = await client
      .post(`${API_PREFIX}/projects/${project.id}/contradictions/refresh`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})
    assert.equal(refresh.status(), 200)
    assert.isAbove((refresh.body() as { data: { created: number } }).data.created, 0)

    const list = await client
      .get(`${API_PREFIX}/projects/${project.id}/contradictions`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
    assert.equal(list.status(), 200)
    const first = (list.body() as { data: Array<{ id: number }> }).data[0]
    assert.isNumber(first.id)

    const show = await client
      .get(`${API_PREFIX}/projects/${project.id}/contradictions/${first.id}`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
    assert.equal(show.status(), 200)

    const confirm = await client
      .post(`${API_PREFIX}/projects/${project.id}/contradictions/${first.id}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})
    assert.equal(confirm.status(), 200)
    assert.equal((confirm.body() as { data: { status: string } }).data.status, 'confirmed')

    const explain = await client
      .post(`${API_PREFIX}/projects/${project.id}/contradictions/${first.id}/explain`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})
    assert.equal(explain.status(), 200)
    assert.equal((explain.body() as { data: { provider: string } }).data.provider, 'fake')

    const dismiss = await client
      .post(`${API_PREFIX}/projects/${project.id}/contradictions/${first.id}/dismiss`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ reason: '人工判定该矛盾暂不成立' })
    assert.equal(dismiss.status(), 200)
    assert.equal((dismiss.body() as { data: { status: string } }).data.status, 'dismissed')
  })

  test('非法列表过滤返回 422', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/contradictions?severity=bad`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
    assert.equal(res.status(), 422)
  })

  test('只读观察者可查看但不能刷新', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    await client
      .post(`${API_PREFIX}/projects/${project.id}/contradictions/refresh`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})

    const viewer = await createUser({ email: uniqueEmail('triz-api-viewer') })
    await addOrgMember(org, viewer, 'viewer')
    const role = await ProjectRole.create({
      projectId: project.id,
      name: ProjectRoleName.READONLY_OBSERVER,
      description: '只读观察者',
      permissions: [],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: viewer.id,
      projectRoleId: role.id,
      isActive: true,
    })
    const viewerToken = await login(client, viewer)

    const list = await client
      .get(`${API_PREFIX}/projects/${project.id}/contradictions`)
      .header('Authorization', `Bearer ${viewerToken}`)
      .header('x-organization-id', String(org.id))
    assert.equal(list.status(), 200)

    const refresh = await client
      .post(`${API_PREFIX}/projects/${project.id}/contradictions/refresh`)
      .header('Authorization', `Bearer ${viewerToken}`)
      .header('x-organization-id', String(org.id))
      .json({})
    assert.equal(refresh.status(), 403)
  })

  test('跨组织访问不泄露对方矛盾', async ({ client, assert }) => {
    const { project } = await setup(client)
    const other = await createUser({ email: uniqueEmail('triz-api-other') })
    const otherOrg = await createOrganization(other)
    const token = await login(client, other)

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/contradictions`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(otherOrg.id))

    assert.isTrue([403, 404].includes(res.status()))
  })
})
