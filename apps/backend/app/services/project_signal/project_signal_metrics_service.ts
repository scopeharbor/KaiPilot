import GanttBaseline from '#models/gantt_baseline'
import Issue from '#models/issue'
import Milestone from '#models/milestone'
import Project from '#models/project'
import Risk from '#models/risk'
import RiskHistory from '#models/risk_history'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import { DateTime } from 'luxon'
import {
  windowExclusiveEnd,
  windowInclusiveStart,
  type SignalWindowRange,
} from './signal_contracts.js'
import {
  HIGH_RISK_LEVELS,
  MILESTONE_BASELINE_MISSING,
  RISK_CLOSED_EVENT_TYPES,
  SEVERE_DEFECT_SEVERITIES,
  SEVERE_DEFECT_TYPES,
  SIGNAL_EVIDENCE_ENTITY_REF_LIMIT,
  SIGNAL_FACT_ROW_LIMIT,
} from './signal_thresholds.js'

/**
 * v3-triz-contradiction-copilot W3 任务 3.2 —— 雷达事实读取器（**只读**）。
 *
 * 只做一件事：把四类信号所需的项目事实按**时间窗**读出来并落到内存聚合，供检测器做确定性判定。
 * 无预归档快照表（design 待核实清单第 6 项结论：用时间窗 SQL 实时环比），无写入。
 *
 * 读取策略（无 N+1、无 raw SQL、全部带 `organization_id` + `project_id` 双列 scope）：
 * - 风险 / 关闭事件：各 **1 次**批量读取（`created_at` 早于最早窗口起点之后的行 + 全量关闭事件），
 *   窗口计数与「窗口末活跃数重放」在内存完成；行数上限 `SIGNAL_FACT_ROW_LIMIT`，超限即
 *   `truncated=true`（上游据此判字段不完整，不冒充完整读数）。
 * - 严重缺陷（`issues.type='bug'` ∧ `severity ∈ critical/major`）：1 次批量读取，按 `created_at` 切片。
 * - 里程碑 + 甘特基线：各 1 次读取；基线为单行覆盖快照，无基线即 `noBaselineReason=BASELINE_MISSING`。
 *
 * 个人维度（D9 ③）：风险只取 `id/risk_level/status/created_at`，议题只取 `id/created_at`，
 * **不读** `owner_id` / `assignee_id` / 任何人员姓名与个人工时，聚合口径只到项目/团队。
 */

/** 单个观测窗的风险 / 缺陷事实。 */
export interface RiskSurgeWindowFacts {
  window: SignalWindowRange
  /** 窗口内新增风险数（`created_at` 切片） */
  newRisks: number
  /** 窗口内新增高危风险数（`risk_level ∈ high/critical`） */
  newHighRisks: number
  /** 窗口末活跃风险数（累计新增 − 累计关闭，下限 0；近似重放，见文件头说明） */
  activeRisks: number
  /** 窗口内新增严重缺陷数 */
  newSevereDefects: number
  /** 证据引用：窗口内新增风险 ID（有界、升序） */
  newRiskIds: number[]
  /** 证据引用：窗口内新增高危风险 ID（有界、升序） */
  newHighRiskIds: number[]
  /** 证据引用：窗口内新增严重缺陷 ID（有界、升序） */
  severeDefectIds: number[]
  /** 窗口末活跃风险数是否因读取上限被截断（截断即不可作为完整读数） */
  activeTruncated: boolean
}

export interface RiskSurgeFacts {
  windows: RiskSurgeWindowFacts[]
  truncated: boolean
}

/** 单个里程碑相对基线的滑移事实。 */
export interface MilestoneSlipFact {
  id: number
  plannedDate: string | null
  baselinePlannedDate: string | null
  /** 正数 = 相对基线后移的天数；null = 无基线或任一侧日期缺失（不计入滑移，MUST NOT 记为 0） */
  slipDays: number | null
}

export interface MilestoneSlipFacts {
  hasBaseline: boolean
  baselineSavedAt: string | null
  milestones: MilestoneSlipFact[]
  /** 基线覆盖到的里程碑数（基线快照内有计划日的条数） */
  baselineCoveredCount: number
  /** 无计划日的里程碑数（关键字段不完整的原因之一） */
  missingPlannedDateCount: number
  /** 无基线时给出 `BASELINE_MISSING`（数据不足降级原因码） */
  noBaselineReason: string | null
  truncated: boolean
}

