import { inject } from '@adonisjs/core'
import ProjectDashboardService from '#services/project_dashboard_service'
import RiskWorkbenchService from '#services/risk_workbench_service'
import ResourceLoadService from '#services/resource_load_service'
import ProjectPredictionDashboardAdapter from '#services/prediction/dashboard_adapter'
import type User from '#models/user'
import type { CommandCenterAccess } from '#policies/project_health_risk_command_center_policy'
import type {
  CommandCenterAttentionCandidate,
  CommandCenterAttentionItem,
  CommandCenterAvailability,
  CommandCenterMeta,
  CommandCenterResponse,
  CommandCenterResponseData,
  CommandCenterSafeTarget,
  CommandCenterSourceKey,
  CommandCenterSourceMeta,
  CommandCenterSourceSummary,
  CommandCenterWarning,
  NormalizedCommandCenterQuery,
  PredictionCommandCenterFacts,
  ResourceLoadCommandCenterFacts,
  TaskMilestoneCommandCenterFacts,
} from '@aiproj/types'
import {
  COMMAND_CENTER_ATTENTION_RULE_VERSION,
  COMMAND_CENTER_CONTRACT_VERSION,
  COMMAND_CENTER_AVAILABILITIES,
  COMMAND_CENTER_EVIDENCE_CLASSES,
  COMMAND_CENTER_FRESHNESS_STATES,
  COMMAND_CENTER_MAX_EVIDENCE_PER_SOURCE,
  COMMAND_CENTER_REASON_CODES,
  COMMAND_CENTER_SEVERITIES,
  COMMAND_CENTER_SOURCES,
  COMMAND_CENTER_WARNING_CODES,
  commandCenterFnv1a,
  computeCommandCenterPermissionFingerprint,
  computeProjectionSignature,
  detectForbiddenFields,
  detectSourcePostureConflict,
  projectAttentionQueue,
  resolveHeadline,
  validateSafeTarget,
  DASHBOARD_METRIC_KEYS,
} from '@aiproj/types'

/** Date → ISO 日期（YYYY-MM-DD），避免依赖 luxon 扩展原型。 */
function isoDateOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Date → ISO 8601 字符串。 */
function isoOf(date: Date): string {
  return date.toISOString()
}

/** reader 级域查询记账（query budget 证据用，不触库）。 */
export interface ReaderQueryLedger {
  entries: Array<{ sourceKey: CommandCenterSourceKey; queries: number }>
  total(): number
}

/** 聚合结果（内部形态，Controller 直接作为 data 返回）。 */
type AggregationResult = CommandCenterResponse

interface OptionalReaderOutcome<T> {
  status: 'fulfilled' | 'rejected' | 'skipped' | 'timeout'
  value: T | null
  elapsedMs: number
}

/** 风险 reader 值形态（summary + 有界复查队列）。 */
type CommandCenterRiskReaderValue = {
  summary: Awaited<ReturnType<RiskWorkbenchService['getSummary']>>
  reviewQueue: Awaited<ReturnType<RiskWorkbenchService['getReviewQueue']>>
}
/** 预测 reader 值形态。 */
type CommandCenterPredictionReaderValue = Awaited<
  ReturnType<ProjectPredictionDashboardAdapter['getSummary']>
>
/** 资源 reader 值形态（team/trend 联合）。 */
type CommandCenterResourceReaderValue = Awaited<ReturnType<ResourceLoadService['load']>>

const READER_DEADLINE_MS = 5_000

/**
 * ProjectHealthRiskCommandCenterService —— 项目健康风险指挥中心只读聚合（§3）。
 *
 * 三段式（D2）：项目门（Policy 已先行）→ 并行 readers → pure projector。
 * 红线：
 *   - 全路径零写入、零 AIGateway、零 Compiler、零网络外发；
 *   - 不复制任何领域派生算法——基础事实一律复用权威 Service 返回；
 *   - 无权限来源在查询前排除，响应中仅保留不携带事实的受限状态；
 *   - 不新增持久化缓存或数据库写入。
 */
@inject()
export default class ProjectHealthRiskCommandCenterService {
  /** 可注入时钟（测试确定性）；生产默认系统时间。 */
  public clock: () => Date = () => new Date()
  /** 每来源耗时上限；超时 reader 转 unavailable（partial）。 */
  public readerDeadlineMs: number = READER_DEADLINE_MS
  /** 域查询记账钩子（测试断言 query budget 用）。 */
  public queryLedger: ReaderQueryLedger | null = null

  constructor(
    private readonly dashboardService: ProjectDashboardService,
    private readonly riskWorkbench: RiskWorkbenchService,
    private readonly predictionAdapter: ProjectPredictionDashboardAdapter,
    private readonly resourceLoadService: ResourceLoadService,
  ) {}

