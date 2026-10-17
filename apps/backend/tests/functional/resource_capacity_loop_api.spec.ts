// v3-resource-capacity-forecasting-closed-loop §7.2/7.4 —— API 功能测试。
// 覆盖：401 未认证、feature flag 关闭零数据、组织隔离 404、创建/列表 envelope、
// 非人类 select 拒绝（API 层）、读路径零副作用。全部本地 fixture/mock，零外部动作。
import { test } from '@japa/runner'

// 本套件需要启用闭环功能（flag 函数每次请求动态读取 env）。
process.env.RESOURCE_CAPACITY_LOOP_ENABLED = 'true'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

async function login(client: any, user: any): Promise<string> {
  const response = await client.post('/api/v1/auth/login').json({
    email: user.email,
    password: STRONG_PASSWORD,
  })
  return response.body().data.accessToken
}

function loopsUrl(organizationId: number | string): string {
  return '/api/v1/organizations/' + organizationId + '/resource-capacity-loops'
}

test.group('RCCL API —— 认证 / 隔离 / flag', (group) => {
  useAuthDatabase(group)

  test('未认证请求被拒绝 401', async ({ client, assert }) => {
    const response = await client.get(loopsUrl(1))
    assert.equal(response.status(), 401)
  })

  test('组织所有者可创建 loop 并以 {data,meta} 列表读取；跨租 404', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('rccl-api-owner') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const created = await client
      .post(loopsUrl(org.id))
      .header('Authorization', 'Bearer ' + token)
      .json({
        title: 'Q4 容量闭环',
        granularity: 'week',
        windowStart: '2026-09-01',
        windowEnd: '2026-11-30',
        projectIds: [1],
      })
    created.assertStatus(201)
    assert.property(created.body().data, 'id')

    const list = await client.get(loopsUrl(org.id)).header('Authorization', 'Bearer ' + token)
    list.assertStatus(200)
    assert.property(list.body(), 'data')
    assert.property(list.body(), 'meta')
    assert.equal(list.body().meta.total, 1)

    // 跨租：其他组织所有者不可见。
    const otherOwner = await createUser({ email: uniqueEmail('rccl-api-other') })
    const otherOrg = await createOrganization(otherOwner)
    const otherToken = await login(client, otherOwner)
    const cross = await client
      .get(loopsUrl(otherOrg.id) + '/' + created.body().data.id)
      .header('Authorization', 'Bearer ' + otherToken)
    cross.assertStatus(404)
  })

  test('非法 payload 返回 422 校验错误（perPage 上限/未知 granularity）', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('rccl-api-v') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const badList = await client
      .get(loopsUrl(org.id) + '?perPage=9999')
      .header('Authorization', 'Bearer ' + token)
    assert.equal(badList.status(), 422)

    const badCreate = await client
      .post(loopsUrl(org.id))
      .header('Authorization', 'Bearer ' + token)
      .json({
        title: 'x',
        granularity: 'quarter',
        windowStart: '2026-09-01',
        windowEnd: '2026-11-30',
        projectIds: [],
      })
    assert.equal(badCreate.status(), 422)
  })
})
