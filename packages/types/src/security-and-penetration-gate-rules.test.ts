/**
 * security-and-penetration-gate-rules —— 规则引擎聚焦测试（任务 3.2/3.4/3.6/3.8/3.10）。
 *
 * 覆盖：catalog 完整性（缺失 surface → SEC-CAT-001 blocking）、attack 覆盖缺类
 * （SEC-CAT-003）、finding 确定性（同输入同 ID/severity/status/subjectPath）、
 * 文本 redline（AI 自动执行 / 客户端权威声明 / 未授权外部动作 / 无确认正式写入；
 * 否定豁免与元描述豁免）、graph freshness（空图谱+无 fallback → blocking；
 * 缺 fallback 记录 → warning）、waiver（warning 可 waiver / redline 拒绝）。
 * 纯本地：零网络、零数据库、零 provider。
 */
import { describe, expect, it } from 'vitest'
import {
  SECURITY_ATTACK_SCENARIOS,
  SECURITY_GATE_CATALOG,
} from './security-and-penetration-gate-fixtures.js'
import {
  ATTACK_KINDS_REQUIRED,
  SEC_RULE_IDS,
  applySecurityWaivers,
  checkArchiveSecurityEvidence,
  checkAttackCoverageCompleteness,
  checkHandleReplayScenarios,
  checkSecurityCatalogCompleteness,
  checkTenantNegativeScenarios,
  evaluateSecurityGate,
  makeSecurityFinding,
  makeSecurityFindingId,
  scanArtifactRedlines,
  sortSecurityFindings,
  validateGraphFreshness,
  type SecurityArtifactSnapshot,
  type SecurityGateEvaluationInput,
  type SecurityWaiver,
} from './security-and-penetration-gate-rules.js'
import type { SecurityFinding } from './security-and-penetration-gate.js'

const snapshot = (artifacts: { path: string; content: string }[]): SecurityArtifactSnapshot => ({
  changeName: 'v3-test-change',
  artifacts,
})

const noEvidenceRefs = [] as SecurityFinding['evidenceRefs']

describe('catalog completeness (3.1/3.2)', () => {
  it('已覆盖 domain 不产 finding', () => {
    const findings = checkSecurityCatalogCompleteness(
      ['authentication-session'],
      SECURITY_GATE_CATALOG,
    )
    expect(findings).toEqual([])
  })

  it('缺失 high-risk surface → SEC-CAT-001 blocking', () => {
    const findings = checkSecurityCatalogCompleteness(
      ['not-registered-domain'],
      SECURITY_GATE_CATALOG,
    )
    expect(findings.length).toBe(1)
    expect(findings[0]!.ruleId).toBe(SEC_RULE_IDS.catalogGap)
    expect(findings[0]!.severity).toBe('blocking')
    expect(findings[0]!.status).toBe('blocked')
  })

  it('未知 domain 也报 gap 且 blocking', () => {
    const findings = checkSecurityCatalogCompleteness(['made-up-surface'], SECURITY_GATE_CATALOG)
    expect(findings[0]!.severity).toBe('blocking')
    expect(findings[0]!.subjectPath).toBe('domain:made-up-surface')
  })

  it('claimedDomains 去重（重复声明只产一条）', () => {
    const findings = checkSecurityCatalogCompleteness(['x', 'x'], SECURITY_GATE_CATALOG)
    expect(findings.length).toBe(1)
  })

  it('attack kind 全覆盖（17 类全部有 fixture）', () => {
    const findings = checkAttackCoverageCompleteness(
      SECURITY_ATTACK_SCENARIOS,
      ATTACK_KINDS_REQUIRED,
    )
    expect(findings).toEqual([])
  })

  it('缺 attack kind → SEC-CAT-003 blocking', () => {
    const findings = checkAttackCoverageCompleteness([], ATTACK_KINDS_REQUIRED)
    expect(findings.length).toBe(ATTACK_KINDS_REQUIRED.length)
    expect(findings[0]!.ruleId).toBe(SEC_RULE_IDS.attackCoverageGap)
    expect(findings[0]!.severity).toBe('blocking')
  })

  it('两组织夹具期望结局必须是 non-leaking / denied-before-side-effect', () => {
    const bad = checkTenantNegativeScenarios(
      SECURITY_ATTACK_SCENARIOS.map((s) =>
        s.twoOrgIntent ? { ...s, expectedOutcome: 'scoped-success' as const } : s,
      ),
    )
    expect(bad.length).toBeGreaterThan(0)
    expect(bad[0]!.ruleId).toBe('SEC-TNT-001')
    expect(bad[0]!.severity).toBe('blocking')
    expect(checkTenantNegativeScenarios(SECURITY_ATTACK_SCENARIOS)).toEqual([])
  })

  it('handle replay 夹具期望结局必须 denied-before-side-effect', () => {
    const bad = checkHandleReplayScenarios(
      SECURITY_ATTACK_SCENARIOS.map((s) =>
        s.kind === 'handle-replay' ? { ...s, expectedOutcome: 'non-leaking-failure' as const } : s,
      ),
    )
    expect(bad.length).toBeGreaterThan(0)
    expect(bad[0]!.ruleId).toBe('SEC-HND-001')
    expect(checkHandleReplayScenarios(SECURITY_ATTACK_SCENARIOS)).toEqual([])
  })
})

