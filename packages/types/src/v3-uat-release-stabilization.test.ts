/**
 * v3-uat-release-stabilization —— 发布稳定化契约单测（任务 2.3/2.4，并覆盖 3.3/3.6/5.2~5.5）。
 *
 * 纯函数测试：triage 归一化 / release-ready 阻塞规则 / 低敏证据校验 / 必填工件检测 /
 * sanitizer 拒敏 / 门禁可见性 / 专项门禁不得冒充 passed / 授权门分类与未授权不触发真实 provider。
 * 全部确定性 fixture，无网络/数据库/provider。
 */
import { describe, expect, it } from 'vitest'
import {
  AUTHORIZATION_GATES,
  RELEASE_CRITICAL_WORKFLOWS,
  REQUIRED_MANIFEST_GATE_SLOTS,
  REQUIRED_STABILIZATION_ARTIFACTS,
  SPECIALIZED_GATE_IDS,
  assertNoRealProviderInvocation,
  assertUnauthorizedActionEvidence,
  classifyAuthorizationGate,
  countUatGateStatuses,
  deriveEvidenceManifestFreshness,
  detectMissingRequiredArtifacts,
  evaluateStabilization,
  isUatReleaseReady,
  makeAuthorizedRealVerificationTemplate,
  makeStabilizationIssue,
  normalizeTriageCategory,
  sanitizeUatEvidenceSummary,
  summarizeUatFindings,
  validateEvidenceLowSensitive,
  validateEvidenceManifest,
  validateScopeLedger,
  validateUatMatrix,
} from './v3-uat-release-stabilization.js'
import {
  makeAuthorizationGatedStabilizationInput,
  makeBlockedStabilizationInput,
  makeEvidenceManifestFixture,
  makeMissingArtifactStabilizationInput,
  makeMissingSpecializedGateStabilizationInput,
  makeMissingWorkflowScenarioInput,
  makePassingStabilizationInput,
  makeScopeLedgerFixture,
  makeStaleScopeStabilizationInput,
  makeTasksIncompleteStabilizationInput,
  makeUatMatrixFixture,
  makeUnauthorizedActionInput,
} from './v3-uat-release-stabilization-fixtures.js'

const FIXED_NOW = new Date('2026-08-16T12:00:00.000Z')

describe('triage 类别归一化（2.3）', () => {
  it('别名映射到规范类别', () => {
    expect(normalizeTriageCategory('blocking')).toBe('release-blocking')
    expect(normalizeTriageCategory('Blocking')).toBe('release-blocking')
    expect(normalizeTriageCategory('release blocker')).toBe('release-blocking')
    expect(normalizeTriageCategory('known issue')).toBe('known-issue')
    expect(normalizeTriageCategory('deferral')).toBe('deferred')
    expect(normalizeTriageCategory('auth-gated')).toBe('authorization-gated')
    expect(normalizeTriageCategory('excluded')).toBe('out-of-scope')
    expect(normalizeTriageCategory('accepted')).toBe('accepted-risk')
  })

  it('规范类别原样通过；未知输入返回 undefined；空白返回 undefined', () => {
    for (const category of [
      'release-blocking',
      'known-issue',
      'deferred',
      'authorization-gated',
      'out-of-scope',
      'accepted-risk',
    ]) {
      expect(normalizeTriageCategory(category)).toBe(category)
    }
    expect(normalizeTriageCategory('unknown-category')).toBeUndefined()
    expect(normalizeTriageCategory('   ')).toBeUndefined()
  })
})

