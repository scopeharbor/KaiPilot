import { test } from '@japa/runner'
import { STRONG_PASSWORD, createUser, uniqueEmail, useAuthDatabase } from './_helpers.js'

/**
 * 任务 4.5 — 认证 API 集成测试：注册 / 登录 / 刷新 / 登出 / 校验的正常与失败路径。
 */
test.group('认证 API', (group) => {
  useAuthDatabase(group)

  // —— 注册 ——
  test('注册成功返回 201 + tokens + user', async ({ client, assert }) => {
    const email = uniqueEmail('reg')
    const res = await client.post('/api/v1/auth/register').json({
      fullName: '张三',
      email,
      password: STRONG_PASSWORD,
      passwordConfirmation: STRONG_PASSWORD,
    })

    res.assertStatus(201)
    assert.properties(res.body().data, ['user', 'accessToken', 'refreshToken'])
    assert.equal(res.body().data.user.email, email)
    assert.notProperty(res.body().data.user, 'password')
  })

  test('注册弱密码返回 422 VALIDATION_ERROR', async ({ client }) => {
    const res = await client.post('/api/v1/auth/register').json({
      fullName: null,
      email: uniqueEmail('weak'),
      password: 'weak',
      passwordConfirmation: 'weak',
    })
    res.assertStatus(422)
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('注册重复邮箱返回 422', async ({ client }) => {
    const email = uniqueEmail('dup')
    await createUser({ email })
    const res = await client.post('/api/v1/auth/register').json({
      fullName: null,
      email,
      password: STRONG_PASSWORD,
      passwordConfirmation: STRONG_PASSWORD,
    })
    res.assertStatus(422)
  })

  test('注册密码确认不一致返回 422', async ({ client }) => {
    const res = await client.post('/api/v1/auth/register').json({
      fullName: null,
      email: uniqueEmail('mismatch'),
      password: STRONG_PASSWORD,
      passwordConfirmation: 'Different1!',
    })
    res.assertStatus(422)
  })

  // —— 登录 ——
  test('登录成功返回 200 + tokens', async ({ client, assert }) => {
    const email = uniqueEmail('login')
    await createUser({ email })
    const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
    res.assertStatus(200)
    assert.properties(res.body().data, ['user', 'accessToken', 'refreshToken'])
  })

  test('登录密码错误返回 401 INVALID_CREDENTIALS', async ({ client }) => {
    const email = uniqueEmail('badpw')
    await createUser({ email })
    const res = await client.post('/api/v1/auth/login').json({ email, password: 'Wrong0rd!' })
    res.assertStatus(401)
    res.assertBodyContains({ error: { code: 'INVALID_CREDENTIALS' } })
  })

  test('登录邮箱不存在返回 401 INVALID_CREDENTIALS（不泄露存在性）', async ({ client }) => {
    const res = await client
      .post('/api/v1/auth/login')
      .json({ email: 'nobody@test.local', password: STRONG_PASSWORD })
    res.assertStatus(401)
    res.assertBodyContains({ error: { code: 'INVALID_CREDENTIALS' } })
  })

  test('登录被禁用用户返回 403 ACCOUNT_INACTIVE', async ({ client }) => {
    const email = uniqueEmail('inactive')
    await createUser({ email, isActive: false })
    const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'ACCOUNT_INACTIVE' } })
  })

  // —— 刷新 ——
  test('刷新成功返回 200 + 新 tokens', async ({ client, assert }) => {
    const email = uniqueEmail('refresh')
    await createUser({ email })
    const login = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
    const refreshToken = login.body().data.refreshToken

    const res = await client.post('/api/v1/auth/refresh').json({ refreshToken })
    res.assertStatus(200)
    assert.properties(res.body().data, ['accessToken', 'refreshToken'])
    assert.notEqual(res.body().data.refreshToken, refreshToken, 'refresh token 应已轮换')
  })

  test('刷新已轮换的旧 refresh token 返回 401（单次使用）', async ({ client }) => {
    const email = uniqueEmail('rotate')
    await createUser({ email })
    const login = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
    const oldToken = login.body().data.refreshToken

    await client.post('/api/v1/auth/refresh').json({ refreshToken: oldToken })
    const reuse = await client.post('/api/v1/auth/refresh').json({ refreshToken: oldToken })
    reuse.assertStatus(401)
  })

  test('刷新无效 token 返回 401', async ({ client }) => {
    const res = await client.post('/api/v1/auth/refresh').json({ refreshToken: 'oat_x.invalid' })
    res.assertStatus(401)
  })

  // —— 校验 / 登出 ——
  test('未带令牌访问 profile 返回 401 AUTH_REQUIRED', async ({ client }) => {
    const res = await client.get('/api/v1/account/profile')
    res.assertStatus(401)
    res.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })
  })

  test('带有效令牌访问 profile 返回 200', async ({ client, assert }) => {
    const email = uniqueEmail('me')
    await createUser({ email })
    const login = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
    const accessToken = login.body().data.accessToken

    const res = await client
      .get('/api/v1/account/profile')
      .header('Authorization', `Bearer ${accessToken}`)
    res.assertStatus(200)
    assert.equal(res.body().data.user.email, email)
  })

  test('伪造/篡改令牌访问 profile 返回 401', async ({ client }) => {
    const res = await client
      .get('/api/v1/account/profile')
      .header('Authorization', 'Bearer not.a.jwt')
    res.assertStatus(401)
  })

  test('登出成功返回 200，登出后 refresh token 失效', async ({ client }) => {
    const email = uniqueEmail('logout')
    await createUser({ email })
    const login = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
    const { accessToken, refreshToken } = login.body().data

    const out = await client
      .post('/api/v1/account/logout')
      .header('Authorization', `Bearer ${accessToken}`)
      .json({ refreshToken })
    out.assertStatus(200)

    const reuse = await client.post('/api/v1/auth/refresh').json({ refreshToken })
    reuse.assertStatus(401)
  })

  test('signup 别名指向 register（兼容保留）', async ({ client }) => {
    const res = await client.post('/api/v1/auth/signup').json({
      fullName: null,
      email: uniqueEmail('signup'),
      password: STRONG_PASSWORD,
      passwordConfirmation: STRONG_PASSWORD,
    })
    res.assertStatus(201)
  })
})