export default class ProjectSignalMetricsService {
  /** 风险 / 缺陷事实：一次读风险、一次读关闭事件、一次读严重缺陷。 */
  async loadRiskSurgeFacts(
    organizationId: number,
    projectId: number,
    windows: readonly SignalWindowRange[],
  ): Promise<RiskSurgeFacts> {
    await this.#projectOrFail(organizationId, projectId)

    const [riskRows, closureRows, defectRows] = await Promise.all([
      Risk.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .select('id', 'risk_level', 'status', 'created_at')
        .orderBy('id', 'asc')
        .limit(SIGNAL_FACT_ROW_LIMIT + 1),
      RiskHistory.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .whereIn('event_type', [...RISK_CLOSED_EVENT_TYPES])
        .select('risk_id', 'occurred_at')
        .orderBy('id', 'asc')
        .limit(SIGNAL_FACT_ROW_LIMIT + 1),
      Issue.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .whereIn('type', [...SEVERE_DEFECT_TYPES])
        .whereIn('severity', [...SEVERE_DEFECT_SEVERITIES])
        .select('id', 'created_at')
        .orderBy('id', 'asc')
        .limit(SIGNAL_FACT_ROW_LIMIT + 1),
    ])

    const risksTruncated = riskRows.length > SIGNAL_FACT_ROW_LIMIT
    const closuresTruncated = closureRows.length > SIGNAL_FACT_ROW_LIMIT
    const defectsTruncated = defectRows.length > SIGNAL_FACT_ROW_LIMIT
    const risks = riskRows.slice(0, SIGNAL_FACT_ROW_LIMIT)
    const closures = closureRows.slice(0, SIGNAL_FACT_ROW_LIMIT)
    const defects = defectRows.slice(0, SIGNAL_FACT_ROW_LIMIT)

    const highRiskLevels = new Set<string>(HIGH_RISK_LEVELS)
    const facts: RiskSurgeWindowFacts[] = windows.map((window) => {
      const fromMs = Date.parse(windowInclusiveStart(window.from))
      const toMs = Date.parse(windowExclusiveEnd(window.to))

      const inWindow = risks.filter((risk) => {
        const createdMs = risk.createdAt.toMillis()
        return createdMs >= fromMs && createdMs < toMs
      })
      const high = inWindow.filter((risk) => highRiskLevels.has(String(risk.riskLevel)))
      const defectsInWindow = defects.filter((issue) => {
        const createdMs = issue.createdAt.toMillis()
        return createdMs >= fromMs && createdMs < toMs
      })

      const createdUpTo = risks.filter((risk) => risk.createdAt.toMillis() < toMs).length
      const closedUpTo = closures.filter((closure) => closure.occurredAt.toMillis() < toMs).length

      return {
        window,
        newRisks: inWindow.length,
        newHighRisks: high.length,
        activeRisks: Math.max(0, createdUpTo - closedUpTo),
        newSevereDefects: defectsInWindow.length,
        newRiskIds: boundIds(inWindow.map((risk) => Number(risk.id))),
        newHighRiskIds: boundIds(high.map((risk) => Number(risk.id))),
        severeDefectIds: boundIds(defectsInWindow.map((issue) => Number(issue.id))),
        activeTruncated: risksTruncated || closuresTruncated,
      }
    })

    return {
      windows: facts,
      truncated: risksTruncated || closuresTruncated || defectsTruncated,
    }
  }

  /** 里程碑相对甘特基线的滑移事实：一次读里程碑、一次读基线行。 */
  async loadMilestoneSlipFacts(
    organizationId: number,
    projectId: number,
  ): Promise<MilestoneSlipFacts> {
    await this.#projectOrFail(organizationId, projectId)

    const [milestoneRows, baseline] = await Promise.all([
      Milestone.query()
        .where('project_id', projectId)
        .select('id', 'planned_date')
        .orderBy('id', 'asc')
        .limit(SIGNAL_FACT_ROW_LIMIT + 1),
      GanttBaseline.query().where('project_id', projectId).first(),
    ])

    const truncated = milestoneRows.length > SIGNAL_FACT_ROW_LIMIT
    const milestones = milestoneRows.slice(0, SIGNAL_FACT_ROW_LIMIT)

    const baselineDates = new Map<number, string | null>()
    for (const entry of baseline?.snapshot?.milestones ?? []) {
      baselineDates.set(Number(entry.id), entry.plannedDate ?? null)
    }

    const facts: MilestoneSlipFact[] = milestones.map((milestone) => {
      const plannedDate = milestone.plannedDate ? milestone.plannedDate.toISODate() : null
      const baselinePlannedDate = baselineDates.has(Number(milestone.id))
        ? baselineDates.get(Number(milestone.id))!
        : null
      return {
        id: Number(milestone.id),
        plannedDate,
        baselinePlannedDate,
        slipDays:
          plannedDate && baselinePlannedDate
            ? calendarDayDiff(baselinePlannedDate, plannedDate)
            : null,
      }
    })

    return {
      hasBaseline: baseline !== null,
      baselineSavedAt: baseline?.snapshot?.savedAt ?? null,
      milestones: facts,
      baselineCoveredCount: facts.filter((fact) => fact.baselinePlannedDate !== null).length,
      missingPlannedDateCount: facts.filter((fact) => fact.plannedDate === null).length,
      noBaselineReason: baseline === null ? MILESTONE_BASELINE_MISSING : null,
      truncated,
    }
  }

  /** 项目归属断言：跨组织 / 不存在统一 404（RL-05，不泄露存在性）。 */
  async #projectOrFail(organizationId: number, projectId: number): Promise<void> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
  }
}

/** 实体 ID 数组有界化（升序、去重、上限 `SIGNAL_EVIDENCE_ENTITY_REF_LIMIT`）。 */
export function boundIds(ids: readonly number[]): number[] {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id)))].sort((a, b) => a - b)
  return unique.slice(0, SIGNAL_EVIDENCE_ENTITY_REF_LIMIT)
}

/** 日历日差（忽略时刻，按年月日取整）。 */
export function calendarDayDiff(from: string, to: string): number {
  const utc = (value: string) => {
    const parsed = DateTime.fromISO(value, { zone: 'utc' })
    return Date.UTC(parsed.year, parsed.month - 1, parsed.day)
  }
  return Math.round((utc(to) - utc(from)) / 86_400_000)
}
