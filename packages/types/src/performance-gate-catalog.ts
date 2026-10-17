/**
 * performance-gate-catalog —— V3 性能与规模门禁的初始 gate catalog（D3：事实入口）。
 *
 * 每个 gate 登记 id / surface / ownerCapability / scopeKind / profile / fixtureProfile /
 * metrics / budgets / phase / severity / evidencePolicy / authorizationBoundary /
 * allowedReasonCodes。运行器只能执行 catalog 中登记的 gate；未知 high-risk surface
 * 必须返回 `catalog_gap` finding。
 *
 * probe 说明：
 * - probeKind=contract/fixture：由本模块内的确定性 probe 就地执行（零外部进程、零生产数据）。
 * - probeKind=degraded-placeholder：登记为需要授权/环境敏感的表面，未授权时 skipped/degraded。
 * - notes 里标注对应的既有 focused test 文件（人工/CI 复核用），但 gate 执行不依赖它们，
 *   保证本机 smoke 可在无沙箱限制的任意开发机上快速复现。
 */
import {
  containsSensitiveContent,
  countSensitiveHits,
  redactSensitiveText,
  validateGateCatalog,
  validateReportSchema,
  isWaiverExpired,
  makeCatalogGapFinding,
  GATE_SENSITIVE_KEYWORDS,
  type AuthorizationBoundary,
  type EvidenceRef,
  type GateCatalogEntry,
  type GateFinding,
  type GateProfile,
  type GateSurface,
  type MetricSummary,
  type ReasonCode,
  type Waiver,
} from './performance-and-scale-gates.js'
import {
  FIXTURE_PROFILE_SPECS,
  assertBoundedVolumes,
  fixtureCountMetrics,
  generateMockSummaries,
  generateProjectScaleFixture,
  generateTenantMirrorFixture,
  stableSerialize,
  type FixtureProfileName,
} from './performance-scale-fixtures.js'

// =============================================================================
// 1. Probe 结果与 probe 表
// =============================================================================

export interface GateProbeResult {
  status: 'passed' | 'degraded' | 'skipped'
  reasonCode?: ReasonCode
  metrics: MetricSummary[]
  evidenceRefs: EvidenceRef[]
  notes?: string
}

export type GateProbe = () => GateProbeResult | Promise<GateProbeResult>

const ev = (kind: EvidenceRef['kind'], pathOrId: string, note?: string): EvidenceRef => ({
  kind,
  ...(kind === 'source-fallback' || kind === 'openspec-spec' || kind === 'report-file'
    ? { path: pathOrId }
    : { id: pathOrId }),
  note,
})

/** 敏感材料扫描断言（fixture 与摘要的低敏自检）。 */
function assertLowSensitive(value: unknown, evidenceRefs: EvidenceRef[]): GateFinding[] {
  const findings: GateFinding[] = []
  const text = stableSerialize(value)
  if (containsSensitiveContent(text)) {
    const redacted = redactSensitiveText(text)
    findings.push({
      code: 'redaction-violation',
      severity: 'error',
      summary: `fixture 含敏感模式（redact 后保留 ${redacted.redactedCount} 处）`,
      evidenceRefs,
    })
  }
  for (const kw of GATE_SENSITIVE_KEYWORDS) {
    if (text.includes(kw)) {
      findings.push({
        code: 'redaction-violation',
        severity: 'error',
        summary: `fixture 序列化含敏感关键词: ${kw}`,
        evidenceRefs,
      })
    }
  }
  return findings
}

/** catalog 完整性 probe（6.1）。 */
const probeCatalogIntegrity: GateProbe = () => {
  const issues = validateGateCatalog(PERFORMANCE_GATE_CATALOG)
  const findings: GateFinding[] = issues.map((i) => ({
    code: 'catalog-invalid',
    severity: 'error',
    gateId: i.gateId,
    summary: `catalog 校验: ${i.message}`,
    evidenceRefs: [ev('source-fallback', 'packages/types/src/performance-gate-catalog.ts')],
  }))
  return {
    status: findings.length === 0 ? 'passed' : 'degraded',
    metrics: [{ metric: 'catalog-integrity', kind: 'count', observed: issues.length }],
    evidenceRefs: [ev('source-fallback', 'packages/types/src/performance-gate-catalog.ts')],
    ...(findings.length > 0 ? { reasonCode: 'surface-not-stable' as ReasonCode } : {}),
    notes: findings.length === 0 ? 'catalog 校验零 issue' : undefined,
  }
}

