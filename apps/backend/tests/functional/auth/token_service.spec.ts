import TokenService from '#services/token_service'
import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { test } from '@japa/runner'
import { SignJWT } from 'jose'
import { createUser, useAuthDatabase } from './_helpers.js'

/**
 * 任务 3.3 — TokenService 单元测试：签发/校验/过期/轮换/复用作废/撤销。
 */
test.group('TokenService', (group) => {
  useAuthDatabase(group)

  async function service() {
    return app.container.make(TokenService)
  }

  test('access token 签发→校验往返，claims 正确', async ({ assert }) => {
    const svc = await service()
    const token = await svc.generateAccessToken({
      sub: 42,
      organizationId: 7,
      roleVersion: 3,
      permissions: ['task:view'],
    })
    const payload = await svc.verifyAccessToken(token)
    assert.equal(payload.sub, 42)
    assert.equal(payload.organizationId, 7)
    assert.equal(payload.roleVersion, 3)
    assert.deepEqual(payload.permissions, ['task:view'])
  })

  test('新签发的 access token 未过期（回归 setExpirationTime bug）', async ({ assert }) => {
    const svc = await service()
    const token = await svc.generateAccessToken({
      sub: 1,
      organizationId: null,
      roleVersion: 0,
      permissions: [],
    })
    // 不应抛出（若 exp 被误设为 1970，会立即抛 AuthRequired）
    const payload = await svc.verifyAccessToken(token)
    assert.isNumber(payload.exp)
    assert.isAbove(payload.exp!, Math.floor(Date.now() / 1000), 'exp 应在未来')
  })

  test('篡改/非法 access token 校验抛错', async ({ assert }) => {
    const svc = await service()
    await assert.rejects(() => svc.verifyAccessToken('not.a.jwt'))
  })

  test('过期 access token 校验抛错', async ({ assert }) => {
    const svc = await service()
    const secret = Buffer.from(env.get('JWT_ACCESS_SECRET'))
    const nowSec = Math.floor(Date.now() / 1000)
    const expired = await new SignJWT({ sub: '1', roleVersion: 0, permissions: [] })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(nowSec - 3600)
      .setExpirationTime(nowSec - 60)
      .sign(secret)
    await assert.rejects(() => svc.verifyAccessToken(expired))
  })

  test('refresh token 签发→校验返回对应用户', async ({ assert }) => {
    const svc = await service()
    const user = await createUser()
    const { token } = await svc.generateRefreshToken(user)
    const { user: resolved } = await svc.verifyRefreshToken(token)
    assert.equal(resolved.id, user.id)
  })

  test('refresh token 轮换后旧值复用即作废', async ({ assert }) => {
    const svc = await service()
    const user = await createUser()
    const { token: oldToken, dbToken } = await svc.generateRefreshToken(user)
    await svc.rotateRefreshToken(user, dbToken)
    await assert.rejects(() => svc.verifyRefreshToken(oldToken))
  })

  test('撤销后的 refresh token 不可再用', async ({ assert }) => {
    const svc = await service()
    const user = await createUser()
    const { token, dbToken } = await svc.generateRefreshToken(user)
    await svc.revokeRefreshToken(user, dbToken.identifier)
    await assert.rejects(() => svc.verifyRefreshToken(token))
  })

  test('禁用用户的 refresh token 校验被拒', async ({ assert }) => {
    const svc = await service()
    const user = await createUser()
    const { token } = await svc.generateRefreshToken(user)
    user.isActive = false
    await user.save()
    await assert.rejects(() => svc.verifyRefreshToken(token))
  })
})
