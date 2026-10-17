/**
 * plugin-capability-seam-catalog-validator —— catalog validator 与红线 findings 测试
 * （tasks 4.2/4.4/4.6/4.8/4.10）。
 *
 * 覆盖：validator fixture（clean/缺字段/重复/未知引用/family gap/矛盾状态/无证据 host-ready/
 * 稳定排序）、红线负例（跨租 scope/global fallback/确认绕过/部分正式写入/失败扩大权限 →
 * 全部 blocking 且不可 waiver）、scope/权限/数据/副作用一致性矩阵、evidence freshness 与
 * local ref、低敏 sanitizer（原值不泄露）。
 */
import { describe, expect, it } from 'vitest'
import {
  containsSeamSensitiveContent,
  evaluateSeamCatalog,
  isSeamFindingWaiverable,
  redactSeamText,
  sanitizeSeamOutput,
  validateSeamCatalog,
  SEAM_RULE_IDS,
  type SeamFinding,
} from './plugin-capability-seam-catalog.js'
import {
  makeSeamCoreAuthorityDelegationFixture,
  makeSeamDuplicateFixture,
  makeSeamExternalActionUnauthorizedFixture,
  makeSeamFixture,
  makeSeamHostReadyNoEvidenceFixture,
  makeSeamInvalidEvidencePathFixture,
  makeSeamMatrixInconsistentFixture,
  makeSeamMissingFieldsFixture,
  makeSeamScopeMissingFixture,
  makeSeamSensitiveFixture,
  makeSeamStaleEvidenceFixture,
} from './plugin-capability-seam-catalog-fixtures.js'

// =============================================================================
// 4.2 validator fixture
// =============================================================================

describe('catalog validator fixture（4.2）', () => {
  it('clean：零 findings；缺字段 → blocking schema', () => {
    const clean = validateSeamCatalog([makeSeamFixture()])
    expect(clean.blockingCount).toBe(0)
    const missing = validateSeamCatalog([makeSeamMissingFieldsFixture() as never])
    expect(missing.blockingCount).toBeGreaterThanOrEqual(3)
  })

  it('重复 identity → blocking duplicate，且不因 family 覆盖规避', () => {
    const entries = [makeSeamFixture(), makeSeamDuplicateFixture()]
    const result = validateSeamCatalog(entries)
    expect(result.findings.some((f) => f.ruleId === SEAM_RULE_IDS.duplicateIdentity)).toBe(true)
    expect(
      result.findings.filter((f) => f.ruleId === SEAM_RULE_IDS.duplicateIdentity)[0]!.severity,
    ).toBe('blocking')
  })

  it('未知 contract/owner ref（提供 known 集时）→ blocking', () => {
    const result = validateSeamCatalog([makeSeamFixture()], {
      knownContractRefs: ['rbac-authorization'],
      knownOwnerRefs: ['compiler-core'],
    })
    expect(result.findings.some((f) => f.ruleId === SEAM_RULE_IDS.unknownContractRef)).toBe(true)
    expect(result.findings.some((f) => f.ruleId === SEAM_RULE_IDS.unknownOwnerRef)).toBe(true)
  })

  it('family gap（remove surface）→ blocking required family', () => {
    const without = [makeSeamFixture()] // 仅 server-query
    const result = evaluateSeamCatalog(without)
    expect(result.findings.some((f) => f.ruleId === SEAM_RULE_IDS.requiredFamilyGap)).toBe(true)
  })

  it('无证据 host-ready → blocking（host-ready 缺 fresh evidence）', () => {
    const result = validateSeamCatalog([makeSeamHostReadyNoEvidenceFixture()])
    expect(result.findings.some((f) => f.ruleId === SEAM_RULE_IDS.hostReadyNoEvidence)).toBe(true)
  })

  it('findings 稳定排序：多次运行顺序不变', () => {
    const entries = [makeSeamFixture(), makeSeamCoreAuthorityDelegationFixture()]
    const r1 = validateSeamCatalog(entries)
    const r2 = validateSeamCatalog(entries)
    expect(r1.findings.map((f) => f.findingId)).toEqual(r2.findings.map((f) => f.findingId))
  })
})

