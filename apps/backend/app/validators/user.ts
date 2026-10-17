import vine from '@vinejs/vine'

/**
 * Shared rules for email and password.
 */
const email = () => vine.string().email().maxLength(254)

/**
 * 密码策略（SEC-02）：至少 8 位，且包含大写字母、小写字母、数字。
 */
const password = () =>
  vine
    .string()
    .minLength(8)
    .maxLength(32)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)

/**
 * 用户注册校验器。
 */
export const registerValidator = vine.create({
  fullName: vine.string().nullable(),
  email: email().unique({ table: 'users', column: 'email' }),
  password: password(),
  passwordConfirmation: password().sameAs('password'),
  organizationName: vine.string().trim().minLength(2).maxLength(255).optional(),
})

/**
 * 用户注册校验器（旧别名，兼容既有引用）。
 * TODO-DEBT: 下个迭代移除 signupValidator，统一使用 registerValidator。
 */
export const signupValidator = registerValidator

/**
 * 用户登录校验器。
 */
export const loginValidator = vine.create({
  email: email(),
  password: vine.string(),
})

/**
 * 密码修改校验器（SEC-02）。
 */
export const changePasswordValidator = vine.create({
  currentPassword: vine.string(),
  password: password(),
  passwordConfirmation: password().sameAs('password'),
})

export const listUsersValidator = vine.create({
  page: vine.number().withoutDecimals().positive().optional(),
  perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
  search: vine.string().trim().maxLength(254).optional(),
  is_active: vine.boolean().optional(),
  auth_provider: vine.enum(['local', 'google', 'saml', 'oidc']).optional(),
})

export const createUserValidator = vine.create({
  fullName: vine.string().trim().maxLength(120).nullable().optional(),
  email: email().unique({ table: 'users', column: 'email' }),
  password: password(),
  isActive: vine.boolean().optional(),
})

export const updateUserValidator = vine.create({
  fullName: vine.string().trim().maxLength(120).nullable().optional(),
  email: email().optional(),
  password: password().optional(),
  isActive: vine.boolean().optional(),
  /** 个人版是否允许自行配置 AI 连接（平台管理员按账号开关）。 */
  allowSelfAiConfig: vine.boolean().optional(),
})

export const refreshValidator = vine.create({
  refreshToken: vine.string().minLength(1),
  organizationId: vine.number().withoutDecimals().positive().nullable().optional(),
})