describe('finding determinism (3.3/3.4)', () => {
  it('同输入两次创建产生相同 findingId/severity/status/subjectPath', () => {
    const input = {
      ruleId: SEC_RULE_IDS.tenantLeakage,
      code: 'redline-tenant-leakage' as const,
      severity: 'blocking' as const,
      subjectPath: 'apps/backend/app/services/x.ts',
      summary: '跨租泄露',
    }
    const a = makeSecurityFinding(input)
    const b = makeSecurityFinding(input)
    expect(a.findingId).toBe(b.findingId)
    expect(a.severity).toBe(b.severity)
    expect(a.status).toBe(b.status)
    expect(a.subjectPath).toBe(b.subjectPath)
    expect(a.sourceHash).toBe(b.sourceHash)
  })

  it('不同 subjectPath 产生不同 findingId', () => {
    const a = makeSecurityFindingId(SEC_RULE_IDS.tenantLeakage, 'a.ts', 'h')
    const b = makeSecurityFindingId(SEC_RULE_IDS.tenantLeakage, 'b.ts', 'h')
    expect(a).not.toBe(b)
  })

  it('稳定排序（ruleId → subjectPath → findingId）', () => {
    const findings = [
      makeSecurityFinding({
        ruleId: 'SEC-RL-002',
        code: 'redline-client-authoritative-claim',
        severity: 'blocking',
        subjectPath: 'z.ts',
        summary: 'x',
      }),
      makeSecurityFinding({
        ruleId: 'SEC-RL-001',
        code: 'redline-ai-auto-execution',
        severity: 'blocking',
        subjectPath: 'a.ts',
        summary: 'x',
      }),
    ]
    const sorted = sortSecurityFindings(findings)
    expect(sorted.map((f) => f.ruleId)).toEqual(['SEC-RL-001', 'SEC-RL-002'])
  })

  it('evidenceRefs 去重排序', () => {
    const f = makeSecurityFinding({
      ruleId: 'SEC-EV-001',
      code: 'missing-evidence',
      severity: 'warning',
      subjectPath: 'x.ts',
      summary: 's',
      evidenceRefs: [
        { kind: 'source-fallback', path: 'b.md' },
        { kind: 'source-fallback', path: 'a.md' },
        { kind: 'source-fallback', path: 'b.md' },
      ],
    })
    expect(f.evidenceRefs.map((r) => r.path)).toEqual(['a.md', 'b.md'])
  })
})