  async getSummary(
    user: User,
    organizationId: number,
    projectId: number,
    query: NormalizedCommandCenterQuery,
    access: CommandCenterAccess,
  ): Promise<AggregationResult> {
    // ── mandatory：基础 Dashboard 权威读取。失败 fail-closed（异常向上收束为统一错误契约）。
    const readStart = this.clock().getTime()
    const dashboard = await this.dashboardService.get(
      organizationId,
      projectId,
      user,
      access.canViewRisk,
      access.canViewResource,
      access.canViewChangeImpact,
      false,
      false,
    )
    this.recordQueries(COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD, 1)
    const dashboardElapsed = this.clock().getTime() - readStart

    const deadlineAt = this.clock().getTime() + this.readerDeadlineMs

    // ── optional readers：权限下推后并行执行，失败/超时转 partial。
    const [riskOut, predictionOut, resourceOut] = await Promise.all([
      access.canViewRisk
        ? this.runReader<CommandCenterRiskReaderValue>(
            COMMAND_CENTER_SOURCES.RISK_WORKBENCH,
            deadlineAt,
            async () => {
              const summary = await this.riskWorkbench.getSummary(organizationId, projectId)
              const reviewQueue = await this.riskWorkbench
                .getReviewQueue(organizationId, projectId)
                .catch(() => [])
              this.recordQueries(COMMAND_CENTER_SOURCES.RISK_WORKBENCH, 2)
              return { summary, reviewQueue: reviewQueue.slice(0, 5) }
            },
          )
        : this.skipped<CommandCenterRiskReaderValue>(),
      this.runReader<CommandCenterPredictionReaderValue>(
        COMMAND_CENTER_SOURCES.PREDICTION,
        deadlineAt,
        async () => {
          const summary = await this.predictionAdapter.getSummary(organizationId, projectId)
          this.recordQueries(COMMAND_CENTER_SOURCES.PREDICTION, 1)
          return summary
        },
      ),
      access.canViewResource
        ? this.runReader(COMMAND_CENTER_SOURCES.RESOURCE_LOAD, deadlineAt, async () => {
            const nowMs = this.clock().getTime()
            const fromIso = isoDateOf(new Date(nowMs))
            const toIso = isoDateOf(new Date(nowMs + 7 * 86_400_000))
            const result = await this.resourceLoadService.load(
              organizationId,
              projectId,
              fromIso,
              toIso,
              'team',
            )
            this.recordQueries(COMMAND_CENTER_SOURCES.RESOURCE_LOAD, 1)
            return result
          })
        : this.skipped<CommandCenterResourceReaderValue>(),
    ])

    // ── pure projector：headline / 来源矩阵 / 注意力 / 签名 / 低敏扫描。
    return this.project({
      organizationId,
      projectId,
      query,
      access,
      dashboard,
      dashboardElapsedMs: dashboardElapsed,
      riskOut,
      predictionOut,
      resourceOut,
    })
  }

  // ───────────────────────────────────────────────────────────────────────────
  // projector：纯投影逻辑（除 clock 注入外不触碰 IO）
  // ───────────────────────────────────────────────────────────────────────────

