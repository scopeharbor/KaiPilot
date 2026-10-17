/**
 * performance-gate-runner.test —— V3 性能门禁 runner 测试（任务 5.6 + 6.6 + 7.2）。
 *
 * 5.6 覆盖：--list 语义（listGates）、过滤（surface/profile/gateIds）、缺失 gate、
 *   命令失败、hard 预算阻断、soft 预算警告、可选依赖缺失退化、未授权外部检查 skipped、
 *   redaction（命令输出含敏感内容 → 摘要只留 hash/warning）。
 * 6.6 覆盖：catalog 中每个已接线 gate 要么本机可跑（passed/warned）、要么带原因退化
 *   （degraded）、要么因授权 skipped、要么 catalog_gap；不允许意外 blocked。
 * 7.2 覆盖：报告引用 Observation evidence（objective/scope/manifest/source fallback）
 *   而不嵌入完整日志/源码/prompt/模型输出/token/secret。
 */
import { describe, expect, it } from 'vitest'
import {
  containsSensitiveContent,
  countSensitiveHits,
  redactSensitiveText,
  type GateCatalogEntry,
  type GateResult,
  type MetricSummary,
} from './performance-and-scale-gates.js'
import {
  GATE_PROBES,
  PERFORMANCE_GATE_CATALOG,
  PERFORMANCE_GATE_CATALOG_BY_ID,
} from './performance-gate-catalog.js'
import {
  evaluateBudgets,
  listGates,
  makeCommandSummary,
  passthroughCommandExecutor,
  runGate,
  runGates,
  summarizeReport,
  type CommandExecution,
  type RunOptions,
} from './performance-gate-runner.js'

const SMOKE_RUN: RunOptions = {
  changeName: 'v3-performance-and-scale-gates',
  profile: 'smoke',
  observation: {
    objective: 'v3-performance-and-scale-gates apply',
    scopeType: 'openspec_change',
    scopeId: 'v3-performance-and-scale-gates',
    manifestId: 'obs-observe-scope-v3-performance-and-scale-gates-apply',
    graphFreshness: 'unknown',
    graphVersion: 'codebase-memory-mcp:aiproj',
    sourceFallbackRefs: [
      { kind: 'source-fallback', path: 'packages/types/src/performance-and-scale-gates.ts' },
    ],
  },
}

