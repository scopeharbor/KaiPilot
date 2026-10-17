import AuditLog from '#models/audit_log'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import type User from '#models/user'
import { ProjectRoleName } from '#rbac'
import type { ApiClient } from '@japa/api-client'
import { test } from '@japa/runner'
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

test.group('WBS API', (group) => {
  useAuthDatabase(group)

  test('完整建改移删流程、include=task 与审计事件', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('wbs-api-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const tree = await client
      .get(`/api/v1/projects/${project.id}/wbs-tree?include=task`)
      .header('Authorization', `Bearer ${token}`)
    tree.assertStatus(200)
    assert.lengthOf(tree.body().data, 1)
    const rootId = tree.body().data[0].id

    const a = await client
      .post(`/api/v1/projects/${project.id}/wbs/nodes`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '需求分析', parentId: rootId })
    a.assertStatus(201)
    a.assertBodyContains({ data: { name: '需求分析', code: '1.1', depth: 1 } })

    const b = await client
      .post(`/api/v1/projects/${project.id}/wbs/nodes`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '开发', parentId: rootId })
    b.assertStatus(201)

    const renamed = await client
      .patch(`/api/v1/projects/${project.id}/wbs/nodes/${a.body().data.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '需求与设计' })
    renamed.assertStatus(200)
    renamed.assertBodyContains({ data: { name: '需求与设计' } })

    const moved = await client
      .post(`/api/v1/projects/${project.id}/wbs/nodes/${a.body().data.id}/move`)
      .header('Authorization', `Bearer ${token}`)
      .json({ parentId: b.body().data.id, displayOrder: 0 })
    moved.assertStatus(200)
    assert.equal(moved.body().data.parentId, b.body().data.id)

    const removed = await client
      .delete(`/api/v1/projects/${project.id}/wbs/nodes/${a.body().data.id}`)
      .header('Authorization', `Bearer ${token}`)
    removed.assertStatus(204)

    const auditLogs = await AuditLog.query().where('entity_type', 'wbs_node')
    const events = auditLogs.map((log) => (log.metadata as { event?: string }).event)
    assert.includeMembers(events, [
      'WBS_NODE_CREATED',
      'WBS_NODE_UPDATED',
      'WBS_NODE_MOVED',
      'WBS_NODE_DELETED',
    ])
  })

  test('只读观察者可查看和折叠，但所有结构写操作返回 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const observer = await createUser({ email: uniqueEmail('observer') })
    const org = await createOrganization(owner)
    await addOrgMember(org, observer, 'viewer')
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const role = await ProjectRole.create({
      projectId: project.id,
      name: ProjectRoleName.READONLY_OBSERVER,
      description: '只读',
      permissions: [],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: observer.id,
      projectRoleId: role.id,
      isActive: true,
    })
    const ownerToken = await login(client, owner)
    const observerToken = await login(client, observer)
    const initial = await client
      .get(`/api/v1/projects/${project.id}/wbs-tree`)
      .header('Authorization', `Bearer ${ownerToken}`)
    const rootId = initial.body().data[0].id

    const view = await client
      .get(`/api/v1/projects/${project.id}/wbs-tree`)
      .header('Authorization', `Bearer ${observerToken}`)
    view.assertStatus(200)

    const collapse = await client
      .patch(`/api/v1/projects/${project.id}/wbs/nodes/${rootId}`)
      .header('Authorization', `Bearer ${observerToken}`)
      .json({ collapsed: true })
    collapse.assertStatus(200)

    const rename = await client
      .patch(`/api/v1/projects/${project.id}/wbs/nodes/${rootId}`)
      .header('Authorization', `Bearer ${observerToken}`)
      .json({ name: '越权改名' })
    rename.assertStatus(403)

    const create = await client
      .post(`/api/v1/projects/${project.id}/wbs/nodes`)
      .header('Authorization', `Bearer ${observerToken}`)
      .json({ name: '越权创建' })
    create.assertStatus(403)

    const move = await client
      .post(`/api/v1/projects/${project.id}/wbs/nodes/${rootId}/move`)
      .header('Authorization', `Bearer ${observerToken}`)
      .json({ parentId: null })
    move.assertStatus(403)

    const remove = await client
      .delete(`/api/v1/projects/${project.id}/wbs/nodes/${rootId}`)
      .header('Authorization', `Bearer ${observerToken}`)
    remove.assertStatus(403)
  })

  test('外部协作者移动被拒，跨组织访问统一 404', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const external = await createUser({ email: uniqueEmail('external') })
    const outsider = await createUser({ email: uniqueEmail('outsider') })
    const org = await createOrganization(owner)
    await createOrganization(outsider)
    await addOrgMember(org, external, 'member')
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const role = await ProjectRole.create({
      projectId: project.id,
      name: ProjectRoleName.EXTERNAL_COLLABORATOR,
      description: '外部',
      permissions: [],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: external.id,
      projectRoleId: role.id,
      isActive: true,
    })
    const ownerToken = await login(client, owner)
    const externalToken = await login(client, external)
    const outsiderToken = await login(client, outsider)
    const tree = await client
      .get(`/api/v1/projects/${project.id}/wbs-tree`)
      .header('Authorization', `Bearer ${ownerToken}`)
    const rootId = tree.body().data[0].id

    const move = await client
      .post(`/api/v1/projects/${project.id}/wbs/nodes/${rootId}/move`)
      .header('Authorization', `Bearer ${externalToken}`)
      .json({ parentId: null })
    move.assertStatus(403)

    const crossOrg = await client
      .get(`/api/v1/projects/${project.id}/wbs-tree`)
      .header('Authorization', `Bearer ${outsiderToken}`)
    crossOrg.assertStatus(404)
    crossOrg.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
  })
})
