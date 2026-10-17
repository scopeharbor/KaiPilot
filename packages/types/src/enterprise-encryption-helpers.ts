// @aiproj/types — 企业级加密与密钥管理：确定性稳定 hash、fingerprint、scope hash 辅助函数
// 纯函数，零运行时依赖，前后端共享。

import crypto from 'node:crypto'
import {
  isKeyPurpose,
  isKmsProviderType,
  isKeyVersionState,
  isKmsWarningCode,
  isKmsForbiddenKey,
  ENVELOPE_PREFIX,
  ENVELOPE_VERSION,
  ENVELOPE_ALGORITHM,
  type KeyPurpose,
  type KmsProviderType,
} from './enterprise-encryption-and-key-management.js'

// ──────────────────────────────────────────────
// 1. 确定性稳定 hash
// ──────────────────────────────────────────────

/**
 * 稳定 FNV-1a 64-bit hash（与 enterprise-audit-enhancement / enterprise-dlp-engine 对齐）。
 * 接受任意字符串，返回 16 字符十六进制小写字符串。
 * 对同一输入始终返回同一值，适合用于指纹、签名、source hash。
 */
export function fnv1aHash(input: string): string {
  const hash = crypto.createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16)
  return hash
}

/**
 * 计算稳定签名（hash 的 hash），用于预览签名等需要防碰撞的场景。
 * 对同一输入始终返回同一值。
 *
 * 注：命名为 kmsComputeStableSignature 以避免与 enterprise-dlp-engine 中的
 * computeStableSignature（接受 Record<string, unknown>）在 barrel export 时冲突。
 */
export function kmsComputeStableSignature(input: string): string {
  return fnv1aHash(`kms:${input}`)
}

// ──────────────────────────────────────────────
// 2. 非 secret fingerprint
// ──────────────────────────────────────────────

/**
 * 计算 key version 的非 secret fingerprint。
 * 输入：组织 ID、purpose、provider、version 号、root key 的 hash 前缀。
 * 输出：低敏感指纹，用于 UI 展示与验证匹配。
 */
export function computeKeyVersionFingerprint(
  organizationId: string,
  purpose: KeyPurpose,
  provider: KmsProviderType,
  version: number,
  rootKeyPrefix: string,
): string {
  const raw = `${organizationId}::${purpose}::${provider}::v${version}::${rootKeyPrefix}`
  return fnv1aHash(raw)
}

/**
 * 计算组织作用域 hash（用于组织隔离检查）。
 */
export function computeOrganizationScopeHash(organizationId: string): string {
  return fnv1aHash(`org:${organizationId}`)
}

/**
 * 计算 source hash（用于适配器/引用追踪）。
 */
export function computeSourceHash(
  purpose: KeyPurpose,
  recordId: string,
  currentHash: string,
): string {
  const raw = `${purpose}::${recordId}::${currentHash}`
  return fnv1aHash(raw)
}

// ──────────────────────────────────────────────
// 3. 稳定 key 排序
// ──────────────────────────────────────────────

/**
 * 对对象键做稳定排序后返回 JSON 字符串（递归处理嵌套对象）。
 * 用于确保 hash 计算不因 key 顺序变化而改变。
 */
export function stableKeyOrder(obj: Record<string, unknown>): string {
  const sorted = sortKeys(obj)
  return JSON.stringify(sorted)
}

function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sortKeys)

  const keys = Object.keys(value as Record<string, unknown>).sort()
  const ordered: Record<string, unknown> = {}
  for (const k of keys) {
    ordered[k] = sortKeys((value as Record<string, unknown>)[k])
  }
  return ordered
}

// ──────────────────────────────────────────────
// 4. 枚举合法性守卫
// ──────────────────────────────────────────────

/**
 * 检查 KeyPurpose 是否合法（与 isKeyPurpose 等价，但显式重导出方便消费者）。
 */
export { isKeyPurpose, isKmsProviderType, isKeyVersionState, isKmsWarningCode, isKmsForbiddenKey }

/**
 * 检查 envelope version 是否已知。
 */
export function isKnownEnvelopeVersion(version: string): boolean {
  return version === ENVELOPE_VERSION
}

/**
 * 检查算法是否受支持。
 */
export function isSupportedAlgorithm(algorithm: string): boolean {
  return algorithm === ENVELOPE_ALGORITHM
}

// ──────────────────────────────────────────────
// 5. Envelope 占位符常量
// ──────────────────────────────────────────────

export const ENVELOPE_PREFIX_V1 = `${ENVELOPE_PREFIX}.${ENVELOPE_VERSION}`

/**
 * 完整的 envelope 格式示例：
 * ekm.v1.base64url(json-header).base64url(wrapped-dek).base64url(iv).base64url(tag).base64url(ciphertext)
 */
export const ENVELOPE_EXAMPLE = 'ekm.v1.eyJhIjogIkFFUy0yNTYtR0NNIn0.abc123.def456.ghi789.jkl012'

/**
 * 已知的 envelope 前缀常量。
 */
export const ALL_KNOWN_ENVELOPE_PREFIXES = [ENVELOPE_PREFIX_V1] as const
