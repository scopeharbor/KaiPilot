/**
 * v2-5-api-v2-surface —— API v2 能力发现端点测试
 *
 * 覆盖：
 * - 特性门禁启用时返回 200 + apiV2Enabled: true
 * - 响应结构（version、endpoints、total）
 * - 每个端点必须包含公开字段（id/method/path/sourceCapability/contractVersion/status）
 * - 不泄露内部字段（无 fallback、rbac、verificationCmd）
 * - 无需认证即可访问（auth: 'optional'）
 */
import { test } from '@japa/runner'
import env from '#start/env'

test.group('API v2 capabilities — 特性启用', (group) => {
  group.setup(() => {
    env.set('API_V2_ENABLED', 'true')
  })

  group.teardown(() => {
    env.set('API_V2_ENABLED', 'false')
  })

  // ── 测试 1：启用时返回 200 + apiV2Enabled ──────────────────────
  test('GET /api/v2/capabilities 返回 200 且 apiV2Enabled 为 true', async ({ client }) => {
    const res = await client.get('/api/v2/capabilities')
    res.assertStatus(200)
    res.assertBodyContains({ apiV2Enabled: true })
  })

  // ── 测试 2：version 与 endpoints 结构 ──────────────────────────
  test('响应含 version: "2" 且 endpoints 为数组', async ({ client, assert }) => {
    const res = await client.get('/api/v2/capabilities')
    res.assertStatus(200)
    const body = res.body() as any
    assert.equal(body.version, '2')
    assert.isArray(body.endpoints)
    assert.isNumber(body.total)
    assert.equal(body.total, body.endpoints.length)
  })

  // ── 测试 3：每个端点的必填字段 ─────────────────────────────────
  test('每个 endpoint 包含 id、method、path、sourceCapability、contractVersion、status', async ({
    client,
    assert,
  }) => {
    const res = await client.get('/api/v2/capabilities')
    res.assertStatus(200)
    const endpoints = (res.body() as any).endpoints as Array<Record<string, unknown>>
    assert.isAtLeast(endpoints.length, 1, '应至少有一个已准入的 v2 端点')

    for (const ep of endpoints) {
      assert.property(ep, 'id')
      assert.property(ep, 'method')
      assert.property(ep, 'path')
      assert.property(ep, 'sourceCapability')
      assert.property(ep, 'contractVersion')
      assert.property(ep, 'status')

      assert.isString(ep.id)
      assert.isString(ep.method)
      assert.isString(ep.path)
      assert.isString(ep.sourceCapability)
      assert.isString(ep.contractVersion)
      assert.isString(ep.status)

      const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
      const validStatuses = ['admitted', 'experimental', 'deprecated', 'removed']
      assert.isTrue(validMethods.includes(ep.method as string), `${ep.method} 不是有效 HTTP 方法`)
      assert.isTrue(validStatuses.includes(ep.status as string), `${ep.status} 不是有效端点状态`)
    }
  })

  // ── 测试 4：敏感字段不泄露 ─────────────────────────────────────
  test('响应不泄露 fallback、rbac、verificationCmd 等内部字段', async ({ client, assert }) => {
    const res = await client.get('/api/v2/capabilities')
    res.assertStatus(200)
    const body = res.body() as any
    assert.notProperty(body, 'fallback')
    assert.notProperty(body, 'rbac')
    assert.notProperty(body, 'verificationCmd')

    const endpoints = body.endpoints as Array<Record<string, unknown>>
    for (const ep of endpoints) {
      assert.notProperty(ep, 'fallback')
      assert.notProperty(ep, 'rbac')
      assert.notProperty(ep, 'verificationCmd')
      assert.notProperty(ep, 'v1Relationship')
      assert.notProperty(ep, 'auth')
      assert.notProperty(ep, 'sideEffectClass')
      assert.notProperty(ep, 'auditBehavior')
      assert.notProperty(ep, 'featureFlag')
      assert.notProperty(ep, 'orgIsolation')
    }
  })

  // ── 测试 5：无需认证即可访问 ───────────────────────────────────
  test('capabilities 端点无需认证返回 200', async ({ client }) => {
    // 不传 bearer token，验证仍正常返回
    const res = await client.get('/api/v2/capabilities')
    res.assertStatus(200)
    res.assertBodyContains({ apiV2Enabled: true })
  })
})
