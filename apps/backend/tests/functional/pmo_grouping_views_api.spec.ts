/**
 * PMO Portfolio Grouping Views API 功能性测试（v3-pmo-portfolio-grouping-views §4.10）。
 *
 * 覆盖：认证、权限拒绝、验证错误、列表响应 envelope、CRUD 响应、
 * 组织隔离、资源不存在 masking。
 */
import { test } from '@japa/runner'
import { createOrganization, createUser, uniqueEmail, useAuthDatabase } from './auth/_helpers.js'
import { PMO_GROUPING_VIEW_SCOPES, PMO_GROUPING_VIEW_PRIMARY_KEYS } from '@aiproj/types'

test.group('PMO Grouping Views API', (group) => {
  useAuthDatabase(group)

  async function setupAuth() {
    const owner = await createUser({
      email: uniqueEmail('pgv-api'),
      isSuperAdmin: true,
      password: 'Passw0rd!',
    })
    const org = await createOrganization(owner)
    return { org, owner }
  }

  async function login(client: any, user: any) {
    const response = await client.post('/api/v1/auth/login').json({
      email: user.email,
      password: 'Passw0rd!',
    })
    // 登录响应走统一 envelope：{ data: { user, accessToken, refreshToken } }
    return response.body().data.accessToken
  }

  // ─── 未认证 ─────────────────────────────────────────────────────────────

  test('GET /pmo/grouping-views 未认证返回 401', async ({ client, assert }) => {
    const response = await client.get('/api/v1/pmo/grouping-views')
    assert.equal(response.status(), 401)
  })

  test('POST /pmo/grouping-views/preview 未认证返回 401', async ({ client, assert }) => {
    const response = await client.post('/api/v1/pmo/grouping-views/preview').json({})
    assert.equal(response.status(), 401)
  })

  test('POST /pmo/grouping-views 未认证返回 401', async ({ client, assert }) => {
    const response = await client.post('/api/v1/pmo/grouping-views').json({
      name: 'test',
      scope: 'personal',
      query: { primaryGrouping: 'status' },
    })
    assert.equal(response.status(), 401)
  })

  test('PUT /pmo/grouping-views/:id 未认证返回 401', async ({ client, assert }) => {
    const response = await client.put('/api/v1/pmo/grouping-views/test-id').json({
      name: 'updated',
    })
    assert.equal(response.status(), 401)
  })

  test('DELETE /pmo/grouping-views/:id 未认证返回 401', async ({ client, assert }) => {
    const response = await client.delete('/api/v1/pmo/grouping-views/test-id')
    assert.equal(response.status(), 401)
  })

  // ─── 认证后列表 ─────────────────────────────────────────────────────────

  test('GET /pmo/grouping-views 认证后返回 200 + envelope', async ({ client, assert }) => {
    const { org, owner } = await setupAuth()
    const token = await login(client, owner)

    const response = await client
      .get('/api/v1/pmo/grouping-views')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))

    assert.equal(response.status(), 200)
    const body = response.body()
    assert.isArray(body.data)
    assert.isObject(body.meta)
    assert.isDefined(body.meta.page)
    assert.isDefined(body.meta.total)
    // 至少包含 6 个系统预设
    const presets = body.data.filter((v: any) => v.scope === 'system')
    assert.equal(presets.length, 6)
  })

  test('GET /pmo/grouping-views/:id 系统预设详情返回 200', async ({ client, assert }) => {
    const { org, owner } = await setupAuth()
    const token = await login(client, owner)

    const response = await client
      .get('/api/v1/pmo/grouping-views/system-by-status')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))

    assert.equal(response.status(), 200)
    const body = response.body()
    assert.equal(body.data.id, 'system-by-status')
    assert.equal(body.data.scope, 'system')
  })

  test('GET /pmo/grouping-views/:id 不存在返回 404', async ({ client, assert }) => {
    const { org, owner } = await setupAuth()
    const token = await login(client, owner)

    const response = await client
      .get('/api/v1/pmo/grouping-views/nonexistent-id')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))

    assert.equal(response.status(), 404)
    const body = response.body()
    assert.equal(body.error.code, 'RESOURCE_NOT_FOUND')
  })

  // ─── 预览 ───────────────────────────────────────────────────────────────

  test('POST /pmo/grouping-views/preview 认证后返回 200', async ({ client, assert }) => {
    const { org, owner } = await setupAuth()
    const token = await login(client, owner)

    const response = await client
      .post('/api/v1/pmo/grouping-views/preview')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
      .json({
        query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
      })

    assert.equal(response.status(), 200)
    const body = response.body()
    assert.isArray(body.data.groups)
    assert.isObject(body.data.meta)
    assert.isDefined(body.data.meta.calculatedAt)
  })

  test('POST /pmo/grouping-views/preview 按 viewId 预览返回 200', async ({ client, assert }) => {
    const { org, owner } = await setupAuth()
    const token = await login(client, owner)

    const response = await client
      .post('/api/v1/pmo/grouping-views/preview')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
      .json({ viewId: 'system-by-health' })

    assert.equal(response.status(), 200)
    const body = response.body()
    assert.isArray(body.data.groups)
  })

  test('POST /pmo/grouping-views/preview 敏感 query 返回 400', async ({ client, assert }) => {
    const { org, owner } = await setupAuth()
    const token = await login(client, owner)

    const response = await client
      .post('/api/v1/pmo/grouping-views/preview')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
      .json({
        query: {
          primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
          projectResults: [],
        },
      })

    assert.equal(response.status(), 400)
    const body = response.body()
    assert.equal(body.error.code, 'VALIDATION_ERROR')
  })

  // ─── 创建 ───────────────────────────────────────────────────────────────

  test('POST /pmo/grouping-views 创建个人视图返回 201', async ({ client, assert }) => {
    const { org, owner } = await setupAuth()
    const token = await login(client, owner)

    const response = await client
      .post('/api/v1/pmo/grouping-views')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
      .json({
        name: 'API 创建测试',
        scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
        query: {
          primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
          sort: 'project_count',
          order: 'desc',
        },
      })

    assert.equal(response.status(), 201)
    const body = response.body()
    assert.equal(body.data.name, 'API 创建测试')
    assert.equal(body.data.scope, 'personal')
    assert.equal(body.data.definitionVersion, 'grouping-view.v1')
    assert.isString(body.data.id)
  })

  test('POST /pmo/grouping-views 创建缺少 name 返回 422', async ({ client, assert }) => {
    const { org, owner } = await setupAuth()
    const token = await login(client, owner)

    const response = await client
      .post('/api/v1/pmo/grouping-views')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
      .json({
        scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
        query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
      })

    assert.equal(response.status(), 422)
  })

  test('POST /pmo/grouping-views 创建 system scope 返回 403', async ({ client, assert }) => {
    const { org, owner } = await setupAuth()
    const token = await login(client, owner)

    const response = await client
      .post('/api/v1/pmo/grouping-views')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
      .json({
        name: '非法系统视图',
        scope: PMO_GROUPING_VIEW_SCOPES.SYSTEM,
        query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
      })

    assert.equal(response.status(), 403)
  })

  test('POST /pmo/grouping-views 敏感内容 query 返回 400', async ({ client, assert }) => {
    const { org, owner } = await setupAuth()
    const token = await login(client, owner)

    const response = await client
      .post('/api/v1/pmo/grouping-views')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
      .json({
        name: '恶意视图',
        scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
        query: {
          primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
          projectResults: ['secret'],
          evidenceText: 'secret evidence',
        },
      })

    assert.equal(response.status(), 400)
  })

  // ─── 更新 ───────────────────────────────────────────────────────────────

  test('PUT /pmo/grouping-views/:id 更新成功返回 200', async ({ client, assert }) => {
    const { org, owner } = await setupAuth()
    const token = await login(client, owner)

    // 先创建一个视图
    const createRes = await client
      .post('/api/v1/pmo/grouping-views')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
      .json({
        name: '待更新视图',
        scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
        query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
      })
    const viewId = createRes.body().data.id

    const response = await client
      .put(`/api/v1/pmo/grouping-views/${viewId}`)
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
      .json({ name: '已更新名称', description: '新描述' })

    assert.equal(response.status(), 200)
    assert.equal(response.body().data.name, '已更新名称')
  })

  test('PUT /pmo/grouping-views/:id 更新系统预设返回 403', async ({ client, assert }) => {
    const { org, owner } = await setupAuth()
    const token = await login(client, owner)

    const response = await client
      .put('/api/v1/pmo/grouping-views/system-by-status')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
      .json({ name: '试图修改系统预设' })

    assert.equal(response.status(), 403)
  })

  test('PUT /pmo/grouping-views/:id 不存在返回 404', async ({ client, assert }) => {
    const { org, owner } = await setupAuth()
    const token = await login(client, owner)

    const response = await client
      .put('/api/v1/pmo/grouping-views/nonexistent-id')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
      .json({ name: 'noop' })

    assert.equal(response.status(), 404)
  })

  // ─── 删除 ───────────────────────────────────────────────────────────────

  test('DELETE /pmo/grouping-views/:id 删除成功返回 204', async ({ client, assert }) => {
    const { org, owner } = await setupAuth()
    const token = await login(client, owner)

    const createRes = await client
      .post('/api/v1/pmo/grouping-views')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
      .json({
        name: '待删除视图',
        scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
        query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
      })
    const viewId = createRes.body().data.id

    const response = await client
      .delete(`/api/v1/pmo/grouping-views/${viewId}`)
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))

    assert.equal(response.status(), 204)
  })

  test('DELETE /pmo/grouping-views/:id 删除系统预设返回 403', async ({ client, assert }) => {
    const { org, owner } = await setupAuth()
    const token = await login(client, owner)

    const response = await client
      .delete('/api/v1/pmo/grouping-views/system-by-status')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))

    assert.equal(response.status(), 403)
  })

  // ─── 复制 ───────────────────────────────────────────────────────────────

  test('POST /pmo/grouping-views/:id/duplicate 复制成功返回 201', async ({ client, assert }) => {
    const { org, owner } = await setupAuth()
    const token = await login(client, owner)

    const response = await client
      .post('/api/v1/pmo/grouping-views/system-by-status/duplicate')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
      .json({ name: '复制的视图' })

    assert.equal(response.status(), 201)
    assert.equal(response.body().data.name, '复制的视图')
    assert.equal(response.body().data.scope, 'personal')
  })

  // ─── 设默认 ────────────────────────────────────────────────────────────

  test('POST /pmo/grouping-views/:id/set-default 设置成功返回 200', async ({ client, assert }) => {
    const { org, owner } = await setupAuth()
    const token = await login(client, owner)

    const createRes = await client
      .post('/api/v1/pmo/grouping-views')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
      .json({
        name: '默认视图候选',
        scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
        query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
      })
    const viewId = createRes.body().data.id

    const response = await client
      .post(`/api/v1/pmo/grouping-views/${viewId}/set-default`)
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
      .json({ scope: 'personal' })

    assert.equal(response.status(), 200)
    assert.isTrue(response.body().data.isDefault)
  })

  // ─── 组织隔离 ───────────────────────────────────────────────────────────

  test('组织隔离：不同组织视图不可见', async ({ client, assert }) => {
    const { org: org1, owner: owner1 } = await setupAuth()
    const token1 = await login(client, owner1)

    // Org2 创建者
    const owner2 = await createUser({
      email: uniqueEmail('org2-owner'),
      isSuperAdmin: true,
    })
    const org2 = await createOrganization(owner2)
    const token2 = await login(client, owner2)

    // org1 创建视图
    await client
      .post('/api/v1/pmo/grouping-views')
      .header('Authorization', `Bearer ${token1}`)
      .header('X-Organization-Id', String(org1.id))
      .json({
        name: 'Org1 独占视图',
        scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
        query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
      })

    // org2 列表不出现 org1 的视图
    const response = await client
      .get('/api/v1/pmo/grouping-views')
      .header('Authorization', `Bearer ${token2}`)
      .header('X-Organization-Id', String(org2.id))

    const dbViews = response.body().data.filter((v: any) => v.scope !== 'system')
    assert.isTrue(dbViews.every((v: any) => v.name !== 'Org1 独占视图'))
  })

  // ─── 不存在的视图 masking ──────────────────────────────────────────────

  test('跨组织视图查询返回 404（隐藏资源存在）', async ({ client, assert }) => {
    const { org: org1, owner: owner1 } = await setupAuth()
    const token1 = await login(client, owner1)

    const owner2 = await createUser({
      email: uniqueEmail('org2-masking'),
      isSuperAdmin: true,
    })
    const org2 = await createOrganization(owner2)
    const token2 = await login(client, owner2)

    // org2 真实创建一个视图，再用 org1 身份访问该 id
    const created = await client
      .post('/api/v1/pmo/grouping-views')
      .header('Authorization', `Bearer ${token2}`)
      .header('X-Organization-Id', String(org2.id))
      .json({
        name: 'org2 私有视图',
        scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
        query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
      })
    assert.equal(created.status(), 201)
    const org2ViewId = created.body().data.id

    // 由于组织隔离，即使 viewId 确实存在，也必须对 org1 表现为不存在
    const response = await client
      .get(`/api/v1/pmo/grouping-views/${org2ViewId}`)
      .header('Authorization', `Bearer ${token1}`)
      .header('X-Organization-Id', String(org1.id))

    // 不存在或不可见的视图统一返回 404（不泄露存在性）
    assert.equal(response.status(), 404)
  })
})