// =============================================================================
// 4.4 核心 authority 红线负例（全部 blocking 且不可 waiver）
// =============================================================================

describe('core authority redline 负例（4.4）', () => {
  const redlineFixture = makeSeamCoreAuthorityDelegationFixture()

  it('跨租户 scope / global-default authority fallback → blocking redline', () => {
    const result = validateSeamCatalog([redlineFixture])
    const redlines = result.findings.filter(
      (f) => f.ruleId === SEAM_RULE_IDS.coreAuthorityDelegation,
    )
    expect(redlines.length).toBeGreaterThanOrEqual(1)
    expect(redlines.every((f) => f.severity === 'blocking')).toBe(true)
  })

  it('确认绕过与部分正式写入：formal-write + not-required 确认 + direct-model-db → redline + matrix', () => {
    const result = validateSeamCatalog([redlineFixture])
    expect(
      result.findings.some(
        (f) =>
          f.ruleId === SEAM_RULE_IDS.matrixInconsistent ||
          f.ruleId === SEAM_RULE_IDS.coreAuthorityDelegation,
      ),
    ).toBe(true)
  })

  it('失败后权限扩大：failureMode=fail-open → blocking redline', () => {
    const result = validateSeamCatalog([{ ...redlineFixture, failureMode: 'fail-open' }])
    expect(
      result.findings.some(
        (f) => f.ruleId === SEAM_RULE_IDS.coreAuthorityDelegation && f.severity === 'blocking',
      ),
    ).toBe(true)
  })

  it('红线 finding 不可被 warning waiver 放行（isSeamFindingWaiverable=false）', () => {
    const result = validateSeamCatalog([redlineFixture])
    const redlineFindings = result.findings.filter((f) => f.severity === 'blocking')
    expect(redlineFindings.length).toBeGreaterThan(0)
    for (const finding of redlineFindings) {
      expect(isSeamFindingWaiverable(finding)).toBe(false)
    }
  })
})

// =============================================================================
// 4.6 scope/权限/数据/副作用矩阵
// =============================================================================

describe('一致性矩阵正反例（4.6）', () => {
  it('只读/advisory/render/transform 在既有 scope/permission 下合法（clean）', () => {
    const result = validateSeamCatalog([makeSeamFixture()])
    expect(result.blockingCount).toBe(0)
  })

  it('scope 缺失（无 scopeModes / 无 requiredPermissions）→ blocking scope finding', () => {
    const result = validateSeamCatalog([makeSeamScopeMissingFixture()])
    expect(result.findings.some((f) => f.ruleId === SEAM_RULE_IDS.scopePermissionMissing)).toBe(
      true,
    )
  })

  it('proposal/preview 必须关联核心确认：formal-write 无确认/无审计 → blocking matrix', () => {
    const result = validateSeamCatalog([makeSeamMatrixInconsistentFixture()])
    expect(result.findings.some((f) => f.ruleId === SEAM_RULE_IDS.matrixInconsistent)).toBe(true)
  })

  it('未授权外部动作 → blocking（不进入 host-ready）', () => {
    const result = validateSeamCatalog([makeSeamExternalActionUnauthorizedFixture()])
    expect(result.findings.some((f) => f.ruleId === SEAM_RULE_IDS.externalActionUnauthorized)).toBe(
      true,
    )
  })

  it('资源超限/崩溃隔离：isolate-drop/block-extension 合法，fail-open 红线', () => {
    const ok = validateSeamCatalog([
      { ...makeSeamFixture(), failureMode: 'isolate-drop' },
      {
        ...makeSeamFixture(),
        seamKey: 'server-query.readonly-provider.b',
        failureMode: 'block-extension',
      },
    ])
    // 第二条 seamKey b 与第一条不同 key，无重复
    expect(ok.blockingCount).toBe(0)
    const bad = validateSeamCatalog([{ ...makeSeamFixture(), failureMode: 'fail-open' }])
    expect(bad.blockingCount).toBeGreaterThanOrEqual(1)
  })

  it('失败不扩大权限：failureMode 不影响授权/scope 判定（RBAC/tenant 仍由核心）', () => {
    const entry = makeSeamFixture()
    const result = validateSeamCatalog([
      { ...entry, failureMode: 'controlled-degrade', scopeModes: ['organization', 'project'] },
    ])
    expect(result.blockingCount).toBe(0)
  })
})

