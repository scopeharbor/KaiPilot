/**
 * security-and-penetration-gate —— 共享契约聚焦测试（任务 2.4 / 2.6 / 3.x 的契约面）。
 *
 * 覆盖：枚举守卫与未知值拒绝、稳定 hash / stable serialize（不同键序等价对象同 hash）、
 * 低敏 sanitization（禁止键删除 + 值级 redaction）、catalog 校验（19 个 high-risk surface
 * 全覆盖 + owner capability + fixture pack + expected command + rule family）、
 * waiver 求值（warning 可 waiver / redline 拒绝）、报告 schema 校验。
 * 纯本地：零网络、零数据库、零 provider。
 */
import { describe, expect, it } from 'vitest'
import {
  SECURITY_GATE_CATALOG,
  SECURITY_ATTACK_SCENARIOS,
  SECURITY_FIXTURE_PACKS_BY_ID,
} from './security-and-penetration-gate-fixtures.js'
import {
  REQUIRED_SECURITY_HIGH_RISK_SURFACES,
  SECURITY_REDLINE_RULE_FAMILIES,
  aggregateSecurityReportStatus,
  computeSecuritySourceHash,
  containsSecuritySensitiveContent,
  evaluateSecurityWaiver,
  isKnownSecurityValue,
  isSecurityDomain,
  isSecurityGateStatus,
  isSecuritySeverity,
  makeSecurityCatalogGapFinding,
  normalizeSecurityGateStatus,
  normalizeSecuritySeverity,
  redactSecurityText,
  sanitizeSecurityEvidence,
  securityFnv1aHash,
  securityStableSerialize,
  validateSecurityCatalog,
  validateSecurityCatalogEntry,
  validateSecurityReportSchema,
  type SecurityFinding,
  type SecurityGateResult,
  type SecurityWaiver,
} from './security-and-penetration-gate.js'

describe('enum guards reject unknown values (2.4)', () => {
  it('security domain 守卫拒绝未知域', () => {
    expect(isSecurityDomain('authentication-session')).toBe(true)
    expect(isSecurityDomain('made-up-domain')).toBe(false)
    expect(isSecurityDomain(42)).toBe(false)
  })

  it('gate status 守卫拒绝未知状态', () => {
    expect(isSecurityGateStatus('blocked')).toBe(true)
    expect(isSecurityGateStatus('passed')).toBe(true)
    expect(isSecurityGateStatus('maybe')).toBe(false)
  })

  it('severity 守卫拒绝未知严重度', () => {
    expect(isSecuritySeverity('blocking')).toBe(true)
    expect(isSecuritySeverity('critical')).toBe(false)
  })

  it('未知值整体判定 isKnownSecurityValue=false，不得当作 passed', () => {
    expect(isKnownSecurityValue('tenant-leakage')).toBe(true)
    expect(isKnownSecurityValue('not-a-real-code')).toBe(false)
    expect(isKnownSecurityValue(null)).toBe(false)
  })

  it('normalize 函数把未知状态归一为 catalog_gap / warning，绝不伪造 passed', () => {
    expect(normalizeSecurityGateStatus('waived')).toBe('waived')
    expect(normalizeSecurityGateStatus('anything-else')).toBe('catalog_gap')
    expect(normalizeSecuritySeverity('info')).toBe('info')
    expect(normalizeSecuritySeverity('fatal')).toBe('warning')
  })
})

