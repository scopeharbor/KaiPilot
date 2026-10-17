import AuthService from '#services/auth_service'
import TwoFactorService from '#services/two_factor_service'
import UserTwoFactorChallenge from '#models/user_two_factor_challenge'
import UserTwoFactorCredential from '#models/user_two_factor_credential'
import UserTwoFactorRecoveryCode from '#models/user_two_factor_recovery_code'
import TwoFactorSecretCipher from '#services/two_factor/two_factor_secret_cipher'
import { totpCodeForStep, currentStep } from '#services/two_factor/totp'
import {
  InvalidTwoFactorCodeException,
  TwoFactorChallengeInvalidException,
  TwoFactorRequiredException,
  TwoFactorStateConflictException,
} from '#exceptions/api_exception'
import app from '@adonisjs/core/services/app'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { STRONG_PASSWORD, createUser, uniqueEmail, useAuthDatabase } from './_helpers.js'
import type User from '#models/user'

/**
 * 两步验证（TOTP）端到端行为：设置 → 启用 → 登录二次校验 → 恢复码 → 关闭。
 *
 * 用真实 SQLite + 真实服务实例跑，不 mock 加解密与数据库——2FA 的价值全在
 * 「密钥能否被绕过」，而绕过路径恰恰藏在持久化与状态迁移里，mock 掉就测不到。
 */