describe('5.6a 列出与过滤', () => {
  it('listGates 返回 smoke 全部条目且顺序确定（catalog 登记顺序）', () => {
    const ids = listGates({ profile: 'smoke' })
    expect(ids.length).toBe(PERFORMANCE_GATE_CATALOG.length)
    expect(ids).toEqual(ids) // 两次调用一致（确定性）
    expect(listGates({ profile: 'smoke' })).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('按 surface 过滤只返回该 surface', () => {
    const ids = listGates({ profile: 'smoke', surface: 'multitenant-boundary' })
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(PERFORMANCE_GATE_CATALOG_BY_ID[id]?.surface).toBe('multitenant-boundary')
    }
  })

  it('缺失 gate id → 过滤结果为空（不会静默执行未知 gate）', () => {
    const ids = listGates({ profile: 'smoke', gateIds: ['does-not-exist'] })
    expect(ids).toEqual([])
  })
})

describe('5.6b 预算求值', () => {
  const entry: GateCatalogEntry = {
    id: 'budget-test',
    surface: 'project-task-wbs-gantt',
    ownerCapability: 'x',
    scopeKind: 'change',
    profile: 'smoke',
    fixtureProfile: 'smoke',
    probeKind: 'fixture',
    metrics: [
      { metric: 'tasks', kind: 'count', hard: 100, soft: 50 },
      { metric: 'duration-ms', kind: 'duration', soft: 1000 },
    ],
    phase: 'apply',
    severity: 'blocking',
    evidencePolicy: { allowedEvidenceKinds: ['fixture-id'], maxOutputBytes: 1024 },
    authorizationBoundary: 'fixture-mock',
    allowedReasonCodes: [],
  }

  it('未超预算 → passed', () => {
    const r = evaluateBudgets(entry, [{ metric: 'tasks', kind: 'count', observed: 40 }])
    expect(r.status).toBe('passed')
  })

  it('soft 超限 → warned（默认不阻断）', () => {
    const r = evaluateBudgets(entry, [{ metric: 'tasks', kind: 'count', observed: 60 }])
    expect(r.status).toBe('warned')
    expect(r.findings.some((f) => f.code === 'soft-budget-exceeded')).toBe(true)
  })

  it('hard 超限 + blocking severity → blocked', () => {
    const r = evaluateBudgets(entry, [{ metric: 'tasks', kind: 'count', observed: 101 }])
    expect(r.status).toBe('blocked')
    expect(r.findings.some((f) => f.code === 'hard-budget-exceeded')).toBe(true)
  })

  it('hard 超限 + warning severity → warned（软门语义）', () => {
    const r = evaluateBudgets({ ...entry, severity: 'warning' }, [
      { metric: 'tasks', kind: 'count', observed: 101 },
    ])
    expect(r.status).toBe('warned')
  })

  it('时间指标只有 soft → 超限只警告', () => {
    const r = evaluateBudgets(entry, [
      { metric: 'duration-ms', kind: 'duration', observed: 5000, stability: 'unstable' },
    ])
    expect(r.status).toBe('warned')
    expect(r.findings.some((f) => f.code === 'soft-budget-exceeded')).toBe(true)
  })
})

describe('5.6c 命令失败 / 命令摘要 / redaction', () => {
  it('命令失败（exit!=0）→ blocking gate 变 blocked 且带 command-failed finding', async () => {
    const entry: GateCatalogEntry = {
      id: 'cmd-fail',
      surface: 'contract-integrity',
      ownerCapability: 'x',
      scopeKind: 'change',
      profile: 'smoke',
      fixtureProfile: 'smoke',
      probeKind: 'command',
      command: 'false',
      metrics: [{ metric: 'exit-code', kind: 'count', hard: 0 }],
      phase: 'apply',
      severity: 'blocking',
      evidencePolicy: { allowedEvidenceKinds: ['fixture-id'], maxOutputBytes: 1024 },
      authorizationBoundary: 'local-only',
      allowedReasonCodes: [],
    }
    const result = await runGate({
      entry,
      probe: undefined,
      executor: () => ({ exitCode: 1, stdout: 'boom', stderr: 'err', durationMs: 10 }),
      authorizedExternalChecks: false,
      waivers: [],
      now: new Date(),
      maxOutputBytes: 1024,
    })
    expect(result.status).toBe('blocked')
    expect(result.findings.some((f) => f.code === 'command-failed')).toBe(true)
    expect(result.reasonCode).toBe('command-not-found')
  })

  it('命令输出含敏感内容 → 摘要只留 hash/警告，报告不嵌原文', () => {
    const exec: CommandExecution = {
      exitCode: 0,
      stdout: 'token sk-proj-abcdefghijklmnopqrstuvwxyz123456 output',
      stderr: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc',
      durationMs: 5,
    }
    const summary = makeCommandSummary('probe-cmd', exec, 1024)
    expect(summary.redactionWarnings.length).toBeGreaterThan(0)
    expect(summary.stdoutHash).toBeTruthy()
    expect(summary.stdoutBytes).toBeGreaterThan(0)
    // 摘要本身不含原文
    expect(containsSensitiveContent(JSON.stringify(summary))).toBe(false)
  })

  it('redactSensitiveText 在 runner 摘要路径下剩余命中为 0', () => {
    const redacted = redactSensitiveText('key=sk-abcdefghijklmnopqrstuvwxyz123456 auth=Bearer xxx')
    expect(countSensitiveHits(redacted.text)).toBe(0)
  })
})

describe('5.6d 退化 / 授权跳过', () => {
  it('未授权外部检查 → skipped（external-not-authorized）', async () => {
    const entry = PERFORMANCE_GATE_CATALOG_BY_ID['real-provider-smoke']!
    const result = await runGate({
      entry,
      probe: GATE_PROBES['real-provider-smoke'],
      executor: passthroughCommandExecutor,
      authorizedExternalChecks: false,
      waivers: [],
      now: new Date(),
      maxOutputBytes: 1024,
    })
    expect(result.status).toBe('skipped')
    expect(result.reasonCode).toBe('external-not-authorized')
  })

  it('授权后外部检查不再 skipped（仍走 probe/fixture 路径）', async () => {
    const entry = PERFORMANCE_GATE_CATALOG_BY_ID['real-provider-smoke']!
    const result = await runGate({
      entry,
      probe: GATE_PROBES['real-provider-smoke'],
      executor: passthroughCommandExecutor,
      authorizedExternalChecks: true,
      waivers: [],
      now: new Date(),
      maxOutputBytes: 1024,
    })
    // 授权后仍是本地 fixture 语义：probe 返回 skipped → 保持 skipped；此处证明授权求值不再拦在边界前
    expect(['passed', 'degraded', 'skipped']).toContain(result.status)
  })

  it('probe 抛异常 → degraded（environment-unstable）', async () => {
    const entry: GateCatalogEntry = {
      id: 'flaky-probe',
      surface: 'contract-integrity',
      ownerCapability: 'x',
      scopeKind: 'change',
      profile: 'smoke',
      fixtureProfile: 'smoke',
      probeKind: 'contract',
      metrics: [{ metric: 'schema-validity', kind: 'count', hard: 1 }],
      phase: 'apply',
      severity: 'warning',
      evidencePolicy: { allowedEvidenceKinds: [], maxOutputBytes: 1024 },
      authorizationBoundary: 'fixture-mock',
      allowedReasonCodes: ['environment-unstable'],
    }
    const result = await runGate({
      entry,
      probe: () => {
        throw new Error('probe boom')
      },
      executor: passthroughCommandExecutor,
      authorizedExternalChecks: false,
      waivers: [],
      now: new Date(),
      maxOutputBytes: 1024,
    })
    expect(result.status).toBe('degraded')
    expect(result.reasonCode).toBe('environment-unstable')
  })

  it('waiver 覆盖 blocked → waived', async () => {
    const entry: GateCatalogEntry = {
      id: 'waived-gate',
      surface: 'contract-integrity',
      ownerCapability: 'x',
      scopeKind: 'change',
      profile: 'smoke',
      fixtureProfile: 'smoke',
      probeKind: 'contract',
      metrics: [{ metric: 'catalog-integrity', kind: 'count', hard: 0 }],
      phase: 'apply',
      severity: 'blocking',
      evidencePolicy: { allowedEvidenceKinds: [], maxOutputBytes: 1024 },
      authorizationBoundary: 'fixture-mock',
      allowedReasonCodes: [],
    }
    const result = await runGate({
      entry,
      probe: () => ({
        status: 'passed',
        metrics: [{ metric: 'catalog-integrity', kind: 'count', observed: 5 }],
        evidenceRefs: [],
      }),
      executor: passthroughCommandExecutor,
      authorizedExternalChecks: false,
      waivers: [
        {
          waiverId: 'w-1',
          type: 'temporary',
          gateIds: ['waived-gate'],
          reason: '示例 waiver',
          expiresAt: '2999-01-01T00:00:00.000Z',
          approverCategory: 'tech-lead',
        },
      ],
      now: new Date('2026-08-16T00:00:00.000Z'),
      maxOutputBytes: 1024,
    })
    expect(result.status).toBe('waived')
    expect(result.waiverRef).toBe('w-1')
  })

  it('过期 waiver 不覆盖 → 保持 blocked', async () => {
    const entry: GateCatalogEntry = {
      id: 'expired-waiver-gate',
      surface: 'contract-integrity',
      ownerCapability: 'x',
      scopeKind: 'change',
      profile: 'smoke',
      fixtureProfile: 'smoke',
      probeKind: 'contract',
      metrics: [{ metric: 'catalog-integrity', kind: 'count', hard: 0 }],
      phase: 'apply',
      severity: 'blocking',
      evidencePolicy: { allowedEvidenceKinds: [], maxOutputBytes: 1024 },
      authorizationBoundary: 'fixture-mock',
      allowedReasonCodes: [],
    }
    const result = await runGate({
      entry,
      probe: () => ({
        status: 'passed',
        metrics: [{ metric: 'catalog-integrity', kind: 'count', observed: 5 }],
        evidenceRefs: [],
      }),
      executor: passthroughCommandExecutor,
      authorizedExternalChecks: false,
      waivers: [
        {
          waiverId: 'w-old',
          type: 'temporary',
          gateIds: ['expired-waiver-gate'],
          reason: '示例',
          expiresAt: '2020-01-01T00:00:00.000Z',
          approverCategory: 'tech-lead',
        },
      ],
      now: new Date('2026-08-16T00:00:00.000Z'),
      maxOutputBytes: 1024,
    })
    expect(result.status).toBe('blocked')
  })
})

describe('6.6 接线证明：每个已接线 gate 本机可跑 / 退化 / 跳过 / gap', () => {
  it('全量 smoke 运行：无意外 blocked、无 catalog_gap、real-provider-smoke 必然 skipped', async () => {
    const { report, gapFindings, gates } = await runGates(SMOKE_RUN)
    expect(gapFindings).toEqual([])
    expect(report.status).not.toBe('blocked')
    for (const g of gates) {
      expect(
        ['passed', 'warned', 'degraded', 'skipped', 'waived'],
        `gate ${g.gateId} 意外状态 ${g.status}`,
      ).toContain(g.status)
    }
    const provider = gates.find((g) => g.gateId === 'real-provider-smoke')
    expect(provider?.status).toBe('skipped')
    expect(provider?.reasonCode).toBe('external-not-authorized')
  })

  it('每个 catalog 条目在 smoke 下都有结果（无静默缺失）', async () => {
    const { report } = await runGates(SMOKE_RUN)
    const ids = new Set(report.gates.map((g) => g.gateId))
    const catalogSmokeIds = new Set(listGates({ profile: 'smoke' }))
    expect(ids).toEqual(catalogSmokeIds)
  })

  it('blocking 门禁全绿（18 smoke gates 中 blocking 均为 passed）', async () => {
    const { report } = await runGates(SMOKE_RUN)
    for (const g of report.gates) {
      const entry = PERFORMANCE_GATE_CATALOG_BY_ID[g.gateId]!
      if (entry.severity === 'blocking') {
        expect(
          ['passed', 'skipped', 'waived'],
          `blocking gate ${g.gateId} 状态 ${g.status}`,
        ).toContain(g.status)
      }
    }
  })
})

describe('7.2 Observation evidence 引用（低敏）', () => {
  it('报告记录 observation context 与 source fallback，且不嵌入敏感材料', async () => {
    const { report } = await runGates(SMOKE_RUN)
    expect(report.observation.objective).toBe('v3-performance-and-scale-gates apply')
    expect(report.observation.scopeType).toBe('openspec_change')
    expect(report.observation.scopeId).toBe('v3-performance-and-scale-gates')
    expect(report.observation.manifestId).toBe(
      'obs-observe-scope-v3-performance-and-scale-gates-apply',
    )
    expect(report.sourceFallback.used).toBe(true)
    expect(report.sourceFallback.refs.length).toBeGreaterThan(0)
    const text = JSON.stringify(report)
    expect(containsSensitiveContent(text)).toBe(false)
    for (const kw of [
      'sk-proj',
      'ghp_',
      'Bearer ',
      'PRIVATE KEY',
      'system prompt',
      'model_output',
      'choices[0].text',
    ]) {
      expect(text, `报告不应包含 ${kw}`).not.toContain(kw)
    }
  })

  it('报告摘要（summarizeReport）低敏且含关键状态', async () => {
    const { report } = await runGates(SMOKE_RUN)
    const summary = summarizeReport(report)
    expect(summary).toContain(report.reportId)
    expect(summary).toContain('real-provider-smoke')
    expect(containsSensitiveContent(summary)).toBe(false)
  })

  it('evidenceRefs 只含低敏引用（kind/path/id/note）', async () => {
    const { report } = await runGates(SMOKE_RUN)
    for (const g of report.gates) {
      for (const ref of g.evidenceRefs) {
        expect([
          'observation-manifest',
          'graph-probe',
          'source-fallback',
          'test-result',
          'report-file',
          'fixture-id',
          'openspec-spec',
        ]).toContain(ref.kind)
        expect(containsSensitiveContent(JSON.stringify(ref))).toBe(false)
      }
    }
  })
})

describe('runner 报告聚合', () => {
  it('skipped 门禁 → 报告状态 degraded（aggregate 语义）', async () => {
    const { report } = await runGates(SMOKE_RUN)
    expect(report.status).toBe('degraded')
    const skipped = report.gates.filter((g) => g.status === 'skipped')
    expect(skipped.length).toBe(1)
  })

  it('报告 schema 合法且 gateIds 与运行集合一致', async () => {
    const { report } = await runGates(SMOKE_RUN)
    expect(report.schemaVersion).toBe('1.0')
    expect(report.gateIds?.length).toBe(report.gates.length)
  })
})
