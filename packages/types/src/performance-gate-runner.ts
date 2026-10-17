/**
 * performance-gate-runner —— V3 性能与规模门禁的 deterministic runner 核心（纯逻辑，命令执行可注入）。
 *
 * 职责（design D5~D8）：
 * - 5.2 命令规划：catalog 过滤（change/surface/profile/gateIds）+ fixture profile 选择 +
 *   environment summary + authorization-boundary 求值。
 * - 5.3 命令执行摘要：exit code / duration / stdout-stderr byte count + hash / redaction warnings。
 * - 5.4 预算求值：hard/soft/degraded/skipped/passed/blocked/warned/waived 八种结局；
 *   hard 违规在 blocking severity 下阻断；软门只警告；时间指标默认 unstable → 警告。
 * - 5.5 报告组装：低敏 `PerformanceScaleGateReport`（JSON 写出由 CLI 负责）。
 * - 7.1 生命周期证据：报告元数据关联 OpenSpec change / Observation objective / graph freshness /
 *   source fallback refs。
 *
 * CLI 层（scripts/performance-scale-gates.ts）只负责参数解析、注入命令执行器（execSync）与文件写出；
 * 所有判定逻辑在本模块，保证 vitest 可直接覆盖。
 */
import {
  aggregateReportStatus,
  fnv1aHash,
  isWaiverExpired,
  makeReportId,
  redactSensitiveText,
  summarizeRedactions,
  type CommandSummary,
  type EnvironmentSummary,
  type EvidenceRef,
  type GateCatalogEntry,
  type GateFinding,
  type GateProfile,
  type GateResult,
  type GateStatus,
  type GateSurface,
  type MetricSummary,
  type ObservationContext,
  type PerformanceScaleGateReport,
  type ReasonCode,
  type RedactionSummary,
  type RedactionWarning,
  type Waiver,
} from './performance-and-scale-gates.js'
import {
  GATE_PROBES,
  PERFORMANCE_GATE_CATALOG,
  checkCatalogCoverage,
  filterCatalog,
  type GateProbe,
} from './performance-gate-catalog.js'

// =============================================================================
// 1. 运行选项与环境摘要（5.2）
// =============================================================================

export interface RunOptions {
  changeName?: string
  profile: GateProfile
  surface?: GateSurface
  gateIds?: string[]
  /** Observation context（7.1）：objective / scope / manifest / graph freshness / source fallback。 */
  observation?: {
    objective?: string
    scopeType?: string
    scopeId?: string
    manifestId?: string
    graphFreshness?: EnvironmentSummary['graphFreshness']
    graphVersion?: string
    sourceFallbackRefs?: EvidenceRef[]
  }
  /** 授权门上下文：未授权的外部检查在此标注（authorization-boundary 求值）。 */
  authorizedExternalChecks?: boolean
  /** 注入的当前时间（测试用）。 */
  now?: Date
  /** 注入的命令执行器（默认由 CLI 提供 execSync 实现）。 */
  commandExecutor?: CommandExecutor
  /** 注入的 probe 表（测试可替换）。 */
  probes?: Record<string, GateProbe>
  /** fixture profile 覆盖（默认按 gate profile 映射）。 */
  fixtureProfileOverride?: string
}

export interface CommandExecution {
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
}

export type CommandExecutor = (
  command: string,
  gateId: string,
) => CommandExecution | Promise<CommandExecution>

/** 默认命令执行器（测试/CLI 均可注入；这里提供同步兜底实现，生产由 CLI 覆写为 execSync）。 */
export const passthroughCommandExecutor: CommandExecutor = (command) => ({
  exitCode: 0,
  stdout: `[probe-only] ${command}`,
  stderr: '',
  durationMs: 0,
})

/** 构建环境摘要（5.2）：平台/node/commit/graph freshness 等。 */
export function buildEnvironmentSummary(
  profile: GateProfile,
  opts: Partial<EnvironmentSummary> = {},
): EnvironmentSummary {
  return {
    platform: opts.platform ?? process.platform,
    nodeVersion: opts.nodeVersion ?? process.version,
    pnpmVersion: opts.pnpmVersion,
    commit: opts.commit ?? 'unknown',
    branch: opts.branch,
    profile,
    graphVersion: opts.graphVersion,
    graphFreshness: opts.graphFreshness ?? 'unknown',
  }
}

/** 组装 Observation context（7.1）。 */
export function makeObservationContext(opts: RunOptions['observation']): ObservationContext {
  return {
    objective: opts?.objective,
    scopeType: opts?.scopeType,
    scopeId: opts?.scopeId,
    manifestId: opts?.manifestId,
    generatedAt: new Date().toISOString(),
    graphVersion: opts?.graphVersion,
    graphFreshness: opts?.graphFreshness ?? 'unknown',
    sourceFallbackRefs: opts?.sourceFallbackRefs ?? [],
  }
}

