// @aiproj/types — 企业级加密与密钥管理：共享契约测试
// 验证枚举、类型守卫、纯函数、脱敏和 fixtures 的确定性行为。

import { describe, it, expect } from 'vitest'
import {
  // 枚举与类型守卫
  KEY_PURPOSES,
  KMS_PROVIDERS,
  KEY_VERSION_STATES,
  KMS_EVENT_TYPES,
  KMS_WARNING_CODES,
  KMS_FORBIDDEN_KEYS,
  isKeyPurpose,
  isKmsProviderType,
  isKeyVersionState,
  isKmsWarningCode,
  isKmsForbiddenKey,
  ENVELOPE_PARTS_EXPECTED,
  ENVELOPE_PREFIX,
  ENVELOPE_VERSION,
  ENVELOPE_ALGORITHM,
  type KeyPurpose,
  type KmsProviderType,
  type KeyVersionState,
} from './enterprise-encryption-and-key-management.js'

import {
  fnv1aHash,
  kmsComputeStableSignature,
  computeKeyVersionFingerprint,
  computeOrganizationScopeHash,
  computeSourceHash,
  stableKeyOrder,
  isKnownEnvelopeVersion,
  isSupportedAlgorithm,
  ALL_KNOWN_ENVELOPE_PREFIXES,
  ENVELOPE_PREFIX_V1,
} from './enterprise-encryption-helpers.js'

import {
  parseEnvelopeHeader,
  parseEnvelope,
  isKmsEnvelope,
  validateEnvelopeHeader,
  checkEnvelopeOrganization,
  checkEnvelopePurpose,
  checkEnvelopeKeyVersion,
  buildAAD,
  validateAAD,
  serializeEnvelopeHeader,
} from './enterprise-encryption-envelope.js'

import {
  detectKmsForbiddenKeys,
  detectKmsForbiddenKeysDeep,
  redactKmsForbiddenKeys,
  redactKmsForbiddenKeysDeep,
  maskSecretValue,
  hasKmsForbiddenKeys,
  buildSafeMetadata,
} from './enterprise-encryption-redaction.js'

import {
  buildKeyRing,
  buildKeyVersion,
  buildDecryptOnlyKeyVersion,
  buildDisabledKeyVersion,
  buildEnvelopeHeader,
  buildProviderHealth,
  buildDegradedProviderHealth,
  buildRotationPreview,
  buildRewrapJob,
  buildRewrapJobItem,
  buildKmsEventEntry,
  buildKmsRotationPreviewedEvent,
  buildEncryptionUsageSummary,
  buildDegradedUsageSummary,
  buildKmsStatusResponse,
  buildKeyRingSummary,
  buildKeyVersionSummary,
  buildKeyRingList,
  buildKeyVersionList,
  buildKmsEventList,
  buildEmptyEventList,
  FIXTURE_ORG_ID,
  FIXTURE_ORG_HASH,
  FIXTURE_KEY_VERSION_FINGERPRINT,
  FIXTURE_PREVIEW_SIGNATURE,
  FIXTURE_PURPOSE_AI_CONNECTION,
  FIXTURE_PURPOSE_INTEGRATION_TOKEN,
  FIXTURE_PROVIDER_LOCAL,
  FIXTURE_PROVIDER_MOCK,
  FIXTURE_STATE_PRIMARY,
  FIXTURE_STATE_DECRYPT_ONLY,
  FIXTURE_STATE_DISABLED,
} from './enterprise-encryption-fixtures.js'

// ──────────────────────────────────────────────
// 1. Stable Hash 测试
// ──────────────────────────────────────────────

