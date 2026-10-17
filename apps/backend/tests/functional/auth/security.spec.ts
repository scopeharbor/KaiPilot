import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { STRONG_PASSWORD, createUser, uniqueEmail, useAuthDatabase } from './_helpers.js'

/**
 * 任务 5.5 — 登录安全边界测试（SEC-02/03/04/10）：
 * 弱密码拒绝、连续失败锁定、锁定期拒绝、速率限制、绝对/空闲会话超时。
 */
test.group('登录安全边界', (group) => {
  useAuthDatabase(group)

  function register(email: string, password: string) {
    return { fullName: null, email, password, passwordConfirmation: password }
  }

  // —— SEC-02 密码策略 ——
  test('弱密码：少于 8 位被拒 422', async ({ client }) => {
    const res = await client
      .post('/api/v1/auth/register')
      .json(register(uniqueEmail('s1'), 'Ab1cde'))
    res.assertStatus(422)
  })

  test('弱密码：缺大写被拒 422', async ({ client }) => {
    const res = await client
      .post('/api/v1/auth/register')
      .json(register(uniqueEmail('s2'), 'passw0rd'))
    res.assertStatus(422)
  })

  test('弱密码：缺数字被拒 422', async ({ client }) => {
    const res = await client
      .post('/api/v1/auth/register')
      .json(register(uniqueEmail('s3'), 'Password'))
    res.assertStatus(422)
  })

  test('弱密码：缺小写被拒 422', async ({ client }) => {
    const res = await client
      .post('/api/v1/auth/register')
      .json(register(uniqueEmail('s4'), 'PASSW0RD'))
    res.assertStatus(422)
  })

  test('强密码（8 位含大小写数字）通过 201', async ({ client }) => {
    const res = await client
      .post('/api/v1/auth/register')
      .json(register(uniqueEmail('s5'), 'Abcdef1x'))
    res.assertStatus(201)
  })

  // —— SEC-03 登录失败锁定 ——
  test('连续失败 5 次后锁定，第 6 次即使密码正确也 429 ACCOUNT_LOCKED', async ({ client }) => {
    const email = uniqueEmail('lock')
    await createUser({ email })

    for (let i = 0; i < 5; i++) {
      const bad = await client.post('/api/v1/auth/login').json({ email, password: 'Wrong0rd!' })
      bad.assertStatus(401)
    }
    const locked = await client
      .post('/api/v1/auth/login')
      .json({ email, password: STRONG_PASSWORD })
    locked.assertStatus(429)
    locked.assertBodyContains({ error: { code: 'ACCOUNT_LOCKED' } })
  })

  test('锁定按 email 隔离：另一账户不受影响', async ({ client }) => {
    const victim = uniqueEmail('lock-victim')
    const other = uniqueEmail('lock-other')
    await createUser({ email: victim })
    await createUser({ email: other })

    for (let i = 0; i < 5; i++) {
      await client.post('/api/v1/auth/login').json({ email: victim, password: 'Wrong0rd!' })
    }
    // 另一账户仍可正常登录
    const ok = await client
      .post('/api/v1/auth/login')
      .json({ email: other, password: STRONG_PASSWORD })
    ok.assertStatus(200)
  })

  test('登录成功清空失败计数（未达阈值不锁定）', async ({ client }) => {
    const email = uniqueEmail('reset')
    await createUser({ email })
    // 4 次失败（未达 5）
    for (let i = 0; i < 4; i++) {
      await client.post('/api/v1/auth/login').json({ email, password: 'Wrong0rd!' })
    }
    // 成功一次
    const ok = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
    ok.assertStatus(200)
    // 再次失败 4 次仍不锁定（计数已清零）
    for (let i = 0; i < 4; i++) {
      await client.post('/api/v1/auth/login').json({ email, password: 'Wrong0rd!' })
    }
    const still = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
    still.assertStatus(200)
  })

  // —— SEC-10 速率限制 ——
  test('速率限制：同一 IP 认证端点超 100 次/分钟后出现 429', async ({ client, assert }) => {
    const statuses: number[] = []
    for (let i = 0; i < 105; i++) {
      const res = await client.post('/api/v1/auth/refresh').json({ refreshToken: 'oat_x.invalid' })
      statuses.push(res.response.status)
    }
    assert.isTrue(
      statuses.includes(429),
      `连打 105 次应至少出现一次 429，实际状态分布：${[...new Set(statuses)].join(',')}`,
    )
  })

  // —— SEC-04 会话超时 ——
  test('绝对超时：refresh token 过期后刷新被拒 401', async ({ client }) => {
    const email = uniqueEmail('abs')
    await createUser({ email })
    const login = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
    const refreshToken = login.body().data.refreshToken

    // 将该 token 的 expires_at 置为过去（存储为 ms epoch 整数）
    await db.from('auth_access_tokens').update({ expires_at: Date.now() - 60_000 })

    const res = await client.post('/api/v1/auth/refresh').json({ refreshToken })
    res.assertStatus(401)
  })

  test('空闲超时：last_used_at 超过 2h 后刷新被拒 401', async ({ client }) => {
    const email = uniqueEmail('idle')
    await createUser({ email })
    const login = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
    const refreshToken = login.body().data.refreshToken

    // 将 created_at / last_used_at 置为 3 小时前（ms epoch 整数，超过 2h 空闲窗）
    const stale = Date.now() - 3 * 60 * 60 * 1000
    await db.from('auth_access_tokens').update({ created_at: stale, last_used_at: stale })

    const res = await client.post('/api/v1/auth/refresh').json({ refreshToken })
    res.assertStatus(401)
  })
})