describe('artifact redline scan (3.5/3.6)', () => {
  it('AI 自动执行声明 → SEC-RL-001 blocking', () => {
    const findings = scanArtifactRedlines(
      snapshot([
        {
          path: 'openspec/changes/v3-x/tasks.md',
          content: '实现 AI 直接落库生成的项目计划，无需用户确认',
        },
      ]),
    )
    expect(
      findings.some((f) => f.ruleId === SEC_RULE_IDS.aiAutoExecution && f.severity === 'blocking'),
    ).toBe(true)
  })

  it('客户端组织声明当权威 → SEC-RL-002 blocking', () => {
    const findings = scanArtifactRedlines(
      snapshot([
        {
          path: 'openspec/changes/v3-x/design.md',
          content: '使用请求体携带的 organizationId 作为租户上下文权威来源',
        },
      ]),
    )
    expect(
      findings.some(
        (f) => f.ruleId === SEC_RULE_IDS.clientAuthoritativeClaim && f.severity === 'blocking',
      ),
    ).toBe(true)
  })

  it('未授权真实外部动作 → SEC-RL-005 blocking', () => {
    const findings = scanArtifactRedlines(
      snapshot([
        {
          path: 'openspec/changes/v3-x/tasks.md',
          content: '联调真实 IdP 并执行真实 OAuth token exchange smoke',
        },
      ]),
    )
    expect(
      findings.some(
        (f) => f.ruleId === SEC_RULE_IDS.unauthorizedExternalAction && f.severity === 'blocking',
      ),
    ).toBe(true)
  })

  it('否定/豁免语境不产 finding（fixture-first、停止在边界）', () => {
    const findings = scanArtifactRedlines(
      snapshot([
        {
          path: 'openspec/changes/v3-x/design.md',
          content:
            '默认不调用真实 provider，停在 fixture/mock 可验证边界；禁止未经用户授权执行真实外部动作',
        },
      ]),
    )
    expect(findings.filter((f) => f.severity === 'blocking')).toEqual([])
  })

  it('元描述行（描述门禁检测对象）不产 blocking', () => {
    const findings = scanArtifactRedlines(
      snapshot([
        {
          path: 'openspec/changes/v3-x/specs/security/spec.md',
          content:
            'security gate MUST block AI auto-execution without confirmation（描述检测对象）',
        },
      ]),
    )
    expect(findings.filter((f) => f.severity === 'blocking')).toEqual([])
  })

  it('redline finding 不可被静默降级（severity 恒 blocking）', () => {
    const findings = scanArtifactRedlines(
      snapshot([{ path: 'openspec/changes/v3-x/tasks.md', content: 'AI 直接落库无需确认' }]),
    )
    const red = findings.filter((f) => f.ruleId === SEC_RULE_IDS.aiAutoExecution)
    expect(red.length).toBeGreaterThan(0)
    for (const f of red) {
      expect(f.severity).toBe('blocking')
      expect(f.status).toBe('blocked')
    }
  })
})

describe('graph freshness / fallback (3.9/3.10)', () => {
  it('空图谱结果 + 无 fallback → SEC-OBS-001 blocking（空结果不得当不存在证明）', () => {
    const findings = validateGraphFreshness({
      graph: { freshness: 'unknown', knownIncomplete: true, fallbackEvidenceRefs: [] },
    })
    expect(
      findings.some(
        (f) => f.ruleId === SEC_RULE_IDS.graphAbsenceConclusion && f.severity === 'blocking',
      ),
    ).toBe(true)
  })

  it('图谱陈旧但记录了 fallback 证据 → 不产 blocking', () => {
    const findings = validateGraphFreshness({
      graph: {
        freshness: 'stale',
        knownIncomplete: true,
        fallbackEvidenceRefs: [
          { kind: 'source-fallback', path: 'openspec/changes/v3-x/observation.md' },
        ],
      },
    })
    expect(findings.some((f) => f.ruleId === SEC_RULE_IDS.graphAbsenceConclusion)).toBe(false)
  })

  it('工件讨论图谱但未记录 fallback → SEC-OBS-002 warning', () => {
    const findings = validateGraphFreshness({
      graph: { freshness: 'fresh', fallbackEvidenceRefs: [] },
      artifactSnapshot: snapshot([
        {
          path: 'openspec/changes/v3-x/observation-and-inventory.md',
          content: 'codebase-memory search_graph 无结果',
        },
      ]),
    })
    expect(
      findings.some(
        (f) => f.ruleId === SEC_RULE_IDS.graphMissingFallback && f.severity === 'warning',
      ),
    ).toBe(true)
  })
})