describe('scope ledger 校验（1.4）', () => {
  it('fresh 且完整 → 零 issue', () => {
    expect(validateScopeLedger(makeScopeLedgerFixture(), FIXED_NOW)).toEqual([])
  })

  it('stale capture（> 7 天）→ blocking stale-capture', () => {
    const issues = validateScopeLedger(
      makeScopeLedgerFixture({
        capture: { ...makeScopeLedgerFixture().capture, capturedAt: '2020-01-01' },
      }),
      FIXED_NOW,
    )
    expect(issues.some((i) => i.kind === 'stale-capture' && i.severity === 'blocking')).toBe(true)
  })

  it('V2.5 release map 不得作为 V3 authority → blocking v25-map-as-authority', () => {
    const ledger = makeScopeLedgerFixture({
      authorityNote:
        '本 run 以 docs/v2-v3/planning/v2.5-release-map.md 作为 V3 release authority。',
    })
    const issues = validateScopeLedger(ledger, FIXED_NOW)
    expect(issues.some((i) => i.kind === 'v25-map-as-authority' && i.severity === 'blocking')).toBe(
      true,
    )
  })

  it('authorityRefs 引用 V2.5 map 同样触发', () => {
    const ledger = makeScopeLedgerFixture({
      authorityRefs: ['docs/v2-v3/planning/v2.5-release-map.md'],
    })
    const issues = validateScopeLedger(ledger, FIXED_NOW)
    expect(issues.some((i) => i.kind === 'v25-map-as-authority')).toBe(true)
  })

  it('缺必填字段 / 非法状态 / 未记录 release map 缺口 → 对应 issue', () => {
    const ledger = makeScopeLedgerFixture({
      capture: { ...makeScopeLedgerFixture().capture, openspecListRef: '' },
      v3ReleaseMapGap: false,
      entries: [
        { id: 'bad', label: '缺状态条目' } as never,
        { id: 'x', label: '非法状态', status: 'unknown' as never },
      ],
    })
    const issues = validateScopeLedger(ledger, FIXED_NOW)
    expect(issues.some((i) => i.kind === 'missing-required-field')).toBe(true)
    expect(issues.some((i) => i.kind === 'invalid-status')).toBe(true)
    expect(issues.some((i) => i.kind === 'release-map-gap-unrecorded')).toBe(true)
  })
})

describe('UAT matrix 校验（3.3）', () => {
  it('七个 release-critical 工作流全部有 planned 场景 → 零 issue', () => {
    expect(validateUatMatrix(makeUatMatrixFixture())).toEqual([])
  })

  it('release-critical 工作流无场景且无显式延期 → blocking missing-release-critical-scenario', () => {
    const matrix = makeUatMatrixFixture()
    matrix.scenarios = matrix.scenarios.filter((s) => s.workflow !== 'cross-tenant-negative')
    const issues = validateUatMatrix(matrix)
    expect(
      issues.some(
        (i) =>
          i.kind === 'missing-release-critical-scenario' &&
          i.workflow === 'cross-tenant-negative' &&
          i.severity === 'blocking',
      ),
    ).toBe(true)
  })

  it('显式延期可豁免缺失场景；但延期缺理由 → warning', () => {
    const matrix = makeUatMatrixFixture()
    matrix.scenarios = matrix.scenarios.filter((s) => s.workflow !== 'cross-tenant-negative')
    matrix.workflowDeferrals = [
      {
        workflow: 'cross-tenant-negative',
        reason: 'fixture：跨租负例已由专项 harness 覆盖',
        impact: 'UAT 人工轮次不重复执行',
        followUpPath: '专项 harness 报告为准',
      },
    ]
    expect(
      validateUatMatrix(matrix).filter((i) => i.kind === 'missing-release-critical-scenario'),
    ).toEqual([])
    matrix.workflowDeferrals = [
      { workflow: 'cross-tenant-negative', reason: '', impact: '', followUpPath: '' },
    ]
    expect(validateUatMatrix(matrix).some((i) => i.kind === 'deferred-without-reason')).toBe(true)
  })

  it('release-blocking 场景 failed/blocked → blocking；deferred 缺理由 → warning', () => {
    const matrix = makeUatMatrixFixture()
    matrix.scenarios[0].severity = 'release-blocking'
    matrix.scenarios[0].status = 'failed'
    matrix.scenarios[1].status = 'deferred'
    const issues = validateUatMatrix(matrix)
    expect(issues.some((i) => i.kind === 'blocking-scenario-failed')).toBe(true)
    expect(issues.some((i) => i.kind === 'deferred-without-reason')).toBe(true)
  })
})