describe('enterprise-encryption: stable hash helpers', () => {
  it('fnv1aHash 对同一输入返回同一值', () => {
    const input = 'hello-world'
    const h1 = fnv1aHash(input)
    const h2 = fnv1aHash(input)
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(16) // sha256 前 16 字符
  })

  it('fnv1aHash 对不同输入返回不同值', () => {
    const h1 = fnv1aHash('input-a')
    const h2 = fnv1aHash('input-b')
    expect(h1).not.toBe(h2)
  })

  it('kmsComputeStableSignature 稳定且带前缀', () => {
    const sig1 = kmsComputeStableSignature('test-input')
    const sig2 = kmsComputeStableSignature('test-input')
    expect(sig1).toBe(sig2)
    expect(sig1).toHaveLength(16)
  })

  it('computeKeyVersionFingerprint 稳定', () => {
    const fp1 = computeKeyVersionFingerprint(
      'org-1',
      'ai_connection_secret',
      'local',
      1,
      'root-prefix',
    )
    const fp2 = computeKeyVersionFingerprint(
      'org-1',
      'ai_connection_secret',
      'local',
      1,
      'root-prefix',
    )
    expect(fp1).toBe(fp2)
    expect(fp1).toHaveLength(16)
  })

  it('computeOrganizationScopeHash 稳定', () => {
    const h1 = computeOrganizationScopeHash('org-1')
    const h2 = computeOrganizationScopeHash('org-1')
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(16)
  })

  it('computeSourceHash 稳定', () => {
    const h1 = computeSourceHash('ai_connection_secret', 'record-1', 'current-hash')
    const h2 = computeSourceHash('ai_connection_secret', 'record-1', 'current-hash')
    expect(h1).toBe(h2)
  })

  it('stableKeyOrder 对同一内容返回相同 JSON', () => {
    const a = stableKeyOrder({ b: 2, a: 1, c: { z: 3, y: 4 } })
    const b = stableKeyOrder({ c: { y: 4, z: 3 }, a: 1, b: 2 })
    expect(a).toBe(b)
  })
})

// ──────────────────────────────────────────────
// 2. 枚举合法性守卫测试
// ──────────────────────────────────────────────

describe('enterprise-encryption: enum guards', () => {
  it('isKeyPurpose 接受合法值', () => {
    expect(isKeyPurpose('ai_connection_secret')).toBe(true)
    expect(isKeyPurpose('integration_token')).toBe(true)
    expect(isKeyPurpose('web_push_subscription')).toBe(true)
    expect(isKeyPurpose('generic_sensitive_blob')).toBe(true)
  })

  it('isKeyPurpose 拒绝非法值', () => {
    expect(isKeyPurpose('unknown_purpose')).toBe(false)
    expect(isKeyPurpose('')).toBe(false)
    expect(isKeyPurpose(123)).toBe(false)
    expect(isKeyPurpose(null)).toBe(false)
  })

  it('isKmsProviderType 接受合法值', () => {
    expect(isKmsProviderType('local')).toBe(true)
    expect(isKmsProviderType('mock')).toBe(true)
  })

  it('isKmsProviderType 拒绝非法值', () => {
    expect(isKmsProviderType('aws')).toBe(false)
    expect(isKmsProviderType(undefined)).toBe(false)
  })

  it('isKeyVersionState 接受合法值', () => {
    expect(isKeyVersionState('primary')).toBe(true)
    expect(isKeyVersionState('decrypt_only')).toBe(true)
    expect(isKeyVersionState('retired')).toBe(true)
    expect(isKeyVersionState('compromised')).toBe(true)
    expect(isKeyVersionState('disabled')).toBe(true)
  })

  it('isKeyVersionState 拒绝非法值', () => {
    expect(isKeyVersionState('deleted')).toBe(false)
    expect(isKeyVersionState('active')).toBe(false)
  })

  it('isKmsWarningCode 接受合法值', () => {
    expect(isKmsWarningCode('app_key_fallback')).toBe(true)
    expect(isKmsWarningCode('envelope_tampered')).toBe(true)
  })

  it('isKmsWarningCode 拒绝非法值', () => {
    expect(isKmsWarningCode('unknown_code')).toBe(false)
  })

  it('isKmsForbiddenKey 检测禁止字段', () => {
    expect(isKmsForbiddenKey('plaintext')).toBe(true)
    expect(isKmsForbiddenKey('rootKey')).toBe(true)
    expect(isKmsForbiddenKey('apiKey')).toBe(true)
    expect(isKmsForbiddenKey('secret')).toBe(true)
    expect(isKmsForbiddenKey('allowed_field')).toBe(false)
  })

  it('isKnownEnvelopeVersion 版本检测', () => {
    expect(isKnownEnvelopeVersion('v1')).toBe(true)
    expect(isKnownEnvelopeVersion('v2')).toBe(false)
    expect(isKnownEnvelopeVersion('')).toBe(false)
  })

  it('isSupportedAlgorithm 算法检测', () => {
    expect(isSupportedAlgorithm('AES-256-GCM')).toBe(true)
    expect(isSupportedAlgorithm('AES-256-CBC')).toBe(false)
  })
})

