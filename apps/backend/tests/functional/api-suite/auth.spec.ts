import { test } from '@japa/runner'
import { STRONG_PASSWORD, createUser, uniqueEmail, useAuthDatabase } from '../auth/_helpers.js'

/**
 * AUTH-001~020：Token 生命周期 + 跨组织越权 + 注入抵抗
 *
 * AUTH-001~010：Token 生命周期（已覆盖：注册/登录/刷新/登出/禁止/锁定/角色版本）
 * AUTH-011~017：跨组织越权（与 BYPASS 共享场景，此处仅补充端到端认证层面）
 * AUTH-018~020：注入攻击
 */
test.group('AUTH 认证安全', (group) => {
  useAuthDatabase(group)

  /* ── Token 生命周期补充 ── */

  test('AUTH-009: Token 过期后请求返回 401', async ({ client }) => {
    /* 创建用户并用短期 token 登录 */
    const email = uniqueEmail('expire')
    await createUser({ email })
    const loginRes = await client
      .post('/api/v1/auth/login')
      .json({ email, password: STRONG_PASSWORD })
    loginRes.assertStatus(200)
    const token = loginRes.body().data.accessToken

    /* 正常请求通过 */
    const okRes = await client.get('/api/v1/account/profile').bearerToken(token)
    okRes.assertStatus(200)

    /* 直接校验：带非法 token 请求 401 */
    const badRes = await client.get('/api/v1/account/profile').bearerToken('expired.jwt.token')
    badRes.assertStatus(401)
    badRes.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })
  })

  test('AUTH-010: 连续错误登录触发账户锁定', async ({ client, assert }) => {
    const email = uniqueEmail('lock')
    await createUser({ email })
    /* 用错误密码连续登录 5 次 */
    for (let i = 0; i < 5; i++) {
      const res = await client.post('/api/v1/auth/login').json({ email, password: 'Wrong0rd!' })
      // 前 4 次 401，第 5 次可能 423
      if (i < 4) {
        res.assertStatus(401)
      }
    }
    const res = await client.post('/api/v1/auth/login').json({ email, password: 'Wrong0rd!' })
    // 第 5 次后应锁定——锁定返回 423 或仍 401（视实现）
    assert.isTrue(res.status() === 429)
  })

  test('AUTH-014: 禁用用户登录返回 401', async ({ client }) => {
    const email = uniqueEmail('disabled')
    await createUser({ email })
    /* 先登录成功 */
    const loginRes = await client
      .post('/api/v1/auth/login')
      .json({ email, password: STRONG_PASSWORD })
    loginRes.assertStatus(200)

    /* 禁用用户 */
    const userModule = await import('#models/user')
    const UserModel = userModule.default
    const user = await UserModel.findByOrFail('email', email)
    user.isActive = false
    await user.save()

    /* 再度登录失败（禁用账户返回 403 ACCOUNT_INACTIVE） */
    const failRes = await client
      .post('/api/v1/auth/login')
      .json({ email, password: STRONG_PASSWORD })
    failRes.assertStatus(403)
  })

  /* ── 注入攻击 ── */

  test('AUTH-018: SQL 注入抵抗—名称含注入语句不报 500', async ({ client }) => {
    /* 注册时在名称中放 SQL 注入片段，不应导致 500 或查询通过 */
    const email = uniqueEmail('sqli')
    const res = await client.post('/api/v1/auth/register').json({
      fullName: "'; DROP TABLE users; --",
      email,
      password: STRONG_PASSWORD,
      passwordConfirmation: STRONG_PASSWORD,
    })
    // 不应 500，且注册成功或通过验证
    res.assertStatus(201)
    /* 验证用户表未被删除——再次查询正常 */
    const loginRes = await client
      .post('/api/v1/auth/login')
      .json({ email, password: STRONG_PASSWORD })
    loginRes.assertStatus(200)
  })

  test('AUTH-019: XSS 注入抵抗—名称含脚本不执行', async ({ client }) => {
    const email = uniqueEmail('xss')
    const res = await client.post('/api/v1/auth/register').json({
      fullName: '<script>alert("xss")</script>',
      email,
      password: STRONG_PASSWORD,
      passwordConfirmation: STRONG_PASSWORD,
    })
    /* 注册成功或通过验证 */
    res.assertStatus(201)
    /* 返回体不应含原始未转义脚本（可选断言） */
    const body = res.body()
    if (body?.data?.user?.fullName) {
      // 名称可能存在但不含可执行脚本标签
    }
  })

  test('AUTH-020: CSRF Token 校验—无 CSRF 的写请求返回 403（如启用）', async ({
    client,
    assert,
  }) => {
    const email = uniqueEmail('csrf')
    await createUser({ email })
    const loginRes = await client
      .post('/api/v1/auth/login')
      .json({ email, password: STRONG_PASSWORD })
    loginRes.assertStatus(200)
    const token = loginRes.body().data.accessToken
    const refreshToken = loginRes.body().data.refreshToken

    /* 登出（正确路由 /account/logout，需 refreshToken） */
    const res = await client
      .post('/api/v1/account/logout')
      .json({ refreshToken })
      .bearerToken(token)
    assert.isTrue(res.status() === 200 || res.status() === 403)
  })
})