describe('deterministic hash & stable serialize (2.2 / spec Scenario Catalog hash is stable)', () => {
  it('不同对象键序产生相同 stable serialize 与 source hash', () => {
    const a = { z: 1, a: 'x', n: [3, 1, 2] }
    const b = { n: [3, 1, 2], a: 'x', z: 1 }
    const sa = securityStableSerialize(a)
    const sb = securityStableSerialize(b)
    expect(sa).toBe(sb)
    expect(computeSecuritySourceHash(a)).toBe(computeSecuritySourceHash(b))
  })

  it('fnv1a hash 稳定且与键序无关', () => {
    expect(securityFnv1aHash('security-gate')).toBe(securityFnv1aHash('security-gate'))
    expect(securityFnv1aHash('a')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('数组顺序参与 hash（顺序不同 hash 不同）', () => {
    expect(securityStableSerialize([1, 2])).not.toBe(securityStableSerialize([2, 1]))
  })
})

describe('low-sensitive sanitization (2.3 / spec Requirement 5)', () => {
  it('文本 redaction 移除 JWT/secret/auth header/saml xml/绝对路径', () => {
    const r = redactSecurityText(
      'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U\n-----BEGIN PRIVATE KEY-----\nMIIE\n<x>Authorization: Bearer sk-abc123def456ghi789jkl</x>',
    )
    expect(r.redactedCount).toBeGreaterThan(0)
    expect(r.text).not.toContain('eyJhbGci')
    expect(r.text).not.toContain('PRIVATE KEY')
    expect(r.text).not.toContain('sk-abc123')
    expect(r.text).toContain('[REDACTED:')
  })

  it('containsSecuritySensitiveContent 探测敏感文本', () => {
    expect(containsSecuritySensitiveContent('api key: sk-abcdefghijklmno123456')).toBe(true)
    expect(containsSecuritySensitiveContent('api key: short')).toBe(false)
    expect(containsSecuritySensitiveContent('普通中文摘要')).toBe(false)
  })

  it('对象 sanitization 删除禁止键并 redact 值', () => {
    const input = {
      gateId: 'x',
      summary: 'ok',
      apiKey: 'sk-abcdefghijklmnop123456',
      nested: { password: 'p@ss', note: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig' },
      safe: 'kept',
    }
    const { value, droppedKeys, redactedCount } = sanitizeSecurityEvidence(input)
    expect(droppedKeys).toContain('apiKey')
    expect(droppedKeys).toContain('password')
    expect(redactedCount).toBeGreaterThan(0)
    const v = value as Record<string, unknown>
    expect(v.apiKey).toBeUndefined()
    expect((v.nested as Record<string, unknown>).password).toBeUndefined()
    expect(v.safe).toBe('kept')
  })

  it('sanitization 处理循环引用不崩溃', () => {
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj
    const { value } = sanitizeSecurityEvidence(obj)
    expect(value).toBeDefined()
  })
})

describe('gate catalog coverage (2.6 / spec Requirement 2)', () => {
  it('全部 required high-risk surfaces 都有 catalog 条目', () => {
    const covered = new Set(SECURITY_GATE_CATALOG.map((e) => e.domain))
    for (const surface of REQUIRED_SECURITY_HIGH_RISK_SURFACES) {
      expect(covered.has(surface as (typeof REQUIRED_SECURITY_HIGH_RISK_SURFACES)[number])).toBe(
        true,
      )
    }
    expect(covered.size).toBe(REQUIRED_SECURITY_HIGH_RISK_SURFACES.length)
  })

  it('每个条目都声明 owner capability / fixture pack / expected command / rule family / authorization boundary', () => {
    for (const entry of SECURITY_GATE_CATALOG) {
      expect(entry.ownerCapability.trim().length).toBeGreaterThan(0)
      expect(entry.defaultFixturePack.trim().length).toBeGreaterThan(0)
      expect(entry.expectedCommand?.trim().length ?? 0).toBeGreaterThan(0)
      expect(SECURITY_REDLINE_RULE_FAMILIES).toContain(entry.blockingRuleFamily)
      expect([
        'local-only',
        'fixture-mock',
        'requires-user-authorization',
        'no-external',
      ]).toContain(entry.authorizationBoundary)
      expect(entry.requiredEvidence.length).toBeGreaterThan(0)
      expect(entry.allowedReasonCodes.length).toBeGreaterThan(0)
    }
  })

  it('catalog 校验通过（无 issue）', () => {
    const issues = validateSecurityCatalog(SECURITY_GATE_CATALOG)
    expect(issues).toEqual([])
  })

  it('catalog 校验能发现缺 owner capability 的坏条目', () => {
    const bad = validateSecurityCatalogEntry({
      ...SECURITY_GATE_CATALOG[0]!,
      ownerCapability: '',
    })
    expect(
      bad.some((i) => i.kind === 'missing-owner-capability' || i.kind === 'missing-field'),
    ).toBe(true)
  })

  it('catalog 校验能发现未知 domain', () => {
    const bad = validateSecurityCatalogEntry({
      ...SECURITY_GATE_CATALOG[0]!,
      domain: 'not-a-domain' as never,
    })
    expect(bad.some((i) => i.kind === 'unknown-domain')).toBe(true)
  })

  it('catalog_gap finding 是 blocking 且 subject path 标注 domain', () => {
    const f = makeSecurityCatalogGapFinding('some-new-surface')
    expect(f.severity).toBe('blocking')
    expect(f.status).toBe('blocked')
    expect(f.subjectPath).toBe('domain:some-new-surface')
    expect(f.ruleId).toBe('SEC-CAT-001')
  })
})

describe('fixture attack packs (2.5)', () => {
  it('17 类 attack kind 全覆盖', () => {
    const kinds = new Set(SECURITY_ATTACK_SCENARIOS.map((f) => f.kind))
    expect(kinds.size).toBe(17)
  })

  it('每个 attack fixture 声明 pack、离线默认与期望结局', () => {
    for (const f of SECURITY_ATTACK_SCENARIOS) {
      expect(f.fixturePack.trim().length).toBeGreaterThan(0)
      expect(f.offlineOnly).toBe(true)
      expect(f.forbiddenFields.length).toBeGreaterThan(0)
      expect([
        'non-leaking-failure',
        'scoped-success',
        'denied-before-side-effect',
        'blocked',
        'waived',
      ]).toContain(f.expectedOutcome)
    }
  })

  it('pack 索引覆盖全部 fixture', () => {
    let total = 0
    for (const list of SECURITY_FIXTURE_PACKS_BY_ID.values()) {
      total += list.length
    }
    expect(total).toBe(SECURITY_ATTACK_SCENARIOS.length)
  })

  it('fixture 的 name/description 不含敏感材料（低敏纪律）', () => {
    const sensitive = [
      'Bearer ',
      'eyJ',
      'sk-',
      'PRIVATE KEY',
      'SAMLResponse',
      'userName',
      'organizationId=',
    ]
    for (const f of SECURITY_ATTACK_SCENARIOS) {
      const text = `${f.name} ${f.description} ${f.notes ?? ''}`
      for (const s of sensitive) {
        expect(text.includes(s)).toBe(false)
      }
    }
  })
})

describe('waiver evaluation (3.7/3.8 contract face)', () => {
  const baseWaiver: SecurityWaiver = {
    waiverId: 'w-1',
    ruleId: 'SEC-WARN-001',
    subjectPath: 'apps/backend/app/services/x.ts',
    owner: 'owner@example.com',
    reason: '已知低风险缺口',
    expiresAt: '2099-01-01T00:00:00.000Z',
    mitigation: '后续 change 补测试',
    evidenceRefs: [{ kind: 'source-fallback', path: 'openspec/changes/x/design.md' }],
    approvalContext: '归档评审',
  }

  const warningFinding: SecurityFinding = {
    findingId: 'f-warn',
    ruleId: 'SEC-WARN-001',
    code: 'missing-evidence',
    severity: 'warning',
    status: 'warned',
    subjectPath: 'apps/backend/app/services/x.ts',
    evidenceRefs: [],
    sourceHash: 'h',
    summary: '缺证据',
  }

  const redlineFinding: SecurityFinding = {
    findingId: 'f-red',
    ruleId: 'SEC-RL-001',
    code: 'redline-tenant-leakage',
    severity: 'blocking',
    status: 'blocked',
    subjectPath: 'apps/backend/app/services/x.ts',
    evidenceRefs: [],
    sourceHash: 'h',
    summary: '跨租泄露',
  }

  it('warning finding + 完整 waiver → accepted', () => {
    const r = evaluateSecurityWaiver(warningFinding, baseWaiver)
    expect(r.accepted).toBe(true)
    expect(r.rejected).toBe(false)
  })

  it('redline finding 不可 waiver（即使 waiver 完整）', () => {
    const r = evaluateSecurityWaiver(redlineFinding, { ...baseWaiver, ruleId: 'SEC-RL-001' })
    expect(r.accepted).toBe(false)
    expect(r.rejected).toBe(true)
    expect(r.reason).toContain('redline')
  })

  it('blocking severity 不可 waiver', () => {
    const r = evaluateSecurityWaiver(
      { ...warningFinding, severity: 'blocking', status: 'blocked' },
      baseWaiver,
    )
    expect(r.accepted).toBe(false)
  })

  it('ruleId / subjectPath 不匹配拒绝', () => {
    expect(
      evaluateSecurityWaiver(warningFinding, { ...baseWaiver, ruleId: 'OTHER' }).accepted,
    ).toBe(false)
    expect(
      evaluateSecurityWaiver(warningFinding, { ...baseWaiver, subjectPath: 'elsewhere.ts' })
        .accepted,
    ).toBe(false)
  })

  it('缺 owner/reason/mitigation/evidenceRefs/approvalContext 拒绝', () => {
    expect(evaluateSecurityWaiver(warningFinding, { ...baseWaiver, owner: '' }).accepted).toBe(
      false,
    )
    expect(evaluateSecurityWaiver(warningFinding, { ...baseWaiver, reason: '' }).accepted).toBe(
      false,
    )
    expect(evaluateSecurityWaiver(warningFinding, { ...baseWaiver, mitigation: '' }).accepted).toBe(
      false,
    )
    expect(
      evaluateSecurityWaiver(warningFinding, { ...baseWaiver, evidenceRefs: [] }).accepted,
    ).toBe(false)
    expect(
      evaluateSecurityWaiver(warningFinding, { ...baseWaiver, approvalContext: '' }).accepted,
    ).toBe(false)
  })

  it('过期 waiver 拒绝', () => {
    const r = evaluateSecurityWaiver(
      warningFinding,
      { ...baseWaiver, expiresAt: '2020-01-01T00:00:00.000Z' },
      new Date('2026-01-01T00:00:00.000Z'),
    )
    expect(r.accepted).toBe(false)
    expect(r.reason).toContain('过期')
  })
})

describe('report aggregation & schema (2.4)', () => {
  const gate = (status: SecurityGateResult['status']): SecurityGateResult => ({
    gateId: 'g',
    domain: 'authentication-session',
    status,
    severity: status === 'blocked' ? 'blocking' : 'warning',
    exitCode: 0,
    findings: [],
    evidenceRefs: [],
    durationMs: 0,
  })

  it('任一 blocked → 报告 blocked', () => {
    expect(aggregateSecurityReportStatus([gate('passed'), gate('blocked')])).toBe('blocked')
  })
  it('无 blocked 但有 warned → warned', () => {
    expect(aggregateSecurityReportStatus([gate('passed'), gate('warned')])).toBe('warned')
  })
  it('degraded/skipped 优先于 passed', () => {
    expect(aggregateSecurityReportStatus([gate('passed'), gate('degraded')])).toBe('degraded')
    expect(aggregateSecurityReportStatus([gate('skipped')])).toBe('degraded')
  })
  it('全 passed → passed', () => {
    expect(aggregateSecurityReportStatus([gate('passed'), gate('passed')])).toBe('passed')
  })

  it('报告 schema 校验：合法对象通过，缺字段报错', () => {
    const valid = {
      schemaVersion: '1.0',
      reportId: 'r1',
      generatedAt: '2026-08-16T00:00:00.000Z',
      changeName: 'x',
      commit: 'abc',
      status: 'passed',
      environment: { platform: 'win32', nodeVersion: '22', commit: 'abc', graphFreshness: 'fresh' },
      observation: { graphFreshness: 'fresh', sourceFallbackRefs: [] },
      gates: [],
      findings: [],
      evidenceRefs: [],
      waiverRefs: [],
      degraded: [],
      sourceFallback: { used: false, refs: [], graphIncomplete: false },
      redactionSummary: { redactedCount: 0, reasons: {} },
    }
    expect(validateSecurityReportSchema(valid)).toEqual([])
    expect(validateSecurityReportSchema({ ...valid, schemaVersion: '2.0' }).length).toBeGreaterThan(
      0,
    )
    expect(validateSecurityReportSchema({ ...valid, gates: 'nope' }).length).toBeGreaterThan(0)
    expect(validateSecurityReportSchema(null)).toEqual(['报告不是对象'])
  })
})
