/**
 * v3-plugin-action-preview-boundary —— plugin action API 手写校验器。
 * 风格与 plugin_install_validator 一致：返回 { valid, errors[] }，不查库。
 */
import type { PluginActionDecisionKind } from '@aiproj/types'

export interface ValidationResult {
  valid: boolean
  errors: { field: string; rule: string; message: string }[]
}

function result(errors: ValidationResult['errors']): ValidationResult {
  return { valid: errors.length === 0, errors }
}

/** POST /plugin-actions/:proposalUid/confirm 载荷 */
export function validateConfirmPayload(
  payload: Record<string, unknown> | undefined | null,
): ValidationResult & { handle: string } {
  const errors: ValidationResult['errors'] = []
  const body = payload ?? {}
  if (typeof body.handle !== 'string' || body.handle.trim().length === 0) {
    errors.push({ field: 'handle', rule: 'required', message: '缺少确认句柄' })
  }
  return { ...result(errors), handle: typeof body.handle === 'string' ? body.handle : '' }
}

const DECISION_KINDS: readonly PluginActionDecisionKind[] = [
  'accept',
  'reject',
  'modify',
  'discard',
]

/** POST /plugin-actions/:proposalUid/decision 载荷 */
export function validateDecisionPayload(
  payload: Record<string, unknown> | undefined | null,
): ValidationResult & { decision: PluginActionDecisionKind | null; userModifiedValue?: unknown } {
  const errors: ValidationResult['errors'] = []
  const body = payload ?? {}
  let decision: PluginActionDecisionKind | null = null
  if (
    typeof body.decision !== 'string' ||
    !DECISION_KINDS.includes(body.decision as PluginActionDecisionKind)
  ) {
    errors.push({
      field: 'decision',
      rule: 'enum',
      message: 'decision 必须是 accept/reject/modify/discard 之一',
    })
  } else {
    decision = body.decision as PluginActionDecisionKind
    if (decision === 'modify') {
      if (body.userModifiedValue === undefined || body.userModifiedValue === null) {
        errors.push({
          field: 'userModifiedValue',
          rule: 'required',
          message: '修改决策必须携带修改后的值',
        })
      } else if (
        typeof body.userModifiedValue !== 'object' ||
        Array.isArray(body.userModifiedValue)
      ) {
        errors.push({ field: 'userModifiedValue', rule: 'object', message: '修改后的值必须是对象' })
      }
    }
  }
  return { ...result(errors), decision, userModifiedValue: body.userModifiedValue }
}