  private project(input: {
    organizationId: number
    projectId: number
    query: NormalizedCommandCenterQuery
    access: CommandCenterAccess
    dashboard: Awaited<ReturnType<ProjectDashboardService['get']>>
    dashboardElapsedMs: number
    riskOut: OptionalReaderOutcome<CommandCenterRiskReaderValue>
    predictionOut: OptionalReaderOutcome<CommandCenterPredictionReaderValue>
    resourceOut: OptionalReaderOutcome<CommandCenterResourceReaderValue>
  }): AggregationResult {
    const {
      organizationId,
      projectId,
      query,
      access,
      dashboard,
      dashboardElapsedMs,
      riskOut,
      predictionOut,
      resourceOut,
    } = input
    const nowIso = isoOf(this.clock())
    const warnings: CommandCenterWarning[] = []
    const discardedTargetWarnings: CommandCenterWarning[] = []

    // —— 来源元数据与摘要 ——
    const dashboardDigest = commandCenterFnv1a(dashboard.meta.metricVersion)
    const dashboardMeta: CommandCenterSourceMeta = {
      sourceKey: COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD,
      evidenceClass: COMMAND_CENTER_EVIDENCE_CLASSES.FACT,
      availability: COMMAND_CENTER_AVAILABILITIES.AVAILABLE,
      freshness: COMMAND_CENTER_FRESHNESS_STATES.CURRENT,
      authorityRef: { kind: 'project-dashboard', id: projectId },
      sourceVersionDigest: dashboardDigest,
      calculatedAt: dashboard.meta.calculatedAt,
      reasonCode: null,
    }

    // 健康 diagnosis：复用 Dashboard 已确认摘要，不额外查询、零生成零确认。
    // 注意：SQLite 下 boolean 列经 Lucid 读回可能是数值 0/1，统一 Boolean 化后再判定。
    const diagSummary = dashboard.healthDiagnosis
    const diagnosisAvailable =
      (diagSummary.available as unknown) === true && diagSummary.status === 'confirmed'
    const diagnosisStale = diagnosisAvailable && Boolean(diagSummary.stale)
    const diagnosisMeta: CommandCenterSourceMeta = diagnosisAvailable
      ? {
          sourceKey: COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS,
          evidenceClass: COMMAND_CENTER_EVIDENCE_CLASSES.CONFIRMED_DIAGNOSIS,
          availability: diagnosisStale
            ? COMMAND_CENTER_AVAILABILITIES.STALE
            : COMMAND_CENTER_AVAILABILITIES.AVAILABLE,
          freshness: diagnosisStale
            ? COMMAND_CENTER_FRESHNESS_STATES.STALE
            : COMMAND_CENTER_FRESHNESS_STATES.CURRENT,
          authorityRef: { kind: 'diagnosis', id: diagSummary.diagnosisId },
          sourceVersionDigest: commandCenterFnv1a(
            `${diagSummary.diagnosisId}:${diagSummary.confirmedAt ?? ''}`,
          ),
          calculatedAt: diagSummary.confirmedAt,
          reasonCode: diagnosisStale ? COMMAND_CENTER_REASON_CODES.HEALTH_DIAGNOSIS_STALE : null,
        }
      : {
          sourceKey: COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS,
          evidenceClass: COMMAND_CENTER_EVIDENCE_CLASSES.CONFIRMED_DIAGNOSIS,
          availability: COMMAND_CENTER_AVAILABILITIES.EMPTY,
          freshness: COMMAND_CENTER_FRESHNESS_STATES.UNKNOWN,
          authorityRef: { kind: 'diagnosis', id: null },
          sourceVersionDigest: null,
          calculatedAt: null,
          reasonCode: COMMAND_CENTER_REASON_CODES.HEALTH_DIAGNOSIS_MISSING,
        }

    const taskTotal = Object.values(dashboard.stats.taskStatusDistribution).reduce(
      (s, v) => s + Number(v),
      0,
    )
    const overdueTaskCount = Number(
      dashboard.metrics.find((m) => m.key === DASHBOARD_METRIC_KEYS.OVERDUE_TASK_COUNT)?.value ?? 0,
    )
    const blockedTaskCount = Number(dashboard.stats.taskStatusDistribution.blocked ?? 0)
    const milestoneTotal = Object.values(dashboard.stats.milestoneStatusDistribution).reduce(
      (s, v) => s + Number(v),
      0,
    )

    // 风险来源：无权限时整体缺席（无数量/时间/hash/引用），不进入签名与队列。
    const riskMeta: CommandCenterSourceMeta = !access.canViewRisk
      ? {
          sourceKey: COMMAND_CENTER_SOURCES.RISK_WORKBENCH,
          evidenceClass: COMMAND_CENTER_EVIDENCE_CLASSES.FACT,
          availability: COMMAND_CENTER_AVAILABILITIES.FORBIDDEN,
          freshness: COMMAND_CENTER_FRESHNESS_STATES.UNKNOWN,
          authorityRef: null,
          sourceVersionDigest: null,
          calculatedAt: null,
          reasonCode: COMMAND_CENTER_REASON_CODES.SOURCE_UNAVAILABLE,
        }
      : metaFromOutcome(
          COMMAND_CENTER_SOURCES.RISK_WORKBENCH,
          riskOut,
          (v) =>
            v.summary.totalRisks === 0
              ? ''
              : commandCenterFnv1a(
                  `${v.summary.totalRisks}:${v.summary.openRisks}:${v.summary.overdueReviewCount}`,
                ),
          () => null,
        )

    const predictionMeta: CommandCenterSourceMeta = metaFromOutcome(
      COMMAND_CENTER_SOURCES.PREDICTION,
      predictionOut,
      (v) =>
        v.snapshotId === null
          ? ''
          : commandCenterFnv1a(`${v.snapshotId}:${v.signalCount}:${String(v.stale)}`),
      (v) => v.confirmedAt,
    )
    adjustPredictionEmptyState(predictionMeta)

    const resourceMeta: CommandCenterSourceMeta = !access.canViewResource
      ? {
          sourceKey: COMMAND_CENTER_SOURCES.RESOURCE_LOAD,
          evidenceClass: COMMAND_CENTER_EVIDENCE_CLASSES.FACT,
          availability: COMMAND_CENTER_AVAILABILITIES.FORBIDDEN,
          freshness: COMMAND_CENTER_FRESHNESS_STATES.UNKNOWN,
          authorityRef: null,
          sourceVersionDigest: null,
          calculatedAt: null,
          reasonCode: COMMAND_CENTER_REASON_CODES.SOURCE_UNAVAILABLE,
        }
      : metaFromOutcome(
          COMMAND_CENTER_SOURCES.RESOURCE_LOAD,
          resourceOut,
          (v) =>
            isTeamLoadResult(v)
              ? commandCenterFnv1a(
                  `res:${v.resources.length}:${Math.round(v.teamAverageUtilizationPercent)}`,
                )
              : '',
          () => null,
        )

    const changeImpactMeta: CommandCenterSourceMeta = {
      sourceKey: COMMAND_CENTER_SOURCES.CHANGE_IMPACT,
      evidenceClass: COMMAND_CENTER_EVIDENCE_CLASSES.AVAILABILITY_WARNING,
      availability: COMMAND_CENTER_AVAILABILITIES.UNSUPPORTED,
      freshness: COMMAND_CENTER_FRESHNESS_STATES.UNKNOWN,
      authorityRef: null,
      sourceVersionDigest: null,
      calculatedAt: null,
      reasonCode: COMMAND_CENTER_REASON_CODES.SOURCE_UNAVAILABLE,
    }

    // —— headline precedence 与冲突 ——
    const headline = resolveHeadline({
      dashboard: {
        meta: dashboardMeta,
        facts: {
          sourceKey: COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD,
          healthStatus: normalizeHealthStatus(dashboard.stats.healthStatus),
          progressPercent: Number(dashboard.stats.progressPercent),
          memberCount: dashboard.stats.memberCount,
          remainingDays: dashboard.stats.remainingDays,
          metricVersion: dashboard.meta.metricVersion,
        },
      },
      diagnosis: diagnosisAvailable
        ? {
            meta: diagnosisMeta,
            facts: {
              sourceKey: COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS,
              diagnosisId: diagSummary.diagnosisId!,
              overallScore: diagSummary.overallScore ?? null,
              overallLabel: diagSummary.overallLabel ?? null,
              status: 'confirmed',
              stale: Boolean(diagSummary.stale),
              confirmedAt: diagSummary.confirmedAt,
              dimensionScores: diagSummary.dimensionScores.map((ds) => ({
                dimension: ds.dimension,
                score: ds.score,
                severity: toSeverity(ds.severity),
              })),
            },
          }
        : null,
    })

    const riskFacts: import('@aiproj/types').RiskWorkbenchCommandCenterFacts | null =
      riskOut.status === 'fulfilled' && riskOut.value
        ? {
            sourceKey: COMMAND_CENTER_SOURCES.RISK_WORKBENCH,
            totalRisks: riskOut.value.summary.totalRisks,
            openRisks: riskOut.value.summary.openRisks,
            highRiskCount: riskOut.value.summary.highRiskCount,
            criticalRiskCount: riskOut.value.summary.criticalRiskCount,
            overdueReviewCount: riskOut.value.summary.overdueReviewCount,
            incompleteResponsePlans: riskOut.value.summary.incompleteResponsePlans,
            healthScore: riskOut.value.summary.healthScore,
            trend30d: riskOut.value.summary.trend30d,
          }
        : null
    const conflictWarning = detectSourcePostureConflict(headline, riskFacts)
    if (conflictWarning) warnings.push(conflictWarning)

    // —— 注意力候选（仅来自已授权来源的既有严重度/逾期/stale 信号）——
    const candidates: CommandCenterAttentionCandidate[] = []

    if (diagnosisStale && diagSummary.diagnosisId != null) {
      candidates.push({
        sourceKey: COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS,
        kind: 'source-stale-review',
        severity: COMMAND_CENTER_SEVERITIES.MEDIUM,
        reasonCode: COMMAND_CENTER_REASON_CODES.SOURCE_STALE_REVIEW_REQUIRED,
        entityRef: { kind: 'diagnosis', id: diagSummary.diagnosisId },
        label: '健康诊断需要刷新复核',
        occurredAt: diagSummary.confirmedAt,
        dueAt: null,
        stale: true,
        targets: [
          {
            kind: 'health-evidence',
            params: { projectId, diagnosisId: diagSummary.diagnosisId },
          },
        ],
      })
    }

    if (riskOut.status === 'fulfilled' && riskOut.value) {
      for (const r of riskOut.value.summary.topRisks.slice(0, 5)) {
        candidates.push({
          sourceKey: COMMAND_CENTER_SOURCES.RISK_WORKBENCH,
          kind: 'high-risk-open',
          severity:
            r.riskLevel === 'critical'
              ? COMMAND_CENTER_SEVERITIES.CRITICAL
              : COMMAND_CENTER_SEVERITIES.HIGH,
          reasonCode: COMMAND_CENTER_REASON_CODES.HIGH_SEVERITY_RISK_OPEN,
          entityRef: { kind: 'risk', id: r.id },
          label: r.title,
          occurredAt: null,
          dueAt: null,
          stale: false,
          targets: [{ kind: 'risk-detail', params: { projectId, riskId: r.id } }],
        })
      }
      const nowDate = isoDateOf(this.clock())
      for (const q of riskOut.value.reviewQueue) {
        if (!q.nextReviewAt) continue
        const due = q.nextReviewAt.slice(0, 10)
        if (due >= nowDate) continue
        candidates.push({
          sourceKey: COMMAND_CENTER_SOURCES.RISK_WORKBENCH,
          kind: 'risk-review-overdue',
          severity:
            q.riskLevel === 'critical'
              ? COMMAND_CENTER_SEVERITIES.CRITICAL
              : q.riskLevel === 'high'
                ? COMMAND_CENTER_SEVERITIES.HIGH
                : COMMAND_CENTER_SEVERITIES.MEDIUM,
          reasonCode: COMMAND_CENTER_REASON_CODES.RISK_REVIEW_OVERDUE,
          entityRef: { kind: 'risk', id: q.id },
          label: q.title,
          occurredAt: q.lastReviewAt,
          dueAt: q.nextReviewAt,
          stale: false,
          targets: [{ kind: 'risk-detail', params: { projectId, riskId: q.id } }],
        })
      }
    }

    if (predictionOut.status === 'fulfilled' && predictionOut.value) {
      // DashboardPredictionSummary 原生携带 stale/staleReason，无需类型改写。
      const p = predictionOut.value
      if (p.snapshotId !== null && p.stale) {
        candidates.push({
          sourceKey: COMMAND_CENTER_SOURCES.PREDICTION,
          kind: 'source-stale-review',
          severity: COMMAND_CENTER_SEVERITIES.LOW,
          reasonCode: COMMAND_CENTER_REASON_CODES.PREDICTION_STALE,
          entityRef: { kind: 'prediction-snapshot', id: p.snapshotId },
          label: '预测快照已过期',
          occurredAt: p.confirmedAt,
          dueAt: null,
          stale: true,
          targets: [{ kind: 'prediction-workbench', params: { projectId } }],
        })
      } else if (
        p.snapshotId !== null &&
        (p.maxSeverity === 'critical' || p.maxSeverity === 'high')
      ) {
        candidates.push({
          sourceKey: COMMAND_CENTER_SOURCES.PREDICTION,
          kind: 'prediction-signal',
          severity:
            p.maxSeverity === 'critical'
              ? COMMAND_CENTER_SEVERITIES.CRITICAL
              : COMMAND_CENTER_SEVERITIES.HIGH,
          reasonCode: COMMAND_CENTER_REASON_CODES.PREDICTION_SIGNAL_ACTIVE,
          entityRef: { kind: 'prediction-snapshot', id: p.snapshotId },
          label: `预测信号 ${p.criticalCount + p.highCount} 条`,
          occurredAt: p.confirmedAt,
          dueAt: null,
          stale: false,
          targets: [{ kind: 'prediction-workbench', params: { projectId } }],
        })
      }
    }

    const taskMilestoneFacts: TaskMilestoneCommandCenterFacts = {
      sourceKey: COMMAND_CENTER_SOURCES.TASK_MILESTONE,
      taskTotal,
      overdueTaskCount,
      blockedTaskCount,
      milestoneTotal,
      overdueMilestoneCount: Number(dashboard.stats.milestoneStatusDistribution.overdue ?? 0),
    }
    if (overdueTaskCount > 0 || blockedTaskCount > 0) {
      candidates.push({
        sourceKey: COMMAND_CENTER_SOURCES.TASK_MILESTONE,
        kind: 'task-overdue',
        severity:
          overdueTaskCount / Math.max(taskTotal, 1) >= 0.25 ||
          blockedTaskCount / Math.max(taskTotal, 1) >= 0.25
            ? COMMAND_CENTER_SEVERITIES.HIGH
            : COMMAND_CENTER_SEVERITIES.MEDIUM,
        reasonCode: COMMAND_CENTER_REASON_CODES.TASK_OVERDUE,
        entityRef: { kind: 'project', id: projectId },
        label: `${overdueTaskCount + blockedTaskCount} 个任务逾期或受阻`,
        occurredAt: dashboard.meta.calculatedAt,
        dueAt: null,
        stale: false,
        targets: [{ kind: 'project-dashboard', params: { projectId } }],
      })
    }
    if (taskMilestoneFacts.overdueMilestoneCount > 0) {
      candidates.push({
        sourceKey: COMMAND_CENTER_SOURCES.TASK_MILESTONE,
        kind: 'milestone-pressure',
        severity: COMMAND_CENTER_SEVERITIES.MEDIUM,
        reasonCode: COMMAND_CENTER_REASON_CODES.MILESTONE_OVERDUE,
        entityRef: { kind: 'project', id: projectId },
        label: `${taskMilestoneFacts.overdueMilestoneCount} 个里程碑逾期`,
        occurredAt: dashboard.meta.calculatedAt,
        dueAt: null,
        stale: false,
        targets: [{ kind: 'milestone-view', params: { projectId } }],
      })
    }

    if (
      resourceOut.status === 'fulfilled' &&
      resourceOut.value &&
      isTeamLoadResult(resourceOut.value)
    ) {
      const overAllocated = resourceOut.value.resources.filter(
        (r) => r.overallUtilizationPercent > 100,
      ).length
      if (overAllocated > 0) {
        candidates.push({
          sourceKey: COMMAND_CENTER_SOURCES.RESOURCE_LOAD,
          kind: 'resource-pressure',
          severity: COMMAND_CENTER_SEVERITIES.MEDIUM,
          reasonCode: COMMAND_CENTER_REASON_CODES.RESOURCE_OVERALLOCATION,
          entityRef: { kind: 'project', id: projectId },
          label: `${overAllocated} 名成员超负荷分配`,
          occurredAt: null,
          dueAt: null,
          stale: false,
          targets: [{ kind: 'resource-workbench', params: { projectId } }],
        })
      }
    }

    // 失败/超时来源的低敏提示（不含内部原因全文）。
    const failureMetas: Array<CommandCenterSourceMeta | null> = [
      riskOut.status === 'rejected' || riskOut.status === 'timeout'
        ? riskMeta.availability === COMMAND_CENTER_AVAILABILITIES.UNAVAILABLE
          ? riskMeta
          : null
        : null,
      predictionOut.status === 'rejected' || predictionOut.status === 'timeout'
        ? predictionMeta.availability === COMMAND_CENTER_AVAILABILITIES.UNAVAILABLE
          ? predictionMeta
          : null
        : null,
      resourceOut.status === 'rejected' || resourceOut.status === 'timeout'
        ? resourceMeta.availability === COMMAND_CENTER_AVAILABILITIES.UNAVAILABLE
          ? resourceMeta
          : null
        : null,
    ]
    for (const meta of failureMetas) {
      if (!meta) continue
      warnings.push({
        code: COMMAND_CENTER_WARNING_CODES.SOURCE_UNAVAILABLE,
        sourceKey: meta.sourceKey,
        message: '该来源暂时不可用，可稍后重试',
      })
    }

    // —— 有界注意力队列 ——
    const queue = projectAttentionQueue(candidates, query.attentionLimit)
    if (queue.truncation.truncated) {
      warnings.push({
        code: COMMAND_CENTER_WARNING_CODES.ATTENTION_TRUNCATED,
        sourceKey: null,
        message: `注意力项超过 ${query.attentionLimit} 条上限，已按稳定规则截断`,
      })
    }

    // —— 来源 summaries（targets 经宿主 allowlist 二次校验）——
    const safeTargetsOf = (targets: CommandCenterSafeTarget[]): CommandCenterSafeTarget[] => {
      const accepted: CommandCenterSafeTarget[] = []
      for (const t of targets) {
        const verdict = validateSafeTarget(t, { projectId })
        if (verdict.ok) accepted.push(verdict.target)
        else {
          discardedTargetWarnings.push({
            code: COMMAND_CENTER_WARNING_CODES.FORGED_TARGET_DISCARDED,
            sourceKey: null,
            message: '一个导航目标未通过安全校验，已被丢弃',
          })
        }
      }
      return accepted.slice(0, 3)
    }

    const dashboardFacts: import('@aiproj/types').ProjectDashboardCommandCenterFacts = {
      sourceKey: COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD,
      healthStatus: normalizeHealthStatus(dashboard.stats.healthStatus),
      progressPercent: Number(dashboard.stats.progressPercent),
      memberCount: dashboard.stats.memberCount,
      remainingDays: dashboard.stats.remainingDays,
      metricVersion: dashboard.meta.metricVersion,
    }

    const sources: CommandCenterSourceSummary[] = [
      {
        sourceKey: COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD,
        meta: dashboardMeta,
        warnings: dashboard.warnings.slice(0, COMMAND_CENTER_MAX_EVIDENCE_PER_SOURCE).map((w) => ({
          code: COMMAND_CENTER_WARNING_CODES.DASHBOARD_RECONCILIATION,
          sourceKey: COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD,
          message: String(w.message ?? '').slice(0, 80) || '基础指标存在对账提示',
        })),
        targets: safeTargetsOf([{ kind: 'project-dashboard', params: { projectId } }]),
        facts: dashboardFacts,
      },
      {
        sourceKey: COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS,
        meta: diagnosisMeta,
        warnings:
          diagnosisMeta.availability === COMMAND_CENTER_AVAILABILITIES.EMPTY
            ? [
                {
                  code: COMMAND_CENTER_WARNING_CODES.HEALTH_DIAGNOSIS_MISSING,
                  sourceKey: COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS,
                  message: '暂无已确认的健康诊断概览',
                },
              ]
            : [],
        targets: safeTargetsOf(
          diagnosisAvailable && diagSummary.diagnosisId != null
            ? [
                {
                  kind: 'health-evidence',
                  params: { projectId, diagnosisId: diagSummary.diagnosisId },
                },
              ]
            : [],
        ),
        facts: diagnosisAvailable
          ? {
              sourceKey: COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS,
              diagnosisId: diagSummary.diagnosisId!,
              overallScore: diagSummary.overallScore ?? null,
              overallLabel: diagSummary.overallLabel ?? null,
              status: 'confirmed',
              stale: Boolean(diagSummary.stale),
              confirmedAt: diagSummary.confirmedAt,
              dimensionScores: diagSummary.dimensionScores.map((ds) => ({
                dimension: ds.dimension,
                score: ds.score,
                severity: toSeverity(ds.severity),
              })),
            }
          : null,
      },
      {
        sourceKey: COMMAND_CENTER_SOURCES.RISK_WORKBENCH,
        meta: riskMeta,
        warnings: [
          ...sourceWarnings(riskMeta),
          ...(conflictWarning
            ? [
                {
                  ...conflictWarning,
                  sourceKey: COMMAND_CENTER_SOURCES.RISK_WORKBENCH,
                },
              ]
            : []),
        ],
        targets: safeTargetsOf(
          access.canViewRisk ? [{ kind: 'risk-workbench', params: { projectId } }] : [],
        ),
        facts: riskFacts,
      },
      {
        sourceKey: COMMAND_CENTER_SOURCES.PREDICTION,
        meta: predictionMeta,
        warnings: sourceWarnings(predictionMeta),
        targets: safeTargetsOf([{ kind: 'prediction-workbench', params: { projectId } }]),
        facts:
          predictionOut.status === 'fulfilled' &&
          predictionOut.value &&
          predictionOut.value.snapshotId !== null
            ? ({
                sourceKey: COMMAND_CENTER_SOURCES.PREDICTION,
                snapshotId: predictionOut.value.snapshotId,
                window: predictionOut.value.window ?? null,
                signalCount: predictionOut.value.signalCount,
                criticalCount: predictionOut.value.criticalCount,
                highCount: predictionOut.value.highCount,
                maxSeverity: toSeverity(predictionOut.value.maxSeverity),
                confirmedAt: predictionOut.value.confirmedAt,
                hasAiExplanation: predictionOut.value.hasAiExplanation,
              } satisfies PredictionCommandCenterFacts)
            : null,
      },
      {
        sourceKey: COMMAND_CENTER_SOURCES.TASK_MILESTONE,
        meta: {
          sourceKey: COMMAND_CENTER_SOURCES.TASK_MILESTONE,
          evidenceClass: COMMAND_CENTER_EVIDENCE_CLASSES.FACT,
          availability:
            taskTotal === 0
              ? COMMAND_CENTER_AVAILABILITIES.EMPTY
              : COMMAND_CENTER_AVAILABILITIES.AVAILABLE,
          freshness: COMMAND_CENTER_FRESHNESS_STATES.CURRENT,
          authorityRef: { kind: 'project-dashboard', id: projectId },
          sourceVersionDigest: dashboardDigest,
          calculatedAt: dashboard.meta.calculatedAt,
          reasonCode: null,
        },
        warnings: [],
        targets: [],
        facts: taskMilestoneFacts,
      },
      {
        sourceKey: COMMAND_CENTER_SOURCES.RESOURCE_LOAD,
        meta: resourceMeta,
        warnings: sourceWarnings(resourceMeta),
        targets: safeTargetsOf(
          access.canViewResource ? [{ kind: 'resource-workbench', params: { projectId } }] : [],
        ),
        facts:
          resourceOut.status === 'fulfilled' &&
          resourceOut.value &&
          isTeamLoadResult(resourceOut.value)
            ? ({
                sourceKey: COMMAND_CENTER_SOURCES.RESOURCE_LOAD,
                overAllocatedMemberCount: resourceOut.value.resources.filter(
                  (r) => r.overallUtilizationPercent > 100,
                ).length,
                peakUtilizationPercent: resourceOut.value.resources.reduce<number>(
                  (peak, r) => Math.max(peak, Math.round(r.overallUtilizationPercent)),
                  0,
                ),
              } satisfies ResourceLoadCommandCenterFacts)
            : null,
      },
      {
        sourceKey: COMMAND_CENTER_SOURCES.CHANGE_IMPACT,
        meta: changeImpactMeta,
        warnings: [
          {
            code: COMMAND_CENTER_WARNING_CODES.SOURCE_UNSUPPORTED,
            sourceKey: COMMAND_CENTER_SOURCES.CHANGE_IMPACT,
            message: '变更影响摘要暂无安全只读出口，首期不接入',
          },
        ],
        targets: [],
        facts: null,
      },
    ]

    // —— 投影签名（隐藏/受限来源在构造前已排除，天然不进签名）——
    const permissionBits = ['project:view']
    if (access.canViewRisk) permissionBits.push('risk:view')
    if (access.canViewResource) permissionBits.push('resource:view')
    if (access.canViewChangeImpact) permissionBits.push('change_impact:view')
    const signatureSources = sources
      .filter((s) => s.meta.availability !== COMMAND_CENTER_AVAILABILITIES.FORBIDDEN)
      .map((s) => ({
        sourceKey: s.meta.sourceKey,
        evidenceClass: s.meta.evidenceClass,
        availability: s.meta.availability,
        freshness: s.meta.freshness,
        reasonCode: s.meta.reasonCode,
        sourceVersionDigest: s.meta.sourceVersionDigest,
        entityRefs: queue.items
          .filter((i) => i.sourceKey === s.meta.sourceKey && i.entityRef)
          .map((i) => i.entityRef!),
      }))
    const projectionSignature = computeProjectionSignature({
      permissionFingerprint: computeCommandCenterPermissionFingerprint(permissionBits),
      query,
      sources: signatureSources,
    })

    // —— 低敏结构化输出二次扫描（损坏来源只产生 bounded warning）——
    const data: CommandCenterResponseData = {
      project: { id: projectId, organizationId },
      headline,
      sources,
      attention: queue.items,
    }
    const findings = detectForbiddenFields(data)
    if (findings.length > 0) {
      throw new Error('COMMAND_CENTER_LOW_SENSITIVE_SCAN_FAILED')
    }

    const meta: CommandCenterMeta = {
      contractVersion: COMMAND_CENTER_CONTRACT_VERSION,
      attentionRuleVersion: COMMAND_CENTER_ATTENTION_RULE_VERSION,
      calculatedAt: nowIso,
      projectionSignature,
      overallAvailability: deriveOverallAvailability(sources.map((s) => s.meta.availability)),
      sourceCounts: countByAvailability(sources.map((s) => s.meta.availability)),
      attentionTruncation: queue.truncation,
      perSourceTimingMs: {
        [COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD]: Math.max(0, Math.round(dashboardElapsedMs)),
        ...(riskOut.elapsedMs > 0
          ? { [COMMAND_CENTER_SOURCES.RISK_WORKBENCH]: Math.round(riskOut.elapsedMs) }
          : {}),
        ...(predictionOut.elapsedMs > 0
          ? { [COMMAND_CENTER_SOURCES.PREDICTION]: Math.round(predictionOut.elapsedMs) }
          : {}),
        ...(resourceOut.elapsedMs > 0
          ? { [COMMAND_CENTER_SOURCES.RESOURCE_LOAD]: Math.round(resourceOut.elapsedMs) }
          : {}),
      },
    }

    void discardedTargetWarnings.length // 目标全部由本服务闭集构造；守卫面保持常热。

    return { data, meta }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // helpers
  // ───────────────────────────────────────────────────────────────────────────

  private recordQueries(sourceKey: CommandCenterSourceKey, count: number): void {
    this.queryLedger?.entries.push({ sourceKey, queries: count })
  }

  private skipped<T>(): OptionalReaderOutcome<T> {
    return { status: 'skipped', value: null, elapsedMs: 0 }
  }

  private async runReader<T>(
    _sourceKey: CommandCenterSourceKey,
    deadlineAt: number,
    fn: () => Promise<T>,
  ): Promise<OptionalReaderOutcome<T>> {
    const started = this.clock().getTime()
    try {
      const remaining = Math.max(0, deadlineAt - started)
      const value = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('READER_DEADLINE_EXCEEDED')), remaining)
          ;(timer as unknown as { unref?: () => void }).unref?.()
        }),
      ])
      return { status: 'fulfilled', value, elapsedMs: this.clock().getTime() - started }
    } catch {
      return {
        status: this.clock().getTime() - started >= this.readerDeadlineMs ? 'timeout' : 'rejected',
        value: null,
        elapsedMs: this.clock().getTime() - started,
      }
    }
  }
}