describe('evidence manifest 校验（3.6 / 5.2 / 7.5）', () => {
  const typedRecord = (recordId: string, collectedHead = 'head-current') => ({
    recordId,
    gateId: 'openspec-strict-validate',
    mode: 'rerun' as const,
    command: 'pnpm exec openspec-cn validate --strict',
    exitCode: 0,
    startedAt: '2026-08-27T00:00:00.000Z',
    finishedAt: '2026-08-27T00:00:01.000Z',
    collectedHead,
    outputDigest: 'sha256:fixture',
    resultSummary: 'exitCode=0',
  })

  it('passing manifest（含 deferred finding）→ 零 blocking', () => {
    const issues = validateEvidenceManifest(makeEvidenceManifestFixture())
    expect(issues.filter((i) => i.severity === 'blocking')).toEqual([])
  })

  it('非 passed 门禁必须带 triageNote（不得静默省略）', () => {
    const manifest = makeEvidenceManifestFixture()
    manifest.gates[5].triageNote = undefined
    const issues = validateEvidenceManifest(manifest)
    expect(issues.some((i) => i.kind === 'gate-not-triaged' && i.severity === 'blocking')).toBe(
      true,
    )
  })

  it('缺必填门槽 → blocking missing-gate-slot', () => {
    const manifest = makeEvidenceManifestFixture()
    manifest.gates = manifest.gates.filter((g) => g.gateId !== 'tests')
    const issues = validateEvidenceManifest(manifest)
    expect(issues.some((i) => i.kind === 'missing-gate-slot' && i.message.includes('tests'))).toBe(
      true,
    )
  })

  it('专项门禁缺失 → blocking missing-specialized-gate，不得计为 passed（5.2）', () => {
    const manifest = makeEvidenceManifestFixture()
    manifest.specializedGates = manifest.specializedGates.filter(
      (g) => g.gateId !== 'security-penetration',
    )
    const issues = validateEvidenceManifest(manifest)
    expect(
      issues.some((i) => i.kind === 'missing-specialized-gate' && i.severity === 'blocking'),
    ).toBe(true)
  })

  it('专项门禁标记 passed 但不完整 → blocking specialized-gate-incomplete-passed', () => {
    const manifest = makeEvidenceManifestFixture()
    const gate = manifest.specializedGates.find((g) => g.gateId === 'performance-scale')!
    gate.blockingFindings = ['示例阻塞 finding']
    const issues = validateEvidenceManifest(manifest)
    expect(issues.some((i) => i.kind === 'specialized-gate-incomplete-passed')).toBe(true)
  })

  it('专项门禁 pending → 只允许 warning 提示，不产生 passed 统计（5.2）', () => {
    const manifest = makeEvidenceManifestFixture()
    const issues = validateEvidenceManifest(manifest)
    const warnings = issues.filter((i) => i.kind === 'specialized-gate-not-counted-as-passed')
    expect(warnings.some((i) => i.subject === 'specialized:security-penetration')).toBe(true)
  })

  it('release-blocking finding 未解决 + releaseStatus=ready → blocking contradicting-release-status', () => {
    const manifest = makeEvidenceManifestFixture({
      releaseStatus: 'ready',
      findings: [
        {
          findingId: 'F-1',
          category: 'release-blocking',
          summary: '阻塞示例',
          rationale: 'x',
          evidenceRef: 'x',
          owner: 'x',
          nextAction: 'x',
          releaseImpact: 'x',
        },
      ],
    })
    const issues = validateEvidenceManifest(manifest)
    expect(issues.some((i) => i.kind === 'contradicting-release-status')).toBe(true)
  })

  it('无授权真实验证时不得声称 v3-ga/生产/真实外部验证（7.5）', () => {
    for (const claim of ['v3-ga', 'production-deployed', 'real-external-validated'] as const) {
      const manifest = makeEvidenceManifestFixture({ releaseClaim: claim })
      expect(validateEvidenceManifest(manifest).some((i) => i.kind === 'overstating-claim')).toBe(
        true,
      )
    }
  })

  it('deferred finding 缺 rationale/nextAction → warning；有则通过', () => {
    const manifest = makeEvidenceManifestFixture({
      findings: [
        {
          findingId: 'F-2',
          category: 'deferred',
          summary: 's',
          rationale: '',
          evidenceRef: 'x',
          owner: 'x',
          nextAction: '',
          releaseImpact: 'x',
        },
      ],
    })
    expect(
      validateEvidenceManifest(manifest).some((i) => i.kind === 'deferred-without-rationale'),
    ).toBe(true)
  })

  it('manifest 证据字段命中敏感内容 → blocking sensitive-evidence', () => {
    const manifest = makeEvidenceManifestFixture()
    manifest.gates[0].resultSummary = 'sk-0123456789abcdef 泄露示例'
    const issues = validateEvidenceManifest(manifest)
    expect(issues.some((i) => i.kind === 'sensitive-evidence' && i.severity === 'blocking')).toBe(
      true,
    )
  })

  it('门禁只有散文结论而无 typed record → 失败并指名 gate', () => {
    const manifest = makeEvidenceManifestFixture()
    const issues = validateEvidenceManifest(manifest, {
      currentHead: 'head-current',
      records: [],
    })
    expect(
      issues.some(
        (issue) => issue.kind === 'missing-evidence-record' && issue.subject === 'gate:openspec',
      ),
    ).toBe(true)
  })

  it('rerun typed record 采自旧 HEAD → 失败且以记录 HEAD 为准', () => {
    const manifest = makeEvidenceManifestFixture()
    manifest.gates[0]!.recordId = 'record-old'
    const issues = validateEvidenceManifest(manifest, {
      currentHead: 'head-current',
      records: [typedRecord('record-old', 'head-old')],
    })
    expect(
      issues.some(
        (issue) => issue.kind === 'stale-evidence-record' && issue.subject === 'gate:openspec',
      ),
    ).toBe(true)
  })

  it('manifest 新鲜度由 record HEAD 派生，createdAt 不会覆盖 stale', () => {
    const manifest = makeEvidenceManifestFixture({ createdAt: '2099-01-01T00:00:00.000Z' })
    for (const gate of manifest.gates) gate.recordId = `record:${gate.gateId}`
    for (const slot of manifest.aiQualitySlots ?? []) slot.recordId = `record:${slot.slotId}`
    const records = [
      ...manifest.gates.map((gate) => typedRecord(gate.recordId!, 'head-current')),
      ...(manifest.aiQualitySlots ?? []).map((slot) => typedRecord(slot.recordId!, 'head-current')),
    ]
    records[0] = typedRecord(manifest.gates[0]!.recordId!, 'head-old')
    const freshness = deriveEvidenceManifestFreshness(manifest, {
      currentHead: 'head-current',
      records,
    })
    expect(freshness.status).toBe('stale')
    expect(freshness.staleGateIds).toContain('openspec')
  })
})