// ──────────────────────────────────────────────
// 3. Envelope 解析/校验测试
// ──────────────────────────────────────────────

describe('enterprise-encryption: envelope parser/validator', () => {
  it('parseEnvelopeHeader 解析合法 header', () => {
    const header = buildEnvelopeHeader()
    const serialized = serializeEnvelopeHeader(header)
    const parsed = parseEnvelopeHeader(Buffer.from(serialized).toString('base64url'))
    expect(parsed).not.toBeNull()
    expect(parsed!.purpose).toBe('ai_connection_secret')
    expect(parsed!.organizationHash).toBe(FIXTURE_ORG_HASH)
  })

  it('parseEnvelopeHeader 返回 null 对非法 base64', () => {
    const result = parseEnvelopeHeader('not-valid-base64!!!')
    expect(result).toBeNull()
  })

  it('isKmsEnvelope 检测信封格式', () => {
    expect(isKmsEnvelope('ekm.v1.abc.def.ghi.jkl.mno')).toBe(true)
    expect(isKmsEnvelope('v1.abc.def')).toBe(false)
    expect(isKmsEnvelope('')).toBe(false)
  })

  it('validateEnvelopeHeader 校验合法 header', () => {
    const header = buildEnvelopeHeader()
    const result = validateEnvelopeHeader(header)
    expect(result.valid).toBe(true)
  })

  it('validateEnvelopeHeader 拒绝非法对象', () => {
    expect(validateEnvelopeHeader(null).valid).toBe(false)
    expect(validateEnvelopeHeader('string').valid).toBe(false)
    expect(validateEnvelopeHeader({}).valid).toBe(false)
  })

  it('validateEnvelopeHeader 拒绝未知版本', () => {
    const result = validateEnvelopeHeader({
      envVersion: 'v2',
      algorithm: 'AES-256-GCM',
      purpose: 'ai_connection_secret',
      provider: 'local',
      organizationHash: 'hash',
      keyVersionFingerprint: 'fp',
      aadHash: 'aad',
    })
    expect(result.valid).toBe(false)
    expect(result.warningCode).toBe('envelope_version_unknown')
  })

  it('checkEnvelopeOrganization 校验组织匹配', () => {
    const header = buildEnvelopeHeader()
    const ok = checkEnvelopeOrganization(header, FIXTURE_ORG_HASH)
    expect(ok.valid).toBe(true)
    const fail = checkEnvelopeOrganization(header, 'wrong-hash')
    expect(fail.valid).toBe(false)
    expect(fail.warningCode).toBe('envelope_organization_mismatch')
  })

  it('checkEnvelopePurpose 校验用途匹配', () => {
    const header = buildEnvelopeHeader()
    const ok = checkEnvelopePurpose(header, 'ai_connection_secret')
    expect(ok.valid).toBe(true)
    const fail = checkEnvelopePurpose(header, 'integration_token')
    expect(fail.valid).toBe(false)
    expect(fail.warningCode).toBe('envelope_purpose_mismatch')
  })

  it('checkEnvelopeKeyVersion 校验 key version 匹配', () => {
    const header = buildEnvelopeHeader()
    const ok = checkEnvelopeKeyVersion(header, FIXTURE_KEY_VERSION_FINGERPRINT)
    expect(ok.valid).toBe(true)
    const fail = checkEnvelopeKeyVersion(header, 'wrong-fp')
    expect(fail.valid).toBe(false)
    expect(fail.warningCode).toBe('key_version_not_found')
  })

  it('buildAAD 构建稳定 AAD', () => {
    const aad = buildAAD(
      FIXTURE_ORG_HASH,
      'ai_connection_secret',
      'source-ref',
      FIXTURE_KEY_VERSION_FINGERPRINT,
      'header-hash',
    )
    expect(aad).toContain(FIXTURE_ORG_HASH)
    expect(aad).toContain('ai_connection_secret')
    expect(aad).toContain(FIXTURE_KEY_VERSION_FINGERPRINT)
  })

  it('validateAAD 校验匹配', () => {
    const aad = buildAAD(
      FIXTURE_ORG_HASH,
      'ai_connection_secret',
      'source-ref',
      FIXTURE_KEY_VERSION_FINGERPRINT,
      'header-hash',
    )
    expect(
      validateAAD(
        aad,
        FIXTURE_ORG_HASH,
        'ai_connection_secret',
        'source-ref',
        FIXTURE_KEY_VERSION_FINGERPRINT,
        'header-hash',
      ),
    ).toBe(true)
    expect(
      validateAAD(
        aad,
        'wrong-org',
        'ai_connection_secret',
        'source-ref',
        FIXTURE_KEY_VERSION_FINGERPRINT,
        'header-hash',
      ),
    ).toBe(false)
  })
})