// =============================================================================
// 4.8 evidence freshness / local ref
// =============================================================================

describe('evidence freshness 与 local ref（4.8）', () => {
  it('fresh：普通 cataloged 不产生 freshness finding', () => {
    const result = validateSeamCatalog([makeSeamFixture()])
    expect(
      result.findings.some(
        (f) =>
          f.ruleId === SEAM_RULE_IDS.evidenceStale || f.ruleId === SEAM_RULE_IDS.evidenceMissing,
      ),
    ).toBe(false)
  })

  it('cataloged + stale → warning（degraded，不 blocking）', () => {
    const result = validateSeamCatalog([makeSeamStaleEvidenceFixture()])
    expect(
      result.findings.some(
        (f) => f.ruleId === SEAM_RULE_IDS.evidenceStale && f.severity === 'warning',
      ),
    ).toBe(true)
    expect(result.blockingCount).toBe(0)
  })

  it('host-ready + stale → blocking（high-risk 缺口不能 degraded）', () => {
    const result = validateSeamCatalog([
      {
        ...makeSeamStaleEvidenceFixture(),
        availability: 'host-ready',
        deliveryStatus: 'delivered',
      },
    ])
    expect(
      result.findings.some(
        (f) => f.ruleId === SEAM_RULE_IDS.evidenceStale && f.severity === 'blocking',
      ),
    ).toBe(true)
  })

  it('缺失证据（missing）→ warning；失效路径 → cataloged warning / host-ready blocking', () => {
    const missing = validateSeamCatalog([{ ...makeSeamFixture(), evidenceFreshness: 'missing' }])
    expect(missing.findings.some((f) => f.ruleId === SEAM_RULE_IDS.evidenceMissing)).toBe(true)

    const resolver = (path: string): boolean =>
      !path.includes('missing_thing') && path.includes('spec.md')
    const cataloged = validateSeamCatalog([makeSeamInvalidEvidencePathFixture()], {
      evidencePathResolver: resolver,
    })
    expect(
      cataloged.findings.some(
        (f) => f.ruleId === SEAM_RULE_IDS.evidencePathInvalid && f.severity === 'warning',
      ),
    ).toBe(true)

    const hostReady = validateSeamCatalog(
      [
        {
          ...makeSeamInvalidEvidencePathFixture(),
          availability: 'host-ready',
          deliveryStatus: 'delivered',
        },
      ],
      { evidencePathResolver: resolver },
    )
    expect(
      hostReady.findings.some(
        (f) => f.ruleId === SEAM_RULE_IDS.evidencePathInvalid && f.severity === 'blocking',
      ),
    ).toBe(true)
  })

  it('图谱空结果无 source fallback → blocking（空图谱不得证明不存在）', () => {
    const result = validateSeamCatalog([makeSeamFixture()], {
      graphAbsentWithoutFallback: true,
    })
    expect(result.findings.some((f) => f.ruleId === SEAM_RULE_IDS.graphAbsentNoFallback)).toBe(true)
  })

  it('相同输入结果可复现（freshness 判定确定性）', () => {
    const r1 = validateSeamCatalog([makeSeamStaleEvidenceFixture()])
    const r2 = validateSeamCatalog([makeSeamStaleEvidenceFixture()])
    expect(JSON.stringify(r1.findings)).toBe(JSON.stringify(r2.findings))
  })
})

// =============================================================================
// 4.10 低敏 sanitizer
// =============================================================================