// =============================================================================
// 2. 预算求值（5.4）
// =============================================================================

export interface BudgetEvaluation {
  status: 'passed' | 'warned' | 'blocked'
  findings: GateFinding[]
}

/** 对 gate 的观察指标做 hard/soft 预算求值（5.4）。 */
export function evaluateBudgets(
  entry: GateCatalogEntry,
  observed: MetricSummary[],
): BudgetEvaluation {
  const findings: GateFinding[] = []
  let blocked = false
  let warned = false

  for (const metric of observed) {
    const budget = entry.metrics.find((m) => m.metric === metric.metric)
    if (!budget) continue
    if (budget.hard !== undefined && metric.observed > budget.hard) {
      blocked = true
      findings.push({
        code: 'hard-budget-exceeded',
        severity: entry.severity === 'blocking' ? 'error' : 'warning',
        gateId: entry.id,
        summary: `metric ${metric.metric} 超 hard 预算: observed=${metric.observed} > hard=${budget.hard}${budget.unit ? ' ' + budget.unit : ''}`,
        evidenceRefs: [],
      })
    } else if (budget.soft !== undefined && metric.observed > budget.soft) {
      warned = true
      findings.push({
        code: 'soft-budget-exceeded',
        severity: 'warning',
        gateId: entry.id,
        summary: `metric ${metric.metric} 超 soft 预算: observed=${metric.observed} > soft=${budget.soft}${budget.unit ? ' ' + budget.unit : ''}`,
        evidenceRefs: [],
      })
    }
  }

  if (entry.severity === 'blocking' && blocked) return { status: 'blocked', findings }
  if (blocked || warned) return { status: 'warned', findings }
  return { status: 'passed', findings }
}

// =============================================================================
// 3. 命令摘要（5.3）
// =============================================================================

/** 把命令输出转成低敏摘要（5.3）：byte count / hash / redaction warnings / handle。 */
export function makeCommandSummary(
  command: string,
  exec: CommandExecution,
  maxOutputBytes = 64 * 1024,
): CommandSummary {
  const stdoutRedacted = redactSensitiveText(exec.stdout, maxOutputBytes)
  const stderrRedacted = redactSensitiveText(exec.stderr, maxOutputBytes)
  const warnings: RedactionWarning[] = [
    ...stdoutRedacted.warnings.map((w) => ({ ...w, hash: w.hash })),
    ...stderrRedacted.warnings,
  ]
  return {
    command,
    exitCode: exec.exitCode,
    durationMs: exec.durationMs,
    stdoutBytes: Buffer.byteLength(exec.stdout, 'utf8'),
    stderrBytes: Buffer.byteLength(exec.stderr, 'utf8'),
    stdoutHash: fnv1aHash(stdoutRedacted.text),
    stderrHash: fnv1aHash(stderrRedacted.text),
    redactionWarnings: warnings,
    outputHandle: `cmd-${fnv1aHash(command).slice(0, 8)}`,
  }
}

// =============================================================================
// 4. 单 gate 执行（5.2~5.4 汇合）
// =============================================================================

export interface GateRunContext {
  entry: GateCatalogEntry
  probe?: GateProbe
  executor: CommandExecutor
  authorizedExternalChecks: boolean
  waivers: Waiver[]
  now: Date
  maxOutputBytes: number
}

/** 求值授权边界：requires-user-authorization 且未授权 → skipped（external-not-authorized）。 */
function evaluateAuthorizationBoundary(
  entry: GateCatalogEntry,
  authorized: boolean,
): { status: GateStatus; reasonCode?: ReasonCode; finding?: GateFinding } {
  if (entry.authorizationBoundary === 'requires-user-authorization' && !authorized) {
    return {
      status: 'skipped',
      reasonCode: 'external-not-authorized',
      finding: {
        code: 'missing-evidence',
        severity: 'info',
        gateId: entry.id,
        summary: `gate ${entry.id} 需要用户授权的外部检查未授权，以 fixture/mock 覆盖（authorization boundary）`,
        evidenceRefs: [],
      },
    }
  }
  return { status: 'passed' }
}

/** 查找覆盖该 gate 且未过期的 waiver。 */
function findActiveWaiver(waivers: Waiver[], gateId: string, now: Date): Waiver | undefined {
  return waivers.find((w) => w.gateIds.includes(gateId) && !isWaiverExpired(w, now))
}