describe('低敏 sanitizer（2.4 / 4.4）', () => {
  const SENSITIVE_SAMPLES: Array<[string, string]> = [
    ['secret', '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFA'],
    ['token', 'ghp_0123456789abcdefghijklmnopqrstuvwxyz'],
    [
      'token',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    ],
    ['api-key', 'sk-0123456789abcdefghijklm'],
    ['auth-header', 'Authorization: Bearer abcdef0123456789abcdef'],
    ['prompt', 'system prompt: 你是一个专家助手，请……'],
    ['model-output', 'model_output: 完整模型原文示例'],
    ['provider-payload', 'https://api.openai.com/v1/chat/completions 原始载荷'],
    ['webhook', 'x-webhook-signature: deadbeef'],
  ]

  it('敏感样本被值级 redaction（输出不再命中）', () => {
    for (const [label, sample] of SENSITIVE_SAMPLES) {
      const sanitized = sanitizeUatEvidenceSummary(sample)
      expect(sanitized).toContain('[REDACTED:')
      expect(validateEvidenceLowSensitive(sanitized).ok).toBe(true)
      expect(sanitized).not.toContain(sample.slice(0, 20))
      void label
    }
  })

  it('普通低敏文本原样保留', () => {
    const text = '所有门禁通过，报告 id=obs-x，路径 openspec/changes/…'
    expect(sanitizeUatEvidenceSummary(text)).toBe(text)
    expect(validateEvidenceLowSensitive(text).ok).toBe(true)
  })

  it('超长日志被截断为 handle（oversized-log）', () => {
    const huge = 'x'.repeat(20_000)
    const sanitized = sanitizeUatEvidenceSummary(huge, 1024)
    expect(sanitized).toContain('[REDACTED:oversized-log:')
    expect(sanitized.length).toBeLessThan(3000)
  })

  it('validateEvidenceLowSensitive 对敏感文本返回 hitCount > 0', () => {
    expect(validateEvidenceLowSensitive('token=abc123xyz789mnopq').ok).toBe(false)
  })

  it('makeStabilizationIssue 强制低敏', () => {
    const issue = makeStabilizationIssue(
      'UAT-ART-001',
      'blocking',
      'x',
      '泄露 sk-0123456789abcdefghijklm 的 message',
    )
    expect(issue.message).not.toContain('sk-0123456789abcdefghijklm')
  })
})

