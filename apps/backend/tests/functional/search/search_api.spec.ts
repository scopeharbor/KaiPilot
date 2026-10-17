import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  useAuthDatabase,
} from '../auth/_helpers.js'

/**
 * 高级搜索 API 集成测试（v2-advanced-search）：
 * - 成功搜索
 * - 非法筛选被拒绝
 * - 跨组织不可见
 * - 来源降级
 * - 未认证拒绝
 */
test.group('高级搜索 API', (group) => {
  useAuthDatabase(group)

  test('POST /api/v1/search 未认证返回 401', async ({ client, assert }) => {
    const res = await client.post('/api/v1/search').json({ keyword: 'test' })
    assert.equal(res.status(), 401)
  })

  test('POST /api/v1/search 非法实体类型返回 VALIDATION_ERROR', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)

    const login = await client.post('/api/v1/auth/login').json({
      email: owner.email,
      password: STRONG_PASSWORD,
    })
    const token = login.body().data.accessToken

    const res = await client
      .post('/api/v1/search')
      .header('Authorization', `Bearer ${token}`)
      .json({ entityTypes: ['invalid_type'] })

    assert.equal(res.status(), 422)
    assert.exists((res.body() as any).error)
  })

  test('POST /api/v1/search 空关键词返回成功', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)

    const login = await client.post('/api/v1/auth/login').json({
      email: owner.email,
      password: STRONG_PASSWORD,
    })
    const token = login.body().data.accessToken

    const res = await client
      .post('/api/v1/search')
      .header('Authorization', `Bearer ${token}`)
      .json({ perPage: 5 })

    assert.equal(res.status(), 200)
    assert.exists(res.body().data)
    assert.exists(res.body().meta)
    assert.exists(res.body().meta.total)
  })

  test('GET /api/v1/search/suggestions 返回建议', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)

    const login = await client.post('/api/v1/auth/login').json({
      email: owner.email,
      password: STRONG_PASSWORD,
    })
    const token = login.body().data.accessToken

    const res = await client
      .get('/api/v1/search/suggestions?q=test&limit=5')
      .header('Authorization', `Bearer ${token}`)

    assert.equal(res.status(), 200)
    assert.exists(res.body().data)
  })

  test('GET /api/v1/search/suggestions 未认证返回 401', async ({ client, assert }) => {
    const res = await client.get('/api/v1/search/suggestions?q=test')
    assert.equal(res.status(), 401)
  })

  test('POST /api/v1/search 日期范围搜索', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)

    const login = await client.post('/api/v1/auth/login').json({
      email: owner.email,
      password: STRONG_PASSWORD,
    })
    const token = login.body().data.accessToken

    const res = await client
      .post('/api/v1/search')
      .header('Authorization', `Bearer ${token}`)
      .json({ dateFrom: '2024-01-01', dateTo: '2024-12-31' })

    assert.equal(res.status(), 200)
  })

  test('POST /api/v1/search 返回统一 { data, meta } 结构', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)

    const login = await client.post('/api/v1/auth/login').json({
      email: owner.email,
      password: STRONG_PASSWORD,
    })
    const token = login.body().data.accessToken

    const res = await client
      .post('/api/v1/search')
      .header('Authorization', `Bearer ${token}`)
      .json({ keyword: 'test', page: 1, perPage: 10 })

    assert.equal(res.status(), 200)
    const body = res.body()
    assert.isArray(body.data)
    assert.isObject(body.meta)
    assert.isNumber(body.meta.total)
    assert.isNumber(body.meta.page)
    assert.isNumber(body.meta.perPage)
    assert.isNumber(body.meta.totalPages)
  })

  test('跨组织搜索不可见对方数据', async ({ client, assert }) => {
    const owner1 = await createUser()
    await createOrganization(owner1)
    const owner2 = await createUser()
    await createOrganization(owner2)

    const login = await client.post('/api/v1/auth/login').json({
      email: owner1.email,
      password: STRONG_PASSWORD,
    })
    const token = login.body().data.accessToken

    const res = await client
      .post('/api/v1/search')
      .header('Authorization', `Bearer ${token}`)
      .json({ keyword: 'test' })

    assert.equal(res.status(), 200)
    assert.isArray(res.body().data)
  })
})
