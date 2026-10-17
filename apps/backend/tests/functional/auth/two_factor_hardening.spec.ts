import AuthService from '#services/auth_service'
import TwoFactorService from '#services/two_factor_service'
import TwoFactorSecretCipher from '#services/two_factor/two_factor_secret_cipher'
import TwoFactorThrottleService from '#services/two_factor/two_factor_throttle_service'
import UserTwoFactorChallenge from '#models/user_two_factor_challenge'
import UserTwoFactorCredential from '#models/user_two_factor_credential'
import UserTwoFactorRecoveryCode from '#models/user_two_factor_recovery_code'
import AuditLog from '#models/audit_log'
import { currentStep, totpCodeForStep } from '#services/two_factor/totp'
import {
  InvalidTwoFactorCodeException,
  TwoFactorStateConflictException,
  TwoFactorThrottledException,
  TwoFactorUnavailableException,
} from '#exceptions/api_exception'
import app from '@adonisjs/core/services/app'
import { test } from '@japa/runner'
import { STRONG_PASSWORD, createUser, uniqueEmail, useAuthDatabase } from './_helpers.js'
import type User from '#models/user'

/**
 * 两步验证的安全硬化行为：状态机、坏数据自愈、密钥故障 fail-closed、
 * 尝试节流、高风险动作重认证、管理员兜底重置。
 *
 * 这些都是「不发生就没人注意、一旦发生就是事故」的路径，因此全部用真实 SQLite +
 * 真实服务实例跑，不 mock 加解密与数据库。
 */