// ─── module-level 纯辅助（不持有状态）────────────────────────────────────────────

function metaFromOutcome<T>(
  sourceKey: CommandCenterSourceKey,
  outcome: OptionalReaderOutcome<T>,
  digestOf: (value: T) => string,
  calculatedAtOf: (value: T) => string | null | undefined,
): CommandCenterSourceMeta {
  if (outcome.status === 'skipped') {
    return {
      sourceKey,
      evidenceClass: COMMAND_CENTER_EVIDENCE_CLASSES.FACT,
      availability: COMMAND_CENTER_AVAILABILITIES.FORBIDDEN,
      freshness: COMMAND_CENTER_FRESHNESS_STATES.UNKNOWN,
      authorityRef: null,
      sourceVersionDigest: null,
      calculatedAt: null,
      reasonCode: COMMAND_CENTER_REASON_CODES.SOURCE_UNAVAILABLE,
    }
  }
  if (outcome.status === 'rejected' || outcome.status === 'timeout') {
    return {
      sourceKey,
      evidenceClass: COMMAND_CENTER_EVIDENCE_CLASSES.AVAILABILITY_WARNING,
      availability: COMMAND_CENTER_AVAILABILITIES.UNAVAILABLE,
      freshness: COMMAND_CENTER_FRESHNESS_STATES.UNKNOWN,
      authorityRef: null,
      sourceVersionDigest: null,
      calculatedAt: null,
      reasonCode: COMMAND_CENTER_REASON_CODES.SOURCE_UNAVAILABLE,
    }
  }
  const value = outcome.value!
  const digest = digestOf(value)
  return {
    sourceKey,
    evidenceClass: COMMAND_CENTER_EVIDENCE_CLASSES.FACT,
    availability:
      digest === '' ? COMMAND_CENTER_AVAILABILITIES.EMPTY : COMMAND_CENTER_AVAILABILITIES.AVAILABLE,
    freshness: COMMAND_CENTER_FRESHNESS_STATES.CURRENT,
    authorityRef: { kind: sourceKey, id: null },
    sourceVersionDigest: digest === '' ? null : digest,
    calculatedAt: calculatedAtOf(value) ?? null,
    reasonCode: null,
  }
}

