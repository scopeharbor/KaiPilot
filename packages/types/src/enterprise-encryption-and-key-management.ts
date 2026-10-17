// @aiproj/types — 企业级加密与密钥管理（KMS）共享契约
// 前后端共享：后端 Service/Controller/Policy、前端工作台、测试、DLP/水印 adapter
// 均消费同一套枚举与纯函数，避免语义漂移。

// ──────────────────────────────────────────────
// 1. Key Purpose（密钥用途——组织内唯一主键维度之一）
// ──────────────────────────────────────────────

export const KEY_PURPOSES = [
  'ai_connection_secret',
  'integration_token',
  'web_push_subscription',
  'file_artifact',
  'report_export_artifact',
  'ocr_artifact',
  'dlp_ledger',
  'watermark_ledger',
  'generic_sensitive_blob',
] as const

export type KeyPurpose = (typeof KEY_PURPOSES)[number]

export function isKeyPurpose(v: unknown): v is KeyPurpose {
  return KEY_PURPOSES.includes(v as KeyPurpose)
}

// ──────────────────────────────────────────────
// 2. Provider Type（KMS Provider 类型）
// ──────────────────────────────────────────────

export const KMS_PROVIDERS = ['local', 'mock'] as const

export type KmsProviderType = (typeof KMS_PROVIDERS)[number]

export function isKmsProviderType(v: unknown): v is KmsProviderType {
  return KMS_PROVIDERS.includes(v as KmsProviderType)
}

// ──────────────────────────────────────────────
// 3. Key Version Lifecycle State
// ──────────────────────────────────────────────

export const KEY_VERSION_STATES = [
  'primary',
  'decrypt_only',
  'retired',
  'compromised',
  'disabled',
] as const

export type KeyVersionState = (typeof KEY_VERSION_STATES)[number]

export function isKeyVersionState(v: unknown): v is KeyVersionState {
  return KEY_VERSION_STATES.includes(v as KeyVersionState)
}

// ──────────────────────────────────────────────
// 4. Envelope Constants & Types
// ──────────────────────────────────────────────

export const ENVELOPE_PREFIX = 'ekm'
export const ENVELOPE_VERSION = 'v1'
export const ENVELOPE_ALGORITHM = 'AES-256-GCM'

/** 信封加密格式：ekm.v1.<header>.<wrappedDek>.<iv>.<tag>.<ciphertext>（均 base64url） */
export const ENVELOPE_PARTS_EXPECTED = 6

export type EnvelopeHeader = {
  /** envelope 版本号 */
  envVersion: typeof ENVELOPE_VERSION
  /** 加密算法 */
  algorithm: typeof ENVELOPE_ALGORITHM
  /** 组织 ID 的确定性 hash（非原始 ID） */
  organizationHash: string
  /** 密钥用途 */
  purpose: KeyPurpose
  /** KMS provider 类型 */
  provider: KmsProviderType
  /** key version 指纹 */
  keyVersionFingerprint: string
  /** 可选的 payload 内容类型描述 */
  contentType?: string
  /** 可选的源引用 hash（如 AI connection ID hash） */
  sourceHash?: string
  /** AAD（认证附加数据）的 hash */
  aadHash: string
  /** 创建时间戳（ms，低敏感） */
  createdAt: number
  /** 可选的过期时间戳（ms） */
  expiresAt?: number
}

// ──────────────────────────────────────────────
// 5. Key Ring / Key Version 域类型
// ──────────────────────────────────────────────

export type KeyRing = {
  id: string
  organizationId: string
  purpose: KeyPurpose
  provider: KmsProviderType
  activeKeyVersionId: string | null
  createdAt: string
  updatedAt: string
}