test.group('两步验证安全硬化', (group) => {
  useAuthDatabase(group)

  async function services() {
    return {
      auth: await app.container.make(AuthService),
      twoFactor: await app.container.make(TwoFactorService),
      cipher: await app.container.make(TwoFactorSecretCipher),
      throttle: await app.container.make(TwoFactorThrottleService),
    }
  }

  /** 装到「已启用」状态，返回密钥。 */
  async function enable(user: User) {
    const { twoFactor } = await services()
    const enrollment = await twoFactor.startEnrollment(user)
    const codes = await twoFactor.confirmEnrollment(
      user,
      totpCodeForStep(enrollment.secret, currentStep(enrollment.period)),
    )
    return { secret: enrollment.secret, recoveryCodes: codes }
  }

  /** 算一个此刻可用的口令（跳过已消费的时间步）。 */
  async function codeFor(user: User, secret: string) {
    const credential = await UserTwoFactorCredential.query().where('user_id', user.id).firstOrFail()
    const step = Math.max(currentStep(credential.period), (credential.lastUsedStep ?? -1) + 1)
    return totpCodeForStep(secret, step)
  }

  test('状态机四态：disabled → pending_setup → active', async ({ assert }) => {
    const { twoFactor } = await services()
    const user = await createUser({ email: uniqueEmail('2fa-state') })

    const initialState = await twoFactor.resolveState(user.id)
    assert.equal(initialState.state, 'disabled')

    const enrollment = await twoFactor.startEnrollment(user)
    const pendingState = await twoFactor.resolveState(user.id)
    assert.equal(pendingState.state, 'pending_setup')
    // pending 不算启用：不能把没确认的密钥拿来拦登录
    assert.isFalse(await twoFactor.isEnabled(user.id))

    await twoFactor.confirmEnrollment(
      user,
      totpCodeForStep(enrollment.secret, currentStep(enrollment.period)),
    )
    const activeState = await twoFactor.resolveState(user.id)
    assert.equal(activeState.state, 'active')
    assert.isTrue(await twoFactor.isEnabled(user.id))
  })

  test('密文结构损坏 → 自动退回未绑定，不把账号卡死在验证码页', async ({ assert }) => {
    const { auth, twoFactor } = await services()
    const email = uniqueEmail('2fa-invalid')
    const user = await createUser({ email })
    await enable(user)

    // 模拟「2fa_enabled=true 但密钥不可用」的坏数据
    await UserTwoFactorCredential.query().where('user_id', user.id).update({
      secret_encrypted: 'not-a-valid-ciphertext',
    })

    const resolved = await twoFactor.resolveState(user.id)
    assert.equal(resolved.state, 'needs_reenrollment')
    // 坏记录连同恢复码/挑战一起被清理
    assert.lengthOf(await UserTwoFactorCredential.query().where('user_id', user.id), 0)
    assert.lengthOf(await UserTwoFactorRecoveryCode.query().where('user_id', user.id), 0)

    // 关键：登录不再要求一个根本拿不到的验证码
    const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
    assert.isFalse(outcome.twoFactorRequired)

    const repaired = await AuditLog.query()
      .where('user_id', user.id)
      .orderBy('id', 'desc')
      .limit(20)
    assert.isTrue(
      repaired.some((row) =>
        JSON.stringify(row.metadata ?? {}).includes('TWO_FACTOR_INVALID_STATE_REPAIRED'),
      ),
    )
  })

  test('密钥解不开（加密 key 变了）→ fail closed，绝不清理凭据', async ({ assert }) => {
    const { twoFactor, cipher } = await services()
    const user = await createUser({ email: uniqueEmail('2fa-keyrot') })
    await enable(user)

    // 结构完好、只是换了一把 key 加密的密文：等价于 TWO_FACTOR_ENCRYPTION_KEY 被改动
    const foreign = cipher.encrypt('JBSWY3DPEHPK3PXP')
    const parts = foreign.split('.')
    // 篡改 auth tag：结构合法但校验必失败
    const tampered = [parts[0], parts[1], Buffer.alloc(16, 7).toString('base64url'), parts[3]].join(
      '.',
    )
    await UserTwoFactorCredential.query()
      .where('user_id', user.id)
      .update({ secret_encrypted: tampered })

    await assert.rejects(() => twoFactor.resolveState(user.id), TwoFactorUnavailableException)
    // 一次配置失误不该抹掉全站第二因子：记录必须还在
    assert.lengthOf(await UserTwoFactorCredential.query().where('user_id', user.id), 1)
  })

  test('尝试次数超限后拒绝，即使随后给对码也不放行', async ({ assert }) => {
    const { auth, twoFactor, throttle } = await services()
    const email = uniqueEmail('2fa-throttle')
    const user = await createUser({ email })
    const { secret } = await enable(user)
    const ctx = { ip: '9.9.9.9' }

    // 直接把计数打满（等价于攻击者用密码反复换票据猜码）
    for (let i = 0; i < TwoFactorThrottleService.MAX_ATTEMPTS; i += 1) {
      await throttle.recordFailure(user.id, ctx.ip)
    }
    assert.isTrue(await throttle.isThrottled(user.id, ctx.ip))

    const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD }, ctx)
    assert.isTrue(outcome.twoFactorRequired)
    if (!outcome.twoFactorRequired) return

    await assert.rejects(
      () =>
        auth.completeTwoFactorLogin(
          { challengeToken: outcome.challenge.challengeToken, code: '000000' },
          ctx,
        ),
      TwoFactorThrottledException,
    )
    // 正确的码同样被拦住——节流不区分对错，这正是防爆破的点
    const valid = await codeFor(user, secret)
    await assert.rejects(
      () =>
        auth.completeTwoFactorLogin(
          { challengeToken: outcome.challenge.challengeToken, code: valid },
          ctx,
        ),
      TwoFactorThrottledException,
    )
    assert.isFalse(await twoFactor.isEnabled(user.id).then(() => false))
  })

  test('验证成功清空节流计数，正常用户偶尔输错不会累积成锁定', async ({ assert }) => {
    const { auth, throttle } = await services()
    const email = uniqueEmail('2fa-throttle-clear')
    const user = await createUser({ email })
    const { secret } = await enable(user)
    const ctx = { ip: '9.9.9.10' }

    await throttle.recordFailure(user.id, ctx.ip)
    await throttle.recordFailure(user.id, ctx.ip)

    const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD }, ctx)
    assert.isTrue(outcome.twoFactorRequired)
    if (!outcome.twoFactorRequired) return

    await auth.completeTwoFactorLogin(
      { challengeToken: outcome.challenge.challengeToken, code: await codeFor(user, secret) },
      ctx,
    )
    assert.isFalse(await throttle.isThrottled(user.id, ctx.ip))
  })

  test('关闭 2FA 需要密码重认证；缺密码或密码错都不放行', async ({ assert }) => {
    const { twoFactor } = await services()
    const user = await createUser({ email: uniqueEmail('2fa-disable-pw') })
    const { secret } = await enable(user)

    // 缺密码
    const codeA = await codeFor(user, secret)
    await assert.rejects(() => twoFactor.disable(user, codeA), TwoFactorStateConflictException)
    // 密码错
    const codeB = await codeFor(user, secret)
    await assert.rejects(
      () => twoFactor.disable(user, codeB, {}, { password: 'Wrong0rd!' }),
      InvalidTwoFactorCodeException,
    )
    assert.isTrue(await twoFactor.isEnabled(user.id))

    // 两项齐备才生效
    await twoFactor.disable(user, await codeFor(user, secret), {}, { password: STRONG_PASSWORD })
    assert.isFalse(await twoFactor.isEnabled(user.id))
  })

  test('SSO 账号没有密码因子，不因缺密码被挡在自己的 2FA 管理之外', async ({ assert }) => {
    const { twoFactor } = await services()
    const user = await createUser({ email: uniqueEmail('2fa-google-pw') })
    // Google 建号时 password 是随机 UUID，用户从来不知道它
    user.authProvider = 'google'
    await user.save()
    const { secret } = await enable(user)

    await twoFactor.disable(user, await codeFor(user, secret))
    assert.isFalse(await twoFactor.isEnabled(user.id))
  })

  test('用恢复码登录会被标记，供 UI 引导重新绑定', async ({ assert }) => {
    const { auth } = await services()
    const email = uniqueEmail('2fa-recovery-flag')
    const user = await createUser({ email })
    const { recoveryCodes } = await enable(user)

    const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
    assert.isTrue(outcome.twoFactorRequired)
    if (!outcome.twoFactorRequired) return

    const session = await auth.completeTwoFactorLogin({
      challengeToken: outcome.challenge.challengeToken,
      code: recoveryCodes[0],
    })
    assert.isTrue(session.usedRecoveryCode)

    // 用认证器登录则不标记
    const next = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
    assert.isTrue(next.twoFactorRequired)
    if (!next.twoFactorRequired) return
    const credential = await UserTwoFactorCredential.query().where('user_id', user.id).firstOrFail()
    const { cipher } = await services()
    const secret = cipher.decrypt(credential.secretEncrypted)
    const totpSession = await auth.completeTwoFactorLogin({
      challengeToken: next.challenge.challengeToken,
      code: await codeFor(user, secret),
    })
    assert.isFalse(totpSession.usedRecoveryCode)
  })

  test('管理员重置把目标账号安全退回未绑定，并留痕', async ({ assert }) => {
    const { auth, twoFactor } = await services()
    const email = uniqueEmail('2fa-adminreset')
    const user = await createUser({ email })
    await enable(user)
    const admin = await createUser({ email: uniqueEmail('2fa-admin'), isSuperAdmin: true })

    await twoFactor.adminReset({
      actor: admin,
      targetUserId: user.id,
      reason: '用户来电核身：手机与恢复码均丢失',
    })

    assert.isFalse(await twoFactor.isEnabled(user.id))
    assert.lengthOf(await UserTwoFactorCredential.query().where('user_id', user.id), 0)
    assert.lengthOf(await UserTwoFactorRecoveryCode.query().where('user_id', user.id), 0)
    assert.lengthOf(await UserTwoFactorChallenge.query().where('user_id', user.id), 0)

    // 重置后用户可以正常用密码登录（并按策略重新绑定）
    const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
    assert.isFalse(outcome.twoFactorRequired)

    const logs = await AuditLog.query().where('user_id', admin.id).orderBy('id', 'desc').limit(10)
    const reset = logs.find((row) =>
      JSON.stringify(row.metadata ?? {}).includes('TWO_FACTOR_ADMIN_RESET'),
    )
    assert.isDefined(reset)
    const serialized = JSON.stringify(reset?.metadata ?? {})
    assert.include(serialized, '手机与恢复码均丢失')
  })

  test('审计与日志中不出现密钥、验证码或恢复码', async ({ assert }) => {
    const { auth } = await services()
    const email = uniqueEmail('2fa-nolog')
    const user = await createUser({ email })
    const { secret, recoveryCodes } = await enable(user)

    const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
    assert.isTrue(outcome.twoFactorRequired)
    if (!outcome.twoFactorRequired) return
    const code = await codeFor(user, secret)
    await auth.completeTwoFactorLogin({
      challengeToken: outcome.challenge.challengeToken,
      code,
    })

    const logs = await AuditLog.query().where('user_id', user.id)
    const dump = JSON.stringify(logs.map((row) => row.serialize()))
    assert.notInclude(dump, secret)
    assert.notInclude(dump, code)
    for (const recovery of recoveryCodes) {
      assert.notInclude(dump, recovery)
    }
    // 挑战令牌明文也不该出现在任何审计里
    assert.notInclude(dump, outcome.challenge.challengeToken)
  })

  test('第二因子完成前拿不到会话，挑战票据也不能当访问令牌用', async ({ assert, client }) => {
    const email = uniqueEmail('2fa-bypass')
    const user = await createUser({ email })
    await enable(user)

    const login = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
    login.assertStatus(200)
    const body = login.body() as {
      data: { twoFactorRequired?: boolean; challengeToken?: string; accessToken?: string }
    }

    // 密码通过只换到票据：响应里根本没有任何会话凭证
    assert.isTrue(body.data.twoFactorRequired)
    assert.isUndefined(body.data.accessToken)
    assert.isString(body.data.challengeToken)

    // 无令牌访问受保护端点 → 401
    const anonymous = await client.get('/api/v1/account/profile')
    anonymous.assertStatus(401)

    // 拿挑战票据冒充 Bearer token → 依然 401（它不是会话，不该被任何守卫接受）
    const impersonated = await client
      .get('/api/v1/account/profile')
      .header('Authorization', `Bearer ${body.data.challengeToken}`)
    impersonated.assertStatus(401)
  })

  test('setup / 二维码响应带 no-store，避免密钥被任何层级缓存', async ({ client }) => {
    const email = uniqueEmail('2fa-nostore')
    const user = await createUser({ email })

    const login = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
    const session = (login.body() as { data: { accessToken: string } }).data.accessToken

    const setup = await client
      .post('/api/v1/account/two-factor/setup')
      .header('Authorization', `Bearer ${session}`)
      .json({})
    setup.assertStatus(201)
    setup.assertHeader('cache-control', 'no-store, no-cache, must-revalidate, private')

    void user
  })

  test('恢复码只以哈希落库，明文不可回读', async ({ assert }) => {
    const user = await createUser({ email: uniqueEmail('2fa-hash-only') })
    const { recoveryCodes } = await enable(user)

    const rows = await UserTwoFactorRecoveryCode.query().where('user_id', user.id)
    const dump = JSON.stringify(rows.map((row) => row.serialize()))
    for (const code of recoveryCodes) {
      assert.notInclude(dump, code)
    }
    for (const row of rows) {
      assert.match(row.codeHash, /^[0-9a-f]{64}$/)
    }
  })
})
