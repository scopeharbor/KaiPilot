import ProjectHealthDiagnosis from '#models/project_health_diagnosis'
import User from '#models/user'
import ProjectHealthDiagnosisPolicy from '#policies/project_health_diagnosis_policy'
import RbacService from '#services/rbac_service'
import { serializeInboxDedupeKey } from '@aiproj/types'
import type { HealthDimension, HealthSeverity } from '@aiproj/types'
import type { InboxProblemKind, InboxSeverity, InboxSourceKind } from '@aiproj/types'
import type { InboxSourceAdapter, InboxSourceEntry } from '../inbox_aggregator.js'

/**
 * `health_diagnosis_draft` 来源适配器。
 *
 * 收件箱条目粒度是**诊断项**（`project_health_diagnosis_items`）而非整份诊断：
 * 一份 AI 草案里的每条发现才对应一个可处理的问题。只取 `ai_ready` 状态的草案
 * ——`pending` 还没出结果，`confirmed`/`rejected` 已被处理过，都不该再进收件箱。
 *
 * 权限沿用来源自身模型（`ProjectHealthDiagnosisPolicy.view`）。
 */

/** 诊断维度 → 收件箱问题种类。 */
const PROBLEM_KIND_BY_DIMENSION: Record<HealthDimension, InboxProblemKind> = {
  progress: 'schedule_risk',
  critical_path: 'dependency_block',
  milestone: 'milestone_pressure',
  resource: 'resource_overload',
  risk: 'risk_escalation',
  change_impact: 'scope_change_impact',
  collaboration: 'process_gap',
  data_integrity: 'data_staleness',
}

/**
 * 健康严重度 → 收件箱严重度。
 * `ok` 不是问题，不进收件箱（在下面被过滤掉，这里的映射仅为类型完整）。
 */
const SEVERITY_MAP: Record<HealthSeverity, InboxSeverity> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  ok: 'info',
}

export class HealthDiagnosisDraftInboxAdapter implements InboxSourceAdapter {
  readonly sourceKind: InboxSourceKind = 'health_diagnosis_draft'

  constructor(
    private readonly policy: ProjectHealthDiagnosisPolicy = new ProjectHealthDiagnosisPolicy(
      new RbacService(),
    ),
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      await ProjectHealthDiagnosis.query().limit(1)
      return true
    } catch {
      return false
    }
  }

  async listForInbox(params: {
    organizationId: number
    projectId: number
    actorId: number
  }): Promise<InboxSourceEntry[]> {
    const actor = await User.find(params.actorId)
    if (!actor) return []
    if (!(await this.policy.view(actor, params.organizationId))) return []

    const diagnoses = await ProjectHealthDiagnosis.query()
      .where('organization_id', params.organizationId)
      .where('project_id', params.projectId)
      .where('status', 'ai_ready')
      .preload('items')

    const entries: InboxSourceEntry[] = []
    for (const diagnosis of diagnoses) {
      // outputHash 是诊断产出的内容哈希；缺失时退回输入签名，保证过期判定始终有锚点。
      const sourceHash = diagnosis.outputHash ?? diagnosis.inputSignature
      const capturedAt = diagnosis.generatedAt.toISO()!

      for (const item of diagnosis.items) {
        if (item.severity === 'ok') continue // 非问题项不进收件箱

        const problemKind = PROBLEM_KIND_BY_DIMENSION[item.dimension] ?? 'other'
        entries.push({
          // 诊断 id + 条目 id 才能唯一定位一条发现，回源时两者都要。
          sourceId: `${diagnosis.id}:${item.id}`,
          projectId: diagnosis.projectId,
          problemKind,
          severity: SEVERITY_MAP[item.severity] ?? 'info',
          // 去重键用「项目 + 维度 + 规则」：同一规则在同一维度反复命中应合并，
          // 而不是每次重新诊断都堆一条新的。刻意不含自由文本。
          declaredDedupeKey: serializeInboxDedupeKey({
            problemKind,
            declaredKey: `${diagnosis.projectId}:${item.dimension}:${item.ruleId}`,
          }),
          sourceHash,
          capturedAt,
        })
      }
    }
    return entries
  }
}
