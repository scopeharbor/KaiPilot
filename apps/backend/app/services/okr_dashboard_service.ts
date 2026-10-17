import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import type User from '#models/user'
import OkrCycle from '#models/okr_cycle'
import OkrObjective from '#models/okr_objective'
import OkrKeyResult from '#models/okr_key_result'
import OkrAlignment from '#models/okr_alignment'
import OkrEvidenceLink from '#models/okr_evidence_link'
import OkrProgressHistory from '#models/okr_progress_history'
import OkrDashboardPolicy from '#policies/okr_dashboard_policy'
import {
  DefaultOkrDashboardBackflowReader,
  type OkrDashboardBackflowReader,
} from '#services/okr_dashboard_backflow_reader'
import {
  OKR_DASHBOARD_MAX_SCAN_OBJECTIVES,
  computeOkrDashboardSummary,
  normalizeOkrDashboardQuery,
  type ComputeOkrDashboardSummaryInput,
  type OkrAlignment as OkrAlignmentDto,
  type OkrConfidenceLevel,
  type OkrDashboardBackflowSummary,
  type OkrDashboardQuery,
  type OkrDashboardSummary,
  type OkrEvidenceLink as OkrEvidenceLinkDto,
  type OkrEvidenceSourceKind,
  type OkrEvidenceTargetKind,
  type OkrKeyResult as OkrKeyResultDto,
  type OkrMeasurementType,
  type OkrObjective as OkrObjectiveDto,
  type OkrProgressHistory as OkrProgressHistoryDto,
  type OkrScope,
  type OkrStatus,
} from '@aiproj/types'

/**
 * OkrDashboardService —— v3-okr-dashboard §3.5。
 *
 * 只读聚合：读 OKR cycle/objective/KR/alignment/evidence/progress_history，
 * 结合可选 backflow summary（未启用/未授权时降级），交给共享确定性 helper
 * `computeOkrDashboardSummary` 输出低敏摘要。
 *
 * 红线：
 *   - 所有查询自动附 `organization_id` 过滤；跨组织读取直接被过滤器排除。
 *   - 只做 SELECT，不产生审计事件的写、不生成 backflow candidate、不改 KR 值。
 *   - 未授权维度（backflow / project 下钻 / 证据敏感字段）在响应前脱敏。
 */
@inject()
export default class OkrDashboardService {
  private backflowReader: OkrDashboardBackflowReader = new DefaultOkrDashboardBackflowReader()

  constructor(private readonly policy: OkrDashboardPolicy) {}

  /** 测试场景可注入 fake/null reader。 */
  setBackflowReader(reader: OkrDashboardBackflowReader): void {
    this.backflowReader = reader
  }

