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

test.group('ChangeRequest 审计集成测试', (group) => {
  useAuthDatabase(group)

  async function createCr(client: ApiClient, token: string, projectId: number): Promise<number> {
    const res = await client
      .post(`/api/v1/projects/${projectId}/change-requests`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '审计测试变更', changeType: 'scope', priority: 'high' })
    return res.body().data.id
  }

  test('创建变更请求写入 CHANGE_REQUEST_CREATED 审计', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('cr-audit-create') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const crId = await createCr(client, token, project.id)

    const logs = await AuditLog.query()
      .where('entity_type', 'change_request')
      .where('entity_id', crId)
      .where('action', 'create')

    assert.lengthOf(logs, 1)
    const metadata = logs[0]!.metadata as Record<string, unknown>
    assert.equal(metadata.event, 'CHANGE_REQUEST_CREATED')
    assert.equal(logs[0]!.userId, owner.id)
    assert.equal(logs[0]!.organizationId, org.id)
    assert.equal(logs[0]!.projectId, project.id)
  })

  test('提交变更请求写入 CHANGE_REQUEST_SUBMITTED 审计', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('cr-audit-submit') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const crId = await createCr(client, token, project.id)

    await client
      .post(`/api/v1/change-requests/${crId}/submit`)
      .header('Authorization', `Bearer ${token}`)

    const logs = await AuditLog.query()
      .where('entity_type', 'change_request')
      .where('entity_id', crId)
      .where('action', 'update')

    const submitLog = logs.find((l) => (l.metadata as any)?.event === 'CHANGE_REQUEST_SUBMITTED')
    assert.isNotNull(submitLog)
    const changes = submitLog!.changes as Record<string, unknown>
    assert.equal((changes.before as any).status, 'draft')
    assert.equal((changes.after as any).status, 'submitted')
  })

  test('审批批准写入 CHANGE_REQUEST_APPROVED 审计', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('cr-audit-approve') })
    const approver = await createUser({ email: uniqueEmail('cr-audit-app') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await addOrgMember(org, approver, 'admin')
    // 找到项目已有的 Project Manager 角色
    const approverRole = await ProjectRole.query()
      .where('project_id', project.id)
      .where('name', ProjectRoleName.PROJECT_MANAGER)
      .firstOrFail()
    await ProjectMember.create({
      projectId: project.id,
      userId: approver.id,
      projectRoleId: approverRole.id,
      isActive: true,
    })

    const ownerToken = await login(client, owner)
    const approverToken = await login(client, approver)

    const crId = await createCr(client, ownerToken, project.id)
    await client
      .post(`/api/v1/change-requests/${crId}/submit`)
      .header('Authorization', `Bearer ${ownerToken}`)

    await client
      .post(`/api/v1/change-requests/${crId}/approve`)
      .header('Authorization', `Bearer ${approverToken}`)
      .json({ decisionReason: '同意变更' })

    const logs = await AuditLog.query()
      .where('entity_type', 'change_request')
      .where('entity_id', crId)

    const approveLog = logs.find((l) => (l.metadata as any)?.event === 'CHANGE_REQUEST_APPROVED')
    assert.isNotNull(approveLog)
    const changes = approveLog!.changes as Record<string, unknown>
    assert.equal((changes.before as any).status, 'submitted')
    assert.equal((changes.after as any).status, 'approved')
  })

  test('拒绝写入 CHANGE_REQUEST_REJECTED 审计', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('cr-audit-reject') })
    const approver = await createUser({ email: uniqueEmail('cr-audit-rej') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await addOrgMember(org, approver, 'admin')
    const approverRole = await ProjectRole.query()
      .where('project_id', project.id)
      .where('name', ProjectRoleName.PROJECT_MANAGER)
      .firstOrFail()
    await ProjectMember.create({
      projectId: project.id,
      userId: approver.id,
      projectRoleId: approverRole.id,
      isActive: true,
    })

    const ownerToken = await login(client, owner)
    const approverToken = await login(client, approver)

    const crId = await createCr(client, ownerToken, project.id)
    await client
      .post(`/api/v1/change-requests/${crId}/submit`)
      .header('Authorization', `Bearer ${ownerToken}`)

    await client
      .post(`/api/v1/change-requests/${crId}/reject`)
      .header('Authorization', `Bearer ${approverToken}`)
      .json({ decisionReason: '影响范围过大' })

    const logs = await AuditLog.query()
      .where('entity_type', 'change_request')
      .where('entity_id', crId)

    const rejectLog = logs.find((l) => (l.metadata as any)?.event === 'CHANGE_REQUEST_REJECTED')
    assert.isNotNull(rejectLog)
    assert.equal(rejectLog!.action, 'reject')
  })

  test('取消写入 CHANGE_REQUEST_CANCELLED 审计', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('cr-audit-cancel') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const crId = await createCr(client, token, project.id)

    await client
      .post(`/api/v1/change-requests/${crId}/cancel`)
      .header('Authorization', `Bearer ${token}`)

    const logs = await AuditLog.query()
      .where('entity_type', 'change_request')
      .where('entity_id', crId)

    const cancelLog = logs.find((l) => (l.metadata as any)?.event === 'CHANGE_REQUEST_CANCELLED')
    assert.isNotNull(cancelLog)
    assert.equal(cancelLog!.action, 'delete')
  })

  test('越权审批不产生审计', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('cr-audit-deny') })
    const viewer = await createUser({ email: uniqueEmail('cr-audit-view') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await addOrgMember(org, viewer, 'member')
    // 创建只读观察者角色（createProjectWithMember 只创建指定角色）
    let viewerRole = await ProjectRole.query()
      .where('project_id', project.id)
      .where('name', ProjectRoleName.READONLY_OBSERVER)
      .first()
    if (!viewerRole) {
      viewerRole = await ProjectRole.create({
        projectId: project.id,
        name: ProjectRoleName.READONLY_OBSERVER,
        description: ProjectRoleName.READONLY_OBSERVER,
        permissions: [],
        isSystem: true,
      })
    }
    await ProjectMember.create({
      projectId: project.id,
      userId: viewer.id,
      projectRoleId: viewerRole.id,
      isActive: true,
    })

    const ownerToken = await login(client, owner)
    const viewerToken = await login(client, viewer)

    const crId = await createCr(client, ownerToken, project.id)
    await client
      .post(`/api/v1/change-requests/${crId}/submit`)
      .header('Authorization', `Bearer ${ownerToken}`)

    // 观察者尝试审批（应被拒绝）
    const res = await client
      .post(`/api/v1/change-requests/${crId}/approve`)
      .header('Authorization', `Bearer ${viewerToken}`)

    res.assertStatus(403)

    // 不应有审批审计
    const logs = await AuditLog.query()
      .where('entity_type', 'change_request')
      .where('entity_id', crId)
      .where('action', 'approve')

    assert.lengthOf(logs, 0)
  })
})