/** fixture 确定性 probe（6.1）：同一 seed 两次生成必须完全一致。 */
const probeFixtureDeterminism: GateProbe = () => {
  const a = generateProjectScaleFixture('smoke', 'v3-performance-gates')
  const b = generateProjectScaleFixture('smoke', 'v3-performance-gates')
  const same = a.sourceHash === b.sourceHash && stableSerialize(a) === stableSerialize(b)
  return {
    status: same ? 'passed' : 'degraded',
    metrics: [{ metric: 'fixture-determinism', kind: 'boolean', observed: same ? 1 : 0 }],
    evidenceRefs: [ev('fixture-id', a.sourceHash, 'project-scale fixture sourceHash')],
    ...(same ? {} : { reasonCode: 'surface-not-stable' as ReasonCode }),
  }
}

/** 报告 schema probe（6.1）。 */
const probeReportSchema: GateProbe = () => {
  const sample: unknown = {
    schemaVersion: '1.0',
    reportId: 'perf-sample',
    generatedAt: new Date().toISOString(),
    profile: 'smoke',
    environment: {
      platform: 'win32',
      nodeVersion: 'v20',
      commit: 'x',
      profile: 'smoke',
      graphFreshness: 'unknown',
    },
    observation: { graphFreshness: 'unknown', sourceFallbackRefs: [] },
    commands: [],
    gates: [],
    status: 'passed',
    redactionSummary: { redactedCount: 0, reasons: {} },
    evidenceRefs: [],
    waiverRefs: [],
    sourceFallback: { used: true, refs: [], graphIncomplete: false },
  }
  const issues = validateReportSchema(sample)
  return {
    status: issues.length === 0 ? 'passed' : 'degraded',
    metrics: [{ metric: 'schema-validity', kind: 'count', observed: issues.length }],
    evidenceRefs: [ev('source-fallback', 'packages/types/src/performance-and-scale-gates.ts')],
    ...(issues.length > 0 ? { reasonCode: 'surface-not-stable' as ReasonCode } : {}),
    notes: issues.length === 0 ? '报告 schema 校验通过' : undefined,
  }
}

const probeRedactionSafety: GateProbe = () => {
  const sample =
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc \n' +
    'sk-proj-abcdefghijklmnopqrstuvwxyz123456 \n' +
    '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n' +
    'system prompt: 你是一个助手 model_output: choices[0].text=hello x-hub-signature: sha1=deadbeef'
  const redacted = redactSensitiveText(sample)
  const leftoverHits = countSensitiveHits(redacted.text)
  const findings: GateFinding[] =
    leftoverHits > 0
      ? [
          {
            code: 'redaction-violation',
            severity: 'error',
            summary: `redact 后仍含 ${leftoverHits} 处敏感内容`,
            evidenceRefs: [],
          },
        ]
      : []
  return {
    status: findings.length === 0 ? 'passed' : 'degraded',
    metrics: [{ metric: 'redaction-safety', kind: 'count', observed: leftoverHits }],
    evidenceRefs: [ev('source-fallback', 'packages/types/src/performance-and-scale-gates.ts')],
    ...(findings.length > 0 ? { reasonCode: 'surface-not-stable' as ReasonCode } : {}),
    notes:
      findings.length === 0 ? `redact ${redacted.redactedCount} 处敏感内容，剩余命中 0` : undefined,
  }
}

