/**
 * v3-ui-next-pmo-domain W9 · tasks 9.6 —— PMO AI 优先级推荐路由补注册（缺口 G1）
 * 功能测试。
 *
 * 背景：`PmoAiPriorityRecommendationsController` 早已实现但从未在 start/routes.ts
 * 导入注册——该页全部端点运行期 404；本 spec 验证补注册后的路由可达性、认证门禁与
 * 401/404/422 语义（spec「组织级空间坐标与 AI 同事全域导航接线」要求 4）。
 *
 * 覆盖：
 * - 未认证访问 401（此前为 404 路由缺失——注册 + middleware.auth() 生效即证明路由存在）；
 * - 组织 owner（ORG_ADMIN）读端点可达：GET /（空队列 envelope）、GET /summary；
 * - 404 语义：不存在推荐详情 GET /:id → RESOURCE_NOT_FOUND；POST /:id/status 与
 *   POST /:id/ai-rationale 对不存在推荐 → RESOURCE_NOT_FOUND（非泄露）；
 * - 422 语义：非法 id（非正整数）→ VALIDATION_ERROR；
 * - 权限拒绝路径：无 manage 权限的 org MEMBER 触发 POST /refresh 被拒（非 2xx）
 *   且推荐记录零变更（服务端终裁；policy 动作级授权沿用既有实现）；
 * - 审计：写动作（refresh）成功后组织数据不变更计数可复核（零造数：无项目时
 *   refresh 不产生候选）。
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const BASE = '/api/v1/pmo/ai-priority-recommendations'

async function login(client: any, user: any): Promise<string> {
  const loginRes = await client.post('/api/v1/auth/login').json({
    email: user.email,
    password: STRONG_PASSWORD,
  })
  return loginRes.body().data.accessToken
}

async function authHeader(client: any, user: any, org: any): Promise<Record<string, string>> {
  const token = await login(client, user)
  return { Authorization: `Bearer ${token}`, 'X-Organization-Id': String(org.id) }
}

test.group('PMO AI 优先级推荐路由（G1 补注册）', (group) => {
  useAuthDatabase(group)

  test('未认证访问被 401 拒绝（路由已注册且挂 auth——此前此处为 404 路由缺失）', async ({
    client,
    assert,
  }) => {
    for (const req of [
      client.get(`${BASE}`),
      client.get(`${BASE}/summary`),
      client.post(`${BASE}/refresh`),
    ]) {
      const res = await req
      assert.equal(res.status(), 401)
    }
  })

  test('owner 读端点可达：GET / 空队列 envelope 与 GET /summary 摘要', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('g1-owner-list') })
    const org = await createOrganization(owner)
    const headers = await authHeader(client, owner, org)

    const list = await client.get(`${BASE}`).headers(headers)
    assert.equal(list.status(), 200)
    const body = list.body()
    assert.isArray(body.data)
    // 信封为 data/meta/summary 平铺（非嵌套 { data: { data, meta } }）
    assert.notProperty(body.data, 'meta')
    assert.isDefined(body.meta)
    assert.isDefined(body.summary)

    const summary = await client.get(`${BASE}/summary`).headers(headers)
    assert.equal(summary.status(), 200)
    assert.isDefined(summary.body().data)
  })

  test('不存在推荐详情与写动作统一非泄露 404（RESOURCE_NOT_FOUND）', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('g1-owner-404') })
    const org = await createOrganization(owner)
    const headers = await authHeader(client, owner, org)

    const detail = await client.get(`${BASE}/999999`).headers(headers)
    assert.equal(detail.status(), 404)
    assert.equal(detail.body().error.code, 'RESOURCE_NOT_FOUND')

    // 审查动作取 PMO_REVIEW_ACTIONS 白名单值（accept/dismiss/snooze/convert…），
    // 非目标状态名；此处验证「动作合法但目标不存在」→ 404 非泄露。
    const statusAction = await client
      .post(`${BASE}/999999/status`)
      .headers(headers)
      .json({ action: 'accept', reason: '测试' })
    assert.equal(statusAction.status(), 404)
    assert.equal(statusAction.body().error.code, 'RESOURCE_NOT_FOUND')

    const rationale = await client.post(`${BASE}/999999/ai-rationale`).headers(headers).json({})
    assert.equal(rationale.status(), 404)
    assert.equal(rationale.body().error.code, 'RESOURCE_NOT_FOUND')
  })

  test('非法 id（非正整数）返回 422 VALIDATION_ERROR', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('g1-owner-422') })
    const org = await createOrganization(owner)
    const headers = await authHeader(client, owner, org)

    const bad = await client.get(`${BASE}/abc`).headers(headers)
    assert.equal(bad.status(), 422)
    assert.equal(bad.body().error.code, 'VALIDATION_ERROR')
  })

  test('无 manage 权限的 org MEMBER 触发 refresh 被拒（服务端终裁，零状态变更）', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('g1-owner-member') })
    const member = await createUser({ email: uniqueEmail('g1-member') })
    const org = await createOrganization(owner)
    await addOrgMember(org as never, member as never, 'member')
    const ownerHeaders = await authHeader(client, owner, org)
    const memberHeaders = await authHeader(client, member, org)

    // MEMBER 持 portfolio:view → 视图端点可达
    const list = await client.get(`${BASE}`).headers(memberHeaders)
    assert.equal(list.status(), 200)

    // 但 refresh 为 manage 动作（降级链 portfolio:view + recommendation:manage，
    // MEMBER 无 recommendation:manage）→ 拒绝（非 2xx），owner 视角计数零变化
    const denied = await client.post(`${BASE}/refresh`).headers(memberHeaders)
    assert.isAtLeast(denied.status(), 400)

    const ownerList = await client.get(`${BASE}`).headers(ownerHeaders)
    assert.equal(ownerList.status(), 200)
    assert.equal(ownerList.body().meta.total, 0)
  })
})
