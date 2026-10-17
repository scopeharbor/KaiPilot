/**
 * v3-plugin-approval-change-flow —— 统一变更请求 API 校验器（手写风格，与
 * plugin_install_validator 一致：返回 { valid, errors[] }，不做查库验证）。
 */
import { PLUGIN_CHANGE_KINDS, isPluginChangeErrorCode, type PluginChangeKind } from '@aiproj/types'

export interface ValidationIssue {
  field: string
  message: string
}

export interface ValidationResult<T> {
  valid: boolean
  errors: ValidationIssue[]
  value?: T
}

function ok<T>(value: T): ValidationResult<T> {
  return { valid: true, errors: [], value }
}

function fail(errors: ValidationIssue[]): { valid: false; errors: ValidationIssue[] } {
  return { valid: false, errors }
}

/** POST / —— 创建请求 */
export function validateCreateChangeRequestInput(body: Record<string, unknown>): ValidationResult<{
  kind: PluginChangeKind
  pluginId: string
  releaseId?: number
  approvalRequired?: boolean
}> {
  const errors: ValidationIssue[] = []
  const kind = body.kind
  if (typeof kind !== 'string' || !(PLUGIN_CHANGE_KINDS as readonly string[]).includes(kind)) {
    errors.push({
      field: 'kind',
      message: 'kind 必须是 install | permission-upgrade | version-upgrade',
    })
  }
  const pluginId = body.pluginId
  if (typeof pluginId !== 'string' || pluginId.trim().length === 0 || pluginId.length > 200) {
    errors.push({ field: 'pluginId', message: 'pluginId 必填且长度 ≤ 200' })
  }
  let releaseId: number | undefined
  if (body.releaseId !== undefined) {
    if (
      typeof body.releaseId !== 'number' ||
      !Number.isInteger(body.releaseId) ||
      body.releaseId <= 0
    ) {
      errors.push({ field: 'releaseId', message: 'releaseId 必须为正整数' })
    } else {
      releaseId = body.releaseId
    }
  }
  let approvalRequired: boolean | undefined
  if (body.approvalRequired !== undefined) {
    if (typeof body.approvalRequired !== 'boolean') {
      errors.push({ field: 'approvalRequired', message: 'approvalRequired 必须为布尔值' })
    } else {
      approvalRequired = body.approvalRequired
    }
  }
  if (errors.length > 0) return fail(errors)
  return ok({
    kind: kind as PluginChangeKind,
    pluginId: (pluginId as string).trim(),
    releaseId,
    approvalRequired,
  })
}

/** 审批/拒绝输入 */
export function validateDecisionInput(body: Record<string, unknown>): ValidationResult<{
  idempotencyKey: string
  reasonCode?: string
}> {
  const errors: ValidationIssue[] = []
  const idempotencyKey = body.idempotencyKey
  if (
    typeof idempotencyKey !== 'string' ||
    idempotencyKey.trim().length === 0 ||
    idempotencyKey.length > 120
  ) {
    errors.push({ field: 'idempotencyKey', message: 'idempotencyKey 必填且长度 ≤ 120' })
  }
  let reasonCode: string | undefined
  if (body.reasonCode !== undefined) {
    if (typeof body.reasonCode !== 'string' || !isPluginChangeErrorCode(body.reasonCode)) {
      errors.push({ field: 'reasonCode', message: 'reasonCode 必须是封闭错误码词表内的值' })
    } else {
      reasonCode = body.reasonCode
    }
  }
  if (errors.length > 0) return fail(errors)
  return ok({
    idempotencyKey: (idempotencyKey as string).trim(),
    reasonCode,
  })
}

/** 确认输入：客户端只回传句柄字符串（authority 字段全部服务端持有） */
export function validateConfirmHandleInput(
  body: Record<string, unknown>,
): ValidationResult<{ handle: string }> {
  const handle = body.handle
  if (typeof handle !== 'string' || !handle.startsWith('chg-cfm-') || handle.length > 80) {
    return fail([{ field: 'handle', message: 'handle 必填且形如 chg-cfm-*' }])
  }
  return ok({ handle })
}

/** 列表过滤 */
export function validateListQuery(query: Record<string, unknown>): ValidationResult<{
  state?: string
  kind?: string
  pluginId?: string
  page?: number
  perPage?: number
}> {
  const errors: ValidationIssue[] = []
  const out: { state?: string; kind?: string; pluginId?: string; page?: number; perPage?: number } =
    {}
  if (query.state !== undefined) {
    if (typeof query.state !== 'string')
      errors.push({ field: 'state', message: 'state 必须为字符串' })
    else out.state = query.state
  }
  if (query.kind !== undefined) {
    if (
      typeof query.kind !== 'string' ||
      !(PLUGIN_CHANGE_KINDS as readonly string[]).includes(query.kind)
    ) {
      errors.push({ field: 'kind', message: 'kind 非法' })
    } else out.kind = query.kind
  }
  if (query.pluginId !== undefined && typeof query.pluginId === 'string')
    out.pluginId = query.pluginId
  for (const key of ['page', 'perPage'] as const) {
    if (query[key] !== undefined) {
      const n = Number(query[key])
      if (!Number.isInteger(n) || n <= 0)
        errors.push({ field: key, message: `${key} 必须为正整数` })
      else out[key] = n
    }
  }
  if (errors.length > 0) return fail(errors)
  return ok(out)
}