/** 预测空态修正：snapshotId 为 null 时显式 empty（metaFromOutcome 以 digest=='' 判空）。 */
function adjustPredictionEmptyState(meta: CommandCenterSourceMeta): void {
  if (
    meta.sourceKey === COMMAND_CENTER_SOURCES.PREDICTION &&
    meta.availability === COMMAND_CENTER_AVAILABILITIES.EMPTY
  ) {
    meta.reasonCode = COMMAND_CENTER_REASON_CODES.PREDICTION_STALE
  }
}

function sourceWarnings(meta: CommandCenterSourceMeta): CommandCenterWarning[] {
  switch (meta.availability) {
    case COMMAND_CENTER_AVAILABILITIES.FORBIDDEN:
      return [
        {
          code: COMMAND_CENTER_WARNING_CODES.PERMISSION_REDACTED,
          sourceKey: meta.sourceKey,
          message: '当前账号无该维度查看权限',
        },
      ]
    case COMMAND_CENTER_AVAILABILITIES.UNAVAILABLE:
      return [
        {
          code: COMMAND_CENTER_WARNING_CODES.SOURCE_UNAVAILABLE,
          sourceKey: meta.sourceKey,
          message: '该来源暂时不可用，可稍后重试',
        },
      ]
    case COMMAND_CENTER_AVAILABILITIES.EMPTY:
      return [
        {
          code: COMMAND_CENTER_WARNING_CODES.SOURCE_EMPTY,
          sourceKey: meta.sourceKey,
          message: '该来源暂无数据',
        },
      ]
    default:
      return []
  }
}