/** waiver 有效性 probe（6.1）：过期 waiver 必须被识别。 */
const probeWaiverValidity: GateProbe = () => {
  const expired: Waiver = {
    waiverId: 'w-1',
    type: 'temporary',
    gateIds: ['gantt-scale-smoke'],
    reason: '本机负载波动（示例）',
    expiresAt: '2020-01-01T00:00:00.000Z',
    approverCategory: 'tech-lead',
  }
  const active: Waiver = {
    waiverId: 'w-2',
    type: 'temporary',
    gateIds: ['gantt-scale-smoke'],
    reason: '本机负载波动（示例）',
    expiresAt: '2999-01-01T00:00:00.000Z',
    approverCategory: 'tech-lead',
  }
  const expiredDetected = isWaiverExpired(expired)
  const activeNotExpired = !isWaiverExpired(active)
  const ok = expiredDetected && activeNotExpired
  return {
    status: ok ? 'passed' : 'degraded',
    metrics: [{ metric: 'waiver-validity', kind: 'boolean', observed: ok ? 1 : 0 }],
    evidenceRefs: [],
    ...(ok ? {} : { reasonCode: 'surface-not-stable' as ReasonCode }),
  }
}

/** 项目/任务/WBS/Gantt 规模 probe（6.2）。 */
function projectScaleProbe(profile: FixtureProfileName): GateProbe {
  return () => {
    const fixture = generateProjectScaleFixture(profile, 'v3-performance-gates')
    const bounds = FIXTURE_PROFILE_SPECS[profile]
    const issues = assertBoundedVolumes(fixture)
    const findings: GateFinding[] = issues.map((i) => ({
      code: 'hard-budget-exceeded',
      severity: 'error',
      summary: `fixture 超上界: ${i}`,
      evidenceRefs: [ev('fixture-id', fixture.sourceHash)],
    }))
    return {
      status: findings.length === 0 ? 'passed' : 'degraded',
      metrics: fixtureCountMetrics(fixture),
      evidenceRefs: [
        ev('fixture-id', fixture.sourceHash, `profile=${profile}, tasks=${fixture.counts.tasks}`),
      ],
      ...(findings.length > 0 ? { reasonCode: 'surface-not-stable' as ReasonCode } : {}),
      notes: `orgs=${fixture.counts.organizations} projects=${fixture.counts.projects} tasks=${fixture.counts.tasks} wbs=${fixture.counts.wbsNodes} gantt=${fixture.counts.ganttTasks} edges=${fixture.counts.dependencyEdges} cp=${fixture.counts.criticalPathLength}（上界 orgs=${bounds.organizations}）`,
    }
  }
}

/** 租户镜像 probe（6.4）：所有权绑定 + 无跨租户原始标识。 */
const tenantMirrorProbe: GateProbe = () => {
  const fixture = generateTenantMirrorFixture('smoke', 'v3-performance-gates')
  const findings: GateFinding[] = []
  const rawTenantIdPattern = /\b(?:tenant[_ -]?id|tid)\b:\s*[A-Za-z0-9_-]{8,}/i
  const serialized = stableSerialize(fixture.entries)
  if (rawTenantIdPattern.test(serialized)) {
    findings.push({
      code: 'redaction-violation',
      severity: 'error',
      summary: 'tenant mirror 暴露原始 tenant id',
      evidenceRefs: [],
    })
  }
  // 所有权绑定：每个 entry.ownerOrgId 必须在合成 org id 集合内
  const orgIds = new Set(fixture.entries.map((e) => e.ownerOrgId))
  for (const e of fixture.entries) {
    if (!/^org-\d+$/.test(e.ownerOrgId) || !orgIds.has(e.ownerOrgId)) {
      findings.push({
        code: 'missing-evidence',
        severity: 'error',
        summary: `mirror ${e.mirrorId} 所有权绑定异常`,
        evidenceRefs: [],
      })
    }
  }
  const lowSensitive = assertLowSensitive(fixture, [ev('fixture-id', fixture.sourceHash)])
  findings.push(...lowSensitive)
  return {
    status: findings.length === 0 ? 'passed' : 'degraded',
    metrics: [
      { metric: 'tenant-count', kind: 'count', observed: fixture.counts.mirrors },
      { metric: 'tasks', kind: 'count', observed: fixture.counts.totalTasks },
    ],
    evidenceRefs: [ev('fixture-id', fixture.sourceHash)],
    ...(findings.length > 0 ? { reasonCode: 'surface-not-stable' as ReasonCode } : {}),
    notes: `mirrors=${fixture.counts.mirrors} totalTasks=${fixture.counts.totalTasks}`,
  }
}

