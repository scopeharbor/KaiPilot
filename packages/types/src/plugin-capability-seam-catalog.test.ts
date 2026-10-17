/**
 * plugin-capability-seam-catalog —— 共享接缝契约测试（tasks 2.2/2.4/2.6）。
 *
 * 覆盖：契约 shape 正反例（必填字段/未知枚举/不可变输入/三态分离/无 host 证据不得 host-ready）、
 * SemVer 严格解析与 exact/same-major 兼容 helper、确定性归一化/排序/查找/digest。
 * 零网络/IO/时间/随机数依赖（纯函数）。
 */
import { describe, expect, it } from 'vitest'
import {
  checkSeamCompatibility,
  compareSeamVersions,
  computeSeamCatalogDigest,
  computeSeamSourceHash,
  findDuplicateSeamIdentities,
  lookupSeamEntry,
  normalizeSeamEntries,
  normalizeSeamEntry,
  parseSeamVersion,
  resolveSeamRequest,
  validateSeamCatalog,
  SEAM_RULE_IDS,
} from './plugin-capability-seam-catalog.js'
import {
  makeSeamDuplicateFixture,
  makeSeamFixture,
  makeSeamHostReadyNoEvidenceFixture,
  makeSeamInvalidVersionFixture,
  makeSeamMissingFieldsFixture,
  makeSeamNotificationTemplateFixture,
  makeSeamSkillAdapterFixture,
  makeSeamStateContradictionFixture,
  makeSeamUnknownEnumFixture,
  makeSeamVersionCatalogFixture,
} from './plugin-capability-seam-catalog-fixtures.js'

// =============================================================================
// 2.2 契约 shape 正反例
// =============================================================================

describe('plugin-capability-seam-catalog 契约 shape（2.2）', () => {
  it('clean fixture：零 blocking，required family 未指定时不产生 family gap', () => {
    const result = validateSeamCatalog([makeSeamFixture()])
    expect(result.blockingCount).toBe(0)
    expect(result.warningCount).toBe(0)
    expect(result.findings.length).toBe(0)
  })

  it('缺必填字段（ownerRef/scopeModes/evidenceFreshness）→ blocking schema/enum finding', () => {
    const result = validateSeamCatalog([makeSeamMissingFieldsFixture() as never])
    expect(result.blockingCount).toBeGreaterThanOrEqual(3)
    const findings = result.findings.filter(
      (f) => f.ruleId === SEAM_RULE_IDS.schemaInvalid || f.ruleId === SEAM_RULE_IDS.unknownEnum,
    )
    expect(findings.length).toBeGreaterThanOrEqual(3)
    expect(findings.every((f) => f.severity === 'blocking')).toBe(true)
  })

  it('未知枚举（surface/classification/tenantAuthority）→ blocking 枚举 finding', () => {
    const result = validateSeamCatalog([makeSeamUnknownEnumFixture() as never])
    expect(result.blockingCount).toBeGreaterThanOrEqual(3)
    const findings = result.findings.filter((f) => f.ruleId === SEAM_RULE_IDS.unknownEnum)
    expect(findings.length).toBeGreaterThanOrEqual(3)
    expect(findings[0]!.severity).toBe('blocking')
  })

  it('非法/预发布版本不被接受（blocking）', () => {
    const result = validateSeamCatalog([makeSeamInvalidVersionFixture()])
    expect(result.findings.some((f) => f.code === 'seam-invalid-version')).toBe(true)
  })

  it('不可变输入：normalizeSeamEntry 不修改原始对象，重复调用结果一致', () => {
    const raw = makeSeamFixture()
    const frozen = JSON.parse(JSON.stringify(raw)) as typeof raw
    const a = normalizeSeamEntry(frozen)
    const b = normalizeSeamEntry(frozen)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(frozen)).toBe(JSON.stringify(raw))
  })

  it('三态分离：hybrid + incremental-gap + cataloged 是合法组合', () => {
    const result = validateSeamCatalog([makeSeamFixture()])
    expect(result.blockingCount).toBe(0)
  })

  it('三态矛盾：net-new + host-ready → blocking（不得由字段互相推导）', () => {
    const result = validateSeamCatalog([makeSeamStateContradictionFixture()])
    expect(
      result.findings.some(
        (f) => f.ruleId === SEAM_RULE_IDS.stateContradiction && f.severity === 'blocking',
      ),
    ).toBe(true)
  })

  it('无 host 证据不得 host-ready：host-ready + 无 evidence 证据 → blocking', () => {
    const result = validateSeamCatalog([makeSeamHostReadyNoEvidenceFixture()])
    expect(result.findings.some((f) => f.ruleId === SEAM_RULE_IDS.hostReadyNoEvidence)).toBe(true)
    expect(
      result.findings.filter((f) => f.ruleId === SEAM_RULE_IDS.hostReadyNoEvidence)[0]!.severity,
    ).toBe('blocking')
  })
})

