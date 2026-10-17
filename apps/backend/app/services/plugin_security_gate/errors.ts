/**
 * v3-plugin-security-gate — 集中错误映射（任务 5.5）
 */
export const GATE_ERROR_CODES = {
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SERVICE_ERROR: 'SERVICE_ERROR',
} as const
export type GateErrorCode = (typeof GATE_ERROR_CODES)[keyof typeof GATE_ERROR_CODES]
export interface GateErrorEnvelope {
  error: { code: GateErrorCode; message: string; details?: Record<string, unknown> }
}
import type { PluginSecurityGateReasonCode } from '@aiproj/types'
const CROSS_TENANT_REASONS: Set<PluginSecurityGateReasonCode> = new Set([
  'cross-tenant-denied',
  'cross-project-denied',
  'scope-mismatch',
  'install-invalid',
  'grant-missing',
])
const PERMISSION_REASONS: Set<PluginSecurityGateReasonCode> = new Set([
  'rbac-denied',
  'policy-denied',
  'grant-escalation',
  'seam-not-ready',
  'confirmation-required',
  'unknown-permission',
  'orphan-contribution',
])
export function mapGateReasonToHttpError(
  reasonCode: PluginSecurityGateReasonCode,
  targetVisibleInCurrentScope: boolean,
): GateErrorEnvelope {
  if (CROSS_TENANT_REASONS.has(reasonCode) || !targetVisibleInCurrentScope)
    return { error: { code: GATE_ERROR_CODES.RESOURCE_NOT_FOUND, message: '请求的资源不存在' } }
  if (PERMISSION_REASONS.has(reasonCode))
    return { error: { code: GATE_ERROR_CODES.PERMISSION_DENIED, message: '权限不足' } }
  return { error: { code: GATE_ERROR_CODES.SERVICE_ERROR, message: '服务暂时不可用' } }
}
export function sanitizeGateErrorDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(details)) {
    const lower = k.toLowerCase()
    if (['token', 'secret', 'authorization', 'password', 'apikey'].some((p) => lower.includes(p)))
      continue
    out[k] = v
  }
  return out
}
