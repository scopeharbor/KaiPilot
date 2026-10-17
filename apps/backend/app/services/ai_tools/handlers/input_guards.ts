// v3-ai-tools-orchestration-layer W2 —— AI 入参轻量防御性收窄
//
// AI 调用方的入参可信度低（可能以字符串携带数字等），虽然编排层已按 JSON Schema
// 做过一次确定性校验，handler 侧仍做一层防御性收窄：类型不符/越界一律抛
// ValidationException（422），绝不静默接受脏数据进入领域服务。
import { ValidationException } from '#exceptions/api_exception'

/** 收窄为有限正整数（AI 入参常以字符串携带数字）。 */
export function asPositiveInt(value: unknown, name: string): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(num) || num <= 0) {
    throw new ValidationException(`${name} 必须是正整数`)
  }
  return num
}

/** 收窄为有限数字（允许 0/小数，如风险评分下限）。 */
export function asFiniteNumber(value: unknown, name: string): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) {
    throw new ValidationException(`${name} 必须是数字`)
  }
  return num
}

/** 收窄为字符串（空串视为缺省，由调用方决定默认值）。 */
export function asOptionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined
  const str = String(value).trim()
  if (str.length > 200) {
    throw new ValidationException(`${name} 超出长度上限`)
  }
  return str || undefined
}

/** 收窄为布尔值（仅接受 true/false 或 'true'/'false' 字符串）。 */
export function asBoolean(value: unknown, name: string): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1 || value === '1') return true
  if (value === 'false' || value === 0 || value === '0') return false
  throw new ValidationException(`${name} 必须是布尔值`)
}

/** 分页收窄：缺省回落默认值，超出上限封顶。 */
export function asPage(value: unknown, name: string, fallback: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback
  return Math.min(asPositiveInt(value, name), max)
}
