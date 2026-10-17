// @aiproj/types — 企业合规准备度：readiness evaluator + redaction/hash 单元测试。
import { describe, it, expect } from 'vitest'
import {
  evaluateControl,
  evaluateReadinessDashboard,
  isExpired,
  isEvidenceFresh,
  crFnv1aHash,
  crComputeStableSignature,
  crComputeProfileHash,
  crComputeSourceHash,
  crComputeSourceSignature,
  detectComplianceForbiddenKeysDeep,
  redactComplianceForbiddenKeysDeep,
  isComplianceForbiddenKey,
  COMPLIANCE_READINESS_STATES,
  COMPLIANCE_WARNING_CODES,
  COMPLIANCE_FORBIDDEN_KEYS,
  type ComplianceEvidenceRef,
} from './enterprise-compliance-readiness.js'
import {
  buildDemoProfile,
  buildDemoControls,
  buildEvidenceRef,
  buildFreshEvidenceFor,
  buildException,
  crBuildProviderHealth,
  buildPackagePreview,
  buildPackageLedgerEntry,
} from './enterprise-compliance-readiness-fixtures.js'

const NOW = '2026-02-01T00:00:00.000Z'

/** 取 demo control：audit_log_integrity（evidenceRequirements=['audit']，用于 ready/missing/blocked 案例） */
function buildControl() {
  return buildDemoControls().find((c) => c.controlId === 'audit_log_integrity')!
}