test.group('两步验证（TOTP）', (group) => {
  useAuthDatabase(group)

  async function services() {
    return {
      auth: await app.container.make(AuthService),
      twoFactor: await app.container.make(TwoFactorService),
      cipher: await app.container.make(TwoFactorSecretCipher),
    }
  }

  /**
   * 读出某用户当前密钥并算出一个**此刻可用**的一次性口令。
   *
   * 注意不能无脑用当前时间步：确认注册与上一次登录都会把当时的时间步标记为已消费
   * （重放防护），同一步的码此后一律拒绝。这里取「当前步」与「已消费步 + 1」中较大者，
   * 仍落在 ±1 校验窗口内——等价于真实用户等到下一个 30 秒窗口再读一次码。
   */
  async function currentCodeFor(user: User, cipher: TwoFactorSecretCipher): Promise<string> {
    const credential = await UserTwoFactorCredential.query().where('user_id', user.id).firstOrFail()
    const secret = cipher.decrypt(credential.secretEncrypted)
    const step = Math.max(currentStep(credential.period), (credential.lastUsedStep ?? -1) + 1)
    return totpCodeForStep(secret, step)
  }

  /** 把用户装到「2FA 已启用」状态，返回密钥与恢复码。 */
  async function enableTwoFactor(user: User) {
    const { twoFactor, cipher } = await services()
    const enrollment = await twoFactor.startEnrollment(user)
    const code = totpCodeForStep(enrollment.secret, currentStep(enrollment.period))
    const recoveryCodes = await twoFactor.confirmEnrollment(user, code)
    return { secret: enrollment.secret, recoveryCodes, cipher, twoFactor }
  }

  test('未启用时状态为关闭，密码登录直接拿到会话', async ({ assert }) => {
    const { auth, twoFactor } = await services()
    const email = uniqueEmail('2fa-off')
    const user = await createUser({ email })

    const status = await twoFactor.status(user)
    assert.isFalse(status.enabled)
    assert.isFalse(status.pending)
    assert.equal(status.recoveryCodesRemaining, 0)

    const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD }, { ip: '1.1.1.1' })
    assert.isFalse(outcome.twoFactorRequired)
    if (!outcome.twoFactorRequired) {
      assert.isString(outcome.session.accessToken)
    }
  })

  test('设置向导：pending 不拦登录，确认后才启用', async ({ assert }) => {
    const { auth, twoFactor, cipher } = await services()
    const email = uniqueEmail('2fa-enroll')
    const user = await createUser({ email })

    const enrollment = await twoFactor.startEnrollment(user, { label: 'iPhone' })
    assert.isString(enrollment.secret)
    assert.include(enrollment.otpauthUri, 'otpauth://totp/')
    assert.include(enrollment.otpauthUri, `secret=${enrollment.secret}`)

    // pending 阶段登录仍走原路径——没确认的密钥不能把用户锁在门外。
    const pendingStatus = await twoFactor.status(user)
    assert.isFalse(pendingStatus.enabled)
    assert.isTrue(pendingStatus.pending)
    const beforeConfirm = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
    assert.isFalse(beforeConfirm.twoFactorRequired)

    // 密钥落库是密文，且能解回原值。
    const credential = await UserTwoFactorCredential.query().where('user_id', user.id).firstOrFail()
    assert.notInclude(credential.secretEncrypted, enrollment.secret)
    assert.equal(cipher.decrypt(credential.secretEncrypted), enrollment.secret)
    assert.equal(credential.label, 'iPhone')

    const codes = await twoFactor.confirmEnrollment(
      user,
      totpCodeForStep(enrollment.secret, currentStep(enrollment.period)),
    )
    assert.lengthOf(codes, TwoFactorService.RECOVERY_CODE_COUNT)

    const status = await twoFactor.status(user)
    assert.isTrue(status.enabled)
    assert.isFalse(status.pending)
    assert.equal(status.recoveryCodesRemaining, TwoFactorService.RECOVERY_CODE_COUNT)
    assert.isNotNull(status.confirmedAt)
  })

  test('确认时验证码错误不启用', async ({ assert }) => {
    const { twoFactor } = await services()
    const user = await createUser({ email: uniqueEmail('2fa-badconfirm') })
    await twoFactor.startEnrollment(user)

    await assert.rejects(
      () => twoFactor.confirmEnrollment(user, '000000'),
      InvalidTwoFactorCodeException,
    )
    const statusAfterBadConfirm = await twoFactor.status(user)
    assert.isFalse(statusAfterBadConfirm.enabled)
  })

  test('恢复码只存哈希，不落明文', async ({ assert }) => {
    const user = await createUser({ email: uniqueEmail('2fa-hash') })
    const { recoveryCodes } = await enableTwoFactor(user)

    const rows = await UserTwoFactorRecoveryCode.query().where('user_id', user.id)
    assert.lengthOf(rows, TwoFactorService.RECOVERY_CODE_COUNT)
    for (const row of rows) {
      assert.match(row.codeHash, /^[0-9a-f]{64}$/)
      assert.notInclude(recoveryCodes, row.codeHash)
    }
  })

  test('启用后密码登录只返回挑战票据，不含任何会话凭证', async ({ assert }) => {
    const { auth } = await services()
    const email = uniqueEmail('2fa-challenge')
    const user = await createUser({ email })
    await enableTwoFactor(user)

    const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD }, { ip: '2.2.2.2' })
    assert.isTrue(outcome.twoFactorRequired)
    if (outcome.twoFactorRequired) {
      assert.isString(outcome.challenge.challengeToken)
      assert.deepEqual(outcome.challenge.methods, ['totp', 'recovery_code'])
      assert.isAbove(DateTime.fromISO(outcome.challenge.expiresAt).toMillis(), Date.now())
      // 库里只有哈希，明文令牌不落库
      const stored = await UserTwoFactorChallenge.query().where('user_id', user.id).firstOrFail()
      assert.notEqual(stored.tokenHash, outcome.challenge.challengeToken)
      assert.match(stored.tokenHash, /^[0-9a-f]{64}$/)
    }
  })

  test('便捷 login() 在启用 2FA 时抛错而非静默放行', async ({ assert }) => {
    const { auth } = await services()
    const email = uniqueEmail('2fa-legacy')
    const user = await createUser({ email })
    await enableTwoFactor(user)

    await assert.rejects(
      () => auth.login({ email, password: STRONG_PASSWORD }),
      TwoFactorRequiredException,
    )
  })

  test('用一次性口令兑换挑战得到正式会话', async ({ assert }) => {
    const { auth, cipher } = await services()
    const email = uniqueEmail('2fa-complete')
    const user = await createUser({ email })
    await enableTwoFactor(user)

    const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
    assert.isTrue(outcome.twoFactorRequired)
    if (!outcome.twoFactorRequired) return

    const session = await auth.completeTwoFactorLogin({
      challengeToken: outcome.challenge.challengeToken,
      code: await currentCodeFor(user, cipher),
    })
    assert.isString(session.accessToken)
    assert.isString(session.refreshToken)
    assert.equal(session.user.id, user.id)

    // 挑战一次性：同一张票据不能再兑换第二次会话。
    await assert.rejects(
      () =>
        auth.completeTwoFactorLogin({
          challengeToken: outcome.challenge.challengeToken,
          code: '000000',
        }),
      TwoFactorChallengeInvalidException,
    )
  })

  test('同一时间步的口令不可重放', async ({ assert }) => {
    const { auth, cipher } = await services()
    const email = uniqueEmail('2fa-replay')
    const user = await createUser({ email })
    await enableTwoFactor(user)

    const code = await currentCodeFor(user, cipher)

    const first = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
    assert.isTrue(first.twoFactorRequired)
    if (!first.twoFactorRequired) return
    await auth.completeTwoFactorLogin({
      challengeToken: first.challenge.challengeToken,
      code,
    })

    // 新挑战 + 同一个口令：时间步已被消费，必须拒绝。
    const second = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
    assert.isTrue(second.twoFactorRequired)
    if (!second.twoFactorRequired) return
    await assert.rejects(
      () =>
        auth.completeTwoFactorLogin({
          challengeToken: second.challenge.challengeToken,
          code,
        }),
      InvalidTwoFactorCodeException,
    )
  })

  test('恢复码可登录且一次性消费', async ({ assert }) => {
    const { auth, twoFactor } = await services()
    const email = uniqueEmail('2fa-recovery')
    const user = await createUser({ email })
    const { recoveryCodes } = await enableTwoFactor(user)
    const [recoveryCode] = recoveryCodes

    const first = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
    assert.isTrue(first.twoFactorRequired)
    if (!first.twoFactorRequired) return
    const session = await auth.completeTwoFactorLogin({
      challengeToken: first.challenge.challengeToken,
      // 小写 + 去连字符：用户实际粘贴的形态也必须能用
      code: recoveryCode.toLowerCase(),
    })
    assert.isString(session.accessToken)
    const statusAfterRecovery = await twoFactor.status(user)
    assert.equal(
      statusAfterRecovery.recoveryCodesRemaining,
      TwoFactorService.RECOVERY_CODE_COUNT - 1,
    )

    const second = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
    assert.isTrue(second.twoFactorRequired)
    if (!second.twoFactorRequired) return
    await assert.rejects(
      () =>
        auth.completeTwoFactorLogin({
          challengeToken: second.challenge.challengeToken,
          code: recoveryCode,
        }),
      InvalidTwoFactorCodeException,
    )
  })

  test('挑战错误次数用尽后作废，即使随后给对码也不放行', async ({ assert }) => {
    const { auth, cipher } = await services()
    const email = uniqueEmail('2fa-attempts')
    const user = await createUser({ email })
    await enableTwoFactor(user)

    const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
    assert.isTrue(outcome.twoFactorRequired)
    if (!outcome.twoFactorRequired) return
    const challengeToken = outcome.challenge.challengeToken

    for (let attempt = 0; attempt < TwoFactorService.MAX_CHALLENGE_ATTEMPTS; attempt += 1) {
      await assert.rejects(
        () => auth.completeTwoFactorLogin({ challengeToken, code: '000000' }),
        InvalidTwoFactorCodeException,
      )
    }

    const validCode = await currentCodeFor(user, cipher)
    await assert.rejects(
      () => auth.completeTwoFactorLogin({ challengeToken, code: validCode }),
      TwoFactorChallengeInvalidException,
    )
  })

  test('过期挑战不可兑换', async ({ assert }) => {
    const { auth, cipher } = await services()
    const email = uniqueEmail('2fa-expired')
    const user = await createUser({ email })
    await enableTwoFactor(user)

    const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
    assert.isTrue(outcome.twoFactorRequired)
    if (!outcome.twoFactorRequired) return

    const challenge = await UserTwoFactorChallenge.query().where('user_id', user.id).firstOrFail()
    challenge.expiresAt = DateTime.utc().minus({ minutes: 1 })
    await challenge.save()

    const validCode = await currentCodeFor(user, cipher)
    await assert.rejects(
      () =>
        auth.completeTwoFactorLogin({
          challengeToken: outcome.challenge.challengeToken,
          code: validCode,
        }),
      TwoFactorChallengeInvalidException,
    )
  })

  test('伪造的挑战令牌无效', async ({ assert }) => {
    const { auth } = await services()
    await assert.rejects(
      () => auth.completeTwoFactorLogin({ challengeToken: 'not-a-real-token', code: '000000' }),
      TwoFactorChallengeInvalidException,
    )
  })

  test('Google 登录同样过第二因子（同邮箱不可绕过）', async ({ assert }) => {
    const { auth, cipher } = await services()
    const email = uniqueEmail('2fa-google')
    const user = await createUser({ email })
    await enableTwoFactor(user)

    const outcome = await auth.attemptGoogleLogin({
      sub: 'google-sub-2fa',
      email,
      email_verified: true,
      name: '双因子用户',
    })
    assert.isTrue(outcome.twoFactorRequired)
    if (!outcome.twoFactorRequired) return

    const session = await auth.completeTwoFactorLogin({
      challengeToken: outcome.challenge.challengeToken,
      code: await currentCodeFor(user, cipher),
    })
    assert.equal(session.user.id, user.id)
  })

  test('已启用时重复 setup 被拒（换设备必须先关闭）', async ({ assert }) => {
    const { twoFactor } = await services()
    const user = await createUser({ email: uniqueEmail('2fa-resetup') })
    await enableTwoFactor(user)

    await assert.rejects(() => twoFactor.startEnrollment(user), TwoFactorStateConflictException)
  })

  test('关闭必须提供有效第二因子，成功后清空全部 2FA 数据', async ({ assert }) => {
    const { auth, twoFactor, cipher } = await services()
    const email = uniqueEmail('2fa-disable')
    const user = await createUser({ email })
    await enableTwoFactor(user)

    await assert.rejects(
      () => twoFactor.disable(user, '000000', {}, { password: STRONG_PASSWORD }),
      InvalidTwoFactorCodeException,
    )
    const statusAfterBadDisable = await twoFactor.status(user)
    assert.isTrue(statusAfterBadDisable.enabled)

    await twoFactor.disable(
      user,
      await currentCodeFor(user, cipher),
      {},
      {
        password: STRONG_PASSWORD,
      },
    )

    const status = await twoFactor.status(user)
    assert.isFalse(status.enabled)
    assert.equal(status.recoveryCodesRemaining, 0)
    assert.lengthOf(await UserTwoFactorCredential.query().where('user_id', user.id), 0)
    assert.lengthOf(await UserTwoFactorRecoveryCode.query().where('user_id', user.id), 0)
    assert.lengthOf(await UserTwoFactorChallenge.query().where('user_id', user.id), 0)

    // 关闭后回到单因子登录
    const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
    assert.isFalse(outcome.twoFactorRequired)
  })

  test('未启用时关闭 / 重置恢复码报状态冲突', async ({ assert }) => {
    const { twoFactor } = await services()
    const user = await createUser({ email: uniqueEmail('2fa-noop') })

    await assert.rejects(
      () => twoFactor.disable(user, '000000', {}, { password: STRONG_PASSWORD }),
      TwoFactorStateConflictException,
    )
    await assert.rejects(
      () => twoFactor.regenerateRecoveryCodes(user, '000000'),
      TwoFactorStateConflictException,
    )
  })

  test('重置恢复码整批替换，旧码立即失效', async ({ assert }) => {
    const { auth, twoFactor } = await services()
    const email = uniqueEmail('2fa-regen')
    const user = await createUser({ email })
    const { recoveryCodes } = await enableTwoFactor(user)
    const [oldCode, secondOldCode] = recoveryCodes

    // 用一条旧恢复码作为第二因子来重置（认证器丢了正是这个场景）
    const fresh = await twoFactor.regenerateRecoveryCodes(user, oldCode)
    assert.lengthOf(fresh, TwoFactorService.RECOVERY_CODE_COUNT)
    for (const code of fresh) {
      assert.notInclude(recoveryCodes, code)
    }
    const statusAfterRegen = await twoFactor.status(user)
    assert.equal(statusAfterRegen.recoveryCodesRemaining, TwoFactorService.RECOVERY_CODE_COUNT)

    const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
    assert.isTrue(outcome.twoFactorRequired)
    if (!outcome.twoFactorRequired) return
    await assert.rejects(
      () =>
        auth.completeTwoFactorLogin({
          challengeToken: outcome.challenge.challengeToken,
          code: secondOldCode,
        }),
      InvalidTwoFactorCodeException,
    )
  })

  test('更换认证器：必须先用当前第二因子授权', async ({ assert }) => {
    const { twoFactor } = await services()
    const user = await createUser({ email: uniqueEmail('2fa-rebind-auth') })
    await enableTwoFactor(user)

    // 不给当前验证码 → 状态冲突（不是「已启用」那种一刀切拒绝，而是明确要求授权）
    await assert.rejects(() => twoFactor.startEnrollment(user), TwoFactorStateConflictException)
    // 给错的当前验证码 → 拒绝
    await assert.rejects(
      () => twoFactor.startEnrollment(user, { currentCode: '000000', password: STRONG_PASSWORD }),
      InvalidTwoFactorCodeException,
    )
  })

  test('更换认证器：确认前旧认证器仍有效，确认后立即失效', async ({ assert }) => {
    const { auth, twoFactor, cipher } = await services()
    const email = uniqueEmail('2fa-rebind')
    const user = await createUser({ email })
    const { secret: oldSecret } = await enableTwoFactor(user)

    // 用当前认证器授权，拿到一张全新的二维码
    const rebind = await twoFactor.startEnrollment(user, {
      currentCode: await currentCodeFor(user, cipher),
      password: STRONG_PASSWORD,
    })
    assert.notEqual(rebind.secret, oldSecret)
    assert.include(rebind.otpauthUri, `secret=${rebind.secret}`)

    // 在途状态：status 报 rebinding，旧密钥仍然是生效的那把
    const midway = await twoFactor.status(user)
    assert.isTrue(midway.enabled)
    assert.isTrue(midway.rebinding)
    const credentialMidway = await UserTwoFactorCredential.query()
      .where('user_id', user.id)
      .firstOrFail()
    assert.equal(cipher.decrypt(credentialMidway.secretEncrypted), oldSecret)

    // 用**新**密钥的验证码确认，完成更换并领新恢复码
    const freshCodes = await twoFactor.confirmEnrollment(
      user,
      totpCodeForStep(rebind.secret, currentStep(rebind.period) + 1),
    )
    assert.lengthOf(freshCodes, TwoFactorService.RECOVERY_CODE_COUNT)

    const after = await twoFactor.status(user)
    assert.isTrue(after.enabled)
    assert.isFalse(after.rebinding)
    const credentialAfter = await UserTwoFactorCredential.query()
      .where('user_id', user.id)
      .firstOrFail()
    assert.equal(cipher.decrypt(credentialAfter.secretEncrypted), rebind.secret)
    assert.isNull(credentialAfter.pendingSecretEncrypted)

    // 旧认证器的码此后一律无效
    const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
    assert.isTrue(outcome.twoFactorRequired)
    if (!outcome.twoFactorRequired) return
    await assert.rejects(
      () =>
        auth.completeTwoFactorLogin({
          challengeToken: outcome.challenge.challengeToken,
          code: totpCodeForStep(oldSecret, currentStep() + 1),
        }),
      InvalidTwoFactorCodeException,
    )
  })

  test('密码错误时不下发挑战（第二因子不能泄露密码是否正确）', async ({ assert }) => {
    const { auth } = await services()
    const email = uniqueEmail('2fa-wrongpass')
    const user = await createUser({ email })
    await enableTwoFactor(user)

    await assert.rejects(() => auth.attemptLogin({ email, password: 'Wrong0rd!' }))
    assert.lengthOf(await UserTwoFactorChallenge.query().where('user_id', user.id), 0)
  })
})
