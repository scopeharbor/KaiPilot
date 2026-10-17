import AuditLog from '#models/audit_log'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import type User from '#models/user'
import type { ApiClient } from '@japa/api-client'
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
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return res.body().data.accessToken
}

test.group('Risk 审计集成测试', (group) => {
  useAuthDatabase(group)

  test('创建风险写入 RISK_CREATED 审计', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('audit-create') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '审计测试', description: '描述' })

    const riskId = res.body().data.id

    const logs = await AuditLog.query()
      .where('entity_type', 'risk')
      .where('entity_id', riskId)
      .where('action', 'create')

    assert.lengthOf(logs, 1)
    const metadata = logs[0]!.metadata as Record<string, unknown>
    assert.equal(metadata.event, 'RISK_CREATED')
    assert.equal(logs[0]!.userId, owner.id)
    assert.equal(logs[0]!.organizationId, org.id)
    assert.equal(logs[0]!.projectId, project.id)
  })

  test('更新风险写入 RISK_UPDATED 审计', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('audit-update') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '原始', description: '描述' })

    const riskId = createRes.body().data.id

    await client
      .patch(`/api/v1/risks/${riskId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '更新后' })

    const logs = await AuditLog.query()
      .where('entity_type', 'risk')
      .where('entity_id', riskId)
      .where('action', 'update')

    const updateLog = logs.find((l) => l.metadata?.event === 'RISK_UPDATED')
    assert.isNotNull(updateLog)
    const metadata = updateLog!.metadata as Record<string, unknown>
    assert.equal(metadata.event, 'RISK_UPDATED')
  })

  test('状态推进写入 RISK_STATUS_CHANGED 审计', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('audit-status') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '状态审计', description: '描述' })

    const riskId = createRes.body().data.id

    await client
      .post(`/api/v1/risks/${riskId}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'analyzing' })

    const logs = await AuditLog.query()
      .where('entity_type', 'risk')
      .where('entity_id', riskId)
      .where('action', 'update')

    const statusLog = logs.find((l) => l.metadata?.event === 'RISK_STATUS_CHANGED')
    assert.isNotNull(statusLog)
    const metadata = statusLog!.metadata as Record<string, unknown>
    assert.equal(metadata.from, 'identified')
    assert.equal(metadata.to, 'analyzing')
  })

  test('删除风险写入 RISK_DELETED 审计', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('audit-delete') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '待删除', description: '描述' })

    const riskId = createRes.body().data.id

    await client.delete(`/api/v1/risks/${riskId}`).header('Authorization', `Bearer ${token}`)

    const logs = await AuditLog.query()
      .where('entity_type', 'risk')
      .where('entity_id', riskId)
      .where('action', 'delete')

    assert.lengthOf(logs, 1)
    const metadata = logs[0]!.metadata as Record<string, unknown>
    assert.equal(metadata.event, 'RISK_DELETED')
  })

  test('越权写入不产生审计', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('audit-no-audit') })
    const viewer = await createUser({ email: uniqueEmail('audit-viewer') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await addOrgMember(org, viewer, 'member')
    const viewerRole = await ProjectRole.create({
      projectId: project.id,
      name: ProjectRoleName.READONLY_OBSERVER,
      description: ProjectRoleName.READONLY_OBSERVER,
      permissions: [],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: viewer.id,
      projectRoleId: viewerRole.id,
      isActive: true,
    })
    const viewerToken = await login(client, viewer)

    // 观察者尝试创建（应被拒绝）
    const res = await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${viewerToken}`)
      .json({ title: '越权', description: '描述' })

    res.assertStatus(403)

    // 不应有审计记录
    const logs = await AuditLog.query()
      .where('entity_type', 'risk')
      .where('action', 'create')
      .where('project_id', project.id)

    assert.lengthOf(logs, 0)
  })
})
