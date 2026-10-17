import PmoAiPriorityRecommendation from '#models/pmo_ai_priority_recommendation'
import ProjectHealthDiagnosis from '#models/project_health_diagnosis'
import ProjectSignal from '#models/project_signal'
import type User from '#models/user'
import PmoAiPriorityRecommendationPolicy from '#policies/pmo_ai_priority_recommendation_policy'
import ProjectHealthDiagnosisPolicy from '#policies/project_health_diagnosis_policy'
import { PROJECT_VIEW } from '#rbac'
import RbacService from '#services/rbac_service'
import { PROJECT_SIGNAL_TYPE_LABELS } from '#services/project_signal/signal_contracts'
import type { ProjectSignalType } from '#services/project_signal/signal_contracts'
import { requiredPermissionFor } from '#services/project_signal/signal_permissions'
import { HEALTH_DIMENSION_LABELS } from '@aiproj/types'
import type {
  HealthDimension,
  InboxEntry,
  InboxEntryContent,
  InboxSourceKind,
  InboxSourceRef,
} from '@aiproj/types'

/**
 * 收件箱正文回源投影。
 *
 * 收件箱表按 spec 只存引用、不存建议正文，此前查询接口也就只返回元数据——
 * 卡片上看不到「这条建议说的是什么」，收件箱实际不可用。这里在**读取时**按条目的
 * 主来源引用（`sourceRefs[0]`）回源现读标题 / 摘要 / 建议动作，结果不写回收件箱表。
 *
 * 权限 fail-closed：先判项目 `project:view`，再沿用各来源自身的查看权限
 * （PMO / 健康诊断的 policy、信号按类型的领域权限）。任一不许即 `content: null`，
 * 不退回「全放」。
 */

/** 由 `project_signals` 供数的来源，回源时共用同一个 id 空间。 */
const SIGNAL_BACKED_SOURCES = new Set<InboxSourceKind>([
  'smart_recommendation',
  'progress_risk_prediction',
  'risk_ai_suggestion',
])

function refKey(ref: Pick<InboxSourceRef, 'sourceKind' | 'sourceId'>): string {
  return SIGNAL_BACKED_SOURCES.has(ref.sourceKind)
    ? `signal:${ref.sourceId}`
    : `${ref.sourceKind}:${ref.sourceId}`
}