describe('archive security evidence (6.2)', () => {
  it('无证据声明 → SEC-EV-001 blocking', () => {
    const findings = checkArchiveSecurityEvidence({
      changeName: 'v3-x',
      claimedDomains: ['authentication-session'],
    })
    expect(findings[0]!.ruleId).toBe(SEC_RULE_IDS.missingSecurityEvidence)
    expect(findings[0]!.severity).toBe('blocking')
  })

  it('non-applicability 说明 → 不产 finding', () => {
    const findings = checkArchiveSecurityEvidence({
      changeName: 'v3-x',
      claimedDomains: ['authentication-session'],
      archiveSecurityEvidence: { nonApplicabilityNote: '本 change 不触及认证/租户/外部边界' },
    })
    expect(findings).toEqual([])
  })

  it('gate 命令 + strict validate → 不产 finding', () => {
    const findings = checkArchiveSecurityEvidence({
      changeName: 'v3-x',
      claimedDomains: ['authentication-session'],
      archiveSecurityEvidence: {
        gateCommand: 'pnpm security:gate -- --change v3-x',
        strictValidate: true,
      },
    })
    expect(findings).toEqual([])
  })

  it('缺 gate 命令 → warning', () => {
    const findings = checkArchiveSecurityEvidence({
      changeName: 'v3-x',
      claimedDomains: [],
      archiveSecurityEvidence: { strictValidate: true },
    })
    expect(findings[0]!.severity).toBe('warning')
  })
})

describe('waiver application (3.7/3.8)', () => {
  const warningFinding: SecurityFinding = {
    findingId: 'f-warn',
    ruleId: 'SEC-EV-001',
    code: 'missing-evidence',
    severity: 'warning',
    status: 'warned',
    subjectPath: 'apps/backend/app/services/x.ts',
    evidenceRefs: noEvidenceRefs,
    sourceHash: 'h',
    summary: '缺证据',
  }
  const redlineFinding: SecurityFinding = {
    findingId: 'f-red',
    ruleId: SEC_RULE_IDS.tenantLeakage,
    code: 'redline-tenant-leakage',
    severity: 'blocking',
    status: 'blocked',
    subjectPath: 'apps/backend/app/services/x.ts',
    evidenceRefs: noEvidenceRefs,
    sourceHash: 'h',
    summary: '跨租泄露',
  }

  const validWaiver: SecurityWaiver = {
    waiverId: 'w-1',
    ruleId: 'SEC-EV-001',
    subjectPath: 'apps/backend/app/services/x.ts',
    owner: 'owner@example.com',
    reason: '已知低风险缺口',
    expiresAt: '2099-01-01T00:00:00.000Z',
    mitigation: '后续 change 补测试',
    evidenceRefs: [{ kind: 'source-fallback', path: 'design.md' }],
    approvalContext: '归档评审',
  }

  it('warning finding + 完整 waiver → status=waived 且保留在输出', () => {
    const { findings, rejectedWaiverFindings } = applySecurityWaivers(
      [warningFinding],
      [validWaiver],
    )
    expect(rejectedWaiverFindings).toEqual([])
    expect(findings[0]!.status).toBe('waived')
    expect(findings[0]!.waiverRef).toBe('w-1')
    expect(findings.length).toBe(1)
  })

  it('redline waiver → 拒绝并产生 SEC-WVR-001 blocking，原 finding 保持 blocked', () => {
    const { findings, rejectedWaiverFindings } = applySecurityWaivers(
      [redlineFinding],
      [{ ...validWaiver, ruleId: SEC_RULE_IDS.tenantLeakage }],
    )
    expect(
      rejectedWaiverFindings.some((f) => f.ruleId === 'SEC-WVR-001' && f.severity === 'blocking'),
    ).toBe(true)
    const kept = findings.find((f) => f.findingId === redlineFinding.findingId)
    expect(kept!.status).toBe('blocked')
  })

  it('waiver 不完整（缺 owner/expiry）→ 不应用，保持 warned', () => {
    const { findings } = applySecurityWaivers(
      [warningFinding],
      [{ ...validWaiver, owner: '', expiresAt: undefined }],
    )
    expect(findings[0]!.status).toBe('warned')
  })

  it('过期 waiver → 不应用', () => {
    const { findings } = applySecurityWaivers(
      [warningFinding],
      [{ ...validWaiver, expiresAt: '2020-01-01T00:00:00.000Z' }],
      new Date('2026-01-01T00:00:00.000Z'),
    )
    expect(findings[0]!.status).toBe('warned')
  })
})