describe('enterprise-compliance-readiness evaluator', () => {
  describe('isExpired / isEvidenceFresh', () => {
    it('判定时间过期', () => {
      expect(isExpired('2026-02-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(true)
      expect(isExpired('2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z')).toBe(false)
      expect(isExpired('2026-02-01T00:00:00.000Z', null)).toBe(false)
    })

    it('无过期时间但 freshness 超窗判 stale', () => {
      const stale = buildEvidenceRef({
        controlId: 'x',
        sourceType: 'audit',
        freshnessSeconds: 200 * 24 * 3600, // 200 天 > 90 天默认窗
        status: 'fresh',
        capturedAt: '2026-01-01T00:00:00.000Z',
      })
      expect(isEvidenceFresh(stale, NOW)).toBe(false)
    })
  })

  describe('evaluateControl — ready', () => {
    it('完整、新鲜、无阻断证据 → ready', () => {
      const control = buildControl()
      const evidence = buildFreshEvidenceFor(control.id, ['audit'])
      const health = crBuildProviderHealth()
      const result = evaluateControl(control, evidence, [], health, NOW)
      expect(result.state).toBe('ready')
      expect(result.missingEvidenceTypes).toEqual([])
      expect(result.blockedDependency).toBeNull()
      expect(result.reasons).not.toContain('exception_expired')
    })
  })

  describe('evaluateControl — missing', () => {
    it('无 required evidence → missing', () => {
      const control = buildControl() // requires ['audit']
      const result = evaluateControl(control, [], [], crBuildProviderHealth(), NOW)
      expect(result.state).toBe('missing')
      expect(result.missingEvidenceTypes).toEqual(['audit'])
      expect(result.reasons).toContain('no_required_evidence')
      expect(result.nextProbe).toContain('collect_evidence:audit_log_integrity')
    })
  })

  describe('evaluateControl — partial', () => {
    it('有部分证据但缺非阻断项 → partial', () => {
      // 构造需要两份证据的控制，但只提供一份 → 部分，非 missing
      const control = {
        ...buildControl(), // audit_log_integrity, requirements=['audit']
        controlId: 'multi_source_control',
        evidenceRequirements: ['audit', 'rbac'],
      }
      const evidence = buildFreshEvidenceFor(control.id, ['audit']) // 只给 audit
      const result = evaluateControl(control, evidence, [], crBuildProviderHealth(), NOW)
      expect(result.state).toBe('partial')
      // audit 满足、rbac 缺失
      expect(result.missingEvidenceTypes).toContain('rbac')
      expect(result.reasons).toContain('missing_evidence_type')
    })

    it('stale evidence → partial with stale refs', () => {
      const control = buildControl()
      const stale = buildEvidenceRef({
        controlId: control.id,
        sourceType: 'audit',
        expiresAt: '2025-01-01T00:00:00.000Z', // 已过期
        status: 'stale',
        capturedAt: '2024-12-01T00:00:00.000Z',
      })
      const result = evaluateControl(control, [stale], [], crBuildProviderHealth(), NOW)
      expect(result.state).toBe('partial')
      expect(result.staleEvidenceRefs).toContain(stale.id)
      expect(result.reasons).toContain('stale_evidence')
    })
  })

  describe('evaluateControl — not_applicable', () => {
    it('标为 not_applicable 且有 reason → not_applicable', () => {
      const control = buildDemoControls().find((c) => c.controlId === 'access_control_ocr_privacy')!
      expect(control.applicability).toBe('not_applicable')
      const result = evaluateControl(control, [], [], crBuildProviderHealth(), NOW)
      expect(result.state).toBe('not_applicable')
      expect(result.reasons).toContain('requires_external_review')
    })
  })

  describe('evaluateControl — blocked (gated dependency)', () => {
    it('邻域 provider degraded → blocked with dependency', () => {
      const control = buildDemoControls().find((c) => c.controlId === 'data_protection_dlp')!
      const health = crBuildProviderHealth({ dlp: { health: 'missing', reason: 'DLP 未归档' } })
      const result = evaluateControl(control, [], [], health, NOW)
      expect(result.state).toBe('blocked')
      expect(result.blockedDependency).toBe('dlp')
      expect(result.reasons).toContain('dlp_unavailable')
      expect(result.reasons).toContain('gated_dependency')
      expect(result.nextProbe).toContain('enable_provider:dlp')
    })

    it('非 dlp 邻域 degraded → neighbor_provider_degraded', () => {
      const control = buildControl() // requires ['audit']
      const health = crBuildProviderHealth({
        audit: { health: 'degraded', reason: '审计 provider 降级' },
      })
      const result = evaluateControl(control, [], [], health, NOW)
      expect(result.state).toBe('blocked')
      expect(result.blockedDependency).toBe('audit')
      expect(result.reasons).toContain('neighbor_provider_degraded')
    })
  })

  describe('evaluateControl — exception', () => {
    it('过期例外使 ready 降级为 partial', () => {
      const control = buildControl()
      const evidence = buildFreshEvidenceFor(control.id, ['audit'])
      const health = crBuildProviderHealth()
      const expired = buildException({
        controlId: control.id,
        status: 'expired',
        dueDate: '2025-01-01T00:00:00.000Z',
      })
      const result = evaluateControl(control, evidence, [expired], health, NOW)
      // control.status==='ready' && 无 missing/stale，但有过期例外 → partial
      expect(result.state).toBe('partial')
      expect(result.reasons).toContain('exception_expired')
    })

    it('未过期例外不阻断 ready', () => {
      const control = buildControl()
      const evidence = buildFreshEvidenceFor(control.id, ['audit'])
      const health = crBuildProviderHealth()
      const open = buildException({
        controlId: control.id,
        status: 'open',
        dueDate: '2027-01-01T00:00:00.000Z', // 未过期
      })
      const result = evaluateControl(control, evidence, [open], health, NOW)
      // 未被过期例外影响 → ready
      expect(result.state).toBe('ready')
    })
  })

  describe('evaluateReadinessDashboard', () => {
    it('聚合状态分布与 provider health / exception summary', () => {
      const profile = buildDemoProfile()
      const controls = buildDemoControls()
      const evidence: ComplianceEvidenceRef[] = []
      for (const c of controls) {
        if (c.applicability === 'applicable') {
          evidence.push(...buildFreshEvidenceFor(c.id, c.evidenceRequirements))
        }
      }
      const health = crBuildProviderHealth()
      const dashboard = evaluateReadinessDashboard({
        profile,
        controls,
        evidenceRefs: evidence,
        exceptions: [],
        providerHealth: health,
        now: NOW,
      })

      // 所有状态值都是合法枚举
      for (const month of Object.values(dashboard.stateDistribution)) {
        expect(typeof month).toBe('number')
      }
      // 有 not_applicable（ocr control）与 ready（audit/rbac 等）
      expect(dashboard.stateDistribution.not_applicable).toBeGreaterThan(0)
      expect(dashboard.stateDistribution.ready).toBeGreaterThan(0)
      expect(dashboard.notCertification).toBe(true)
      // provider health 长度
      expect(dashboard.providerHealth.length).toBeGreaterThan(0)
      // exception summary 计数正确
      expect(dashboard.exceptionSummary).toEqual({ open: 0, expired: 0, closed: 0 })
      // 控制项结果数等于控制数
      expect(dashboard.controls.length).toBe(controls.length)
      // 所有枚举覆盖
      expect(COMPLIANCE_READINESS_STATES).toHaveLength(5)
    })

    it('provider 缺失使 DLP/KMS control 标为 blocked 而非 ready', () => {
      const profile = buildDemoProfile()
      const controls = buildDemoControls()
      const dlpControl = controls.find((c) => c.controlId === 'data_protection_dlp')!
      const health = crBuildProviderHealth({
        dlp: { health: 'missing', reason: 'DLP 未 apply' },
        kms: { health: 'missing', reason: 'KMS 未 apply' },
      })
      const dashboard = evaluateReadinessDashboard({
        profile,
        controls,
        evidenceRefs: [],
        exceptions: [],
        providerHealth: health,
        now: NOW,
      })
      const dlpResult = dashboard.controls.find((c) => c.controlId === dlpControl.controlId)!
      expect(dlpResult.state).toBe('blocked')
      expect(dlpResult.blockedDependency).toBe('dlp')
      // 被阻断的控制不记为 ready
      expect(dashboard.stateDistribution.ready).toBe(0)
    })
  })
})

describe('enterprise-compliance-readiness redaction & hash helpers', () => {
  describe('forbidden key detection', () => {
    it('识别 prompt/modelOutput/token/Authorization/apiKey/secret/password/rawBody/fileBody/absolutePath', () => {
      for (const key of [
        'prompt',
        'modelOutput',
        'model_output',
        'token',
        'authorization',
        'Authorization',
        'apiKey',
        'api_key',
        'secret',
        'password',
        'rawBody',
        'raw_body',
        'fileBody',
        'file_body',
        'absolutePath',
        'absolute_path',
      ]) {
        expect(isComplianceForbiddenKey(key), key).toBe(true)
      }
      expect(isComplianceForbiddenKey('safeKey')).toBe(false)
      expect(isComplianceForbiddenKey('count')).toBe(false)
    })

    it('深度检测嵌套中的 forbidden key', () => {
      const obj = {
        audit: { id: 1 },
        nested: {
          rawBody: '敏感正文',
          payload: { apiKey: 'sk-xxx', prompt: '请摘要' },
        },
      }
      const found = detectComplianceForbiddenKeysDeep(obj)
      expect(found).toContain('nested.rawBody')
      expect(found).toContain('nested.payload.apiKey')
      expect(found).toContain('nested.payload.prompt')
    })

    it('redact 递归删除 forbidden keys 且不修改原对象', () => {
      const original = {
        id: 1,
        secret: 's3cr3t',
        prompt: 'hello',
        nested: { authorization: 'Bearer x', fileBody: 'abc' },
        legit: 'keep',
      }
      const redacted = redactComplianceForbiddenKeysDeep(original)
      expect(redacted.secret).toBeUndefined()
      expect(redacted.prompt).toBeUndefined()
      expect(redacted.nested.authorization).toBeUndefined()
      expect(redacted.nested.fileBody).toBeUndefined()
      expect(redacted.legit).toBe('keep')
      // 原对象不变
      expect(original.secret).toBe('s3cr3t')
      expect(original.nested.authorization).toBe('Bearer x')
    })
  })

  describe('stable hash helpers', () => {
    it('fnv1a / stable signature 确定性且大小写敏感', () => {
      expect(crFnv1aHash('abc')).toBe(crFnv1aHash('abc'))
      expect(crFnv1aHash('abc')).not.toBe(crFnv1aHash('ABC'))
      expect(crComputeStableSignature({ b: 1, a: 2 })).toBe(
        crComputeStableSignature({ a: 2, b: 1 }),
      )
    })

    it('profile/control/source hash 确定性', () => {
      const p1 = crComputeProfileHash({
        organizationId: 1,
        profileId: 'cp',
        version: 1,
        scope: 'org',
      })
      const p2 = crComputeProfileHash({
        organizationId: 1,
        profileId: 'cp',
        version: 1,
        scope: 'org',
      })
      const p3 = crComputeProfileHash({
        organizationId: 2,
        profileId: 'cp',
        version: 1,
        scope: 'org',
      })
      expect(p1).toBe(p2)
      expect(p1).not.toBe(p3)
      expect(crComputeSourceHash('audit', 'p', 'ref')).toBe(
        crComputeSourceHash('audit', 'p', 'ref'),
      )
    })
  })

  describe('package signatures', () => {
    it('preview/source/package signature 稳定且区分组织', () => {
      const controlHashes = ['h1', 'h2']
      const sourceSig = crComputeSourceSignature({
        profileHash: 'ph',
        controlHashes,
        providerHealth: { audit: 'live' },
        capturedAt: '2026-01-01T00:00:00.000Z',
      })
      expect(sourceSig).toBe(
        crComputeSourceSignature({
          profileHash: 'ph',
          controlHashes,
          providerHealth: { audit: 'live' },
          capturedAt: '2026-01-01T00:00:00.000Z',
        }),
      )
      // capturedAt 变 → signature 变
      expect(sourceSig).not.toBe(
        crComputeSourceSignature({
          profileHash: 'ph',
          controlHashes,
          providerHealth: { audit: 'live' },
          capturedAt: '2026-02-01T00:00:00.000Z',
        }),
      )
      // package preview 完整结构
      const preview = buildPackagePreview()
      expect(preview.requiresConfirmation).toBe(true)
      expect(preview.notCertification).toBe(true)
      expect(preview.warningCodes).toContain('not_certification')
      expect(preview.packageHash).toBeTruthy()
      // ledger entry 可校验
      const ledger = buildPackageLedgerEntry()
      expect(ledger.packageHash).toBe(preview.packageHash)
      expect(ledger.status).toBe('confirmed')
    })
  })

  describe('warning code catalog', () => {
    it('覆盖 spec 要求的 warning categories', () => {
      expect(COMPLIANCE_WARNING_CODES).toContain('not_certification')
      expect(COMPLIANCE_WARNING_CODES).toContain('stale_source_signature')
      expect(COMPLIANCE_WARNING_CODES).toContain('expired_evidence')
      expect(COMPLIANCE_WARNING_CODES).toContain('neighbor_provider_degraded')
      expect(COMPLIANCE_WARNING_CODES).toContain('exception_expired')
    })

    it('forbidden keys 覆盖 spec 列出的敏感字段', () => {
      const specKeys = [
        'prompt',
        'modelOutput',
        'token',
        'Authorization',
        'apiKey',
        'secret',
        'password',
        'rawBody',
        'fileBody',
        'absolutePath',
      ]
      for (const k of specKeys) {
        expect(
          COMPLIANCE_FORBIDDEN_KEYS.some((x) => x.toLowerCase() === k.toLowerCase()),
          k,
        ).toBe(true)
      }
    })
  })

  it('所有状态枚举合法', () => {
    expect([...COMPLIANCE_READINESS_STATES].sort()).toEqual(
      ['ready', 'partial', 'missing', 'not_applicable', 'blocked'].sort(),
    )
  })
})
