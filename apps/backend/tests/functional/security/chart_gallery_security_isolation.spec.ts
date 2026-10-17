// v3-chart-gallery-data-foundation W5.6 —— 核心安全红线与多租户隔离对抗测试
//
// - RL-05（跨租户防探测）：遍历图表馆全部项目级端点 + 部门树资源端点，跨组织
//   ID 一律 404 RESOURCE_NOT_FOUND，绝不泄露存在性（含 GET/POST/PATCH/DELETE）；
// - RL-06（副作用边界 + 权限门禁）：只读观察者读端点 200、全部写端点 403；
// - RL-01（人工确认）：所有写操作必须携带合法 Token（未认证 401 抽查）。
import { test } from '@japa/runner'
import type Organization from '#models/organization'
import ProjectRole from '#models/project_role'
import ProjectMember from '#models/project_member'
import Task from '#models/task'
import type User from '#models/user'
import { ProjectRoleName } from '#rbac'
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

/** 追加项目成员（org 成员 + 项目角色）。 */
async function addProjectMember(
  org: Organization,
  projectId: number,
  user: User,
  roleName: string,
): Promise<void> {
  await addOrgMember(org, user, 'member')
  const role = await ProjectRole.create({
    projectId,
    name: roleName,
    description: roleName,
    permissions: [],
    isSystem: true,
  })
  await ProjectMember.create({
    projectId,
    userId: user.id,
    projectRoleId: role.id,
    isActive: true,
  })
}

async function makeTask(projectId: number, name: string) {
  return Task.create({
    projectId,
    name,
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    isCriticalPath: false,
    isOnLongestPath: false,
  })
}

function charterPayload() {
  return {
    title: '隔离测试章程',
    vision: 'vision',
    scope: 'scope',
    objectives: ['o1'],
    successCriteria: ['s1'],
    startDate: '2026-01-01',
    endDate: '2026-03-31',
  }
}

/** 在组织 A 预置全量种子数据，返回可复用资源 ID。 */
async function seedOrgA(client: ApiClient, owner: User, org: Organization) {
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  const token = await login(client, owner)

  const charter = await client
    .post(`/api/v1/projects/${project.id}/charter`)
    .header('Authorization', `Bearer ${token}`)
    .json(charterPayload())
  const requirement = await client
    .post(`/api/v1/projects/${project.id}/requirements`)
    .header('Authorization', `Bearer ${token}`)
    .json({
      title: '隔离需求',
      acceptanceCriteria: [{ id: 'ac-1', statement: 's', status: 'pending' }],
    })
  const task = await makeTask(project.id, '隔离任务')
  await client
    .post(`/api/v1/projects/${project.id}/requirements/${requirement.body().data.id}/tasks`)
    .header('Authorization', `Bearer ${token}`)
    .json({ taskId: task.id })
  const issue = await client
    .post(`/api/v1/projects/${project.id}/issues`)
    .header('Authorization', `Bearer ${token}`)
    .json({ title: '隔离议题', type: 'bug' })
  const stakeholder = await client
    .post(`/api/v1/projects/${project.id}/stakeholders`)
    .header('Authorization', `Bearer ${token}`)
    .json({ name: '隔离干系人', stakeholderType: 'external' })
  const plan = await client
    .post(`/api/v1/projects/${project.id}/communication-plans`)
    .header('Authorization', `Bearer ${token}`)
    .json({
      name: '隔离沟通计划',
      ownerId: owner.id,
      purpose: 'purpose',
      audience: 'audience',
    })
  const dept = await client
    .post('/api/v1/departments')
    .header('Authorization', `Bearer ${token}`)
    .json({ name: '隔离部门', code: 'ISO-DEPT' })

  return {
    projectId: project.id,
    charterId: charter.body().data?.id,
    requirementId: requirement.body().data.id,
    issueId: issue.body().data.id,
    stakeholderId: stakeholder.body().data.id,
    planId: plan.body().data.id,
    deptId: dept.body().data.id,
  }
}

interface Probe {
  method: 'get' | 'post' | 'patch' | 'delete'
  path: string
  body?: Record<string, unknown>
}