// ──────────────────────────────────────────────
// 4. 脱敏 Redaction 测试
// ──────────────────────────────────────────────

describe('enterprise-encryption: redaction helpers', () => {
  it('detectKmsForbiddenKeys 检测禁止字段', () => {
    const obj = { plaintext: 'secret', allowedField: 'ok', apiKey: 'key' }
    const found = detectKmsForbiddenKeys(obj)
    expect(found).toContain('plaintext')
    expect(found).toContain('apiKey')
    expect(found).not.toContain('allowedField')
  })

  it('detectKmsForbiddenKeys 对空对象返回空数组', () => {
    expect(detectKmsForbiddenKeys({})).toEqual([])
  })

  it('redactKmsForbiddenKeys 删除禁止字段', () => {
    const obj = { plaintext: 'secret', allowedField: 'ok', secret: 'sensitive' }
    const redacted = redactKmsForbiddenKeys(obj)
    expect(redacted).not.toHaveProperty('plaintext')
    expect(redacted).not.toHaveProperty('secret')
    expect(redacted).toHaveProperty('allowedField', 'ok')
  })

  it('redactKmsForbiddenKeys 不修改原始对象', () => {
    const obj = { plaintext: 'secret', allowedField: 'ok' }
    const redacted = redactKmsForbiddenKeys(obj)
    expect(obj).toHaveProperty('plaintext')
    expect(redacted).not.toHaveProperty('plaintext')
  })

  it('redactKmsForbiddenKeysDeep 递归删除禁止字段', () => {
    const obj = { nested: { plaintext: 'secret', inner: { apiKey: 'key', ok: 'fine' } } }
    const redacted = redactKmsForbiddenKeysDeep(obj)
    expect(redacted).not.toHaveProperty('nested.plaintext')
    expect((redacted as any).nested).not.toHaveProperty('plaintext')
    expect((redacted as any).nested.inner).not.toHaveProperty('apiKey')
    expect((redacted as any).nested.inner).toHaveProperty('ok', 'fine')
  })

  it('maskSecretValue 掩盖敏感值', () => {
    expect(maskSecretValue('sk-secret-key-abc')).toBe('sk...bc')
    expect(maskSecretValue('ab')).toBe('****')
    expect(maskSecretValue('')).toBe('****')
    expect(maskSecretValue('abcde')).toBe('ab...de')
  })

  it('hasKmsForbiddenKeys 检测包含', () => {
    expect(hasKmsForbiddenKeys({ plaintext: 'x' })).toBe(true)
    expect(hasKmsForbiddenKeys({ ok: 'fine' })).toBe(false)
  })

  it('buildSafeMetadata 只保留允许的字段', () => {
    const source = { name: 'test', plaintext: 'secret', count: 5, apiKey: 'key' }
    const safe = buildSafeMetadata(source, ['name', 'count'])
    expect(safe).toHaveProperty('name', 'test')
    expect(safe).toHaveProperty('count', 5)
    expect(safe).not.toHaveProperty('plaintext')
    expect(safe).not.toHaveProperty('apiKey')
  })
})

