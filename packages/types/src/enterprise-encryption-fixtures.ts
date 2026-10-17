// @aiproj/types — 企业级加密与密钥管理：确定性 Fixtures
// 纯函数，零运行时依赖，前后端共享。
// 所有 fixture 值均为确定性硬编码，不引入随机性。

import type {
  KeyRing,
  KeyVersion,
  KeyPurpose,
  KmsProviderType,
  KeyVersionState,
  KmsEventEntry,
  RotationPreview,
  RewrapJob,
  RewrapJobItem,
  EncryptionUsageSummary,
  KmsProviderHealth,
  KmsStatusResponse,
  KeyRingSummary,
  KeyVersionSummary,
  EnvelopeHeader,
} from './enterprise-encryption-and-key-management.js'

// ──────────────────────────────────────────────
// 1. 基础常量
// ──────────────────────────────────────────────

export const FIXTURE_ORG_ID = 'org-encryption-test-001'
export const FIXTURE_ORG_HASH = 'a1b2c3d4e5f6a7b8'
export const FIXTURE_PROJECT_ID = 'proj-encryption-test-001'
export const FIXTURE_KEY_VERSION_FINGERPRINT = 'f1e2d3c4b5a69788'
export const FIXTURE_SOURCE_HASH = 's0urce-h4sh-0000'
export const FIXTURE_AAD_HASH = 'aad-h4sh-0000'
export const FIXTURE_PREVIEW_SIGNATURE = 'pr3v1ew-s1gn4ture'
export const FIXTURE_REQUEST_ID = 'req-encryption-001'

// ──────────────────────────────────────────────
// 2. Provider 类型 fixtures
// ──────────────────────────────────────────────

export const FIXTURE_PROVIDER_LOCAL: KmsProviderType = 'local'
export const FIXTURE_PROVIDER_MOCK: KmsProviderType = 'mock'

// ──────────────────────────────────────────────
// 3. Key Purpose fixtures
// ──────────────────────────────────────────────

export const FIXTURE_PURPOSE_AI_CONNECTION: KeyPurpose = 'ai_connection_secret'
export const FIXTURE_PURPOSE_INTEGRATION_TOKEN: KeyPurpose = 'integration_token'
export const FIXTURE_PURPOSE_WEB_PUSH: KeyPurpose = 'web_push_subscription'
export const FIXTURE_PURPOSE_FILE_ARTIFACT: KeyPurpose = 'file_artifact'
export const FIXTURE_PURPOSE_REPORT_EXPORT: KeyPurpose = 'report_export_artifact'
export const FIXTURE_PURPOSE_OCR_ARTIFACT: KeyPurpose = 'ocr_artifact'
export const FIXTURE_PURPOSE_DLP_LEDGER: KeyPurpose = 'dlp_ledger'
export const FIXTURE_PURPOSE_WATERMARK_LEDGER: KeyPurpose = 'watermark_ledger'
export const FIXTURE_PURPOSE_GENERIC: KeyPurpose = 'generic_sensitive_blob'

// ──────────────────────────────────────────────
// 4. Key Version State fixtures
// ──────────────────────────────────────────────

export const FIXTURE_STATE_PRIMARY: KeyVersionState = 'primary'
export const FIXTURE_STATE_DECRYPT_ONLY: KeyVersionState = 'decrypt_only'
export const FIXTURE_STATE_RETIRED: KeyVersionState = 'retired'
export const FIXTURE_STATE_COMPROMISED: KeyVersionState = 'compromised'
export const FIXTURE_STATE_DISABLED: KeyVersionState = 'disabled'

// ──────────────────────────────────────────────
// 5. Key Ring fixtures
// ──────────────────────────────────────────────