  async getSummary(
    organizationId: number,
    query: OkrDashboardQuery,
    user: User,
  ): Promise<{ data: OkrDashboardSummary }> {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const normalized = normalizeOkrDashboardQuery(query)
    const access = await this.policy.resolveAccess(user, organizationId)

    // 1. 周期：默认选活跃周期或最新周期
    const cycle = await this.resolveCycle(organizationId, normalized.cycleId)

    // 2. 组织隔离查询——objective/KR/alignment/evidence/progressHistory
    let objectiveQuery = OkrObjective.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .limit(OKR_DASHBOARD_MAX_SCAN_OBJECTIVES)

    if (cycle) objectiveQuery = objectiveQuery.where('cycle_id', cycle.id)
    if (normalized.scopes && normalized.scopes.length > 0)
      objectiveQuery = objectiveQuery.whereIn('scope', normalized.scopes)
    if (normalized.ownerId) objectiveQuery = objectiveQuery.where('owner_id', normalized.ownerId)
    if (normalized.statuses && normalized.statuses.length > 0)
      objectiveQuery = objectiveQuery.whereIn('status', normalized.statuses)

    const objectiveRows = await objectiveQuery
    const objectives: OkrObjectiveDto[] = objectiveRows.map(toObjectiveDto)
    const objectiveIds = objectives.map((o) => o.id)

    // KR / alignment / evidence 都限定在 objective 范围内
    let keyResults: OkrKeyResultDto[] = []
    let alignments: OkrAlignmentDto[] = []
    let evidence: OkrEvidenceLinkDto[] = []
    let progressHistory: OkrProgressHistoryDto[] = []
    if (objectiveIds.length > 0) {
      const [krRows, alignRows, evidenceRows] = await Promise.all([
        OkrKeyResult.query()
          .where('organization_id', organizationId)
          .whereIn('objective_id', objectiveIds)
          .whereNull('deleted_at'),
        OkrAlignment.query()
          .where('organization_id', organizationId)
          .where((q) => {
            q.whereIn('child_objective_id', objectiveIds).orWhereIn(
              'parent_objective_id',
              objectiveIds,
            )
          })
          .whereNull('deleted_at'),
        OkrEvidenceLink.query()
          .where('organization_id', organizationId)
          .where((q) => {
            q.where((q2) => {
              q2.where('target_type', 'objective').whereIn('target_id', objectiveIds)
            })
          })
          .whereNull('deleted_at')
          .limit(OKR_DASHBOARD_MAX_SCAN_OBJECTIVES),
      ])
      keyResults = krRows.map(toKeyResultDto)
      alignments = alignRows.map(toAlignmentDto)

      // 追加 KR 级别证据
      const krIds = keyResults.map((k) => k.id)
      let krEvidenceRows: OkrEvidenceLink[] = []
      if (krIds.length > 0) {
        krEvidenceRows = await OkrEvidenceLink.query()
          .where('organization_id', organizationId)
          .where('target_type', 'key_result')
          .whereIn('target_id', krIds)
          .whereNull('deleted_at')
          .limit(OKR_DASHBOARD_MAX_SCAN_OBJECTIVES)
      }
      evidence = [...evidenceRows.map(toEvidenceLinkDto), ...krEvidenceRows.map(toEvidenceLinkDto)]

      if (krIds.length > 0) {
        const progressRows = await OkrProgressHistory.query()
          .where('organization_id', organizationId)
          .whereIn('key_result_id', krIds)
          .orderBy('recorded_at', 'desc')
          .limit(200)
        progressHistory = progressRows.map(toProgressHistoryDto)
      }
    }

    // 3. 证据脱敏：无 evidence 可见权限的用户不参与证据聚合
    const restrictedEvidenceCount = access.canViewEvidence ? 0 : evidence.length
    if (!access.canViewEvidence) evidence = []

    // 4. Backflow 摘要——始终只读，未授权/未启用降级为 unavailable
    const backflowInput = await this.resolveBackflow(organizationId, user)

    // 5. Freshness 元数据——用 objective / KR / alignment / evidence 的最新 updatedAt
    const freshness = {
      cycle: cycle?.updatedAt ?? null,
      objective: maxIso(objectives.map((o) => o.updatedAt)),
      keyResult: maxIso(keyResults.map((k) => k.updatedAt)),
      alignment: maxIso(alignments.map((a) => a.updatedAt)),
      evidence: maxIso(evidence.map((e) => e.updatedAt)),
      progressHistory: maxIso(progressHistory.map((p) => p.recordedAt)),
      backflow: backflowInput?.lastRefreshedAt ?? null,
    }

    const cycleContext: ComputeOkrDashboardSummaryInput['cycle'] = cycle
      ? {
          cycleId: cycle.id,
          title: cycle.title,
          status: cycle.status as OkrStatus,
          startDate: cycle.startDate,
          endDate: cycle.endDate,
        }
      : {
          cycleId: null,
          title: null,
          status: null,
          startDate: null,
          endDate: null,
        }

    const summary = computeOkrDashboardSummary({
      organizationId,
      actorId: user.id,
      cycle: cycleContext,
      objectives,
      keyResults,
      alignments,
      evidence,
      progressHistory,
      restrictedObjectiveCount: 0,
      restrictedKeyResultCount: 0,
      restrictedEvidenceCount,
      freshness,
      backflow: backflowInput,
      normalizedQuery: normalized,
    })

    return { data: summary }
  }

