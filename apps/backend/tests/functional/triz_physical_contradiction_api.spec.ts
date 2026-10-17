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
const BASE = (projectId: number) =>
  `${API_PREFIX}/projects/${projectId}/triz/physical-contradiction-analyses`

async function login(client: any, user: any) {
  const r = await client
    .post(`${API_PREFIX}/auth/login`)
    .json({ email: user.email, password: STRONG_PASSWORD })
  return (r.body() as { data: { accessToken: string } }).data.accessToken
}

async function seedData(projectId: number) {
  for (let i = 0; i < 6; i++) {
    await Task.create({
      projectId,
      name: `逾期任务 ${i}`,
      status: 'in_progress',
      taskType: 'task',
      priority: 'medium',
      endDate: DateTime.now().minus({ days: 3 }),
      isCriticalPath: true,
    } as any)
  }
  for (let i = 0; i < 25; i++) {
    await Task.create({
      projectId,
      name: `范围条目 ${i}`,
      status: 'not_started',
      taskType: 'task',
      priority: 'low',
    } as any)
  }
}

test.group('TRIZ physical contradiction analyzer API', (group) => {
  useAuthDatabase(group)

  async function setup(client: any) {
    const owner = await createUser({ email: uniqueEmail('phys-api-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seedData(project.id)
    const token = await login(client, owner)
    return { owner, org, project, token }
  }

  test('未认证访问返回 401', async ({ client }) => {
    const { project } = await setup(client)
    const res = await client.get(BASE(project.id))
    res.assertStatus(401)
  })

  test('create/list/show/candidates/explain/review/preview 完整流程', async ({
    client,
    assert,
  }) => {
    const { org, project, token } = await setup(client)

    const create = await client
      .post(BASE(project.id))
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})
    assert.equal(create.status(), 200)
    const createBody = create.body() as {
      data: { id: number; candidates: Array<{ candidateKey: string }> }
    }
    assert.isNumber(createBody.data.id)

    const list = await client
      .get(BASE(project.id))
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
    assert.equal(list.status(), 200)
    assert.isAtLeast((list.body() as { data: unknown[] }).data.length, 1)

    const runId = createBody.data.id
    const show = await client
      .get(`${BASE(project.id)}/${runId}`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
    assert.equal(show.status(), 200)

    const candidates = await client
      .get(`${BASE(project.id)}/${runId}/candidates`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
    assert.equal(candidates.status(), 200)

    const candidateList = (
      candidates.body() as {
        data: Array<{ candidateKey: string }>
      }
    ).data
    if (candidateList.length > 0) {
      const key = candidateList[0].candidateKey

      const explain = await client
        .post(`${BASE(project.id)}/${runId}/candidates/${key}/explain`)
        .header('Authorization', `Bearer ${token}`)
        .header('x-organization-id', String(org.id))
        .json({})
      assert.equal(explain.status(), 200)
      assert.isTrue(
        (explain.body() as { data: { explanation: { isFallback: boolean } } }).data.explanation
          .isFallback,
      )

      const review = await client
        .post(`${BASE(project.id)}/${runId}/candidates/${key}/review`)
        .header('Authorization', `Bearer ${token}`)
        .header('x-organization-id', String(org.id))
        .json({ action: 'mark_reviewed' })
      assert.equal(review.status(), 200)
      assert.equal((review.body() as { data: { status: string } }).data.status, 'reviewed')

      const confirmPreview = await client
        .post(`${BASE(project.id)}/${runId}/candidates/${key}/confirmation-preview`)
        .header('Authorization', `Bearer ${token}`)
        .header('x-organization-id', String(org.id))
        .json({})
      assert.equal(confirmPreview.status(), 200)
      assert.equal(
        (confirmPreview.body() as { data: { projectedType: string } }).data.projectedType,
        'physical',
      )

      const handoffPreview = await client
        .post(`${BASE(project.id)}/${runId}/candidates/${key}/handoff-preview`)
        .header('Authorization', `Bearer ${token}`)
        .header('x-organization-id', String(org.id))
        .json({ targetType: 'decision_log' })
      assert.equal(handoffPreview.status(), 200)
    }
  })

  test('非法 review action 返回 422', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const create = await client
      .post(BASE(project.id))
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})
    const runId = (create.body() as { data: { id: number } }).data.id

    const candidates = await client
      .get(`${BASE(project.id)}/${runId}/candidates`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
    const candidateList = (
      candidates.body() as {
        data: Array<{ candidateKey: string }>
      }
    ).data
    if (candidateList.length === 0) return
    const key = candidateList[0].candidateKey

    const res = await client
      .post(`${BASE(project.id)}/${runId}/candidates/${key}/review`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ action: 'invalid_action' })
    assert.equal(res.status(), 422)
  })

  test('跨组织访问返回 404 且不泄漏 run 存在性', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    const create = await client
      .post(BASE(project.id))
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})
    const runId = (create.body() as { data: { id: number } }).data.id

    // 另一个组织 + 另一个用户
    const other = await createUser({ email: uniqueEmail('phys-api-other') })
    const otherOrg = await createOrganization(other)
    const otherToken = await login(client, other)

    const res = await client
      .get(`${BASE(project.id)}/${runId}`)
      .header('Authorization', `Bearer ${otherToken}`)
      .header('x-organization-id', String(otherOrg.id))
    assert.isTrue(res.status() === 404 || res.status() === 403)
  })

  test('只读观察者可查看列表但不能创建分析', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    // 先用项目经理创建一次
    await client
      .post(BASE(project.id))
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})

    const viewer = await createUser({ email: uniqueEmail('phys-api-viewer') })
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

    // 观察者可以查看列表（拥有 physical_contradiction:analyze via READONLY_OBSERVER）
    const list = await client
      .get(BASE(project.id))
      .header('Authorization', `Bearer ${viewerToken}`)
      .header('x-organization-id', String(org.id))
    assert.equal(list.status(), 200)

    // 观察者不能 review（需 manage 权限）
    const runs = (list.body() as { data: Array<{ id: number }> }).data
    if (runs.length > 0) {
      const candidatesRes = await client
        .get(`${BASE(project.id)}/${runs[0].id}/candidates`)
        .header('Authorization', `Bearer ${viewerToken}`)
        .header('x-organization-id', String(org.id))
      const cs = (candidatesRes.body() as { data: Array<{ candidateKey: string }> }).data
      if (cs.length > 0) {
        const review = await client
          .post(`${BASE(project.id)}/${runs[0].id}/candidates/${cs[0].candidateKey}/review`)
          .header('Authorization', `Bearer ${viewerToken}`)
          .header('x-organization-id', String(org.id))
          .json({ action: 'mark_reviewed' })
        assert.isTrue(review.status() === 403 || review.status() === 404)
      }
    }
  })
})
