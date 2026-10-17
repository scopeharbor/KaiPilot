import AuthService from '#services/auth_service'
import TwoFactorService from '#services/two_factor_service'
import UserTwoFactorChallenge from '#models/user_two_factor_challenge'
import UserTwoFactorCredential from '#models/user_two_factor_credential'
import { currentStep, totpCodeForStep } from '#services/two_factor/totp'
import {
  InvalidTwoFactorCodeException,
  TwoFactorChallengeInvalidException,
} from '#exceptions/api_exception'
import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { test } from '@japa/runner'
import { STRONG_PASSWORD, createUser, uniqueEmail, useAuthDatabase } from './_helpers.js'

/**
 * 登录期绑定（enrollment-at-login）。
 *
 * 账号尚未绑定认证器时，密码通过后**不直接给会话**，而是先在登录界面给出二维码让用户
 * 当场绑定——Auth0 Universal Login 的原话是 "they are prompted to scan a QR code to
 * enroll in OTPs"，绑定完成后才是常规的「读码 → 输码」登录。
 *
 * 本组显式开启该策略；`.env.test` 里默认关着，以免改变既有认证用例的「密码正确即拿到
 * 会话」契约。
 */
test.group('两步验证登录期绑定', (group) => {
  useAuthDatabase(group)

  /** 逐用例设置策略并在用例后还原，避免污染同进程内其他 spec。 */
  function useEnrollmentMode(mode: 'off' | 'optional' | 'required') {
    const previous = env.get('TWO_FACTOR_LOGIN_ENROLLMENT') ?? 'off'
    env.set('TWO_FACTOR_LOGIN_ENROLLMENT', mode)
    return () => env.set('TWO_FACTOR_LOGIN_ENROLLMENT', previous)
  }

  async function services() {
    return {
      auth: await app.container.make(AuthService),
      twoFactor: await app.container.make(TwoFactorService),
    }
  }

  test('off：未绑定账号密码通过即登录（既有契约）', async ({ assert }) => {
    const restore = useEnrollmentMode('off')
    try {
      const { auth } = await services()
      const email = uniqueEmail('2fa-enroll-off')
      await createUser({ email })
      const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
      assert.isFalse(outcome.twoFactorRequired)
    } finally {
      restore()
    }
  })

  test('optional：密码通过后给出扫码绑定挑战，且不含任何会话凭证', async ({ assert }) => {
    const restore = useEnrollmentMode('optional')
    try {
      const { auth, twoFactor } = await services()
      const email = uniqueEmail('2fa-enroll-opt')
      const user = await createUser({ email })

      const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
      assert.isTrue(outcome.twoFactorRequired)
      if (!outcome.twoFactorRequired) return
      assert.equal(outcome.challenge.purpose, 'enroll')
      // 绑定阶段还没有恢复码，唯一可用方式是刚扫进认证器的一次性口令
      assert.deepEqual(outcome.challenge.methods, ['totp'])

      // 二维码内容用票据换取（密钥不随登录响应下发，也不进 URL）
      const enrollment = await twoFactor.enrollmentForChallenge(outcome.challenge.challengeToken)
      assert.isString(enrollment.secret)
      assert.include(enrollment.otpauthUri, 'otpauth://totp/')
      assert.include(enrollment.otpauthUri, `secret=${enrollment.secret}`)

      // 此刻账号仍未启用 2FA——挑战没兑换就什么都没发生
      const midway = await twoFactor.status(user)
      assert.isFalse(midway.enabled)
      assert.isTrue(midway.pending)
    } finally {
      restore()
    }
  })

  test('optional：扫码后输码完成绑定并登录，同批下发恢复码', async ({ assert }) => {
    const restore = useEnrollmentMode('optional')
    try {
      const { auth, twoFactor } = await services()
      const email = uniqueEmail('2fa-enroll-done')
      const user = await createUser({ email })

      const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
      assert.isTrue(outcome.twoFactorRequired)
      if (!outcome.twoFactorRequired) return

      const enrollment = await twoFactor.enrollmentForChallenge(outcome.challenge.challengeToken)
      const session = await auth.completeTwoFactorLogin({
        challengeToken: outcome.challenge.challengeToken,
        code: totpCodeForStep(enrollment.secret, currentStep(enrollment.period)),
      })

      assert.isString(session.accessToken)
      assert.equal(session.user.id, user.id)
      assert.lengthOf(session.recoveryCodes ?? [], TwoFactorService.RECOVERY_CODE_COUNT)

      const status = await twoFactor.status(user)
      assert.isTrue(status.enabled)
      assert.equal(status.recoveryCodesRemaining, TwoFactorService.RECOVERY_CODE_COUNT)

      // 下次登录变成普通的 verify 挑战
      const next = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
      assert.isTrue(next.twoFactorRequired)
      if (next.twoFactorRequired) assert.equal(next.challenge.purpose, 'verify')
    } finally {
      restore()
    }
  })

  test('optional：绑定验证码错误不启用，也不签发会话', async ({ assert }) => {
    const restore = useEnrollmentMode('optional')
    try {
      const { auth, twoFactor } = await services()
      const email = uniqueEmail('2fa-enroll-bad')
      const user = await createUser({ email })

      const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
      assert.isTrue(outcome.twoFactorRequired)
      if (!outcome.twoFactorRequired) return

      await assert.rejects(
        () =>
          auth.completeTwoFactorLogin({
            challengeToken: outcome.challenge.challengeToken,
            code: '000000',
          }),
        InvalidTwoFactorCodeException,
      )
      const status = await twoFactor.status(user)
      assert.isFalse(status.enabled)
    } finally {
      restore()
    }
  })

  test('optional：可暂时跳过，跳过后拿到会话且不留待确认密钥', async ({ assert }) => {
    const restore = useEnrollmentMode('optional')
    try {
      const { auth, twoFactor } = await services()
      const email = uniqueEmail('2fa-enroll-skip')
      const user = await createUser({ email })

      const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
      assert.isTrue(outcome.twoFactorRequired)
      if (!outcome.twoFactorRequired) return

      const session = await auth.skipTwoFactorEnrollment({
        challengeToken: outcome.challenge.challengeToken,
      })
      assert.isString(session.accessToken)

      const status = await twoFactor.status(user)
      assert.isFalse(status.enabled)
      assert.isFalse(status.pending)
      assert.lengthOf(await UserTwoFactorCredential.query().where('user_id', user.id), 0)
      assert.lengthOf(await UserTwoFactorChallenge.query().where('user_id', user.id), 0)
    } finally {
      restore()
    }
  })

  test('required：不允许跳过', async ({ assert }) => {
    const restore = useEnrollmentMode('required')
    try {
      const { auth } = await services()
      const email = uniqueEmail('2fa-enroll-req')
      await createUser({ email })

      const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
      assert.isTrue(outcome.twoFactorRequired)
      if (!outcome.twoFactorRequired) return

      await assert.rejects(
        () => auth.skipTwoFactorEnrollment({ challengeToken: outcome.challenge.challengeToken }),
        TwoFactorChallengeInvalidException,
      )
    } finally {
      restore()
    }
  })

  test('已绑定账号的 verify 挑战永远不可跳过', async ({ assert }) => {
    const restore = useEnrollmentMode('optional')
    try {
      const { auth, twoFactor } = await services()
      const email = uniqueEmail('2fa-enroll-noskip')
      const user = await createUser({ email })

      const enrollment = await twoFactor.startEnrollment(user)
      await twoFactor.confirmEnrollment(
        user,
        totpCodeForStep(enrollment.secret, currentStep(enrollment.period)),
      )

      const outcome = await auth.attemptLogin({ email, password: STRONG_PASSWORD })
      assert.isTrue(outcome.twoFactorRequired)
      if (!outcome.twoFactorRequired) return
      assert.equal(outcome.challenge.purpose, 'verify')

      await assert.rejects(
        () => auth.skipTwoFactorEnrollment({ challengeToken: outcome.challenge.challengeToken }),
        TwoFactorChallengeInvalidException,
      )
    } finally {
      restore()
    }
  })

  test('Google 登录同样走登录期绑定', async ({ assert }) => {
    const restore = useEnrollmentMode('optional')
    try {
      const { auth, twoFactor } = await services()
      const email = uniqueEmail('2fa-enroll-google')
      await createUser({ email })

      const outcome = await auth.attemptGoogleLogin({
        sub: 'google-sub-enroll',
        email,
        email_verified: true,
        name: '待绑定用户',
      })
      assert.isTrue(outcome.twoFactorRequired)
      if (!outcome.twoFactorRequired) return
      assert.equal(outcome.challenge.purpose, 'enroll')

      const enrollment = await twoFactor.enrollmentForChallenge(outcome.challenge.challengeToken)
      const session = await auth.completeTwoFactorLogin({
        challengeToken: outcome.challenge.challengeToken,
        code: totpCodeForStep(enrollment.secret, currentStep(enrollment.period)),
      })
      assert.isString(session.accessToken)
      assert.lengthOf(session.recoveryCodes ?? [], TwoFactorService.RECOVERY_CODE_COUNT)
    } finally {
      restore()
    }
  })
})