function normalizeHealthStatus(value: string): 'green' | 'yellow' | 'red' | 'unknown' {
  return value === 'green' || value === 'yellow' || value === 'red' ? value : 'unknown'
}

function toSeverity(value: unknown): import('@aiproj/types').CommandCenterSeverity {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'info'
}

function isTeamLoadResult(value: unknown): value is {
  resources: Array<{ overallUtilizationPercent: number }>
  teamAverageUtilizationPercent: number
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { resources?: unknown }).resources)
  )
}

function deriveOverallAvailability(
  availabilities: CommandCenterAvailability[],
): CommandCenterAvailability {
  if (availabilities.includes(COMMAND_CENTER_AVAILABILITIES.UNAVAILABLE)) {
    return COMMAND_CENTER_AVAILABILITIES.STALE
  }
  return availabilities.every((a) => a === COMMAND_CENTER_AVAILABILITIES.AVAILABLE)
    ? COMMAND_CENTER_AVAILABILITIES.AVAILABLE
    : COMMAND_CENTER_AVAILABILITIES.STALE
}

function countByAvailability(
  availabilities: CommandCenterAvailability[],
): Record<CommandCenterAvailability, number> {
  const counts = {
    available: 0,
    empty: 0,
    stale: 0,
    forbidden: 0,
    unavailable: 0,
    unsupported: 0,
  } as Record<CommandCenterAvailability, number>
  for (const a of availabilities) counts[a] += 1
  return counts
}

export type { CommandCenterAttentionItem }