// ──────────────────────────────────────────────
// 5. Fixture 确定性测试
// ──────────────────────────────────────────────

describe('enterprise-encryption: fixture determinism', () => {
  it('buildKeyRing 每次调用返回相同结构', () => {
    const a = buildKeyRing()
    const b = buildKeyRing()
    expect(a).toEqual(b)
  })

  it('buildKeyVersion 返回正确状态', () => {
    const kv = buildKeyVersion()
    expect(kv.state).toBe('primary')
    expect(kv.version).toBe(1)
    expect(kv.activatedAt).not.toBeNull()
  })

  it('buildDecryptOnlyKeyVersion 返回 decrypt_only 状态', () => {
    const kv = buildDecryptOnlyKeyVersion()
    expect(kv.state).toBe('decrypt_only')
    expect(kv.version).toBe(0)
  })

  it('buildDisabledKeyVersion 返回 disabled 状态', () => {
    const kv = buildDisabledKeyVersion()
    expect(kv.state).toBe('disabled')
    expect(kv.activatedAt).toBeNull()
  })

  it('buildEnvelopeHeader 返回合法 header', () => {
    const header = buildEnvelopeHeader()
    expect(header.envVersion).toBe('v1')
    expect(header.algorithm).toBe('AES-256-GCM')
    expect(header.organizationHash).toBe(FIXTURE_ORG_HASH)
    expect(header.purpose).toBe('ai_connection_secret')
  })

  it('buildProviderHealth 返回健康状态', () => {
    const h = buildProviderHealth()
    expect(h.status).toBe('ok')
    expect(h.available).toBe(true)
  })

  it('buildDegradedProviderHealth 返回 degraded 状态', () => {
    const h = buildDegradedProviderHealth()
    expect(h.status).toBe('degraded')
    expect(h.available).toBe(false)
  })

  it('buildRotationPreview 返回合法预览', () => {
    const p = buildRotationPreview()
    expect(p.currentPrimaryVersion).toBe(1)
    expect(p.newVersion).toBe(2)
    expect(p.signature).toBe(FIXTURE_PREVIEW_SIGNATURE)
  })

  it('buildRewrapJob 返回合法 job', () => {
    const j = buildRewrapJob()
    expect(j.purpose).toBe('ai_connection_secret')
    expect(j.status).toBe('in_progress')
    expect(j.idempotencyKey).toBeTruthy()
  })

  it('buildRewrapJobItem 返回合法 item', () => {
    const item = buildRewrapJobItem()
    expect(item.status).toBe('pending')
    expect(item.rewrapJobId).toBe('rewrap-job-001')
  })

  it('buildKmsEventEntry 返回合法事件', () => {
    const e = buildKmsEventEntry()
    expect(e.eventType).toBe('key_version_activated')
    expect(e.purpose).toBe('ai_connection_secret')
  })

  it('buildKmsRotationPreviewedEvent 返回预览事件', () => {
    const e = buildKmsRotationPreviewedEvent()
    expect(e.eventType).toBe('rotation_previewed')
  })

  it('buildEncryptionUsageSummary 返回健康状态', () => {
    const s = buildEncryptionUsageSummary()
    expect(s.status).toBe('healthy')
    expect(s.purpose).toBe('ai_connection_secret')
  })

  it('buildDegradedUsageSummary 返回 degraded 状态', () => {
    const s = buildDegradedUsageSummary()
    expect(s.status).toBe('degraded')
    expect(s.encryptedRecords).toBe(0)
    expect(s.legacyRecords).toBe(10)
  })

  it('buildKmsStatusResponse 返回合法响应', () => {
    const r = buildKmsStatusResponse()
    expect(r.enabled).toBe(true)
    expect(r.provider).toBe('local')
    expect(r.health).not.toBeNull()
  })

  it('buildKeyRingSummary 返回合法摘要', () => {
    const s = buildKeyRingSummary()
    expect(s.purpose).toBe('ai_connection_secret')
    expect(s.activeVersion).toBe(1)
  })

  it('buildKeyVersionSummary 返回合法版本摘要', () => {
    const s = buildKeyVersionSummary()
    expect(s.version).toBe(1)
    expect(s.state).toBe('primary')
  })

  it('buildKeyRingList 返回多 ring 列表', () => {
    const list = buildKeyRingList()
    expect(list).toHaveLength(3)
    expect(list[0].purpose).toBe('ai_connection_secret')
    expect(list[2].activeVersion).toBeNull()
  })

  it('buildKeyVersionList 返回多版本列表', () => {
    const list = buildKeyVersionList()
    expect(list).toHaveLength(2)
    expect(list[1].state).toBe('decrypt_only')
  })

  it('buildKmsEventList 返回多事件列表', () => {
    const list = buildKmsEventList()
    expect(list).toHaveLength(3)
  })

  it('buildEmptyEventList 返回空列表', () => {
    expect(buildEmptyEventList()).toEqual([])
  })

  it('fixture overrides 有效', () => {
    const ring = buildKeyRing({ purpose: 'integration_token' })
    expect(ring.purpose).toBe('integration_token')
  })

  it('fixture 常量正确', () => {
    expect(FIXTURE_ORG_ID).toBe('org-encryption-test-001')
    expect(FIXTURE_PROVIDER_LOCAL).toBe('local')
    expect(FIXTURE_PROVIDER_MOCK).toBe('mock')
    expect(FIXTURE_STATE_PRIMARY).toBe('primary')
    expect(FIXTURE_STATE_DECRYPT_ONLY).toBe('decrypt_only')
    expect(FIXTURE_STATE_DISABLED).toBe('disabled')
  })
})

