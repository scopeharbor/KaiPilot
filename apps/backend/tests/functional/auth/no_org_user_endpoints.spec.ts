import { test } from '@japa/runner'
import { createUser, uniqueEmail, useAuthDatabase } from './_helpers.js'
import Organization from '#models/organization'
import OrganizationMember from '#models/organization_member'

/**
 * 回归测试（个人/无组织账号修复）：
 * 已认证但未加入任何组织的用户（Google 个人账号等价态，token 无 organizationId）
 * 访问组织级关键端点必须返回可读的 403/404，而不是 500。
 *
 * 曾复现：
 *   GET /api/v1/notifications/unread-count → 500 TypeError: Cannot read properties
 *     of undefined (reading 'organizationId')（`ctx.tenant!` 崩潰）
 *   GET /api/v1/organizations/:id/dashboard/layouts/current → 500
 *     Cannot inject（DI 链损坏，全體用户）
 */
test.group('无组织用户访问组织级端点（不 500）', (group) => {
  useAuthDatabase(group)

  test('无组织用户 unread-count 返回 403 而非 500', async ({ assert, client }) => {
    const email = uniqueEmail('no-org')
    await createUser({ email })
    const login = await client.post('/api/v1/auth/login').json({
      email,
      password: 'Passw0rd!',
    })
    const token = login.body().data.accessToken as string

    const res = await client.get('/api/v1/notifications/unread-count').bearerToken(token)
    assert.equal(res.status(), 403)
    const body = res.body()
    assert.equal(body.error?.code, 'PERMISSION_DENIED')
    assert.isTrue(body.error?.message.includes('组织'), '错误信息可读')
  })

  test('无组织用户访问他人组织布局端点返回 404 而非 500', async ({ assert, client }) => {
    const email = uniqueEmail('no-org2')
    await createUser({ email })
    const login = await client.post('/api/v1/auth/login').json({
      email,
      password: 'Passw0rd!',
    })
    const token = login.body().data.accessToken as string

    const owner = await createUser()
    const org = await Organization.create({
      ownerId: owner.id,
      name: '目标组织',
      slug: `target-${Date.now()}`,
      planTier: 'free',
    })
    await OrganizationMember.create({ organizationId: org.id, userId: owner.id, role: 'owner' })

    const res = await client
      .get(`/api/v1/organizations/${org.id}/dashboard/layouts/current`)
      .bearerToken(token)
    assert.notEqual(res.status(), 500, '非成员必须被非泄露错误掩蔽，不能 500')
    // multitenant-tenant-identification「Missing tenant is rejected」：无活动组织时返回任一已登记的
    // 非泄露错误（403/404 等）均合规；真正的要求是不能从响应推断目标组织是否存在。
    assert.include([403, 404], res.status())
    const missing = await client
      .get(`/api/v1/organizations/${org.id + 100000}/dashboard/layouts/current`)
      .bearerToken(token)
    assert.equal(missing.status(), res.status(), '存在与不存在的组织必须返回相同状态')
    assert.deepEqual(missing.body(), res.body(), '存在与不存在的组织必须返回相同响应体')
  })

  test('无组织用户 /auth/me 仍正常返回（会话不破）', async ({ assert, client }) => {
    const email = uniqueEmail('no-org3')
    const user = await createUser({ email })
    const login = await client.post('/api/v1/auth/login').json({
      email,
      password: 'Passw0rd!',
    })
    const token = login.body().data.accessToken as string

    const res = await client.get('/api/v1/auth/me').bearerToken(token)
    assert.equal(res.status(), 200)
    const body = res.body()
    assert.equal(body.data?.user?.id, user.id)
    assert.deepEqual(body.data?.permissions, [])
  })
})
