import ChangeRequest from '#models/change_request'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import { ProjectRoleName } from '#rbac'
import type User from '#models/user'
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
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return res.body().data.accessToken
}

let crSeq = 0
async function makeCr(projectId: number, organizationId: number, userId: number, status = 'draft') {
  crSeq += 1
  return ChangeRequest.create({
    crCode: `CR-IMP-API-${process.pid}-${crSeq}`,
    organizationId,
    projectId,
    requesterId: userId,
    requestedBy: userId,
    title: 'API 影响分析变更',
    changeType: 'scope',
    status,
    priority: 'medium',
  })
}

async function addProjectRoleMember(projectId: number, userId: number, roleName: ProjectRoleName) {
  let role = await ProjectRole.query()
    .where('project_id', projectId)
    .where('name', roleName)
    .first()
  if (!role) {
    role = await ProjectRole.create({
      projectId,
      name: roleName,
      description: roleName,
      permissions: [],
      isSystem: true,
    })
  }
  await ProjectMember.create({
    projectId,
    userId,
    projectRoleId: role.id,
    isActive: true,
  })
}

test.group('ChangeImpactAnalysis API', (group) => {
  useAuthDatabase(group)

  test('项目成员拥有 view 权限可创建只读分析，但不能刷新', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('imp-api-owner') })
    const member = await createUser({ email: uniqueEmail('imp-api-member') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await addOrgMember(org, member, 'member')
    await addProjectRoleMember(project.id, member.id, ProjectRoleName.MEMBER)
    const cr = await makeCr(project.id, org.id, owner.id)
    const token = await login(client, member)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/change-requests/${cr.id}/impact-analyses`)
      .bearerToken(token)
      .json({ scope: { dimensions: ['scope', 'schedule'], maxPropagationDepth: 3 } })

    createRes.assertStatus(201)
    const analysisId = createRes.body().data.id
    assert.equal(createRes.body().data.changeRequestId, cr.id)

    const refreshRes = await client
      .post(`/api/v1/impact-analyses/${analysisId}/refresh`)
      .bearerToken(token)

    refreshRes.assertStatus(403)
  })

  test('扁平详情路由按组织隔离，跨组织用户拿不到分析', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('imp-api-org-a') })
    const other = await createUser({ email: uniqueEmail('imp-api-org-b') })
    const org = await createOrganization(owner)
    const otherOrg = await createOrganization(other)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await createProjectWithMember(otherOrg, other, other, ProjectRoleName.PROJECT_MANAGER)
    const cr = await makeCr(project.id, org.id, owner.id)
    const ownerToken = await login(client, owner)
    const otherToken = await login(client, other)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/change-requests/${cr.id}/impact-analyses`)
      .bearerToken(ownerToken)
    const analysisId = createRes.body().data.id

    const res = await client.get(`/api/v1/impact-analyses/${analysisId}`).bearerToken(otherToken)
    res.assertStatus(404)
  })

  test('拒绝变更请求时可引用未过期影响分析作为审批证据', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('imp-api-reject') })
    const approver = await createUser({ email: uniqueEmail('imp-api-reject-approver') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await addOrgMember(org, approver, 'admin')
    await addProjectRoleMember(project.id, approver.id, ProjectRoleName.PROJECT_MANAGER)
    const cr = await makeCr(project.id, org.id, owner.id, 'submitted')
    const ownerToken = await login(client, owner)
    const approverToken = await login(client, approver)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/change-requests/${cr.id}/impact-analyses`)
      .bearerToken(ownerToken)
    const analysisId = createRes.body().data.id

    const rejectRes = await client
      .post(`/api/v1/change-requests/${cr.id}/reject`)
      .bearerToken(approverToken)
      .json({ decisionReason: '影响过大', impactAnalysisId: analysisId })

    rejectRes.assertStatus(200)
    assert.equal(rejectRes.body().data.status, 'rejected')
    assert.equal(Number(rejectRes.body().data.approveRefAnalysisId), analysisId)

    const reloaded = await ChangeRequest.findOrFail(cr.id)
    assert.equal(Number(reloaded.approveRefAnalysisId), analysisId)
  })
})