// ──────────────────────────────────────────────
// 6. 依赖轻量测试（确保不引入运行时外部依赖）
// ──────────────────────────────────────────────

describe('enterprise-encryption: dependency-light imports', () => {
  it('主类型文件可独立导入', () => {
    // 仅使用 node:crypto 的 fnv1aHash 在 enterprise-encryption-helpers 中
    // 类型文件本身零运行时依赖
    expect(KEY_PURPOSES).toHaveLength(9)
    expect(KMS_PROVIDERS).toHaveLength(2)
    expect(KEY_VERSION_STATES).toHaveLength(5)
    expect(KMS_EVENT_TYPES).toHaveLength(13)
    expect(KMS_WARNING_CODES.length).toBeGreaterThan(10)
    expect(KMS_FORBIDDEN_KEYS.length).toBeGreaterThan(10)
    expect(ENVELOPE_PARTS_EXPECTED).toBe(6)
    expect(ENVELOPE_PREFIX).toBe('ekm')
    expect(ENVELOPE_VERSION).toBe('v1')
    expect(ENVELOPE_ALGORITHM).toBe('AES-256-GCM')
  })

  it('envelope 常量正确', () => {
    expect(ALL_KNOWN_ENVELOPE_PREFIXES).toEqual(['ekm.v1'])
    expect(ENVELOPE_PREFIX_V1).toBe('ekm.v1')
  })
})
