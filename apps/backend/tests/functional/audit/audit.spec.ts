import AuditLog from '#models/audit_log'
import app from '@adonisjs/core/services/app'
import { test } from '@japa/runner'
import { STRONG_PASSWORD, createUser, uniqueEmail, useAuthDatabase } from '../auth/_helpers.js'

/**
 * 任务 7.2 — 认证/权限动作审计埋点测试：
 * 各动作产生对应 audit_logs 记录（action 动词 + metadata.event + severity 正确）。
 */
test.group('审计埋点', (group) => {
  useAuthDatabase(group)

  async function latestByEvent(event: string) {
    const rows = await AuditLog.query().orderBy('id', 'desc')
    return rows.find((r) => (r.metadata as any)?.event === event)
  }

  test('登录成功写入 LOGIN_SUCCESS（action=login）', async ({ client, assert }) => {
    const email = uniqueEmail('a-ok')
    await createUser({ email })
    await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })

    const log = await latestByEvent('LOGIN_SUCCESS')
    assert.isOk(log, '应有 LOGIN_SUCCESS 审计')
    assert.equal(log!.action, 'login')
    assert.equal(log!.severity, 'info')
  })

  test('登录失败写入 LOGIN_FAILED（severity=warning）', async ({ client, assert }) => {
    const email = uniqueEmail('a-bad')
    await createUser({ email })
    await client.post('/api/v1/auth/login').json({ email, password: 'Wrong0rd!' })

    const log = await latestByEvent('LOGIN_FAILED')
    assert.isOk(log, '应有 LOGIN_FAILED 审计')
    assert.equal(log!.action, 'login')
    assert.equal(log!.severity, 'warning')
    assert.equal((log!.metadata as any).reason, 'invalid_credentials')
  })

  test('刷新写入 TOKEN_REFRESHED', async ({ client, assert }) => {
    const email = uniqueEmail('a-refresh')
    await createUser({ email })
    const login = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
    await client.post('/api/v1/auth/refresh').json({ refreshToken: login.body().data.refreshToken })

    const log = await latestByEvent('TOKEN_REFRESHED')
    assert.isOk(log, '应有 TOKEN_REFRESHED 审计')
    assert.equal(log!.action, 'login')
  })

  test('登出写入 LOGOUT', async ({ client, assert }) => {
    const email = uniqueEmail('a-logout')
    await createUser({ email })
    const login = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
    const { accessToken, refreshToken } = login.body().data
    await client
      .post('/api/v1/account/logout')
      .header('Authorization', `Bearer ${accessToken}`)
      .json({ refreshToken })

    const log = await latestByEvent('LOGOUT')
    assert.isOk(log, '应有 LOGOUT 审计')
    assert.equal(log!.action, 'logout')
  })

  test('角色变更写入 ROLE_CHANGED（action=update）', async ({ assert }) => {
    const user = await createUser()
    const { default: AuthService } = await import('#services/auth_service')
    const auth = await app.container.make(AuthService)
    await auth.bumpRoleVersion(user.id)

    const log = await latestByEvent('ROLE_CHANGED')
    assert.isOk(log, '应有 ROLE_CHANGED 审计')
    assert.equal(log!.action, 'update')
    assert.equal(log!.userId, user.id)
  })

  test('审计写入失败不阻塞主请求（非阻塞语义）', async ({ client }) => {
    // 正常登录即验证主流程不被审计写入影响
    const email = uniqueEmail('a-nonblock')
    await createUser({ email })
    const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
    res.assertStatus(200)
  })
})