function toSafeId(value: string | undefined): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** 只取有限数值的键值对，按「键=值」拼接；证据里的实体 ID 等非数值不展示。 */
function numericPairs(record: unknown): string | null {
  if (!record || typeof record !== 'object') return null
  const pairs = Object.entries(record as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .map(([k, v]) => `${k}=${Math.round((v as number) * 100) / 100}`)
  return pairs.length > 0 ? pairs.join('，') : null
}

export function buildPmoRecommendationContent(row: {
  title: string
  summary: string
  suggestedAction: string | null
}): InboxEntryContent {
  return {
    title: row.title,
    summary: row.summary || null,
    suggestedAction: row.suggestedAction || null,
  }
}

export function buildHealthItemContent(item: {
  dimension: HealthDimension
  ruleId: string
  evidence: string | null
  suggestedAction: string | null
}): InboxEntryContent {
  const dimension = HEALTH_DIMENSION_LABELS[item.dimension] ?? item.dimension
  return {
    title: `健康诊断 · ${dimension}（${item.ruleId}）`,
    summary: item.evidence || null,
    suggestedAction: item.suggestedAction || null,
  }
}

export function buildProjectSignalContent(signal: {
  signalType: ProjectSignalType
  observationWindow: string
  evidence: Record<string, unknown> | null
}): InboxEntryContent {
  const label = PROJECT_SIGNAL_TYPE_LABELS[signal.signalType] ?? signal.signalType
  const evidence = signal.evidence ?? {}
  const parts: string[] = []
  if (typeof evidence.metric === 'string' && evidence.metric) {
    parts.push(`指标 ${evidence.metric}`)
  }
  const readings = numericPairs(evidence.readings)
  if (readings) parts.push(`读数 ${readings}`)
  const thresholds = numericPairs(evidence.thresholds)
  if (thresholds) parts.push(`阈值 ${thresholds}`)
  return {
    title: `${label}（观测窗 ${signal.observationWindow}）`,
    summary: parts.length > 0 ? parts.join('；') : null,
    // 信号只存读数证据，没有来源给出的建议动作；不凭空编写。
    suggestedAction: null,
  }
}

export class InboxContentResolver {
  constructor(
    private readonly rbac: RbacService = new RbacService(),
    private readonly pmoPolicy: PmoAiPriorityRecommendationPolicy = new PmoAiPriorityRecommendationPolicy(
      new RbacService(),
    ),
    private readonly healthPolicy: ProjectHealthDiagnosisPolicy = new ProjectHealthDiagnosisPolicy(
      new RbacService(),
    ),
  ) {}

  async resolve(
    user: User,
    organizationId: number,
    entries: readonly InboxEntry[],
  ): Promise<InboxEntry[]> {
    if (entries.length === 0) return []

    const viewableProjects = new Set<number>()
    for (const projectId of new Set(entries.map((e) => Number(e.projectId)))) {
      if (!Number.isSafeInteger(projectId)) continue
      const check = await this.rbac.check(user, PROJECT_VIEW, organizationId, projectId)
      if (check.allowed) viewableProjects.add(projectId)
    }

    const refs = entries
      .filter((e) => viewableProjects.has(Number(e.projectId)))
      .map((e) => e.sourceRefs[0])
      .filter((ref): ref is InboxSourceRef => Boolean(ref))

    const contents = new Map<string, InboxEntryContent>()
    await this.loadPmo(user, organizationId, refs, contents)
    await this.loadHealth(user, organizationId, refs, contents)
    await this.loadSignals(user, organizationId, refs, contents)

    return entries.map((entry) => {
      const ref = entry.sourceRefs[0]
      const content =
        ref && viewableProjects.has(Number(entry.projectId))
          ? (contents.get(refKey(ref)) ?? null)
          : null
      return { ...entry, content }
    })
  }

  private async loadPmo(
    user: User,
    organizationId: number,
    refs: InboxSourceRef[],
    contents: Map<string, InboxEntryContent>,
  ): Promise<void> {
    const ids = refs
      .filter((r) => r.sourceKind === 'pmo_priority_recommendation')
      .map((r) => toSafeId(r.sourceId))
      .filter((id): id is number => id !== null)
    if (ids.length === 0) return
    if (!(await this.pmoPolicy.canView(user, organizationId))) return

    const rows = await PmoAiPriorityRecommendation.query()
      .where('organization_id', organizationId)
      .whereIn('id', ids)
    for (const row of rows) {
      contents.set(
        refKey({ sourceKind: 'pmo_priority_recommendation', sourceId: String(row.id) }),
        buildPmoRecommendationContent(row),
      )
    }
  }

  private async loadHealth(
    user: User,
    organizationId: number,
    refs: InboxSourceRef[],
    contents: Map<string, InboxEntryContent>,
  ): Promise<void> {
    // 适配器写入的 sourceId 形如 `${diagnosisId}:${itemId}`。
    const diagnosisIds = refs
      .filter((r) => r.sourceKind === 'health_diagnosis_draft')
      .map((r) => toSafeId(r.sourceId.split(':')[0]))
      .filter((id): id is number => id !== null)
    if (diagnosisIds.length === 0) return
    if (!(await this.healthPolicy.view(user, organizationId))) return

    const diagnoses = await ProjectHealthDiagnosis.query()
      .where('organization_id', organizationId)
      .whereIn('id', [...new Set(diagnosisIds)])
      .preload('items')
    for (const diagnosis of diagnoses) {
      for (const item of diagnosis.items) {
        contents.set(
          refKey({
            sourceKind: 'health_diagnosis_draft',
            sourceId: `${diagnosis.id}:${item.id}`,
          }),
          buildHealthItemContent(item),
        )
      }
    }
  }

  private async loadSignals(
    user: User,
    organizationId: number,
    refs: InboxSourceRef[],
    contents: Map<string, InboxEntryContent>,
  ): Promise<void> {
    const ids = refs
      .filter((r) => SIGNAL_BACKED_SOURCES.has(r.sourceKind))
      .map((r) => toSafeId(r.sourceId))
      .filter((id): id is number => id !== null)
    if (ids.length === 0) return

    const signals = await ProjectSignal.query()
      .where('organization_id', organizationId)
      .whereIn('id', [...new Set(ids)])
      .whereNull('deleted_at')

    // 与适配器同口径：按信号类型判领域权限，无权看风险数据的人也看不到风险信号正文。
    const permissionCache = new Map<string, boolean>()
    for (const signal of signals) {
      const cacheKey = `${signal.signalType}:${signal.projectId}`
      let allowed = permissionCache.get(cacheKey)
      if (allowed === undefined) {
        const check = await this.rbac.check(
          user,
          requiredPermissionFor(signal.signalType),
          organizationId,
          signal.projectId,
        )
        allowed = check.allowed
        permissionCache.set(cacheKey, allowed)
      }
      if (!allowed) continue
      contents.set(`signal:${signal.id}`, buildProjectSignalContent(signal))
    }
  }
}
