/**
 * PMO 优先级评分 API 功能测试（v3-pmo-priority-scoring-model §3.6）
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'
import Project from '#models/project'

async function login(client: any, user: any): Promise<string> {
  const loginRes = await client.post('/api/v1/auth/login').json({
    email: user.email,
    password: STRONG_PASSWORD,
  })
  return loginRes.body().data.accessToken
}

test.group('PMO Priority Scoring API', (group) => {
  useAuthDatabase(group)

  test('未认证用户被拒绝 401', async ({ client, assert }) => {
    const res = await client.get('/api/v1/pmo/priority-scoring/summary')
    assert.equal(res.status(), 401)
  })

  test('认证用户读取空组合摘要', async ({ client, assert }) => {
    const user = await createUser({ email: uniqueEmail('pmo-ps-empty') })
    const org = await createOrganization(user)
    const token = await login(client, user)

    const res = await client
      .get('/api/v1/pmo/priority-scoring/summary')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))

    assert.equal(res.status(), 200)
    const body = res.body()
    assert.isDefined(body.data)
    const emptyWarn = body.data.warnings.find((w: any) => w.code === 'EMPTY_PORTFOLIO')
    assert.isDefined(emptyWarn)
  })

  test('认证用户读取项目评分列表', async ({ client, assert }) => {
    const user = await createUser({ email: uniqueEmail('pmo-ps-list') })
    const org = await createOrganization(user)
    const token = await login(client, user)

    // 创建测试项目
    await Project.create({
      name: '评分测试项目',
      organizationId: org.id,
      status: 'active',
      priority: 'high',
      createdBy: user.id,
    })

    const res = await client
      .get('/api/v1/pmo/priority-scoring/projects?page=1&perPage=10')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))

    assert.equal(res.status(), 200)
    const body = res.body()
    assert.isDefined(body.data)
    assert.isDefined(body.meta)
    assert.equal(body.meta.page, 1)
    assert.equal(body.meta.perPage, 10)
  })

  test('权重版本端点可访问', async ({ client, assert }) => {
    const user = await createUser({ email: uniqueEmail('pmo-ps-weights') })
    const org = await createOrganization(user)
    const token = await login(client, user)

    const res = await client
      .get('/api/v1/pmo/priority-scoring/weights')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))

    assert.equal(res.status(), 200)
    const body = res.body()
    assert.isDefined(body.data)
    assert.equal(body.data.version, 'pmo-priority-v1')
    assert.equal(body.data.dimensions.length, 8)
  })

  test('分组切片端点可访问', async ({ client, assert }) => {
    const user = await createUser({ email: uniqueEmail('pmo-ps-groups') })
    const org = await createOrganization(user)
    const token = await login(client, user)

    const res = await client
      .get('/api/v1/pmo/priority-scoring/groups?groupBy=priority_level')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))

    assert.equal(res.status(), 200)
    const body = res.body()
    assert.isDefined(body.data)
    assert.isDefined(body.meta)
  })

  test('跨组织排除', async ({ client, assert }) => {
    const user = await createUser({ email: uniqueEmail('pmo-ps-cross') })
    const org = await createOrganization(user)
    const token = await login(client, user)

    const otherUser = await createUser({ email: uniqueEmail('pmo-ps-other') })
    const otherOrg = await createOrganization(otherUser)

    await Project.create({
      name: '其他组织项目',
      organizationId: otherOrg.id,
      status: 'active',
      createdBy: otherUser.id,
    })

    const res = await client
      .get('/api/v1/pmo/priority-scoring/projects')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))

    assert.equal(res.status(), 200)
    const body = res.body()
    for (const item of body.data) {
      assert.notEqual(item.projectName, '其他组织项目')
    }
  })

  test('不支持的 perPage 返回错误', async ({ client, assert }) => {
    const user = await createUser({ email: uniqueEmail('pmo-ps-valid') })
    const org = await createOrganization(user)
    const token = await login(client, user)

    const res = await client
      .get('/api/v1/pmo/priority-scoring/projects?perPage=200')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))

    assert.isAbove(res.status(), 399)
  })

  test('响应 envelope 形状正确', async ({ client, assert }) => {
    const user = await createUser({ email: uniqueEmail('pmo-ps-env') })
    const org = await createOrganization(user)
    const token = await login(client, user)

    const res = await client
      .get('/api/v1/pmo/priority-scoring/summary')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))

    assert.equal(res.status(), 200)
    const body = res.body()
    assert.isDefined(body.data)
    assert.property(body.data, 'totalProjects')
    assert.property(body.data, 'scoreVersion')
    assert.property(body.data, 'levelCounts')
    assert.property(body.data, 'warnings')
  })
})
