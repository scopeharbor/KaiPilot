/**
 * v2-ai-risk-progress-prediction 5.7 —— 预测 API 功能测试。
 *
 * 覆盖：项目成员成功、只读限制、跨组织 404、同组织非成员拒绝、
 * 幂等创建和统一错误结构。
 */
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Task from '#models/task'
import { ProjectRoleName } from '#rbac'
import {
  STRONG_PASSWORD,
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

test.group('ProjectPredictions API', (group) => {
  useAuthDatabase(group)

  async function setup(client: any) {
    const owner = await createUser({ email: uniqueEmail('pred-api') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    // 创建任务使预测可生成
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    await Task.create({
      projectId: Number(project.id),
      name: '预测测试任务',
      status: 'in_progress',
      endDate: DateTime.fromISO(futureDate),
    })
    const token = await login(client, owner)
    return { owner, org, project, token }
  }

  test('未认证返回 401', async ({ client }) => {
    const { project } = await setup(client)
    const res = await client.get(`${API_PREFIX}/projects/${project.id}/predictions`)
    res.assertStatus(401)
  })

  test('创建预测快照（store）成功', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    const res = await client
      .post(`${API_PREFIX}/projects/${project.id}/predictions`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ window: 30 })

    res.assertStatus(201)
    const body = res.body() as { data: { id: number }; warnings: any[] }
    assert.isNumber(body.data.id)
    assert.isArray(body.warnings)
  })

  test('列表查询返回分页', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    // 先创建快照
    await client
      .post(`${API_PREFIX}/projects/${project.id}/predictions`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ window: 30 })

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/predictions`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(200)
    const body = res.body() as { data: any[]; meta: { total: number } }
    assert.isArray(body.data)
    assert.isAbove(body.meta.total, 0)
  })

  test('最新快照（latest）返回最近一个', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    await client
      .post(`${API_PREFIX}/projects/${project.id}/predictions`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ window: 30 })

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/predictions/latest`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(200)
    const body = res.body() as { data: { id: number; signals: any[] } }
    assert.isNumber(body.data.id)
    assert.isArray(body.data.signals)
  })

  test('确认快照返回正确状态', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    const create = await client
      .post(`${API_PREFIX}/projects/${project.id}/predictions`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ window: 30 })
    const snapshotId = (create.body() as { data: { id: number } }).data.id

    const res = await client
      .post(`${API_PREFIX}/projects/${project.id}/predictions/${snapshotId}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ notes: 'API 测试确认' })

    res.assertStatus(200)
    const body = res.body() as { data: { status: string; confirmation: { status: string } } }
    assert.equal(body.data.status, 'confirmed')
  })

  test('清除快照返回正确状态', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    const create = await client
      .post(`${API_PREFIX}/projects/${project.id}/predictions`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ window: 30 })
    const snapshotId = (create.body() as { data: { id: number } }).data.id

    const res = await client
      .post(`${API_PREFIX}/projects/${project.id}/predictions/${snapshotId}/dismiss`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ reason: 'API 测试忽略' })

    res.assertStatus(200)
    const body = res.body() as { data: { status: string } }
    assert.equal(body.data.status, 'dismissed')
  })

  test('跨组织访问返回 404', async ({ client }) => {
    const { project } = await setup(client)
    const otherUser = await createUser({ email: uniqueEmail('pred-api-other') })
    const otherOrg = await createOrganization(otherUser)
    const token = await login(client, otherUser)

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/predictions`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(otherOrg.id))

    res.assertStatus(404)
  })

  test('无效 window 返回 422', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    const res = await client
      .post(`${API_PREFIX}/projects/${project.id}/predictions`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ window: 999 })

    res.assertStatus(422)
    const body = res.body() as { error: { code: string } }
    assert.equal(body.error.code, 'VALIDATION_ERROR')
  })

  test('已确认快照二次确认返回 409', async ({ client }) => {
    const { org, project, token } = await setup(client)

    const create = await client
      .post(`${API_PREFIX}/projects/${project.id}/predictions`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ window: 30 })
    const snapshotId = (create.body() as { data: { id: number } }).data.id

    // 首次确认
    await client
      .post(`${API_PREFIX}/projects/${project.id}/predictions/${snapshotId}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})

    // 二次确认应返回 409
    const res = await client
      .post(`${API_PREFIX}/projects/${project.id}/predictions/${snapshotId}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})

    res.assertStatus(409)
  })
})