/** 执行单个 gate（probe 或 command），做预算求值并组装 GateResult。 */
export async function runGate(ctx: GateRunContext): Promise<GateResult> {
  const { entry, executor, authorizedExternalChecks, waivers, now } = ctx
  const start = Date.now()
  const findings: GateFinding[] = []
  const evidenceRefs: EvidenceRef[] = []
  const redactionWarnings: RedactionWarning[] = []
  let commandSummary: CommandSummary | undefined
  let metricSummaries: MetricSummary[] = []
  let status: GateStatus = 'passed'
  let reasonCode: ReasonCode | undefined
  const waivedBy = findActiveWaiver(waivers, entry.id, now)

  // 授权边界（5.2）
  const boundary = evaluateAuthorizationBoundary(entry, authorizedExternalChecks)
  if (boundary.status !== 'passed') {
    status = boundary.status
    reasonCode = boundary.reasonCode
    if (boundary.finding) findings.push(boundary.finding)
    return {
      gateId: entry.id,
      surface: entry.surface,
      status: waivedBy ? 'waived' : status,
      exitCode: null,
      durationMs: Date.now() - start,
      metricSummaries: [],
      findings,
      redactionSummary: summarizeRedactions(redactionWarnings),
      evidenceRefs,
      reasonCode,
      waiverRef: waivedBy?.waiverId,
    }
  }

  try {
    // probe 或 command 执行
    const probe = ctx.probe
    if (probe) {
      const result = await probe()
      metricSummaries = result.metrics
      evidenceRefs.push(...result.evidenceRefs)
      if (result.status === 'degraded' || result.status === 'skipped') {
        status = result.status
        reasonCode = result.reasonCode ?? 'surface-not-stable'
        if (result.notes) {
          findings.push({
            code: 'missing-evidence',
            severity: 'info',
            gateId: entry.id,
            summary: `gate 退化: ${result.notes}`,
            evidenceRefs: result.evidenceRefs,
          })
        }
      }
    } else if (entry.command) {
      const exec = await executor(entry.command, entry.id)
      commandSummary = makeCommandSummary(entry.command, exec, ctx.maxOutputBytes)
      redactionWarnings.push(...commandSummary.redactionWarnings)
      const exitMetric: MetricSummary = {
        metric: 'exit-code',
        kind: 'count',
        observed: exec.exitCode ?? -1,
      }
      metricSummaries = [exitMetric]
      if (exec.exitCode !== 0) {
        findings.push({
          code: 'command-failed',
          severity: entry.severity === 'blocking' ? 'error' : 'warning',
          gateId: entry.id,
          summary: `命令失败 exit=${exec.exitCode}（摘要见 handle ${commandSummary.outputHandle}）`,
          evidenceRefs: [],
        })
        status = entry.severity === 'blocking' ? 'blocked' : 'warned'
        reasonCode = 'command-not-found'
      }
    } else {
      status = 'degraded'
      reasonCode = 'surface-not-stable'
      findings.push({
        code: 'missing-evidence',
        severity: 'warning',
        gateId: entry.id,
        summary: 'gate 既无 probe 也无 command',
        evidenceRefs: [],
      })
    }
  } catch (err) {
    status = 'degraded'
    reasonCode = 'environment-unstable'
    findings.push({
      code: 'needs-source-verification',
      severity: 'warning',
      gateId: entry.id,
      summary: `gate 执行异常（低敏描述）: ${String((err as Error)?.message ?? err).slice(0, 200)}`,
      evidenceRefs: [],
    })
  }

  // 预算求值（5.4）
  const budget = evaluateBudgets(entry, metricSummaries)
  findings.push(...budget.findings)
  if (status === 'passed' || status === 'warned' || status === 'blocked') {
    if (budget.status === 'blocked') status = 'blocked'
    else if (budget.status === 'warned' && status === 'passed') status = 'warned'
  }

  // waiver 覆盖：blocked/warned/degraded/skipped 可被 waiver 转 waived
  if (waivedBy && status !== 'passed') {
    status = 'waived'
  }

  return {
    gateId: entry.id,
    surface: entry.surface,
    status,
    exitCode: commandSummary?.exitCode ?? null,
    durationMs: Date.now() - start,
    metricSummaries,
    commandSummary,
    findings,
    redactionSummary: summarizeRedactions(redactionWarnings),
    evidenceRefs,
    reasonCode,
    waiverRef: waivedBy?.waiverId,
  }
}

// =============================================================================
// 5. 批量运行与报告组装（5.2/5.5/7.1）
// =============================================================================

export interface RunResult {
  report: PerformanceScaleGateReport
  /** catalog_gap findings（未知 high-risk surface）。 */
  gapFindings: GateFinding[]
  /** 排序后的 gate 结果。 */
  gates: GateResult[]
}

