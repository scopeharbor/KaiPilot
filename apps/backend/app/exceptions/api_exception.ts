import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * API 异常基类：渲染统一错误体 `{ error: { code, message, details? } }`（sec06/sec08）。
 *
 * 各领域异常继承本类并覆写 static status/code；抛出即由默认 ExceptionHandler 调用其 handle 渲染。
 */
export default class ApiException extends Exception {
  static status = 400
  static code = 'API_ERROR'

  declare details?: unknown

  constructor(message: string, options?: { status?: number; code?: string; details?: unknown }) {
    super(message, options)
    if (options?.details !== undefined) {
      this.details = options.details
    }
  }

  async handle(error: ApiException, ctx: HttpContext) {
    ctx.response.status(error.status).send({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    })
  }
}

/**
 * 缺失/无效/过期访问令牌（401）。
 */
export class AuthRequiredException extends ApiException {
  static status = 401
  static code = 'AUTH_REQUIRED'
}

/**
 * 邮箱或密码错误（401，不区分邮箱是否存在）。
 */
export class InvalidCredentialsException extends ApiException {
  static status = 401
  static code = 'INVALID_CREDENTIALS'
}

/**
 * 账户被禁用（403）。
 */
export class AccountInactiveException extends ApiException {
  static status = 403
  static code = 'ACCOUNT_INACTIVE'
}

/**
 * 登录失败次数过多，账户临时锁定（429）。
 */
export class AccountLockedException extends ApiException {
  static status = 429
  static code = 'ACCOUNT_LOCKED'
}

/**
 * 密码已验证，但账号开启了两步验证，需要提交第二因子（401）。
 *
 * 仅用于 `AuthService.login` 这类「必须直接拿到会话」的内部/测试调用路径；
 * HTTP 登录端点走 `attemptLogin`，把它表达为 `twoFactorRequired` 响应而非错误。
 */
export class TwoFactorRequiredException extends ApiException {
  static status = 401
  static code = 'TWO_FACTOR_REQUIRED'
}

/**
 * 两步验证码或恢复码不正确（401）。
 *
 * 一次性口令与恢复码共用同一个错误码：区分二者会告诉攻击者「这条恢复码存在但过期了」
 * 之类的信息，与登录不区分邮箱是否存在的既有语义一致。
 */
export class InvalidTwoFactorCodeException extends ApiException {
  static status = 401
  static code = 'TWO_FACTOR_INVALID_CODE'
}

/**
 * 登录挑战无效、已过期、已消费或尝试次数耗尽（401）。前端据此退回密码步重来。
 */
export class TwoFactorChallengeInvalidException extends ApiException {
  static status = 401
  static code = 'TWO_FACTOR_CHALLENGE_INVALID'
}

/**
 * 两步验证状态与请求不匹配（409）：如未启用却要求关闭、已启用却重复确认。
 */
export class TwoFactorStateConflictException extends ApiException {
  static status = 409
  static code = 'TWO_FACTOR_STATE_CONFLICT'
}

/**
 * 两步验证子系统自身不可用（503）。
 *
 * 目前唯一来源：库里的密钥密文结构完好却解不开，说明 `TWO_FACTOR_ENCRYPTION_KEY`
 * （或其兜底的 `APP_KEY`）被改动或配错。这种情况**必须 fail closed**——既不能放行，
 * 也绝不能把凭据当坏数据清理掉：一次配置失误不该抹掉全站用户的第二因子。
 */
export class TwoFactorUnavailableException extends ApiException {
  static status = 503
  static code = 'TWO_FACTOR_UNAVAILABLE'
}

/**
 * 两步验证尝试次数超限（429）。与登录锁定分开计数：密码已经验过，
 * 这里防的是「拿到密码后暴力猜 6 位码」。
 */
export class TwoFactorThrottledException extends ApiException {
  static status = 429
  static code = 'TWO_FACTOR_THROTTLED'
}

/**
 * JWT 内角色版本与当前不一致，需刷新（401）。
 */
export class RoleVersionMismatchException extends ApiException {
  static status = 401
  static code = 'ROLE_VERSION_MISMATCH'
}

/**
 * 权限不足（403）。
 */
export class PermissionDeniedException extends ApiException {
  static status = 403
  static code = 'PERMISSION_DENIED'
}

/**
 * 资源不存在 / 跨组织不可见（404，不泄露存在性）。
 */
export class ResourceNotFoundException extends ApiException {
  static status = 404
  static code = 'RESOURCE_NOT_FOUND'
}

/**
 * 业务状态冲突（409），例如组织 owner 保护或所有权未转交。
 */
export class ConflictException extends ApiException {
  static status = 409
  static code = 'RESOURCE_CONFLICT'
}

/**
 * 已是组织成员（产品错误码 2006）。
 */
export class AlreadyMemberException extends ApiException {
  static status = 409
  static code = '2006'
}

/**
 * 领域级参数校验失败（422）。
 */
export class ValidationException extends ApiException {
  static status = 422
  static code = 'VALIDATION_ERROR'
}

/**
 * 功能开关关闭，该能力暂不可用（503）。开关按路由组挂载时组内**读写路径一并 503**
 * （如 mpd 的 `mpdCrudFeatureGuard`），不存在「写不可用、list/detail 等读仍可用」的例外。
 */
export class FeatureDisabledException extends ApiException {
  static status = 503
  static code = 'FEATURE_DISABLED'
}

/**
 * 租户识别链路自身不可用（503，v3-multitenant-tenant-identification §3.5）。
 *
 * 仅用于 resolver 依赖（组织/成员/角色版本查询）异常这类**基础设施故障**：
 * 此时服务端拿不到可信租户事实，必须 fail closed 返回 degraded，
 * **绝不允许**回退到客户端提交的 organizationId hint 继续放行业务。
 */
export class TenantResolutionUnavailableException extends ApiException {
  static status = 503
  static code = 'TENANT_RESOLUTION_UNAVAILABLE'
}

/**
 * 连接池治理异常（v3-multitenant-connection-pool-management §6.5）。
 *
 * 对外统一 503 + 非泄露 message：耗尽、超时、降级、熔断在 API 层不得暴露
 * 其他租户的活跃/排队数、provider 名称、连接串或原始驱动错误——等待时间与
 * 错误细节本身就是多租户侧信道（design Risk「队列等待时间成为侧信道」）。
 *
 * `code` 用具体的 `CONNECTION_POOL_*` 值，便于客户端区分重试策略；
 * 具体值来自共享契约 `TCPM_POOL_ERROR_CODES`，不含任何租户维度信息。
 */
export class ConnectionPoolUnavailableException extends ApiException {
  static status = 503
  static code = 'CONNECTION_POOL_EXHAUSTED'

  constructor(code: string, message: string, status = 503) {
    super(message, { status, code })
  }
}