describe('必填工件检测（4.1）', () => {
  it('全部在列 → 零缺失', () => {
    expect(detectMissingRequiredArtifacts([...REQUIRED_STABILIZATION_ARTIFACTS])).toEqual([])
  })

  it('缺失工件被低敏点名（只报路径）', () => {
    const missing = detectMissingRequiredArtifacts(
      [...REQUIRED_STABILIZATION_ARTIFACTS].filter(
        (p) => p !== 'scripts/check-v3-uat-stabilization.ts',
      ),
    )
    expect(missing).toEqual(['scripts/check-v3-uat-stabilization.ts'])
  })
})

describe('稳定化整体评估（4.1/4.3）', () => {
  const FIXED = { now: FIXED_NOW }

  it('passing fixture → ready，零 blocking', () => {
    const result = evaluateStabilization(makePassingStabilizationInput(), FIXED.now)
    expect(result.status).toBe('ready')
    expect(result.blockingCount).toBe(0)
    expect(isUatReleaseReady(result)).toBe(true)
  })

  it('blocked fixture（release-blocking finding）→ not-ready', () => {
    const result = evaluateStabilization(makeBlockedStabilizationInput(), FIXED.now)
    expect(result.status).toBe('not-ready')
    expect(result.blockingCount).toBeGreaterThanOrEqual(1)
    expect(result.issues.some((i) => i.ruleId === 'UAT-TRG-001')).toBe(true)
  })

  it('missing-artifact fixture → not-ready 且指出缺失路径', () => {
    const result = evaluateStabilization(makeMissingArtifactStabilizationInput(), FIXED.now)
    expect(result.status).toBe('not-ready')
    expect(
      result.issues.some((i) => i.ruleId === 'UAT-ART-001' && i.message.includes('uat-matrix.md')),
    ).toBe(true)
  })

  it('tasks 未完成 → not-ready', () => {
    const result = evaluateStabilization(makeTasksIncompleteStabilizationInput(), FIXED.now)
    expect(result.status).toBe('not-ready')
    expect(result.issues.some((i) => i.ruleId === 'UAT-ART-002')).toBe(true)
  })

  it('missing-specialized-gate fixture → not-ready（专项门禁缺口是阻塞输入）', () => {
    const result = evaluateStabilization(makeMissingSpecializedGateStabilizationInput(), FIXED.now)
    expect(result.status).toBe('not-ready')
    expect(
      result.issues.some(
        (i) => i.ruleId === 'UAT-MAN-002' && i.message.includes('missing-specialized-gate'),
      ),
    ).toBe(true)
  })

  it('stale-scope fixture → not-ready（stale capture 阻塞发布声明）', () => {
    const result = evaluateStabilization(makeStaleScopeStabilizationInput(), FIXED.now)
    expect(result.status).toBe('not-ready')
    expect(
      result.issues.some((i) => i.ruleId === 'UAT-LED-002' && i.message.includes('stale-capture')),
    ).toBe(true)
  })

  it('missing-workflow-scenario fixture → not-ready', () => {
    const result = evaluateStabilization(makeMissingWorkflowScenarioInput(), FIXED.now)
    expect(result.status).toBe('not-ready')
    expect(result.issues.some((i) => i.message.includes('cross-tenant-negative'))).toBe(true)
  })

  it('authorization-gated fixture → ready（授权门是延期不是阻塞）', () => {
    const result = evaluateStabilization(makeAuthorizationGatedStabilizationInput(), FIXED.now)
    expect(result.status).toBe('ready')
  })
})