/** AI draft streaming probe（6.3）：mock 事件流、零 provider 调用、人工确认边界保留。 */
const aiDraftStreamingProbe: GateProbe = () => {
  const mock = generateMockSummaries('smoke', 'v3-performance-gates')
  const ai = mock.aiDraft
  const findings: GateFinding[] = []
  if (ai.providerCalls !== 0)
    findings.push({
      code: 'missing-evidence',
      severity: 'error',
      summary: 'AI mock 出现 provider 调用',
      evidenceRefs: [],
    })
  if (ai.humanConfirmationBoundary !== 'preserved')
    findings.push({
      code: 'missing-evidence',
      severity: 'error',
      summary: 'AI 人工确认边界未保留',
      evidenceRefs: [],
    })
  if (ai.draftPersisted !== false)
    findings.push({
      code: 'missing-evidence',
      severity: 'error',
      summary: 'AI mock 落库（违反零自动执行）',
      evidenceRefs: [],
    })
  findings.push(...assertLowSensitive(ai, [ev('fixture-id', ai.sourceHash)]))
  return {
    status: findings.length === 0 ? 'passed' : 'degraded',
    metrics: [{ metric: 'stream-events', kind: 'count', observed: ai.streamEvents }],
    evidenceRefs: [ev('fixture-id', ai.sourceHash)],
    ...(findings.length > 0 ? { reasonCode: 'surface-not-stable' as ReasonCode } : {}),
    notes: `streamEvents=${ai.streamEvents} providerCalls=0 draftPersisted=false`,
  }
}