  private async resolveCycle(
    organizationId: number,
    cycleId: number | undefined,
  ): Promise<{
    id: number
    title: string
    status: string
    startDate: string
    endDate: string
    updatedAt: string
  } | null> {
    if (cycleId) {
      const row = await OkrCycle.query()
        .where('organization_id', organizationId)
        .whereNull('deleted_at')
        .where('id', cycleId)
        .first()
      if (!row) return null
      return toCycleContext(row)
    }
    const active = await OkrCycle.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .where('status', 'active')
      .orderBy('start_date', 'desc')
      .first()
    if (active) return toCycleContext(active)
    const latest = await OkrCycle.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .orderBy('start_date', 'desc')
      .first()
    return latest ? toCycleContext(latest) : null
  }

  /**
   * 只读 backflow 摘要 reader。未启用/未实现降级为 unavailable；无权限返回 forbidden；
   * 只从既有 backflow 汇总表读取，不触发生成、重算或写入。
   */
  private async resolveBackflow(
    organizationId: number,
    user: User,
  ): Promise<OkrDashboardBackflowSummaryInput | undefined> {
    // Backflow view 权限判定
    if (!(await this.policy.canViewBackflowSummary(user, organizationId))) {
      return { forbidden: true }
    }
    // 通过注入的 reader 读取——只 SELECT/COUNT，不触发任何写入或建议生成路径。
    // reader 抛错要降级成 unavailable 而不是把整份 summary 一起拖挂：
    // backflow 是 Dashboard 上的一块观察面，它读不到不该让其余 KPI 也读不到。
    let result: Awaited<ReturnType<OkrDashboardBackflowReader['read']>>
    try {
      result = await this.backflowReader.read(organizationId)
    } catch {
      return { unavailable: true }
    }
    if (result.unavailable || !result.available) {
      return { unavailable: true }
    }
    return {
      available: true,
      candidateCount: result.candidateCount,
      conflictCount: result.conflictCount,
      staleCount: result.staleCount,
      lastRefreshedAt: result.lastRefreshedAt,
      targets: [],
    }
  }
}

/**
 * OKR Dashboard 只读读审计/telemetry payload builder（§3.9-P1）。
 *
 * 目标：产出可供低敏日志/telemetry 记录的载荷，**绝不包含** prompt、模型输出、
 * 证据正文、Authorization、token、API key、跨组织数据、objective/KR/evidence 明细。
 * 输出仅含：计数、metricVersion、cycleId 与查询摘要中的白名单键。
 *
 * 使用者：可选，Controller 层若接入 telemetry 时调用；默认不写读审计（V1/V3 项目模式
 * 不记录 read 审计），此 helper 用于统一脱敏并作为未来接入 telemetry pipeline 的入口。
 */
export interface OkrDashboardReadTelemetryPayload {
  event: 'okr_dashboard.summary_read'
  actorId: number
  organizationId: number
  metricVersion: string
  cycleId: number | null
  attentionLimit: number
  staleThresholdMinutes: number
  visibleObjectiveCount: number
  visibleKeyResultCount: number
  restrictedObjectiveCount: number
  restrictedKeyResultCount: number
  warningCount: number
  inputSignatureHash: string
  calculatedAt: string
}

export function buildOkrDashboardReadTelemetryPayload(
  summary: OkrDashboardSummary,
): OkrDashboardReadTelemetryPayload {
  return {
    event: 'okr_dashboard.summary_read',
    actorId: summary.meta.actorId,
    organizationId: summary.meta.organizationId,
    metricVersion: summary.meta.metricVersion,
    cycleId: summary.meta.cycleId,
    attentionLimit: summary.meta.attentionLimit,
    staleThresholdMinutes: summary.meta.staleThresholdMinutes,
    visibleObjectiveCount: summary.meta.visibleObjectiveCount,
    visibleKeyResultCount: summary.meta.visibleKeyResultCount,
    restrictedObjectiveCount: summary.meta.restrictedObjectiveCount,
    restrictedKeyResultCount: summary.meta.restrictedKeyResultCount,
    warningCount: summary.warnings.length,
    inputSignatureHash: summary.meta.inputSignatureHash,
    calculatedAt: summary.meta.calculatedAt,
  }
}

