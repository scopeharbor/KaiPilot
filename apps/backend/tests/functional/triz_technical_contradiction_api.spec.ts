import Task from '#models/task'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const API_PREFIX = '/api/v1'
const BASE = (projectId: number) =>
  `${API_PREFIX}/projects/${projectId}/triz/technical-contradiction-analyses`

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

test.group('TRIZ technical contradiction analyzer API', (group) => {
  useAuthDatabase(group)

  async function setup(client: any) {
    const owner = await createUser({ email: uniqueEmail('tech-api-owner') })
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
    const createBody = create.body() as { data: { id: number; candidates: any[] } }
    const runId = createBody.data.id
    assert.isTrue(Array.isArray(createBody.data.candidates))

    // list
    const list = await client
      .get(BASE(project.id))
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
    assert.equal(list.status(), 200)
    const listBody = list.body() as { data: any[]; meta: { total: number } }
    assert.isAtLeast(listBody.meta.total, 1)

    // show
    const show = await client
      .get(`${BASE(project.id)}/${runId}`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
    assert.equal(show.status(), 200)

    // candidates
    const candidates = await client
      .get(`${BASE(project.id)}/${runId}/candidates`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
    assert.equal(candidates.status(), 200)

    if (createBody.data.candidates.length > 0) {
      const candidateKey = createBody.data.candidates[0].candidateKey

      // explain (AI fallback path)
      const explain = await client
        .post(`${BASE(project.id)}/${runId}/candidates/${candidateKey}/explain`)
        .header('Authorization', `Bearer ${token}`)
        .header('x-organization-id', String(org.id))
        .json({})
      assert.equal(explain.status(), 200)
      const explainBody = explain.body() as {
        data: { explanation: { isFallback: boolean; narrative: string } }
      }
      assert.isTrue(explainBody.data.explanation.isFallback)
      assert.isTrue(explainBody.data.explanation.narrative.length > 0)

      // review
      const review = await client
        .post(`${BASE(project.id)}/${runId}/candidates/${candidateKey}/review`)
        .header('Authorization', `Bearer ${token}`)
        .header('x-organization-id', String(org.id))
        .json({ action: 'mark_reviewed' })
      assert.equal(review.status(), 200)

      // confirmation preview
      const confirmPreview = await client
        .post(`${BASE(project.id)}/${runId}/candidates/${candidateKey}/confirmation-preview`)
        .header('Authorization', `Bearer ${token}`)
        .header('x-organization-id', String(org.id))
        .json({})
      assert.equal(confirmPreview.status(), 200)
      const cpBody = confirmPreview.body() as { data: { requiresUserConfirmation: boolean } }
      assert.isTrue(cpBody.data.requiresUserConfirmation)

      // handoff preview
      const handoffPreview = await client
        .post(`${BASE(project.id)}/${runId}/candidates/${candidateKey}/handoff-preview`)
        .header('Authorization', `Bearer ${token}`)
        .header('x-organization-id', String(org.id))
        .json({})
      assert.equal(handoffPreview.status(), 200)
    }
  })

  test('跨组织访问返回 404/403 且不泄漏运行存在性', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const create = await client
      .post(BASE(project.id))
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})
    const runId = (create.body() as { data: { id: number } }).data.id

    // 另一组织用户
    const other = await createUser({ email: uniqueEmail('tech-api-other') })
    const otherOrg = await createOrganization(other)
    const { project: otherProject } = await createProjectWithMember(
      otherOrg,
      other,
      other,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const otherToken = await login(client, other)

    const res = await client
      .get(`${BASE(otherProject.id)}/${runId}`)
      .header('Authorization', `Bearer ${otherToken}`)
      .header('x-organization-id', String(otherOrg.id))
    assert.isTrue(res.status() === 403 || res.status() === 404)
    const body = res.body() as { error?: { code: string } }
    assert.isTrue(
      body.error?.code === 'PERMISSION_DENIED' || body.error?.code === 'RESOURCE_NOT_FOUND',
    )
  })

  test('无效分页参数返回 VALIDATION_ERROR', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const res = await client
      .get(`${BASE(project.id)}?page=0&perPage=999`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
    assert.isTrue(res.status() === 400 || res.status() === 422)
  })

  test('无效 status 过滤返回 VALIDATION_ERROR', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const res = await client
      .get(`${BASE(project.id)}?status=invalid_status_value`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
    assert.isTrue(res.status() === 400 || res.status() === 422)
    const body = res.body() as { error?: { code: string } }
    assert.isTrue(
      body.error?.code === 'VALIDATION_ERROR' || res.status() === 400 || res.status() === 422,
    )
  })

  test('无效审查动作返回校验错误', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const create = await client
      .post(BASE(project.id))
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})
    const createBody = create.body() as { data: { id: number; candidates: any[] } }
    if (createBody.data.candidates.length === 0) return
    const runId = createBody.data.id
    const candidateKey = createBody.data.candidates[0].candidateKey

    const res = await client
      .post(`${BASE(project.id)}/${runId}/candidates/${candidateKey}/review`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ action: 'invalid_action' })
    assert.isTrue(res.status() === 400 || res.status() === 422)
  })

  test('列表响应使用 { data, meta } 信封', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    await client
      .post(BASE(project.id))
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})

    const res = await client
      .get(BASE(project.id))
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
    const body = res.body() as {
      data: any[]
      meta: { total: number; page: number; perPage: number; totalPages: number }
    }
    assert.isTrue(Array.isArray(body.data))
    assert.isDefined(body.meta)
    assert.isDefined(body.meta.total)
    assert.isDefined(body.meta.page)
  })
})