/** 选择 gate 的 probe（probeKind contract/fixture/degraded-placeholder → GATE_PROBES；focused-test/command → 无 probe 走 command）。 */
function selectProbe(
  entry: GateCatalogEntry,
  probes: Record<string, GateProbe>,
): GateProbe | undefined {
  if (entry.probeKind === 'focused-test' || entry.probeKind === 'command') return undefined
  return probes[entry.id]
}

/** 运行选中的 gates 并组装报告（5.2 规划 + 5.3/5.4 执行 + 5.5 报告）。 */
export async function runGates(opts: RunOptions): Promise<RunResult> {
  const now = opts.now ?? new Date()
  const profile = opts.profile
  const entries = filterCatalog(PERFORMANCE_GATE_CATALOG, {
    surface: opts.surface,
    profile,
    gateIds: opts.gateIds,
  })
  const probes = opts.probes ?? GATE_PROBES
  const executor = opts.commandExecutor ?? passthroughCommandExecutor
  const waivers: Waiver[] = []
  const gapFindings = checkCatalogCoverage(opts.surface, profile)

  const gates: GateResult[] = []
  const commands: CommandSummary[] = []
  const allMetricSummaries: MetricSummary[] = []

  for (const entry of entries) {
    const result = await runGate({
      entry,
      probe: selectProbe(entry, probes),
      executor,
      authorizedExternalChecks: opts.authorizedExternalChecks ?? false,
      waivers,
      now,
      maxOutputBytes: entry.evidencePolicy.maxOutputBytes,
    })
    gates.push(result)
    if (result.commandSummary) commands.push(result.commandSummary)
    allMetricSummaries.push(...result.metricSummaries)
  }

  const redactionSummary: RedactionSummary = {
    redactedCount: gates.reduce((a, g) => a + g.redactionSummary.redactedCount, 0),
    reasons: {},
  }
  for (const g of gates) {
    for (const [k, v] of Object.entries(g.redactionSummary.reasons)) {
      redactionSummary.reasons[k as keyof RedactionSummary['reasons']] =
        (redactionSummary.reasons[k as keyof RedactionSummary['reasons']] ?? 0) + (v ?? 0)
    }
  }

  const observation = makeObservationContext(opts.observation)
  const environment = buildEnvironmentSummary(profile, {
    graphVersion: opts.observation?.graphVersion,
    graphFreshness: opts.observation?.graphFreshness,
  })

  const report: PerformanceScaleGateReport = {
    schemaVersion: '1.0',
    reportId: makeReportId(opts.changeName, profile, now),
    generatedAt: now.toISOString(),
    changeName: opts.changeName,
    commit: environment.commit,
    profile,
    surface: opts.surface,
    gateIds: entries.map((e) => e.id),
    environment,
    observation,
    commands,
    gates,
    metricSummaries: allMetricSummaries,
    status: aggregateReportStatus(gates),
    redactionSummary,
    evidenceRefs: [],
    waiverRefs: waivers,
    sourceFallback: {
      used: (opts.observation?.sourceFallbackRefs?.length ?? 0) > 0,
      refs: opts.observation?.sourceFallbackRefs ?? [],
      graphIncomplete: observation.graphFreshness === 'stale',
    },
  }
  return { report, gapFindings, gates }
}

/** 报告文本摘要（stdout 模式 / progress 记录用，低敏）。 */
export function summarizeReport(report: PerformanceScaleGateReport): string {
  const lines: string[] = []
  lines.push(`Performance&Scale Gates 报告: ${report.reportId}`)
  lines.push(
    `  change=${report.changeName ?? '-'} profile=${report.profile} status=${report.status} surface=${report.surface ?? '-'}`,
  )
  lines.push(
    `  commit=${report.commit} gates=${report.gates.length} commands=${report.commands.length} redacted=${report.redactionSummary.redactedCount}`,
  )
  for (const g of report.gates) {
    const metrics = g.metricSummaries.map((m) => `${m.metric}=${m.observed}`).join(' ')
    lines.push(
      `  [${g.status}] ${g.gateId} (${g.durationMs}ms) ${metrics}${g.reasonCode ? ' reason=' + g.reasonCode : ''}`,
    )
  }
  return lines.join('\n')
}

/** 过滤后的 gate id 列表（--list 模式）。 */
export function listGates(opts: {
  profile?: GateProfile
  surface?: GateSurface
  gateIds?: string[]
}): string[] {
  return filterCatalog(PERFORMANCE_GATE_CATALOG, opts).map((e) => e.id)
}