type OkrDashboardBackflowSummaryInput = {
  available?: boolean
  forbidden?: boolean
  unavailable?: boolean
  candidateCount?: number
  conflictCount?: number
  staleCount?: number
  lastRefreshedAt?: string | null
  targets?: OkrDashboardBackflowSummary['targets']
}

// ── DTO Helpers ─────────────────────────────────────────────────────────────

function isoOr(value: unknown, fallback: string | null = null): string | null {
  if (value instanceof DateTime) return value.toISO() ?? fallback
  if (value === null || value === undefined) return fallback
  return String(value)
}

function requiredIso(value: unknown): string {
  return isoOr(value, new Date(0).toISOString()) as string
}

function maxIso(values: Array<string | null | undefined>): string | null {
  let max: string | null = null
  for (const value of values) {
    if (!value) continue
    if (max === null || value > max) max = value
  }
  return max
}

function toObjectiveDto(row: OkrObjective): OkrObjectiveDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    cycleId: row.cycleId,
    projectId: row.projectId,
    teamId: null,
    ownerId: row.ownerId,
    scope: row.scope as OkrScope,
    title: row.title,
    description: row.description ?? null,
    status: row.status as OkrStatus,
    weight: row.weight,
    progress: row.progress,
    confidence: row.confidence as OkrConfidenceLevel,
    startDate: row.startDate,
    endDate: row.endDate,
    metricVersion: row.metricVersion,
    calculatedAt: isoOr(row.calculatedAt),
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
    deletedAt: isoOr(row.deletedAt),
  }
}

function toKeyResultDto(row: OkrKeyResult): OkrKeyResultDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    objectiveId: row.objectiveId,
    title: row.title,
    description: row.description ?? null,
    measurementType: row.measurementType as OkrMeasurementType,
    unitLabel: row.unitLabel ?? null,
    baselineValue: row.baselineValue,
    targetValue: row.targetValue,
    currentValue: row.currentValue,
    confidence: row.confidence as OkrConfidenceLevel,
    status: row.status as OkrStatus,
    weight: row.weight,
    lastUpdatedAt: isoOr(row.lastUpdatedAt),
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
    deletedAt: isoOr(row.deletedAt),
  }
}

function toAlignmentDto(row: OkrAlignment): OkrAlignmentDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    childObjectiveId: row.childObjectiveId,
    parentObjectiveId: row.parentObjectiveId,
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
    deletedAt: isoOr(row.deletedAt),
  }
}

function toEvidenceLinkDto(row: OkrEvidenceLink): OkrEvidenceLinkDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    targetType: row.targetType as OkrEvidenceTargetKind,
    targetId: row.targetId,
    sourceKind: row.sourceKind as OkrEvidenceSourceKind,
    sourceId: row.sourceId,
    summary: row.summary,
    hash: row.hash,
    lastSeenAt: requiredIso(row.lastSeenAt),
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
    deletedAt: isoOr(row.deletedAt),
  }
}

function toProgressHistoryDto(row: OkrProgressHistory): OkrProgressHistoryDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    keyResultId: row.keyResultId,
    previousValue: row.previousValue,
    newValue: row.newValue,
    source: row.source as OkrEvidenceSourceKind,
    confidence: row.confidence as OkrConfidenceLevel,
    note: row.note,
    evidenceRefs: row.evidenceRefs,
    recordedBy: row.recordedBy,
    recordedAt: requiredIso(row.recordedAt),
    createdAt: requiredIso(row.createdAt),
  }
}

function toCycleContext(row: OkrCycle): {
  id: number
  title: string
  status: string
  startDate: string
  endDate: string
  updatedAt: string
} {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    startDate: row.startDate,
    endDate: row.endDate,
    updatedAt: requiredIso(row.updatedAt),
  }
}