describe('授权门分类与未授权边界（5.3/5.4）', () => {
  it('AUTHORIZATION_GATES 覆盖七类真实外部动作', () => {
    expect(AUTHORIZATION_GATES.map((g) => g.gateId)).toEqual([
      'real-oauth-token-exchange',
      'webhook-callback-outbound',
      'web-push',
      'external-writeback',
      'public-publishing',
      'production-deployment',
      'large-real-model-evaluation',
    ])
  })

  it('classifyAuthorizationGate 按 id 与中文标签命中', () => {
    expect(classifyAuthorizationGate('web-push')?.gateId).toBe('web-push')
    expect(classifyAuthorizationGate('真实 OAuth/token 交换')?.gateId).toBe(
      'real-oauth-token-exchange',
    )
    expect(classifyAuthorizationGate('not-a-gate')).toBeUndefined()
  })

  it('未授权真实动作只允许 fixture/mock/authorization-gated 证据（5.4）', () => {
    expect(assertNoRealProviderInvocation('fixture')).toBe(true)
    expect(assertNoRealProviderInvocation('mock')).toBe(true)
    expect(assertNoRealProviderInvocation('authorization-gated')).toBe(true)
    expect(assertNoRealProviderInvocation('real-invocation')).toBe(false)
  })

  it('未授权动作在 manifest 中记录为 fixture 且不触发真实 provider', () => {
    const input = makeUnauthorizedActionInput()
    const manifest = input.manifest!
    const gateId = 'real-oauth-token-exchange'
    // 未授权：fixture/mock 证据合法，real-invocation 非法
    expect(assertUnauthorizedActionEvidence(manifest, gateId, 'fixture')).toBe(true)
    expect(assertUnauthorizedActionEvidence(manifest, gateId, 'mock')).toBe(true)
    expect(assertUnauthorizedActionEvidence(manifest, gateId, 'authorization-gated')).toBe(true)
    expect(assertUnauthorizedActionEvidence(manifest, gateId, 'real-invocation')).toBe(false)
    // manifest 无任何 authorizedRealVerifications → 无真实调用被记录
    expect(manifest.authorizedRealVerifications).toEqual([])
  })

  it('授权后 real-invocation 合法（记录在 authorizedRealVerifications）', () => {
    const manifest = makeEvidenceManifestFixture({
      authorizedRealVerifications: [
        {
          verificationId: 'AV-001',
          gateId: 'real-oauth-token-exchange',
          providerOrEndpoint: 'fixture-idp.example.test',
          costBoundary: '≤ 5 次调用',
          resultSummary: 'fixture 记录（低敏）',
          redactionBoundary: '不落 token/原始响应',
          authorizedBy: '用户',
          authorizedAt: '2026-08-16',
        },
      ],
    })
    expect(
      assertUnauthorizedActionEvidence(manifest, 'real-oauth-token-exchange', 'real-invocation'),
    ).toBe(true)
    expect(assertUnauthorizedActionEvidence(manifest, 'web-push', 'real-invocation')).toBe(false)
  })

  it('makeAuthorizedRealVerificationTemplate 生成含全部 5.5 字段的空模板', () => {
    const template = makeAuthorizedRealVerificationTemplate('public-publishing')
    expect(template.gateId).toBe('public-publishing')
    expect(template.providerOrEndpoint).toBe('')
    expect(template.costBoundary).toBe('')
    expect(template.redactionBoundary).toBe('')
    expect(template.resultSummary).toBe('')
  })
})

describe('汇总 helpers', () => {
  it('summarizeUatFindings 按类别计数', () => {
    const manifest = makeEvidenceManifestFixture()
    const counts = summarizeUatFindings(manifest.findings)
    expect(counts.deferred).toBe(1)
    expect(counts['release-blocking']).toBe(0)
  })

  it('countUatGateStatuses 统计门禁状态', () => {
    const manifest = makeEvidenceManifestFixture()
    const counts = countUatGateStatuses(manifest.gates)
    expect(counts.passed).toBe(6)
    expect(counts.skipped).toBe(2)
    expect(counts.pending).toBe(2)
  })

  it('常量完整性：七个 critical workflow / 十个门槽 / 两个专项门禁 id', () => {
    expect(RELEASE_CRITICAL_WORKFLOWS).toHaveLength(7)
    expect(REQUIRED_MANIFEST_GATE_SLOTS).toHaveLength(10)
    expect(SPECIALIZED_GATE_IDS).toEqual(['performance-scale', 'security-penetration'])
  })
})
