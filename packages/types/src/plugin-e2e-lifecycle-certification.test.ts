import { describe, test, expect } from 'vitest'
import {
  createFocusedProfile,
  createReleaseProfile,
  canonicalizeReport,
  computeE2EReportDigest,
  validateCertificationReport,
  validateCertificationLedger,
  normalizeEvidenceRef,
  isRepoRelativeEvidenceRef,
  canonicalizeEvidenceRefs,
  pE2EDeepRedact,
  scanE2ESensitiveLeakage,
  buildReproCommand,
  addReportToLedger,
  createEmptyLedger,
  computeLedgerDigest,
  isCiGatePass,
  PLUGIN_E2E_SCHEMA_VERSION,
} from './plugin-e2e-lifecycle-certification.js'
import {
  focusedPassReport,
  releasePassReport,
  failedCrossTenantReport,
  failedResidueReport,
  failedMissingRequiredStepReport,
  sensitiveLeakageRawReportInput,
  absolutePathRawReportInput,
  focusedLedger,
  releaseLedger,
} from './plugin-e2e-lifecycle-certification-fixtures.js'

describe('plugin-e2e-lifecycle-certification · 4.3 证据账本与脱敏/路径/复现', () => {
  test('focused 与 release profile 稳定', () => {
    const focused = createFocusedProfile()
    const release = createReleaseProfile()
    expect(focused.kind).toBe('focused')
    expect(release.kind).toBe('release')
    expect(focused.stepIds.length).toBe(9)
    expect(release.stepIds.length).toBeGreaterThan(focused.stepIds.length)
    expect(release.requiredStepIds.length).toBe(11)
  })

  test('报告 canonicalize 确定性：相同输入产生相同 digest', () => {
    const a = canonicalizeReport(focusedPassReport)
    const b = canonicalizeReport({ ...focusedPassReport, generatedAt: '2026-08-22T00:00:00.000Z' })
    expect(a.digest).toBe(b.digest)
    expect(a.digest).toBe(computeE2EReportDigest(focusedPassReport))
  })

  test('必需要步骤缺失即 fail-closed', () => {
    const v = validateCertificationReport(failedMissingRequiredStepReport)
    expect(v.valid).toBe(false)
    expect(v.errors.some((e) => e.includes('missing required step'))).toBe(true)
    expect(isCiGatePass(failedMissingRequiredStepReport)).toBe(false)
  })

  test('敏感字段脱敏：token/secret/Authorization 被替换', () => {
    const canonical = canonicalizeReport(sensitiveLeakageRawReportInput as any)
    const json = JSON.stringify(canonical)
    expect(json).not.toMatch(/sk-1234/)
    expect(json).not.toMatch(/my-secret-value/)
    expect(json).toContain('[redacted]')
    // 脱敏后不应再有敏感泄露
    const leakage = scanE2ESensitiveLeakage(canonical)
    expect(leakage.leaked).toBe(false)
  })

  test('敏感值深度脱敏：pE2EDeepRedact 覆盖嵌套结构', () => {
    const input = {
      nested: { token: 'sk-abcdef1234567890abcdef12345', ok: 'hello' },
      bearer: 'Bearer abcdef1234567890._-token',
      deep: { arr: [{ secret: 'x' }, 'Bearer sk-123'] },
    }
    const redacted = pE2EDeepRedact(input)
    expect(redacted.nested.token).toBe('[redacted]')
    expect(redacted.bearer).toBe('[redacted]')
    expect(JSON.stringify(redacted)).not.toMatch(/sk-abcdef/)
  })

  test('路径稳定性：绝对路径/URL/Windows 盘符被归一为相对 evidence ref', () => {
    const canonical = canonicalizeReport(absolutePathRawReportInput as any)
    for (const step of canonical.steps) {
      expect(isRepoRelativeEvidenceRef(step.evidenceRef ?? '')).toBe(true)
      expect(step.evidenceRef).not.toMatch(/^\/abs/)
      expect(step.evidenceRef).not.toMatch(/^C:/)
      expect(step.evidenceRef).not.toMatch(/^https?:\/\//)
    }
    // 具体归一化
    expect(normalizeEvidenceRef('/abs/path/to/evidence.json')).toBe('evidence:evidence.json')
    expect(normalizeEvidenceRef('C:\\abs\\windows\\evidence.json')).toBe('evidence:evidence.json')
    expect(normalizeEvidenceRef('https://example.com/evidence.json')).toBe('evidence:evidence.json')
    expect(normalizeEvidenceRef('..\\traversal')).toBe('evidence:invalid-traversal')
  })

  test('路径稳定性：canonicalizeEvidenceRefs 去重排序', () => {
    const refs = canonicalizeEvidenceRefs([
      'evidence:b.json',
      'evidence:a.json',
      'evidence:b.json',
      '/abs/c.json',
    ])
    expect(refs).toEqual(['evidence:a.json', 'evidence:b.json', 'evidence:c.json'])
  })

  test('失败复现命令：包含 profile/plugin/digest/failed/fixture 且零敏感', () => {
    const cmd = buildReproCommand(failedCrossTenantReport)
    expect(cmd).toContain('--profile release')
    expect(cmd).toContain('com.aiproj.canary-query@1.0.0')
    expect(cmd).toContain('--digest')
    expect(cmd).toContain('--failed cross-org-access')
    expect(cmd).toContain('--zero-network')
    expect(cmd).not.toMatch(/token|secret|Authorization/i)
    expect(cmd).not.toMatch(/https?:\/\//)
  })

  test('失败复现命令在相同报告下稳定', () => {
    const a = buildReproCommand(failedResidueReport)
    const b = buildReproCommand(failedResidueReport)
    expect(a).toBe(b)
    // focused 与 release 前缀区分
    expect(a).toContain('--profile release')
  })

  test('证据账本：空账本 digest 稳定，追加后 digest 变化', () => {
    const empty = createEmptyLedger()
    expect(empty.entries.length).toBe(0)
    expect(empty.ledgerDigest).toBe(computeLedgerDigest([]))
    expect(validateCertificationLedger(empty).valid).toBe(true)

    const withFocused = addReportToLedger(empty, focusedPassReport)
    expect(withFocused.entries.length).toBe(1)
    expect(withFocused.entries[0]!.reportDigest).toBe(focusedPassReport.digest)
    expect(withFocused.entries[0]!.reproCommand).toContain('--profile focused')
    expect(validateCertificationLedger(withFocused).valid).toBe(true)

    // 幂等：重复追加同一报告不产生重复条目
    const dup = addReportToLedger(withFocused, focusedPassReport)
    expect(dup.entries.length).toBe(1)
    expect(dup.ledgerDigest).toBe(withFocused.ledgerDigest)
  })

  test('证据账本：focused + release 两条，evidenceRefs 均为相对路径', () => {
    expect(releaseLedger.entries.length).toBe(2)
    for (const e of releaseLedger.entries) {
      expect(e.evidenceRefs.every((r) => isRepoRelativeEvidenceRef(r))).toBe(true)
      expect(e.reproCommand).not.toMatch(/token|secret/i)
      expect(e.reproCommand).toContain('--zero-network')
    }
    expect(validateCertificationLedger(releaseLedger).valid).toBe(true)
  })

  test('账本中失败报告仍可入账但 CI 门禁不通过', () => {
    expect(validateCertificationReport(failedCrossTenantReport).valid).toBe(true)
    expect(isCiGatePass(failedCrossTenantReport)).toBe(false)
    expect(failedCrossTenantReport.conclusion).toBe('fail')
    expect(failedCrossTenantReport.reproCommand).toContain('--failed')
  })

  test('报告中含绝对路径 evidenceRef 经 canonicalize 后可通过校验', () => {
    const canonical = canonicalizeReport(absolutePathRawReportInput as any)
    const v = validateCertificationReport(canonical)
    expect(v.valid).toBe(true)
  })

  test('报告脱敏后不含跨租标识或 secret', () => {
    const leakage = scanE2ESensitiveLeakage(focusedPassReport)
    expect(leakage.leaked).toBe(false)
    const ledgerLeakage = scanE2ESensitiveLeakage(focusedLedger)
    expect(ledgerLeakage.leaked).toBe(false)
  })

  test('release 完整报告通过校验且 CI 门禁可通过', () => {
    const v = validateCertificationReport(releasePassReport)
    expect(v.valid).toBe(true)
    expect(isCiGatePass(releasePassReport)).toBe(true)
    expect(releasePassReport.schemaVersion).toBe(PLUGIN_E2E_SCHEMA_VERSION)
  })
})