test.group('Chart Gallery 安全隔离', (group) => {
  useAuthDatabase(group)

  test('RL-05 项目级端点跨租户一律 404（RESOURCE_NOT_FOUND，防探测）', async ({
    assert,
    client,
  }) => {
    const ownerA = await createUser({ email: uniqueEmail('iso-orga') })
    const orgA = await createOrganization(ownerA)
    const seeds = await seedOrgA(client, ownerA, orgA)

    const outsider = await createUser({ email: uniqueEmail('iso-orgb') })
    await createOrganization(outsider)
    const foreignToken = await login(client, outsider)

    const pid = seeds.projectId
    const probes: Probe[] = [
      // 章程（5）
      { method: 'get', path: `/api/v1/projects/${pid}/charter` },
      { method: 'post', path: `/api/v1/projects/${pid}/charter`, body: charterPayload() },
      { method: 'patch', path: `/api/v1/projects/${pid}/charter`, body: { title: 'x' } },
      { method: 'post', path: `/api/v1/projects/${pid}/charter/submit` },
      {
        method: 'post',
        path: `/api/v1/projects/${pid}/charter/approve`,
        body: { action: 'approve' },
      },
      // 需求（8）
      { method: 'get', path: `/api/v1/projects/${pid}/requirements` },
      {
        method: 'post',
        path: `/api/v1/projects/${pid}/requirements`,
        body: { title: '跨组织需求' },
      },
      { method: 'get', path: `/api/v1/projects/${pid}/requirements/rtm-matrix` },
      { method: 'get', path: `/api/v1/projects/${pid}/requirements/${seeds.requirementId}` },
      {
        method: 'patch',
        path: `/api/v1/projects/${pid}/requirements/${seeds.requirementId}`,
        body: { title: '跨组织改' },
      },
      { method: 'delete', path: `/api/v1/projects/${pid}/requirements/${seeds.requirementId}` },
      {
        method: 'post',
        path: `/api/v1/projects/${pid}/requirements/${seeds.requirementId}/tasks`,
        body: { taskId: 999999 },
      },
      {
        method: 'delete',
        path: `/api/v1/projects/${pid}/requirements/${seeds.requirementId}/tasks/999999`,
      },
      // 议题（6）
      { method: 'get', path: `/api/v1/projects/${pid}/issues` },
      { method: 'post', path: `/api/v1/projects/${pid}/issues`, body: { title: '跨组织议题' } },
      { method: 'get', path: `/api/v1/projects/${pid}/issues/${seeds.issueId}` },
      {
        method: 'patch',
        path: `/api/v1/projects/${pid}/issues/${seeds.issueId}`,
        body: { title: 'x' },
      },
      {
        method: 'patch',
        path: `/api/v1/projects/${pid}/issues/${seeds.issueId}/status`,
        body: { status: 'in_progress' },
      },
      { method: 'delete', path: `/api/v1/projects/${pid}/issues/${seeds.issueId}` },
      // 干系人（5）
      { method: 'get', path: `/api/v1/projects/${pid}/stakeholders` },
      { method: 'get', path: `/api/v1/projects/${pid}/stakeholders?view=quadrant` },
      { method: 'post', path: `/api/v1/projects/${pid}/stakeholders`, body: { name: 'x' } },
      { method: 'get', path: `/api/v1/projects/${pid}/stakeholders/${seeds.stakeholderId}` },
      {
        method: 'patch',
        path: `/api/v1/projects/${pid}/stakeholders/${seeds.stakeholderId}`,
        body: { name: 'x' },
      },
      { method: 'delete', path: `/api/v1/projects/${pid}/stakeholders/${seeds.stakeholderId}` },
      // 沟通计划（5）
      { method: 'get', path: `/api/v1/projects/${pid}/communication-plans` },
      {
        method: 'post',
        path: `/api/v1/projects/${pid}/communication-plans`,
        body: { name: 'x', ownerId: 1, purpose: 'p', audience: 'a' },
      },
      { method: 'get', path: `/api/v1/projects/${pid}/communication-plans/${seeds.planId}` },
      {
        method: 'patch',
        path: `/api/v1/projects/${pid}/communication-plans/${seeds.planId}`,
        body: { isActive: false },
      },
      { method: 'delete', path: `/api/v1/projects/${pid}/communication-plans/${seeds.planId}` },
      // 聚合只读端点（8）
      { method: 'get', path: `/api/v1/projects/${pid}/raci-matrix` },
      { method: 'get', path: `/api/v1/projects/${pid}/obs-tree` },
      { method: 'get', path: `/api/v1/projects/${pid}/metrics/evm` },
      { method: 'get', path: `/api/v1/projects/${pid}/metrics/evm/s-curve` },
      { method: 'get', path: `/api/v1/projects/${pid}/metrics/burndown` },
      { method: 'get', path: `/api/v1/projects/${pid}/metrics/lob` },
      { method: 'get', path: `/api/v1/projects/${pid}/metrics/control-chart` },
      { method: 'get', path: `/api/v1/projects/${pid}/metrics/pareto` },
    ]

    for (const probe of probes) {
      let req = client[probe.method](probe.path).header('Authorization', `Bearer ${foreignToken}`)
      if (probe.body) req = req.json(probe.body as never)
      const res = await req
      assert.equal(
        res.status(),
        404,
        `${probe.method.toUpperCase()} ${probe.path} 应 404（跨租户防探测）`,
      )
      assert.equal(res.body().error.code, 'RESOURCE_NOT_FOUND')
    }
  })

  test('RL-05 部门树资源跨组织一律 404（组织级路由由服务层隔离）', async ({ assert, client }) => {
    const ownerA = await createUser({ email: uniqueEmail('iso-dept-a') })
    const orgA = await createOrganization(ownerA)
    const seeds = await seedOrgA(client, ownerA, orgA)

    const outsider = await createUser({ email: uniqueEmail('iso-dept-b') })
    await createOrganization(outsider)
    const foreignToken = await login(client, outsider)

    // 组织 B 的 admin/owner 具备 ORG_MANAGE（通过中间件），但资源属于组织 A → 服务层 404
    const probes: Probe[] = [
      { method: 'get', path: `/api/v1/departments/${seeds.deptId}` },
      { method: 'patch', path: `/api/v1/departments/${seeds.deptId}`, body: { name: 'x' } },
      { method: 'delete', path: `/api/v1/departments/${seeds.deptId}` },
    ]
    for (const probe of probes) {
      let req = client[probe.method](probe.path).header('Authorization', `Bearer ${foreignToken}`)
      if (probe.body) req = req.json(probe.body as never)
      const res = await req
      assert.equal(res.status(), 404, `${probe.method.toUpperCase()} ${probe.path}`)
      assert.equal(res.body().error.code, 'RESOURCE_NOT_FOUND')
    }
  })

  test('RL-06 只读观察者：读 200 / 写 403；RL-01 未认证 401', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('iso-observer') })
    const org = await createOrganization(owner)
    const seeds = await seedOrgA(client, owner, org)

    const viewer = await createUser({ email: uniqueEmail('iso-viewer') })
    await addProjectMember(org, seeds.projectId, viewer, ProjectRoleName.READONLY_OBSERVER)
    const viewerToken = await login(client, viewer)
    const pid = seeds.projectId

    // 读端点全部放行（project:view / task:view）
    const readPaths = [
      `/api/v1/projects/${pid}/charter`,
      `/api/v1/projects/${pid}/requirements`,
      `/api/v1/projects/${pid}/requirements/rtm-matrix`,
      `/api/v1/projects/${pid}/requirements/${seeds.requirementId}`,
      `/api/v1/projects/${pid}/issues`,
      `/api/v1/projects/${pid}/issues/${seeds.issueId}`,
      `/api/v1/projects/${pid}/stakeholders`,
      `/api/v1/projects/${pid}/stakeholders/${seeds.stakeholderId}`,
      `/api/v1/projects/${pid}/communication-plans`,
      `/api/v1/projects/${pid}/communication-plans/${seeds.planId}`,
      `/api/v1/projects/${pid}/raci-matrix`,
      `/api/v1/projects/${pid}/obs-tree`,
      `/api/v1/projects/${pid}/metrics/evm`,
      `/api/v1/projects/${pid}/metrics/evm/s-curve`,
      `/api/v1/projects/${pid}/metrics/burndown`,
      `/api/v1/projects/${pid}/metrics/lob`,
      `/api/v1/projects/${pid}/metrics/control-chart`,
      `/api/v1/projects/${pid}/metrics/pareto`,
      '/api/v1/departments',
    ]
    for (const path of readPaths) {
      const res = await client.get(path).header('Authorization', `Bearer ${viewerToken}`)
      assert.equal(res.status(), 200, `只读 GET ${path} 应 200`)
    }

    // 写端点全部 403（权限不足；同组织内不泄露资源存在性，返回 PERMISSION_DENIED）
    const writeProbes: Probe[] = [
      { method: 'post', path: `/api/v1/projects/${pid}/charter`, body: charterPayload() },
      { method: 'patch', path: `/api/v1/projects/${pid}/charter`, body: { title: 'x' } },
      { method: 'post', path: `/api/v1/projects/${pid}/charter/submit` },
      {
        method: 'post',
        path: `/api/v1/projects/${pid}/charter/approve`,
        body: { action: 'approve' },
      },
      { method: 'post', path: `/api/v1/projects/${pid}/requirements`, body: { title: 'x' } },
      {
        method: 'patch',
        path: `/api/v1/projects/${pid}/requirements/${seeds.requirementId}`,
        body: { title: 'x' },
      },
      { method: 'delete', path: `/api/v1/projects/${pid}/requirements/${seeds.requirementId}` },
      {
        method: 'post',
        path: `/api/v1/projects/${pid}/requirements/${seeds.requirementId}/tasks`,
        body: { taskId: 1 },
      },
      {
        method: 'delete',
        path: `/api/v1/projects/${pid}/requirements/${seeds.requirementId}/tasks/1`,
      },
      { method: 'post', path: `/api/v1/projects/${pid}/issues`, body: { title: 'x' } },
      {
        method: 'patch',
        path: `/api/v1/projects/${pid}/issues/${seeds.issueId}`,
        body: { title: 'x' },
      },
      {
        method: 'patch',
        path: `/api/v1/projects/${pid}/issues/${seeds.issueId}/status`,
        body: { status: 'in_progress' },
      },
      { method: 'delete', path: `/api/v1/projects/${pid}/issues/${seeds.issueId}` },
      { method: 'post', path: `/api/v1/projects/${pid}/stakeholders`, body: { name: 'x' } },
      {
        method: 'patch',
        path: `/api/v1/projects/${pid}/stakeholders/${seeds.stakeholderId}`,
        body: { name: 'x' },
      },
      { method: 'delete', path: `/api/v1/projects/${pid}/stakeholders/${seeds.stakeholderId}` },
      {
        method: 'post',
        path: `/api/v1/projects/${pid}/communication-plans`,
        body: { name: 'x', ownerId: viewer.id, purpose: 'p', audience: 'a' },
      },
      {
        method: 'patch',
        path: `/api/v1/projects/${pid}/communication-plans/${seeds.planId}`,
        body: { isActive: false },
      },
      { method: 'delete', path: `/api/v1/projects/${pid}/communication-plans/${seeds.planId}` },
      { method: 'post', path: '/api/v1/departments', body: { name: 'x', code: 'X' } },
      { method: 'patch', path: `/api/v1/departments/${seeds.deptId}`, body: { name: 'x' } },
      { method: 'delete', path: `/api/v1/departments/${seeds.deptId}` },
    ]
    for (const probe of writeProbes) {
      let req = client[probe.method](probe.path).header('Authorization', `Bearer ${viewerToken}`)
      if (probe.body) req = req.json(probe.body as never)
      const res = await req
      assert.equal(
        res.status(),
        403,
        `${probe.method.toUpperCase()} ${probe.path} 应 403（只读观察者）`,
      )
      assert.equal(res.body().error.code, 'PERMISSION_DENIED')
    }

    // RL-01：未认证写请求 → 401
    const unauth = await client.post(`/api/v1/projects/${pid}/issues`).json({ title: '未认证登记' })
    unauth.assertStatus(401)
  })
})
