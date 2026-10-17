import crypto from 'node:crypto'
import ProjectSignal from '#models/project_signal'
import User from '#models/user'
import { PROJECT_VIEW } from '#rbac'
import RbacService from '#services/rbac_service'
import { requiredPermissionFor } from '#services/project_signal/signal_permissions'
import type { ProjectSignalType } from '#services/project_signal/signal_contracts'
import { serializeInboxDedupeKey } from '@aiproj/types'
import type { InboxProblemKind, InboxSeverity, InboxSourceKind } from '@aiproj/types'
import { DateTime } from 'luxon'
import type { InboxSourceAdapter, InboxSourceEntry } from '../inbox_aggregator.js'

/**
 * 被动雷达信号（`project_signals`）来源适配器。
 *
 * 覆盖收件箱五来源里剩下的三个。它们与 PMO / 健康诊断不同，**没有各自独立的建议表**；
 * 真正的持久化检测结果只有一处——`project_signals` 的四类硬信号
 * （进度偏差 / 风险突变 / 资源过载 / 里程碑滑移）。因此三个来源由同一个类按
 * `signalTypes` 切分出三个实例，四类信号**各归一处、不重复计数**。
 *
 * 归属依据：`copilot_triggers/rule_registry.ts` 已把事件类型与收件箱来源对应起来，
 * 其中 `resource_overload → smart_recommendation`、`milestone_risk → progress_risk_prediction`
 * 是注册表里写死的；`progress_deviation`（进度偏差）归入「进度与风险预测」、
 * `risk_surge`（风险/缺陷突变）归入「AI 风险识别建议」为其自然语义延伸。
 *
 * **不走 `TriggerWiringService`**：那条推送链路自身还依赖一个未实现的
 * `sourceAdapter.getSnapshot`，且全仓没有任何调用方，产出的也是决策记录而非收件箱条目。
 * 收件箱既有的聚合模型是拉取式，这里与 PMO / 健康诊断两个适配器保持同一形状。
 */

/** 各来源认领的信号类型（闭集，四类各归一处）。 */
const SIGNAL_TYPES_BY_SOURCE = {
  smart_recommendation: ['resource_overload'],
  progress_risk_prediction: ['progress_deviation', 'milestone_slip'],
  risk_ai_suggestion: ['risk_surge'],
} as const satisfies Partial<Record<InboxSourceKind, readonly ProjectSignalType[]>>

export type ProjectSignalInboxSourceKind = keyof typeof SIGNAL_TYPES_BY_SOURCE

/** 信号类型 → 收件箱问题种类（四类都有精确对应，无需落 `other`）。 */
const PROBLEM_KIND_BY_SIGNAL: Record<ProjectSignalType, InboxProblemKind> = {
  progress_deviation: 'schedule_risk',
  risk_surge: 'risk_escalation',
  resource_overload: 'resource_overload',
  milestone_slip: 'milestone_pressure',
}

/**
 * 信号严重度（info/warning/critical）→ 收件箱严重度（critical/high/medium/low/info）。
 * 信号侧只有三档，`warning` 取收件箱的 `high`：它代表「需要处理但未到危急」。
 */
const SEVERITY_MAP = {
  info: 'info',
  warning: 'high',
  critical: 'critical',
} as const satisfies Record<string, InboxSeverity>

/**
 * 来源内容哈希：覆盖会改变建议含义的字段。
 *
 * 信号表没有现成的内容哈希列（`idempotencyKey` 只标识「同一次观测」，
 * 严重度或证据变化时它不变），所以这里按确定性字段集自算一个，
 * 好让新鲜度检查能识别「同一信号但结论已变」。
 */
function computeSignalHash(signal: ProjectSignal): string {
  const payload = JSON.stringify({
    signalType: signal.signalType,
    severity: signal.severity,
    confidenceTier: signal.confidenceTier,
    evidence: signal.evidence ?? null,
  })
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

export class ProjectSignalInboxAdapter implements InboxSourceAdapter {
  readonly sourceKind: InboxSourceKind
  readonly #signalTypes: readonly ProjectSignalType[]

  constructor(
    sourceKind: ProjectSignalInboxSourceKind,
    private readonly rbac: RbacService = new RbacService(),
  ) {
    this.sourceKind = sourceKind
    this.#signalTypes = SIGNAL_TYPES_BY_SOURCE[sourceKind]
  }

  async isAvailable(): Promise<boolean> {
    try {
      await ProjectSignal.query().limit(1)
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

    // 读信号先要 project:view（signal_permissions 头部注释的第 1 条要求）。
    const projectView = await this.rbac.check(
      actor,
      PROJECT_VIEW,
      params.organizationId,
      params.projectId,
    )
    if (!projectView.allowed) return []

    // 再按信号类型逐类判领域权限：无权看风险数据的人，收件箱里也不该出现风险信号。
    // fail-closed —— 一类都不许时直接返回空，而不是退回「全放」。
    const permittedTypes: ProjectSignalType[] = []
    for (const signalType of this.#signalTypes) {
      const domain = await this.rbac.check(
        actor,
        requiredPermissionFor(signalType),
        params.organizationId,
        params.projectId,
      )
      if (domain.allowed) permittedTypes.push(signalType)
    }
    if (permittedTypes.length === 0) return []

    const now = DateTime.now()
    const signals = await ProjectSignal.query()
      .where('organization_id', params.organizationId)
      .where('project_id', params.projectId)
      .whereIn('signal_type', permittedTypes)
      // 只取仍待处理的：dismissed / adopted / expired 都已有归宿，不该再进收件箱。
      .where('status', 'open')
      .whereNull('deleted_at')
      .where('expires_at', '>', now.toSQL({ includeOffset: false })!)

    return signals.map((signal) => {
      const problemKind = PROBLEM_KIND_BY_SIGNAL[signal.signalType]
      return {
        sourceId: String(signal.id),
        projectId: signal.projectId,
        problemKind,
        severity: SEVERITY_MAP[signal.severity] ?? 'info',
        // idempotencyKey 本就是信号侧的去重标识，按收件箱契约再封一层问题种类。
        declaredDedupeKey: serializeInboxDedupeKey({
          problemKind,
          declaredKey: signal.idempotencyKey,
        }),
        sourceHash: computeSignalHash(signal),
        capturedAt: signal.createdAt.toISO()!,
      }
    })
  }
}

/** 供新鲜度检查器复用：按同一字段集重算某条信号的内容哈希。 */
export function projectSignalContentHash(signal: ProjectSignal): string {
  return computeSignalHash(signal)
}