export type KeyVersion = {
  // 曾误写为 `íd`（带锐音符的 í）。字段名不匹配让每个 KmsProvider 实现都无法
  // 满足接口，TS 报的是「缺少属性 íd」——肉眼几乎看不出与 id 的区别。
  id: string
  keyRingId: string
  state: KeyVersionState
  /** 版本号（递增整数，用于排序与引用） */
  version: number
  /** 密钥指纹（低敏感，用于 UI 展示与验证匹配） */
  fingerprint: string
  /** provider 侧元数据（低敏感 JSON，不含 root key 原文） */
  providerMetadata: Record<string, unknown>
  activatedAt: string | null
  retiredAt: string | null
  createdAt: string
  updatedAt: string
}

// ──────────────────────────────────────────────
// 6. 低敏感 KMS Event Ledger 类型
// ──────────────────────────────────────────────

export type KmsEventType =
  | 'key_version_activated'
  | 'key_version_disabled'
  | 'key_version_compromised'
  | 'rotation_previewed'
  | 'rotation_confirmed'
  | 'rewrap_previewed'
  | 'rewrap_started'
  | 'rewrap_progress'
  | 'rewrap_completed'
  | 'rewrap_failed'
  | 'provider_health_changed'
  | 'adapter_degraded'
  | 'adapter_recovered'

export const KMS_EVENT_TYPES: KmsEventType[] = [
  'key_version_activated',
  'key_version_disabled',
  'key_version_compromised',
  'rotation_previewed',
  'rotation_confirmed',
  'rewrap_previewed',
  'rewrap_started',
  'rewrap_progress',
  'rewrap_completed',
  'rewrap_failed',
  'provider_health_changed',
  'adapter_degraded',
  'adapter_recovered',
]

export type KmsEventEntry = {
  id: string
  organizationId: string
  projectId?: string
  eventType: KmsEventType
  /** 关联 key version 指纹（非原始 ID） */
  keyVersionFingerprint?: string
  /** 关联 key purpose */
  purpose?: KeyPurpose
  /** 请求 trace ID */
  requestId?: string
  /** 低敏感 payload JSON（不含密钥/密文/原文） */
  metadata: Record<string, unknown>
  /** 事件指纹 hash */
  fingerprint: string
  /** 警告码（可选） */
  warningCode?: string
  createdAt: string
}

// ──────────────────────────────────────────────
// 7. Rotation / Rewrap 类型
// ──────────────────────────────────────────────

export type RotationPreview = {
  purpose: KeyPurpose
  currentPrimaryVersion: number
  newVersion: number
  /** 受影响的加密记录计数 */
  usageCounts: Record<string, number>
  /** 已覆盖的 adapter 数 */
  adapterCoverage: number
  /** 不支持的 adapter 数 */
  unsupportedCount: number
  /** degraded adapter 数 */
  degradedCount: number
  /** 源快照 hash（防止确认时状态已变） */
  sourceSnapshotHash: string
  /** 预览过期时间 */
  expiresAt: number
  /** 预览签名 */
  signature: string
}

export type RewrapJobStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'

export const REWRAP_JOB_STATUSES: RewrapJobStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
]

export type RewrapJob = {
  id: string
  organizationId: string
  purpose: KeyPurpose
  fromKeyVersionFingerprint: string
  toKeyVersionFingerprint: string
  status: RewrapJobStatus
  totalItems: number
  completedItems: number
  skippedItems: number
  failedItems: number
  idempotencyKey: string
  createdAt: string
  updatedAt: string
}

export type RewrapJobItem = {
  id: string
  rewrapJobId: string
  adapterKey: string
  sourceHash: string
  status: 'pending' | 'completed' | 'skipped' | 'failed'
  failureReason?: string
  createdAt: string
}

// ──────────────────────────────────────────────
// 8. Encryption Usage Adapter 类型
// ──────────────────────────────────────────────

export type EncryptionUsageSummary = {
  adapterKey: string
  purpose: KeyPurpose
  totalRecords: number
  encryptedRecords: number
  legacyRecords: number
  /** 适配器健康状态 */
  status: 'healthy' | 'degraded' | 'unsupported'
  /** 适配器状态描述 */
  statusDetail?: string
}

// ──────────────────────────────────────────────
// 9. Provider Health 类型
// ──────────────────────────────────────────────