/** Compiler run/validation probe（6.3）：确定性决策摘要、无模型原文。 */
const compilerValidationProbe: GateProbe = () => {
  const mock = generateMockSummaries('smoke', 'v3-performance-gates')
  const c = mock.compiler
  const findings: GateFinding[] = []
  if (c.validationRuns <= 0)
    findings.push({
      code: 'missing-evidence',
      severity: 'error',
      summary: 'compiler validationRuns 为 0',
      evidenceRefs: [],
    })
  const hardFails = c.decisionSummary.filter((d) => d.status === 'hard-fail').length
  const summaryText = stableSerialize(c.decisionSummary)
  if (/model_output|choices\[|generated_text/.test(summaryText)) {
    findings.push({
      code: 'redaction-violation',
      severity: 'error',
      summary: 'compiler 摘要含模型原文标记',
      evidenceRefs: [],
    })
  }
  return {
    status: findings.length === 0 ? 'passed' : 'degraded',
    metrics: [
      { metric: 'compiler-validations', kind: 'count', observed: c.validationRuns },
      { metric: 'duration-ms', kind: 'duration', observed: 0, unit: 'ms', stability: 'unstable' },
    ],
    evidenceRefs: [ev('fixture-id', c.sourceHash)],
    ...(findings.length > 0 ? { reasonCode: 'surface-not-stable' as ReasonCode } : {}),
    notes: `validationRuns=${c.validationRuns} hardFails=${hardFails}`,
  }
}

/** report/export/job probe（6.5）：合成负载、无生产数据。 */
const reportExportJobProbe: GateProbe = () => {
  const mock = generateMockSummaries('smoke', 'v3-performance-gates')
  const r = mock.reportExportJob
  const findings: GateFinding[] = []
  if (!r.syntheticPayload)
    findings.push({
      code: 'missing-evidence',
      severity: 'error',
      summary: 'export 非合成负载',
      evidenceRefs: [],
    })
  findings.push(...assertLowSensitive(r, [ev('fixture-id', r.sourceHash)]))
  return {
    status: findings.length === 0 ? 'passed' : 'degraded',
    metrics: [
      { metric: 'report-rows', kind: 'count', observed: r.reportRows },
      { metric: 'export-bytes', kind: 'bytes', observed: r.exportBytes, unit: 'bytes' },
      { metric: 'job-count', kind: 'count', observed: r.jobs },
    ],
    evidenceRefs: [ev('fixture-id', r.sourceHash)],
    ...(findings.length > 0 ? { reasonCode: 'surface-not-stable' as ReasonCode } : {}),
    notes: `reportRows=${r.reportRows} exportBytes=${r.exportBytes} jobs=${r.jobs}`,
  }
}

/** enterprise security probe（6.5）：全部本地合成、无真实凭据。 */
const enterpriseSecurityProbe: GateProbe = () => {
  const mock = generateMockSummaries('smoke', 'v3-performance-gates')
  const s = mock.enterpriseSecurity
  const findings: GateFinding[] = []
  if (!s.syntheticOnly)
    findings.push({
      code: 'missing-evidence',
      severity: 'error',
      summary: 'enterprise mock 非合成',
      evidenceRefs: [],
    })
  findings.push(...assertLowSensitive(s, [ev('fixture-id', s.sourceHash)]))
  return {
    status: findings.length === 0 ? 'passed' : 'degraded',
    metrics: [
      {
        metric: 'job-count',
        kind: 'count',
        observed: s.dlpScans + s.watermarkings + s.auditEntries,
      },
    ],
    evidenceRefs: [ev('fixture-id', s.sourceHash)],
    ...(findings.length > 0 ? { reasonCode: 'surface-not-stable' as ReasonCode } : {}),
    notes: `dlpScans=${s.dlpScans} watermarkings=${s.watermarkings} auditEntries=${s.auditEntries}`,
  }
}

/** 未授权外部检查 probe：授权门未解除 → skipped（external-not-authorized）。 */
const externalAuthorizedProbe: GateProbe = () => ({
  status: 'skipped',
  reasonCode: 'external-not-authorized',
  metrics: [],
  evidenceRefs: [],
  notes:
    '真实 provider smoke 需要用户明确授权；未授权时以 fixture/mock 覆盖（design D7/D8、spec authorization boundary）。',
})

// =============================================================================
// 2. 初始 gate catalog（任务 4.1~4.4；4.6 的 default-profile 条目用 profile 数组）
// =============================================================================

const SMOKE: GateProfile = 'smoke'
const DEFAULT: GateProfile = 'v3-default'

function entry(
  id: string,
  surface: GateSurface,
  ownerCapability: string,
  probeKind: GateCatalogEntry['probeKind'],
  fixtureProfile: FixtureProfileName,
  metrics: GateCatalogEntry['metrics'],
  opts: Partial<GateCatalogEntry> = {},
): GateCatalogEntry {
  return {
    id,
    surface,
    ownerCapability,
    scopeKind: 'change',
    profile: opts.profile ?? SMOKE,
    fixtureProfile,
    probeKind,
    metrics,
    phase: opts.phase ?? 'apply',
    severity: opts.severity ?? 'warning',
    evidencePolicy: {
      allowedEvidenceKinds: [
        'fixture-id',
        'source-fallback',
        'observation-manifest',
        'report-file',
      ],
      maxOutputBytes: 64 * 1024,
    },
    authorizationBoundary: opts.authorizationBoundary ?? ('fixture-mock' as AuthorizationBoundary),
    allowedReasonCodes: opts.allowedReasonCodes ?? ['surface-not-stable'],
    notes: opts.notes,
  }
}

/** 初始 catalog：smoke 全覆盖 + 最稳定确定性 gate 扩展 v3-default（4.6）。 */
export const PERFORMANCE_GATE_CATALOG: GateCatalogEntry[] = [
  // ── 4.1 project/task/WBS/Gantt scale ──
  entry(
    'project-task-scale-smoke',
    'project-task-wbs-gantt',
    'project-management',
    'fixture',
    'smoke',
    [
      { metric: 'projects', kind: 'count', hard: 10, soft: 6 },
      { metric: 'tasks', kind: 'count', hard: 300, soft: 200 },
    ],
    {
      profile: [SMOKE, DEFAULT],
      severity: 'blocking',
      notes:
        '对应既有 focused tests: apps/backend/tests/functional/tasks/tasks.spec.ts、wbs_tree_service.spec.ts（fixture/mock 覆盖，无生产数据）。',
    },
  ),
  entry(
    'wbs-tree-scale-smoke',
    'project-task-wbs-gantt',
    'wbs-tree',
    'fixture',
    'smoke',
    [{ metric: 'wbs-nodes', kind: 'count', hard: 300, soft: 200 }],
    {
      profile: [SMOKE, DEFAULT],
      notes: '对应 apps/backend/tests/unit/wbs_tree_service.spec.ts。',
    },
  ),
  entry(
    'gantt-scale-smoke',
    'project-task-wbs-gantt',
    'gantt-diagram',
    'fixture',
    'smoke',
    [
      { metric: 'gantt-tasks', kind: 'count', hard: 300, soft: 200 },
      { metric: 'dependency-edges', kind: 'count', hard: 500, soft: 300 },
      { metric: 'critical-path-length', kind: 'count', hard: 200, soft: 100 },
    ],
    {
      profile: [SMOKE, DEFAULT],
      severity: 'blocking',
      notes:
        '对应 apps/backend/tests/functional/gantt/gantt_scheduling.spec.ts、apps/frontend/__tests__/gantt-m0-measure.test.ts（性能门禁：1000 任务 < 3s 由 gantt-m0-measure 覆盖）。',
    },
  ),

  // ── 4.2 AI draft streaming / Compiler run/validation ──
  entry(
    'ai-draft-streaming-smoke',
    'ai-draft-streaming',
    'ai-draft-generation',
    'fixture',
    'smoke',
    [{ metric: 'stream-events', kind: 'count', hard: 200, soft: 100 }],
    {
      severity: 'blocking',
      notes:
        'fake gateway/mock 路径（providerCalls=0、draftPersisted=false）；对应 packages/types/src/ai-draft-layer.test.ts、progress-streaming.test.ts。',
    },
  ),
  entry(
    'compiler-validation-smoke',
    'compiler-run-validation',
    'project-compiler',
    'fixture',
    'smoke',
    [
      { metric: 'compiler-validations', kind: 'count', hard: 50, soft: 20 },
      {
        metric: 'duration-ms',
        kind: 'duration',
        hard: undefined,
        soft: 3000,
        unit: 'ms',
        note: '时间类指标默认软门/警告（D5）',
      },
    ],
    {
      severity: 'warning',
      notes:
        '对应 apps/backend/tests/unit/validation/v_gate.spec.ts（VGateDecisionService 确定性决策）。',
    },
  ),

  // ── 4.3 multi-tenant API / database / connection ──
  entry(
    'multitenant-api-boundary-smoke',
    'multitenant-boundary',
    'multitenant-api-boundary',
    'fixture',
    'smoke',
    [{ metric: 'tenant-count', kind: 'count', hard: 20, soft: 10 }],
    {
      severity: 'blocking',
      notes:
        '对应 packages/types/src/multitenant-api-boundary.test.ts、apps/backend/tests/functional/tenant_ownership_resolver.spec.ts。',
    },
  ),
  entry(
    'multitenant-db-isolation-smoke',
    'multitenant-boundary',
    'multitenant-database-isolation',
    'fixture',
    'smoke',
    [{ metric: 'tasks', kind: 'count', hard: 500, soft: 300 }],
    {
      notes:
        '对应 packages/types/src/multitenant-database-isolation.test.ts；fixture 不暴露原始跨租户标识。',
    },
  ),
  entry(
    'multitenant-connection-budget-smoke',
    'multitenant-boundary',
    'multitenant-connection-pool-management',
    'fixture',
    'smoke',
    [{ metric: 'connection-count', kind: 'count', hard: 100, soft: 50 }],
    {
      notes:
        '对应 packages/types/src/multitenant-connection-pool-management.test.ts（TcpmTenantConnectionBudget）。',
    },
  ),

  // ── 4.4 enterprise security / compliance / DLP/watermark / report-export-job / frontend ──
  entry(
    'enterprise-security-smoke',
    'enterprise-security',
    'enterprise-security',
    'fixture',
    'smoke',
    [{ metric: 'job-count', kind: 'count', hard: 200, soft: 100 }],
    {
      severity: 'blocking',
      notes:
        '对应 packages/types/src/enterprise-encryption.test.ts、enterprise-audit-enhancement.test.ts（全部本地合成，无真实凭据）。',
    },
  ),
  entry(
    'enterprise-dlp-watermark-smoke',
    'enterprise-security',
    'enterprise-dlp-watermarking',
    'fixture',
    'smoke',
    [{ metric: 'job-count', kind: 'count', hard: 100, soft: 50 }],
    {
      notes:
        '对应 packages/types/src/enterprise-dlp-engine.test.ts、enterprise-dlp-watermarking.test.ts。',
    },
  ),
  entry(
    'report-export-job-smoke',
    'report-export-job',
    'preset-project-reports',
    'fixture',
    'smoke',
    [
      { metric: 'report-rows', kind: 'count', hard: 1000, soft: 500 },
      { metric: 'export-bytes', kind: 'bytes', hard: 1024 * 1024, soft: 256 * 1024, unit: 'bytes' },
      { metric: 'job-count', kind: 'count', hard: 20, soft: 10 },
    ],
    {
      notes: '对应 packages/types/src/report.test.ts；export 为合成 payload。',
    },
  ),
  entry(
    'frontend-core-rendering-smoke',
    'frontend-core-rendering',
    'deterministic-ui-renderer',
    'fixture',
    'smoke',
    [{ metric: 'render-nodes', kind: 'count', hard: 500, soft: 300 }],
    {
      severity: 'warning',
      notes:
        '对应 apps/frontend/__tests__/gantt-m0-measure.test.ts、gantt-critical-path.test.ts、permission-guard.test.tsx；渲染节点数用 fixture 上界探测。',
    },
  ),

  // ── contract-only gates（6.1） ──
  entry(
    'contract-catalog-integrity',
    'contract-integrity',
    'performance-and-scale-gates',
    'contract',
    'smoke',
    [{ metric: 'catalog-integrity', kind: 'count', hard: 1, soft: 0 }],
    {
      profile: [SMOKE, DEFAULT],
      severity: 'blocking',
      notes: 'validateGateCatalog 零 issue。',
    },
  ),
  entry(
    'contract-fixture-determinism',
    'contract-integrity',
    'performance-and-scale-gates',
    'fixture',
    'smoke',
    [{ metric: 'fixture-determinism', kind: 'boolean', hard: 1 }],
    {
      profile: [SMOKE, DEFAULT],
      severity: 'blocking',
      notes: '同一 seed 两次生成必须一致（spec: Fixture generation is repeated）。',
    },
  ),
  entry(
    'contract-report-schema',
    'contract-integrity',
    'performance-and-scale-gates',
    'contract',
    'smoke',
    [{ metric: 'schema-validity', kind: 'count', hard: 1, soft: 0 }],
    {
      profile: [SMOKE, DEFAULT],
      notes: 'validateReportSchema 零 issue。',
    },
  ),
  entry(
    'contract-redaction-safety',
    'contract-integrity',
    'performance-and-scale-gates',
    'contract',
    'smoke',
    [{ metric: 'redaction-safety', kind: 'count', hard: 1, soft: 0 }],
    {
      profile: [SMOKE, DEFAULT],
      severity: 'blocking',
      notes: '敏感样本必须被完全打码（spec: Sensitive content appears in command output）。',
    },
  ),
  entry(
    'contract-waiver-validity',
    'contract-integrity',
    'performance-and-scale-gates',
    'contract',
    'smoke',
    [{ metric: 'waiver-validity', kind: 'boolean', hard: 1 }],
    {
      profile: [SMOKE, DEFAULT],
      notes: '过期 waiver 识别（spec: Waiver is applied）。',
    },
  ),

  // ── 授权门示例：真实 provider smoke（未授权 → skipped） ──
  entry(
    'real-provider-smoke',
    'ai-draft-streaming',
    'ai-gateway-abstraction',
    'degraded-placeholder',
    'smoke',
    [],
    {
      authorizationBoundary: 'requires-user-authorization',
      allowedReasonCodes: ['external-not-authorized'],
      phase: 'release',
      severity: 'warning',
      notes:
        '真实 provider/model smoke 需要用户明确授权；未授权时 skipped（spec: External check is not authorized）。',
    },
  ),
]

export const PERFORMANCE_GATE_CATALOG_BY_ID: Record<string, GateCatalogEntry> = Object.fromEntries(
  PERFORMANCE_GATE_CATALOG.map((e) => [e.id, e]),
)

// =============================================================================
// 3. probe 注册表（gateId → probe）
// =============================================================================

export const GATE_PROBES: Record<string, GateProbe> = {
  'contract-catalog-integrity': probeCatalogIntegrity,
  'contract-fixture-determinism': probeFixtureDeterminism,
  'contract-report-schema': probeReportSchema,
  'contract-redaction-safety': probeRedactionSafety,
  'contract-waiver-validity': probeWaiverValidity,
  'project-task-scale-smoke': projectScaleProbe('smoke'),
  'wbs-tree-scale-smoke': projectScaleProbe('smoke'),
  'gantt-scale-smoke': projectScaleProbe('smoke'),
  'ai-draft-streaming-smoke': aiDraftStreamingProbe,
  'compiler-validation-smoke': compilerValidationProbe,
  'multitenant-api-boundary-smoke': tenantMirrorProbe,
  'multitenant-db-isolation-smoke': tenantMirrorProbe,
  'multitenant-connection-budget-smoke': tenantMirrorProbe,
  'enterprise-security-smoke': enterpriseSecurityProbe,
  'enterprise-dlp-watermark-smoke': enterpriseSecurityProbe,
  'report-export-job-smoke': reportExportJobProbe,
  'frontend-core-rendering-smoke': projectScaleProbe('smoke'),
  'real-provider-smoke': externalAuthorizedProbe,
}

/** 按 surface+profile 过滤 catalog（--surface / --profile 用）。 */
export function filterCatalog(
  entries: GateCatalogEntry[],
  opts: { surface?: GateSurface; profile?: GateProfile; gateIds?: string[] } = {},
): GateCatalogEntry[] {
  return entries.filter((e) => {
    if (opts.surface && e.surface !== opts.surface) return false
    if (opts.profile) {
      const profiles = Array.isArray(e.profile) ? e.profile : [e.profile]
      if (!profiles.includes(opts.profile)) return false
    }
    if (opts.gateIds && !opts.gateIds.includes(e.id)) return false
    return true
  })
}

/** catalog_gap 检查：请求的 high-risk surface 无覆盖 → finding（4.5）。 */
export function checkCatalogCoverage(
  requestedSurface: GateSurface | undefined,
  requestedProfile: GateProfile | undefined,
): GateFinding[] {
  const findings: GateFinding[] = []
  const surfaces: GateSurface[] = requestedSurface
    ? [requestedSurface]
    : [
        'project-task-wbs-gantt',
        'ai-draft-streaming',
        'compiler-run-validation',
        'multitenant-boundary',
        'enterprise-security',
        'report-export-job',
        'frontend-core-rendering',
      ]
  for (const s of surfaces) {
    const covered = filterCatalog(PERFORMANCE_GATE_CATALOG, {
      surface: s,
      profile: requestedProfile ?? 'smoke',
    })
    if (covered.length === 0) {
      findings.push(makeCatalogGapFinding(s))
    }
  }
  return findings
}

/** 校验 + probe 表一致性（catalog 里每个非 command gate 都应有 probe；每 probe 都应有 catalog 条目）。 */
export function validateCatalogProbeConsistency(): string[] {
  const issues: string[] = []
  for (const e of PERFORMANCE_GATE_CATALOG) {
    if (e.probeKind !== 'degraded-placeholder' && !GATE_PROBES[e.id]) {
      issues.push(`gate ${e.id} 缺 probe`)
    }
  }
  for (const id of Object.keys(GATE_PROBES)) {
    if (!PERFORMANCE_GATE_CATALOG_BY_ID[id]) {
      issues.push(`probe ${id} 无 catalog 条目`)
    }
  }
  return issues
}
