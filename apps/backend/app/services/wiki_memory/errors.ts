/**
 * v3-llm-wiki-memory-foundation —— 记忆维基业务错误。控制器按类别映射为统一错误 envelope。
 */
import type { WikiParseError } from '@aiproj/types'

export class WikiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

/** 不存在、跨组织或无权读取：一律 404，不泄露存在性。 */
export class WikiNotFoundError extends WikiError {
  constructor(message = '资源不存在') {
    super('RESOURCE_NOT_FOUND', message, 404)
  }
}

export class WikiPermissionError extends WikiError {
  constructor(message = '没有执行此操作的权限') {
    super('PERMISSION_DENIED', message, 403)
  }
}

export class WikiValidationError extends WikiError {
  constructor(message: string, errors?: WikiParseError[]) {
    super('VALIDATION_ERROR', message, 400, errors ? { errors } : undefined)
  }
}

/** 基线修订过期、状态不允许等并发冲突。 */
export class WikiConflictError extends WikiError {
  constructor(message: string, code = 'WIKI_CONFLICT') {
    super(code, message, 409)
  }
}

export class WikiRetractedClaimError extends WikiError {
  constructor(keys: string[]) {
    super('WIKI_CLAIM_RETRACTED', '修订包含已被撤回的主张，需先由审阅者解除撤回记录', 409, {
      claimKeys: keys,
    })
  }
}

export class WikiFeatureDisabledError extends WikiError {
  constructor() {
    super('FEATURE_DISABLED', '本组织未开启记忆维基', 503)
  }
}

export class WikiDlpBlockedError extends WikiError {
  constructor() {
    super('DLP_BLOCKED', '数据防泄漏策略不允许导出这些内容', 403)
  }
}
