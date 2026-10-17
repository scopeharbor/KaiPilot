import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import type User from '#models/user'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function login(client: ApiClient, user: User): Promise<string> {
  const response = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return response.body().data.accessToken
}

test.group('Gantt baseline API', (group) => {
  useAuthDatabase(group)

  test('PM 可保存并覆盖，读取返回当前唯一基线', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('baseline-api-owner') })
    const organization = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      organization,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)
    const path = `/api/v1/projects/${project.id}/gantt/baseline`
    const first = await client.post(path).header('Authorization', `Bearer ${token}`)
    const second = await client.post(path).header('Authorization', `Bearer ${token}`)
    first.assertStatus(200)
    second.assertStatus(200)
    const firstBody = first.body() as { data: { id: number } }
    const secondBody = second.body() as { data: { id: number } }
    assert.equal(firstBody.data.id, secondBody.data.id)
    const read = await client.get(path).header('Authorization', `Bearer ${token}`)
    read.assertStatus(200)
    const readBody = read.body() as { data: { id: number } }
    assert.equal(readBody.data.id, firstBody.data.id)
  })

  test('只读观察者可读取空态，但保存返回 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('baseline-api-owner') })
    const observer = await createUser({ email: uniqueEmail('baseline-api-observer') })
    const organization = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      organization,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await addOrgMember(organization, observer, 'member')
    const role = await ProjectRole.create({
      projectId: project.id,
      name: ProjectRoleName.READONLY_OBSERVER,
      description: '只读观察者',
      permissions: [],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: observer.id,
      projectRoleId: role.id,
      isActive: true,
    })
    const token = await login(client, observer)
    const path = `/api/v1/projects/${project.id}/gantt/baseline`
    const read = await client.get(path).header('Authorization', `Bearer ${token}`)
    read.assertStatus(200)
    read.assertBodyContains({ data: null })
    const save = await client.post(path).header('Authorization', `Bearer ${token}`)
    save.assertStatus(403)
    save.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  test('跨组织读取返回 404', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('baseline-owner') })
    const organization = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      organization,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const outsider = await createUser({ email: uniqueEmail('baseline-outsider') })
    await createOrganization(outsider)
    const token = await login(client, outsider)
    const response = await client
      .get(`/api/v1/projects/${project.id}/gantt/baseline`)
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(404)
    response.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
  })
})