// =============================================================================
// 2.4 版本兼容 helper
// =============================================================================

describe('plugin-capability-seam-catalog SemVer 兼容（2.4）', () => {
  it('严格 MAJOR.MINOR.PATCH 解析：合法三段通过，prerelease/非法拒绝', () => {
    expect(parseSeamVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(parseSeamVersion(' 0.0.0 ')).toEqual({ major: 0, minor: 0, patch: 0 })
    expect(parseSeamVersion('1.2.3-beta.1')).toBeNull()
    expect(parseSeamVersion('v1.2.3')).toBeNull()
    expect(parseSeamVersion('1.2')).toBeNull()
    expect(parseSeamVersion('1.2.3.4')).toBeNull()
    expect(parseSeamVersion('')).toBeNull()
  })

  it('exact：版本字符串相等 → compatible-exact；不等 → major mismatch', () => {
    const exact = checkSeamCompatibility({
      catalogVersion: '1.2.0',
      requestedVersion: '1.2.0',
      policy: 'exact',
    })
    expect(exact.compatible).toBe(true)
    expect(exact.reasonCode).toBe('compatible-exact')

    const diff = checkSeamCompatibility({
      catalogVersion: '1.2.1',
      requestedVersion: '1.2.0',
      policy: 'exact',
    })
    expect(diff.compatible).toBe(false)
    expect(diff.reasonCode).toBe('incompatible-major-mismatch')
  })

  it('same-major 前向兼容：catalog 1.3.0 可满足请求 1.2.0', () => {
    const r = checkSeamCompatibility({
      catalogVersion: '1.3.0',
      requestedVersion: '1.2.0',
      policy: 'same-major',
    })
    expect(r.compatible).toBe(true)
    expect(r.reasonCode).toBe('compatible-same-major')
  })

  it('same-major 边界：catalog 1.2.1 可满足请求 1.2.0', () => {
    const r = checkSeamCompatibility({
      catalogVersion: '1.2.1',
      requestedVersion: '1.2.0',
      policy: 'same-major',
    })
    expect(r.compatible).toBe(true)
  })

  it('请求未来 minor/patch → incompatible-requested-future', () => {
    const r = checkSeamCompatibility({
      catalogVersion: '1.1.0',
      requestedVersion: '1.2.0',
      policy: 'same-major',
    })
    expect(r.compatible).toBe(false)
    expect(r.reasonCode).toBe('incompatible-requested-future')
  })

  it('跨 major → incompatible-major-mismatch', () => {
    const r = checkSeamCompatibility({
      catalogVersion: '2.0.0',
      requestedVersion: '1.5.0',
      policy: 'same-major',
    })
    expect(r.compatible).toBe(false)
    expect(r.reasonCode).toBe('incompatible-major-mismatch')
  })

  it('非法输入 → incompatible-invalid-version', () => {
    const r = checkSeamCompatibility({
      catalogVersion: '1.0.0-beta',
      requestedVersion: '1.0.0',
      policy: 'same-major',
    })
    expect(r.compatible).toBe(false)
    expect(r.reasonCode).toBe('incompatible-invalid-version')
  })

  it('deprecated 无迁移 → incompatible-deprecated-no-migration', () => {
    const r = checkSeamCompatibility({
      catalogVersion: '2.0.0',
      requestedVersion: '2.0.0',
      policy: 'same-major',
      deprecated: { replacedBy: 'other.seam' },
    })
    expect(r.compatible).toBe(false)
    expect(r.reasonCode).toBe('incompatible-deprecated-no-migration')
    // 有 migrationRef 时允许
    const ok = checkSeamCompatibility({
      catalogVersion: '2.0.0',
      requestedVersion: '2.0.0',
      policy: 'exact',
      deprecated: { replacedBy: 'other.seam', migrationRef: 'docs/runbook/migrate.md' },
    })
    expect(ok.compatible).toBe(true)
  })

  it('未知 seam → resolveSeamRequest incompatible-unknown-seam（fail closed，不静默降级）', () => {
    const entries = makeSeamVersionCatalogFixture()
    const r = resolveSeamRequest(entries, 'unknown.seam', '1.0.0')
    expect(r.compatible).toBe(false)
    expect(r.reasonCode).toBe('incompatible-unknown-seam')
  })

  it('resolveSeamRequest：exact 命中优先；same-major 取最高兼容版本', () => {
    const entries = makeSeamVersionCatalogFixture()
    const exact = resolveSeamRequest(entries, 'server-query.readonly-provider', '1.3.2')
    expect(exact.compatible).toBe(true)
    expect(exact.reasonCode).toBe('compatible-exact')

    const same = resolveSeamRequest(entries, 'server-query.readonly-provider', '1.2.0')
    expect(same.compatible).toBe(true)
    expect(same.reasonCode).toBe('compatible-same-major')

    const future = resolveSeamRequest(entries, 'server-query.readonly-provider', '1.9.0')
    expect(future.compatible).toBe(false)
    expect(future.reasonCode).toBe('incompatible-requested-future')
  })

  it('version 比较：compareSeamVersions 稳定（非法版本视为最小）', () => {
    expect(compareSeamVersions('1.2.3', '1.2.2')).toBeGreaterThan(0)
    expect(compareSeamVersions('1.2.3', '1.10.0')).toBeLessThan(0)
    expect(compareSeamVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareSeamVersions('bad', '1.0.0')).toBeLessThan(0)
  })
})

// =============================================================================
// 2.6 确定性 / 归一化 / 排序 / 查找 / digest
// =============================================================================

describe('plugin-capability-seam-catalog 确定性（2.6）', () => {
  it('输入顺序变化不改变 normalized entries / findings / digest', () => {
    const a = [
      makeSeamFixture(),
      makeSeamSkillAdapterFixture(),
      makeSeamNotificationTemplateFixture(),
    ]
    const b = [a[2]!, a[0]!, a[1]!]
    const ra = validateSeamCatalog(a)
    const rb = validateSeamCatalog(b)
    expect(ra.digest).toBe(rb.digest)
    expect(JSON.stringify(ra.entries)).toBe(JSON.stringify(rb.entries))
    expect(JSON.stringify(ra.findings)).toBe(JSON.stringify(rb.findings))
  })

  it('normalizeSeamEntries 按键名+版本稳定排序（同 key 多版本升序）', () => {
    const entries = makeSeamVersionCatalogFixture()
    const normalized = normalizeSeamEntries(entries)
    const keys = normalized.map((e) => `${e.seamKey}@${e.seamVersion}`)
    expect(keys).toEqual([...keys].sort())
  })

  it('重复 key/version 不会被 lookup 任意选择（lookup 返回 null；resolve 判定 ambiguous）', () => {
    const entries = [makeSeamFixture(), makeSeamDuplicateFixture()]
    expect(findDuplicateSeamIdentities(entries)).toEqual(['server-query.readonly-provider@1.0.0'])
    expect(lookupSeamEntry(entries, 'server-query.readonly-provider', '1.0.0')).toBeNull()
    const resolved = resolveSeamRequest(entries, 'server-query.readonly-provider', '1.0.0')
    expect(resolved.compatible).toBe(false)
    expect(resolved.reasonCode).toBe('incompatible-ambiguous-identity')
  })

  it('digest 与 source hash 确定性且输入顺序无关', () => {
    const entries = makeSeamVersionCatalogFixture()
    const d1 = computeSeamCatalogDigest(entries)
    const d2 = computeSeamCatalogDigest([...entries].reverse())
    expect(d1).toBe(d2)
    expect(computeSeamSourceHash({ b: 1, a: 2 })).toBe(computeSeamSourceHash({ a: 2, b: 1 }))
  })

  it('函数不依赖时间/随机数/IO/网络：两次完整校验结果逐字节一致', () => {
    const entries = [makeSeamFixture(), makeSeamStateContradictionFixture()]
    const r1 = validateSeamCatalog(entries)
    const r2 = validateSeamCatalog(entries)
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
  })
})