describe('低敏 finding/report sanitizer（4.10）', () => {
  it('敏感 fixture 触发 redaction violation blocking；原值不出现在 findings/消毒输出', () => {
    const result = validateSeamCatalog([makeSeamSensitiveFixture()])
    expect(result.findings.some((f) => f.ruleId === SEAM_RULE_IDS.redactionViolation)).toBe(true)
    // findings 低敏：原值不出现
    const findingsJson = JSON.stringify(result.findings)
    expect(findingsJson).not.toContain('sk-proj-fixture-token')
    expect(findingsJson).not.toContain('api.openai.com')
    expect(findingsJson).not.toContain('你是一个系统提示')
    // 消毒输出：对象级 sanitize 后原值不出现
    const { sanitized } = sanitizeSeamOutput(result)
    const serialized = JSON.stringify(sanitized)
    expect(serialized).not.toContain('sk-proj-fixture-token')
    expect(serialized).not.toContain('api.openai.com')
    expect(serialized).not.toContain('你是一个系统提示')
  })

  it('对象级 sanitize：forbidden 键丢弃，敏感字符串打码为 [REDACTED:...]', () => {
    const { sanitized, droppedKeys, redactedCount } = sanitizeSeamOutput({
      findingId: 'f1',
      ruleId: 'SEAM-001',
      title: 'accessToken=eyJhbGciOiJIUzI1NiJ9.payload.signature',
      prompt: 'system prompt 你是一个AI助手',
      providerPayload: { raw: 'secret sk-proj-abcdefghijklmnop' },
      summary: 'ok',
    })
    expect(droppedKeys).toContain('prompt')
    expect(droppedKeys).toContain('providerPayload')
    expect(redactedCount).toBeGreaterThan(0)
    const text = JSON.stringify(sanitized)
    expect(text).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(text).not.toContain('sk-proj-abcdefghijklmnop')
    expect(text).not.toContain('system prompt')
    expect(text).toContain('[REDACTED:')
  })

  it('文本级 redaction：各类敏感样本逐类打码，原值不出现', () => {
    const samples: Array<[string, string]> = [
      ['-----BEGIN RSA PRIVATE KEY-----\nabc', 'PRIVATE KEY'],
      ['ghp_1234567890abcdefghij_abcdefghij', 'ghp_'],
      ['token=sk-proj-abcdefghijklmnopqrst', 'sk-proj'],
      ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.xyz', 'Bearer'],
      ['<system>你是一个资深项目经理</system>', '你是一个'],
      ['model_output: choices[0].text', 'model_output'],
      ['endpoint api.openai.com/v1', 'openai'],
      ['tenant_id=org_a1b2c3d4e5f6g7h8', 'tenant_id'],
    ]
    for (const [input, needle] of samples) {
      const result = redactSeamText(input)
      expect(result.redactedCount).toBeGreaterThan(0)
      expect(result.text).not.toContain(needle)
      expect(containsSeamSensitiveContent(input)).toBe(true)
    }
  })

  it('sanitizer 不因错误对象/超长内容泄露完整 payload', () => {
    const long = `x`.repeat(200_000)
    const r = redactSeamText(`prefix ${long} suffix`)
    expect(r.redactedCount).toBeGreaterThan(0)
    expect(r.text.length).toBeLessThan(1500)
    expect(r.text).toContain('[REDACTED:oversized')

    const { sanitized } = sanitizeSeamOutput({ message: long })
    const text = JSON.stringify(sanitized)
    expect(text.length).toBeLessThan(1500)
    expect(text).toContain('[REDACTED:oversized')
  })

  it('finding 生成本身低敏：summary 恒定模板，不含输入原始值', () => {
    const result = validateSeamCatalog([makeSeamStaleEvidenceFixture()])
    for (const finding of result.findings as SeamFinding[]) {
      expect(
        Object.values(finding).every(
          (v) => typeof v !== 'string' || !containsSeamSensitiveContent(v),
        ),
      ).toBe(true)
    }
  })
})