export type KmsProviderHealth = {
  provider: KmsProviderType
  available: boolean
  /** 健康状态：ok / degraded / unavailable */
  status: 'ok' | 'degraded' | 'unavailable'
  /** 状态描述 */
  detail: string
  /** 支持的 key purposes 列表 */
  supportedPurposes: KeyPurpose[]
  /** 最后一次健康检查时间 */
  lastChecked: string
}

// ──────────────────────────────────────────────
// 10. Warning Codes
// ──────────────────────────────────────────────

export const KMS_WARNING_CODES = [
  'app_key_fallback',
  'missing_root_key',
  'feature_disabled',
  'unsupported_provider',
  'provider_unavailable',
  'key_version_not_found',
  'key_version_disabled',
  'key_version_compromised',
  'envelope_format_invalid',
  'envelope_version_unknown',
  'envelope_algorithm_mismatch',
  'envelope_organization_mismatch',
  'envelope_purpose_mismatch',
  'envelope_tampered',
  'rotation_preview_stale',
  'rewrap_item_skipped',
  'rewrap_item_failed',
  'adapter_degraded',
  'adapter_unsupported',
  'cross_organization_denied',
] as const

export type KmsWarningCode = (typeof KMS_WARNING_CODES)[number]

export function isKmsWarningCode(v: unknown): v is KmsWarningCode {
  return KMS_WARNING_CODES.includes(v as KmsWarningCode)
}

// ──────────────────────────────────────────────
// 11. 低敏感 KMS API Response 类型
// ──────────────────────────────────────────────

export type KmsStatusResponse = {
  enabled: boolean
  provider: KmsProviderType | null
  health: KmsProviderHealth | null
  purposes: KeyPurpose[]
}

export type KeyRingSummary = {
  id: string
  purpose: KeyPurpose
  provider: KmsProviderType
  activeVersion: number | null
  activeFingerprint: string | null
  totalVersions: number
}

export type KeyVersionSummary = {
  version: number
  state: KeyVersionState
  fingerprint: string
  activatedAt: string | null
}

// ──────────────────────────────────────────────
// 12. DTO 类型
// ──────────────────────────────────────────────

export type CreateKeyVersionRequest = {
  purpose: KeyPurpose
  provider: KmsProviderType
}

export type ActivateKeyVersionRequest = {
  purpose: KeyPurpose
  version: number
  fingerprint: string
}

export type DisableKeyVersionRequest = {
  purpose: KeyPurpose
  version: number
  fingerprint: string
}

export type RotationPreviewRequest = {
  purpose: KeyPurpose
}

export type RotationConfirmRequest = {
  purpose: KeyPurpose
  previewSignature: string
}

export type RewrapPreviewRequest = {
  purpose: KeyPurpose
}

export type RewrapExecuteRequest = {
  purpose: KeyPurpose
  previewSignature: string
}

export type KmsEventFilter = {
  purpose?: KeyPurpose
  eventType?: KmsEventType
  page?: number
  perPage?: number
}

// ──────────────────────────────────────────────
// 13. Forbidden Keys（与 DLP/audit 对齐的脱敏常量）
// ──────────────────────────────────────────────

/** 禁止出现在 KMS ledger/audit/API 响应中的字段名 */
export const KMS_FORBIDDEN_KEYS = [
  'plaintext',
  'rootKey',
  'root_key',
  'wrappedDek',
  'wrapped_dek',
  'ciphertext',
  'apiKey',
  'api_key',
  'secret',
  'password',
  'authorization',
  'Authorization',
  'token',
  'privateKey',
  'private_key',
  'modelOutput',
  'model_output',
  'prompt',
  'ocrText',
  'ocr_text',
  'reportBody',
  'report_body',
  'fileContent',
  'file_content',
  'absolutePath',
  'absolute_path',
] as const

export type KmsForbiddenKey = (typeof KMS_FORBIDDEN_KEYS)[number]

export function isKmsForbiddenKey(v: unknown): v is KmsForbiddenKey {
  return KMS_FORBIDDEN_KEYS.includes(v as KmsForbiddenKey)
}