export function buildKeyRing(overrides?: Partial<KeyRing>): KeyRing {
  return {
    id: 'key-ring-001',
    organizationId: FIXTURE_ORG_ID,
    purpose: FIXTURE_PURPOSE_AI_CONNECTION,
    provider: FIXTURE_PROVIDER_LOCAL,
    activeKeyVersionId: 'key-version-001',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

export function buildKeyVersion(overrides?: Partial<KeyVersion>): KeyVersion {
  return {
    id: 'key-version-001',
    keyRingId: 'key-ring-001',
    state: FIXTURE_STATE_PRIMARY,
    version: 1,
    fingerprint: FIXTURE_KEY_VERSION_FINGERPRINT,
    providerMetadata: {},
    activatedAt: '2026-08-01T00:00:00.000Z',
    retiredAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

export function buildDecryptOnlyKeyVersion(overrides?: Partial<KeyVersion>): KeyVersion {
  return buildKeyVersion({
    id: 'key-version-000',
    state: FIXTURE_STATE_DECRYPT_ONLY,
    version: 0,
    fingerprint: 'd3crypt0nly-f1ng3rpr1nt',
    activatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  })
}

export function buildDisabledKeyVersion(overrides?: Partial<KeyVersion>): KeyVersion {
  return buildKeyVersion({
    id: 'key-version-disabled',
    state: FIXTURE_STATE_DISABLED,
    version: 2,
    fingerprint: 'd1s4bl3d-f1ng3rpr1nt',
    activatedAt: null,
    ...overrides,
  })
}

// ──────────────────────────────────────────────
// 6. Envelope fixtures
// ──────────────────────────────────────────────

export function buildEnvelopeHeader(overrides?: Partial<EnvelopeHeader>): EnvelopeHeader {
  return {
    envVersion: 'v1',
    algorithm: 'AES-256-GCM',
    organizationHash: FIXTURE_ORG_HASH,
    purpose: FIXTURE_PURPOSE_AI_CONNECTION,
    provider: FIXTURE_PROVIDER_LOCAL,
    keyVersionFingerprint: FIXTURE_KEY_VERSION_FINGERPRINT,
    contentType: 'ai_connection_secret',
    sourceHash: FIXTURE_SOURCE_HASH,
    aadHash: FIXTURE_AAD_HASH,
    createdAt: 1722441600000,
    ...overrides,
  }
}

// ──────────────────────────────────────────────
// 7. Provider Health fixtures
// ──────────────────────────────────────────────

export function buildProviderHealth(overrides?: Partial<KmsProviderHealth>): KmsProviderHealth {
  return {
    provider: FIXTURE_PROVIDER_LOCAL,
    available: true,
    status: 'ok',
    detail: 'Local provider is healthy',
    supportedPurposes: [FIXTURE_PURPOSE_AI_CONNECTION, FIXTURE_PURPOSE_INTEGRATION_TOKEN],
    lastChecked: '2026-08-04T00:00:00.000Z',
    ...overrides,
  }
}

export function buildDegradedProviderHealth(
  overrides?: Partial<KmsProviderHealth>,
): KmsProviderHealth {
  return buildProviderHealth({
    available: false,
    status: 'degraded',
    detail: 'Local provider root key not configured, using APP_KEY fallback',
    ...overrides,
  })
}

// ──────────────────────────────────────────────
// 8. Rotation Preview fixtures
// ──────────────────────────────────────────────

export function buildRotationPreview(overrides?: Partial<RotationPreview>): RotationPreview {
  return {
    purpose: FIXTURE_PURPOSE_AI_CONNECTION,
    currentPrimaryVersion: 1,
    newVersion: 2,
    usageCounts: { ai_connection_secret: 5, integration_token: 3 },
    adapterCoverage: 2,
    unsupportedCount: 0,
    degradedCount: 0,
    sourceSnapshotHash: 'sn4psh0t-h4sh-001',
    expiresAt: Date.now() + 300000,
    signature: FIXTURE_PREVIEW_SIGNATURE,
    ...overrides,
  }
}

// ──────────────────────────────────────────────
// 9. Rewrap fixtures
// ──────────────────────────────────────────────

export function buildRewrapJob(overrides?: Partial<RewrapJob>): RewrapJob {
  return {
    id: 'rewrap-job-001',
    organizationId: FIXTURE_ORG_ID,
    purpose: FIXTURE_PURPOSE_AI_CONNECTION,
    fromKeyVersionFingerprint: 'd3crypt0nly-f1ng3rpr1nt',
    toKeyVersionFingerprint: FIXTURE_KEY_VERSION_FINGERPRINT,
    status: 'in_progress',
    totalItems: 10,
    completedItems: 4,
    skippedItems: 1,
    failedItems: 0,
    idempotencyKey: 'idempotency-rewrap-001',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:05:00.000Z',
    ...overrides,
  }
}

export function buildRewrapJobItem(overrides?: Partial<RewrapJobItem>): RewrapJobItem {
  return {
    id: 'rewrap-item-001',
    rewrapJobId: 'rewrap-job-001',
    adapterKey: 'ai_connection_secret',
    sourceHash: FIXTURE_SOURCE_HASH,
    status: 'pending',
    createdAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  }
}

// ──────────────────────────────────────────────
// 10. KMS Event fixtures
// ──────────────────────────────────────────────

export function buildKmsEventEntry(overrides?: Partial<KmsEventEntry>): KmsEventEntry {
  return {
    id: 'kms-event-001',
    organizationId: FIXTURE_ORG_ID,
    projectId: FIXTURE_PROJECT_ID,
    eventType: 'key_version_activated',
    keyVersionFingerprint: FIXTURE_KEY_VERSION_FINGERPRINT,
    purpose: FIXTURE_PURPOSE_AI_CONNECTION,
    requestId: FIXTURE_REQUEST_ID,
    metadata: { action: 'activate', source: 'admin' },
    fingerprint: '3v3nt-f1ng3rpr1nt',
    createdAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  }
}

export function buildKmsRotationPreviewedEvent(overrides?: Partial<KmsEventEntry>): KmsEventEntry {
  return buildKmsEventEntry({
    eventType: 'rotation_previewed',
    metadata: { currentVersion: 1, newVersion: 2, affectedRecords: 8 },
    ...overrides,
  })
}

// ──────────────────────────────────────────────
// 11. Usage Summary fixtures
// ──────────────────────────────────────────────

export function buildEncryptionUsageSummary(
  overrides?: Partial<EncryptionUsageSummary>,
): EncryptionUsageSummary {
  return {
    adapterKey: 'ai_connection_secret',
    purpose: FIXTURE_PURPOSE_AI_CONNECTION,
    totalRecords: 10,
    encryptedRecords: 8,
    legacyRecords: 2,
    status: 'healthy',
    ...overrides,
  }
}

export function buildDegradedUsageSummary(
  overrides?: Partial<EncryptionUsageSummary>,
): EncryptionUsageSummary {
  return buildEncryptionUsageSummary({
    status: 'degraded',
    statusDetail: 'KMS feature disabled, using legacy cipher',
    encryptedRecords: 0,
    legacyRecords: 10,
    ...overrides,
  })
}

// ──────────────────────────────────────────────
// 12. API Response fixtures
// ──────────────────────────────────────────────

export function buildKmsStatusResponse(overrides?: Partial<KmsStatusResponse>): KmsStatusResponse {
  return {
    enabled: true,
    provider: FIXTURE_PROVIDER_LOCAL,
    health: buildProviderHealth(),
    purposes: [FIXTURE_PURPOSE_AI_CONNECTION, FIXTURE_PURPOSE_INTEGRATION_TOKEN],
    ...overrides,
  }
}

export function buildKeyRingSummary(overrides?: Partial<KeyRingSummary>): KeyRingSummary {
  return {
    id: 'key-ring-001',
    purpose: FIXTURE_PURPOSE_AI_CONNECTION,
    provider: FIXTURE_PROVIDER_LOCAL,
    activeVersion: 1,
    activeFingerprint: FIXTURE_KEY_VERSION_FINGERPRINT,
    totalVersions: 2,
    ...overrides,
  }
}

export function buildKeyVersionSummary(overrides?: Partial<KeyVersionSummary>): KeyVersionSummary {
  return {
    version: 1,
    state: FIXTURE_STATE_PRIMARY,
    fingerprint: FIXTURE_KEY_VERSION_FINGERPRINT,
    activatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

// ──────────────────────────────────────────────
// 13. 多 fixture 生成
// ──────────────────────────────────────────────

export function buildKeyRingList(): KeyRingSummary[] {
  return [
    buildKeyRingSummary({ purpose: 'ai_connection_secret', activeVersion: 1, totalVersions: 2 }),
    buildKeyRingSummary({
      id: 'key-ring-002',
      purpose: 'integration_token',
      activeVersion: 1,
      totalVersions: 1,
    }),
    buildKeyRingSummary({
      id: 'key-ring-003',
      purpose: 'web_push_subscription',
      activeVersion: null,
      activeFingerprint: null,
      totalVersions: 0,
    }),
  ]
}

export function buildKeyVersionList(): KeyVersionSummary[] {
  return [
    buildKeyVersionSummary({
      version: 1,
      state: 'primary',
      fingerprint: FIXTURE_KEY_VERSION_FINGERPRINT,
    }),
    buildKeyVersionSummary({
      version: 0,
      state: 'decrypt_only',
      fingerprint: 'd3crypt0nly-f1ng3rpr1nt',
      activatedAt: '2026-07-01T00:00:00.000Z',
    }),
  ]
}

export function buildKmsEventList(): KmsEventEntry[] {
  return [
    buildKmsEventEntry({
      id: 'event-001',
      eventType: 'key_version_activated',
      fingerprint: 'event-fp-001',
    }),
    buildKmsRotationPreviewedEvent({ id: 'event-002', fingerprint: 'event-fp-002' }),
    buildKmsEventEntry({
      id: 'event-003',
      eventType: 'rotation_confirmed',
      fingerprint: 'event-fp-003',
    }),
  ]
}

export function buildEmptyEventList(): KmsEventEntry[] {
  return []
}
