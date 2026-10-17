import vine from '@vinejs/vine'

/**
 * 两步验证请求校验器。
 *
 * `code` 刻意只做「非空 + 长度上界」校验，不在此区分一次性口令与恢复码格式：
 * 格式判定属业务语义（`TwoFactorService` 先试 TOTP 再试恢复码），放在校验层会让
 * 「码的形态」变成可探测信息，也会在用户误输时给出两种不同的错误。
 */
const secondFactorCode = () => vine.string().trim().minLength(1).maxLength(64)

/** 只带挑战票据的请求（取二维码、跳过绑定）。 */
export const twoFactorChallengeValidator = vine.create({
  challengeToken: vine.string().trim().minLength(1).maxLength(256),
})

/** 登录第二步：兑换挑战票据。 */
export const twoFactorLoginValidator = vine.create({
  challengeToken: vine.string().trim().minLength(1).maxLength(256),
  code: secondFactorCode(),
})

/**
 * 开始设置 / 更换认证器。
 * - `label`：可选的认证器标签（纯展示，便于用户区分多台设备）；
 * - `currentCode`：**更换认证器**时必填的当前第二因子。首次绑定不需要，
 *   故在校验层是可选的，「已启用就必须给」由 Service 判定（那才是它能看到状态的地方）。
 */
export const twoFactorSetupValidator = vine.create({
  label: vine.string().trim().maxLength(64).nullable().optional(),
  currentCode: secondFactorCode().optional(),
  /** 更换认证器时的密码重认证。local 账号必填，SSO 账号无此因子（由 Service 判定）。 */
  password: vine.string().maxLength(256).optional(),
})

/** 确认 / 重置恢复码：只要一个第二因子。 */
export const twoFactorCodeValidator = vine.create({
  code: secondFactorCode(),
})

/** 关闭两步验证：第二因子 + 密码重认证（高风险动作）。 */
export const twoFactorDisableValidator = vine.create({
  code: secondFactorCode(),
  password: vine.string().maxLength(256).optional(),
})

/**
 * 管理员代为重置他人两步验证。
 * `reason` 必填且要求有实质内容——这是人工核身的留痕，空理由等于没有留痕。
 */
export const twoFactorAdminResetValidator = vine.create({
  reason: vine.string().trim().minLength(4).maxLength(500),
})
