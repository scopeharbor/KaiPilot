import type Project from '#models/project'
import type { ReportGenerateFilters, ReportSnapshot, ReportWarning } from '@aiproj/types'

/**
 * 报表聚合上下文（design D3/D6）。
 *
 * 每次生成一次报表就构造一个 `AggregatorContext`：
 * - `project` 已经通过 Service 层 `projectExistsInOrg` 组织隔离校验；
 * - `filters` 来自 API 输入的 `ReportGenerateFilters`，聚合器需对未提供字段回退到项目全量数据；
 * - `warnings` 由聚合器 push 累加，最终写入 `snapshotMetadata.warnings`（design D5）；
 * - `now` 便于测试注入固定时钟。
 *
 * 聚合器读取的数据必须全部来源于正式落库（tasks/milestones/wbs_nodes/…），
 * 严禁读取 `ai_drafts` 或未确认草案（design D2 数据来源）。
 */
export interface AggregatorContext {
  organizationId: number
  project: Project
  filters: ReportGenerateFilters
  now: Date
  warnings: ReportWarning[]
}

/**
 * 聚合器结果：负责组装模板对应的 snapshot，
 * 但不组装 `snapshotMetadata`（由 ReportService 统一装配以保证一致性）。
 */
export type AggregatorSnapshotWithoutMetadata<T extends ReportSnapshot> = Omit<
  T,
  'snapshotMetadata'
>

/**
 * 聚合器接口：模板 -> 快照。V1 四个模板实现该接口，
 * 之后新增模板只需追加 `report_aggregators/<template>_aggregator.ts` + Service 注册。
 */
export interface ReportAggregator<T extends ReportSnapshot> {
  readonly template: T['template']
  aggregate(context: AggregatorContext): Promise<AggregatorSnapshotWithoutMetadata<T>>
}

/**
 * 快照公共工具：把 `ReportGenerateFilters.fromDate/toDate` 归一到 `[start, end)` 区间。
 * 缺省时返回 null，聚合器自行决定"全量"语义（对 tasks 一般不加时间限制）。
 */
export function normalizeDateRange(filters: ReportGenerateFilters): {
  start: Date | null
  end: Date | null
} {
  const start = filters.fromDate ? new Date(filters.fromDate) : null
  const end = filters.toDate ? new Date(filters.toDate) : null
  return {
    start: start && !Number.isNaN(start.getTime()) ? start : null,
    end: end && !Number.isNaN(end.getTime()) ? end : null,
  }
}

/**
 * 快照公共工具：ISO 日期距今差值（正数=已过，负数=未来）。
 */
export function daysDiff(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}
