// @aiproj/types — 企业级加密与密钥管理：Envelope Header 解析器/校验器
// 纯函数，零运行时依赖，前后端共享。

import {
  ENVELOPE_PREFIX,
  ENVELOPE_VERSION,
  ENVELOPE_PARTS_EXPECTED,
  isKeyPurpose,
  isKmsProviderType,
  type EnvelopeHeader,
  type KeyPurpose,
} from './enterprise-encryption-and-key-management.js'
import { isKnownEnvelopeVersion, isSupportedAlgorithm } from './enterprise-encryption-helpers.js'

// ──────────────────────────────────────────────
// 1. Envelope 序列化与解析
// ──────────────────────────────────────────────

/**
 * 将 EnvelopeHeader 序列化为 JSON 字符串。
 */
export function serializeEnvelopeHeader(header: EnvelopeHeader): string {
  return JSON.stringify(header)
}

/**
 * 解析 base64url 编码的 JSON header。
 * 返回解析失败时返回 null。
 */
export function parseEnvelopeHeader(raw: string): EnvelopeHeader | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8')
    const parsed = JSON.parse(json) as Record<string, unknown>
    return parsed as EnvelopeHeader
  } catch {
    return null
  }
}

/**
 * 解析完整 envelope payload，返回各部分或 null。
 * 格式：ekm.v1.<header>.<wrappedDek>.<iv>.<tag>.<ciphertext>
 */
export function parseEnvelope(payload: string): {
  header: EnvelopeHeader | null
  headerRaw: string
  wrappedDek: string
  iv: string
  tag: string
  ciphertext: string
} | null {
  const parts = payload.split('.')
  if (parts.length !== ENVELOPE_PARTS_EXPECTED) return null

  const [prefix, version, headerRaw, wrappedDek, iv, tag, ciphertext] = parts
  if (prefix !== ENVELOPE_PREFIX || version !== ENVELOPE_VERSION) return null

  // noUncheckedIndexedAccess 下按下标取值恒为 `string | undefined`，
  // 长度校验不会让 TS 收窄，这里显式判空后各段才是 string。
  if (
    headerRaw === undefined ||
    wrappedDek === undefined ||
    iv === undefined ||
    tag === undefined ||
    ciphertext === undefined
  ) {
    return null
  }

  const header = parseEnvelopeHeader(headerRaw)
  return { header, headerRaw, wrappedDek, iv, tag, ciphertext }
}

/**
 * 检查 payload 是否为 KMS envelope 格式（快速检测）。
 */
export function isKmsEnvelope(payload: string): boolean {
  return payload.startsWith(`${ENVELOPE_PREFIX}.${ENVELOPE_VERSION}.`)
}

// ──────────────────────────────────────────────
// 2. Envelope 校验
// ──────────────────────────────────────────────

export type EnvelopeValidationResult = {
  valid: boolean
  /** 当 valid 为 false 时的警告码 */
  warningCode?: string
  /** 错误描述 */
  detail?: string
}

/**
 * 校验 envelope header 的必填字段与合法性。
 */
export function validateEnvelopeHeader(header: unknown): EnvelopeValidationResult {
  if (!header || typeof header !== 'object') {
    return {
      valid: false,
      warningCode: 'envelope_format_invalid',
      detail: 'Header must be an object',
    }
  }

  const h = header as Record<string, unknown>

  if (!isKnownEnvelopeVersion(String(h.envVersion ?? ''))) {
    return {
      valid: false,
      warningCode: 'envelope_version_unknown',
      detail: `Unknown envelope version: ${h.envVersion}`,
    }
  }

  if (!isSupportedAlgorithm(String(h.algorithm ?? ''))) {
    return {
      valid: false,
      warningCode: 'envelope_algorithm_mismatch',
      detail: `Unsupported algorithm: ${h.algorithm}`,
    }
  }

  if (!isKeyPurpose(h.purpose)) {
    return {
      valid: false,
      warningCode: 'envelope_purpose_mismatch',
      detail: `Invalid purpose: ${String(h.purpose)}`,
    }
  }

  if (!isKmsProviderType(h.provider)) {
    return {
      valid: false,
      warningCode: 'envelope_format_invalid',
      detail: `Invalid provider: ${String(h.provider)}`,
    }
  }

  if (typeof h.organizationHash !== 'string' || h.organizationHash.length === 0) {
    return {
      valid: false,
      warningCode: 'envelope_organization_mismatch',
      detail: 'Missing organizationHash',
    }
  }

  if (typeof h.keyVersionFingerprint !== 'string' || h.keyVersionFingerprint.length === 0) {
    return {
      valid: false,
      warningCode: 'key_version_not_found',
      detail: 'Missing keyVersionFingerprint',
    }
  }

  if (typeof h.aadHash !== 'string' || h.aadHash.length === 0) {
    return { valid: false, warningCode: 'envelope_tampered', detail: 'Missing aadHash' }
  }

  return { valid: true }
}

/**
 * 校验 envelope 的 organization 匹配。
 */
export function checkEnvelopeOrganization(
  header: EnvelopeHeader,
  expectedOrgHash: string,
): EnvelopeValidationResult {
  if (header.organizationHash !== expectedOrgHash) {
    return {
      valid: false,
      warningCode: 'envelope_organization_mismatch',
      detail: 'Organization hash does not match',
    }
  }
  return { valid: true }
}

/**
 * 校验 envelope 的 purpose 匹配。
 */
export function checkEnvelopePurpose(
  header: EnvelopeHeader,
  expectedPurpose: KeyPurpose,
): EnvelopeValidationResult {
  if (header.purpose !== expectedPurpose) {
    return {
      valid: false,
      warningCode: 'envelope_purpose_mismatch',
      detail: `Purpose mismatch: expected ${expectedPurpose}, got ${header.purpose}`,
    }
  }
  return { valid: true }
}

/**
 * 校验 key version fingerprint 匹配。
 */
export function checkEnvelopeKeyVersion(
  header: EnvelopeHeader,
  expectedFingerprint: string,
): EnvelopeValidationResult {
  if (header.keyVersionFingerprint !== expectedFingerprint) {
    return {
      valid: false,
      warningCode: 'key_version_not_found',
      detail: 'Key version fingerprint does not match',
    }
  }
  return { valid: true }
}

// ──────────────────────────────────────────────
// 3. AAD 构建与校验
// ──────────────────────────────────────────────

/**
 * 构建认证附加数据（AAD）字符串。
 * AAD 绑定组织 hash、purpose、source reference、key version fingerprint 和 header hash。
 */
export function buildAAD(
  organizationHash: string,
  purpose: KeyPurpose,
  sourceRef: string,
  keyVersionFingerprint: string,
  headerHash: string,
): string {
  return [organizationHash, purpose, sourceRef, keyVersionFingerprint, headerHash].join('::')
}

/**
 * 校验 AAD 是否匹配预期值。
 */
export function validateAAD(
  aad: string,
  organizationHash: string,
  purpose: KeyPurpose,
  sourceRef: string,
  keyVersionFingerprint: string,
  headerHash: string,
): boolean {
  const expected = buildAAD(organizationHash, purpose, sourceRef, keyVersionFingerprint, headerHash)
  return aad === expected
}
