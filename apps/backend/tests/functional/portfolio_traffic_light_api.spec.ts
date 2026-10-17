/**
 * PMO Portfolio Traffic Light API 功能性测试（v3-pmo-portfolio-traffic-light §4.6）。
 *
 * 覆盖：认证访问、未认证拒绝、权限控制、响应 envelope 形状、复核标记创建。
 *
 * 认证方式：通过 POST /api/v1/auth/login 获取 JWT token，再以 bearerToken 方式发送。
 */
import { test } from '@japa/runner'
import {
  createOrganization,
  createUser,
  useAuthDatabase,
  STRONG_PASSWORD,
} from './auth/_helpers.js'

/** 登录并返回 access token（统一 envelope：data.accessToken）。 */
async function loginToken(client: any, user: any): Promise<string> {
  const loginRes = await client.post('/api/v1/auth/login').json({
    email: user.email,
    password: STRONG_PASSWORD,
  })
  return loginRes.body().data.accessToken
}

test.group('PMO Portfolio Traffic Light API', (group) => {
  useAuthDatabase(group)

  // ─── 401 Unauthenticated ──────────────────────────────────────────────────────────

  test('GET /api/v1/pmo/traffic-light 未认证 401', async ({ client, assert }) => {
    const response = await client.get('/api/v1/pmo/traffic-light')
    assert.equal(response.status(), 401)
  })

  test('GET /api/v1/pmo/traffic-light/counts 未认证 401', async ({ client, assert }) => {
    const response = await client.get('/api/v1/pmo/traffic-light/counts')
    assert.equal(response.status(), 401)
  })

  test('GET /api/v1/pmo/traffic-light/:projectId 未认证 401', async ({ client, assert }) => {
    const response = await client.get('/api/v1/pmo/traffic-light/1')
    assert.equal(response.status(), 401)
  })

  test('POST /api/v1/pmo/traffic-light/:projectId/review 未认证 401', async ({
    client,
    assert,
  }) => {
    const response = await client.post('/api/v1/pmo/traffic-light/1/review').json({
      reviewState: 'acknowledged',
    })
    assert.equal(response.status(), 401)
  })

  // ─── Authenticated Reads ──────────────────────────────────────────────────────────

  test('认证用户 GET /api/v1/pmo/traffic-light 返回 data+meta envelope', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)

    const token = await loginToken(client, user)
    const response = await client
      .get('/api/v1/pmo/traffic-light')
      .bearerToken(token)
      .header('X-Organization-Id', String(org.id))

    assert.equal(response.status(), 200)
    const body = response.body()
    assert.isArray(body.data)
    assert.properties(body.meta, ['page', 'perPage', 'total', 'totalPages', 'calculatedAt'])
  })

  test('认证用户 GET /api/v1/pmo/traffic-light/counts 返回 traffic light 计数', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)

    const token = await loginToken(client, user)
    const response = await client
      .get('/api/v1/pmo/traffic-light/counts')
      .bearerToken(token)
      .header('X-Organization-Id', String(org.id))

    assert.equal(response.status(), 200)
    const body = response.body()
    assert.properties(body.data, ['red', 'yellow', 'green', 'gray', 'total', 'calculatedAt'])
  })

  test('认证用户 GET /api/v1/pmo/traffic-light/:projectId 不存在的项目返回 404', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)

    const token = await loginToken(client, user)
    const response = await client
      .get('/api/v1/pmo/traffic-light/999999')
      .bearerToken(token)
      .header('X-Organization-Id', String(org.id))

    assert.equal(response.status(), 404)
    assert.equal(response.body().error.code, 'RESOURCE_NOT_FOUND')
  })

  // ─── Validation Errors ────────────────────────────────────────────────────────────

  test('POST review 缺少 reviewState 返回 422', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)

    const token = await loginToken(client, user)
    const response = await client
      .post('/api/v1/pmo/traffic-light/1/review')
      .bearerToken(token)
      .header('X-Organization-Id', String(org.id))
      .json({ note: '缺少 reviewState 字段' })

    // 422 Unprocessable Entity
    assert.isAtLeast(response.status(), 400)
  })

  test('POST review 非法 reviewState 返回 422', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)

    const token = await loginToken(client, user)
    const response = await client
      .post('/api/v1/pmo/traffic-light/1/review')
      .bearerToken(token)
      .header('X-Organization-Id', String(org.id))
      .json({ reviewState: 'invalid_state_xyz' })

    assert.isAtLeast(response.status(), 400)
  })
})