describe('evaluateSecurityGate 总入口', () => {
  const baseInput: SecurityGateEvaluationInput = {
    changeName: 'v3-x',
    claimedDomains: ['authentication-session'],
    catalogEntries: SECURITY_GATE_CATALOG,
    attackScenarios: SECURITY_ATTACK_SCENARIOS,
    archiveSecurityEvidence: {
      gateCommand: 'pnpm security:gate -- --change v3-x',
      strictValidate: true,
    },
    graph: {
      freshness: 'fresh',
      fallbackEvidenceRefs: [{ kind: 'source-fallback', path: 'observation.md' }],
    },
  }

  it('干净输入 → status=passed，零 blocking/warning', () => {
    const result = evaluateSecurityGate(baseInput)
    expect(result.status).toBe('passed')
    expect(result.blockingCount).toBe(0)
    expect(result.warningCount).toBe(0)
  })

  it('缺失 surface 覆盖 → blocked', () => {
    const result = evaluateSecurityGate({ ...baseInput, claimedDomains: ['new-surface-xyz'] })
    expect(result.status).toBe('blocked')
    expect(result.blockingCount).toBeGreaterThan(0)
  })

  it('无归档证据 → blocked', () => {
    const result = evaluateSecurityGate({ ...baseInput, archiveSecurityEvidence: undefined })
    expect(result.status).toBe('blocked')
    expect(result.blockingCount).toBeGreaterThan(0)
  })

  it('文本 redline（未授权外部动作）→ blocked', () => {
    const result = evaluateSecurityGate({
      ...baseInput,
      artifactSnapshot: snapshot([
        { path: 'openspec/changes/v3-x/tasks.md', content: '执行真实 webhook 外发 smoke 验证' },
      ]),
    })
    expect(result.status).toBe('blocked')
    expect(result.findings.some((f) => f.ruleId === SEC_RULE_IDS.unauthorizedExternalAction)).toBe(
      true,
    )
  })

  it('无证据 warning 可 waiver → warned 降至 waived，不产 blocking', () => {
    const result = evaluateSecurityGate({
      ...baseInput,
      archiveSecurityEvidence: { strictValidate: true },
      waivers: [
        {
          waiverId: 'w-1',
          ruleId: SEC_RULE_IDS.missingSecurityEvidence,
          subjectPath: 'change:v3-x',
          owner: 'owner@example.com',
          reason: '已知缺口',
          expiresAt: '2099-01-01T00:00:00.000Z',
          mitigation: '后续补齐',
          evidenceRefs: [{ kind: 'source-fallback', path: 'design.md' }],
          approvalContext: '归档评审',
        },
      ],
    })
    expect(result.status).toBe('warned')
    expect(result.findings.some((f) => f.status === 'waived')).toBe(true)
  })
})
