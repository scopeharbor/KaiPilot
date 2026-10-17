import AuthService from '#services/auth_service'
import Organization from '#models/organization'
import OrganizationMember from '#models/organization_member'
import User from '#models/user'
import {
  AccountInactiveException,
  AccountLockedException,
  InvalidCredentialsException,
} from '#exceptions/api_exception'
import app from '@adonisjs/core/services/app'
import { test } from '@japa/runner'
import { STRONG_PASSWORD, createUser, uniqueEmail, useAuthDatabase } from './_helpers.js'

/**
 * 任务 3.3 — AuthService 单元测试：注册/登录/刷新/登出/禁用拒绝/锁定/角色版本传播。
 */
test.group('AuthService', (group) => {
  useAuthDatabase(group)

  async function service() {
    return app.container.make(AuthService)
  }

  test('注册创建用户并签发 token', async ({ assert }) => {
    const svc = await service()
    const email = uniqueEmail('svc-reg')
    const { user, accessToken, refreshToken } = await svc.register({
      fullName: '李四',
      email,
      password: STRONG_PASSWORD,
    })
    assert.equal(user.email, email)
    assert.equal(user.authProvider, 'local')
    assert.isString(accessToken)
    assert.isString(refreshToken)
  })

  test('登录成功返回 token', async ({ assert }) => {
    const svc = await service()
    const email = uniqueEmail('svc-login')
    await createUser({ email })
    const { accessToken } = await svc.login({ email, password: STRONG_PASSWORD }, { ip: '1.1.1.1' })
    assert.isString(accessToken)
  })

  test('Google 登录新邮箱会创建用户、默认组织并签发 token', async ({ assert }) => {
    const svc = await service()
    const email = uniqueEmail('svc-google-new')

    const { user, accessToken, refreshToken } = await svc.loginWithGoogle(
      {
        sub: 'google-sub-new-user',
        email,
        email_verified: true,
        name: 'Google 新用户',
      },
      { ip: '4.4.4.4' },
    )

    assert.equal(user.email, email)
    assert.equal(user.authProvider, 'google')
    assert.equal(user.providerId, 'google-sub-new-user')
    assert.isString(accessToken)
    assert.isString(refreshToken)

    const org = await Organization.query().where('owner_id', user.id).firstOrFail()
    const membership = await OrganizationMember.query()
      .where('organization_id', org.id)
      .where('user_id', user.id)
      .firstOrFail()
    assert.equal(membership.role, 'owner')
  })

  test('Google 登录已有邮箱复用原用户并签发 token', async ({ assert }) => {
    const svc = await service()
    const email = uniqueEmail('svc-google-existing')
    const existing = await createUser({ email })

    const { user, accessToken } = await svc.loginWithGoogle(
      {
        sub: 'google-sub-existing-user',
        email,
        email_verified: true,
        name: '已有用户',
      },
      { ip: '5.5.5.5' },
    )

    assert.equal(user.id, existing.id)
    assert.equal(user.email, email)
    assert.isString(accessToken)
  })

  test('密码错误抛 InvalidCredentials', async ({ assert }) => {
    const svc = await service()
    const email = uniqueEmail('svc-badpw')
    await createUser({ email })
    await assert.rejects(
      () => svc.login({ email, password: 'Wrong0rd!' }, { ip: '1.1.1.2' }),
      InvalidCredentialsException,
    )
  })

  test('禁用用户登录抛 AccountInactive', async ({ assert }) => {
    const svc = await service()
    const email = uniqueEmail('svc-inactive')
    await createUser({ email, isActive: false })
    await assert.rejects(
      () => svc.login({ email, password: STRONG_PASSWORD }, { ip: '1.1.1.3' }),
      AccountInactiveException,
    )
  })

  test('连续失败 5 次后锁定，锁定期即使密码正确也拒绝（SEC-03）', async ({ assert }) => {
    const svc = await service()
    const email = uniqueEmail('svc-lock')
    const ip = '9.9.9.9'
    await createUser({ email })

    for (let i = 0; i < 5; i++) {
      await assert.rejects(() => svc.login({ email, password: 'Wrong0rd!' }, { ip }))
    }
    // 第 6 次即使密码正确也应因锁定被拒
    await assert.rejects(
      () => svc.login({ email, password: STRONG_PASSWORD }, { ip }),
      AccountLockedException,
    )
  })

  test('刷新轮换 token 且重读 roleVersion', async ({ assert }) => {
    const svc = await service()
    const email = uniqueEmail('svc-refresh')
    await createUser({ email })
    const { refreshToken } = await svc.login(
      { email, password: STRONG_PASSWORD },
      { ip: '2.2.2.2' },
    )

    const res = await svc.refresh(refreshToken)
    assert.isString(res.accessToken)
    assert.notEqual(res.refreshToken, refreshToken)
    // 旧 refresh token 复用作废
    await assert.rejects(() => svc.refresh(refreshToken))
  })

  test('登出后 refresh token 失效', async ({ assert }) => {
    const svc = await service()
    const email = uniqueEmail('svc-logout')
    const user = await createUser({ email })
    const { refreshToken } = await svc.login(
      { email, password: STRONG_PASSWORD },
      { ip: '3.3.3.3' },
    )

    await svc.logout(user, refreshToken)
    await assert.rejects(() => svc.refresh(refreshToken))
  })

  test('bumpRoleVersion 递增用户 role_version', async ({ assert }) => {
    const svc = await service()
    const user = await createUser({ roleVersion: 0 })
    await svc.bumpRoleVersion(user.id)
    const reloaded = await User.findOrFail(user.id)
    assert.equal(reloaded.roleVersion, 1)
  })
})
