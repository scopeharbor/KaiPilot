// 全局资源 Hub 呈现侧纯函数适配器（v3-ui-next-org-portfolio-domains W7 · tasks 7.6）。
//
// 仅供新轨 `/next/resources` 全局资源入口使用（GlobalResourcesHub /
// ProjectResourceSummaryCard）：零 UI / 零 DOM / 零网络依赖。
//
// - 项目负载摘要（overload 判定阈值 >100%、行级/汇总聚合纯函数）；
// - 资源类型分布（count + 占比）与中文标签；
// - 资源利用率/容量展示格式化；全部对非法输入兜底，永不崩溃。
import type { Resource } from '@/lib/api/resources'
import type { ResourceLoadItem } from '@/lib/api/resources'

// ---------------------------------------------------------------------------
// 超载判定（双通道色阶契约：额定内冷蓝 `--nx-chart-1`、超载 `--nx-status-danger`，
// 阈值与既有资源域工作台完全同源：>100% 即超载，100% 不算）
// ---------------------------------------------------------------------------

/** 利用率百分比是否超载（>100% 严格大于；边界 100.0 不超载、100.5 超载）。 */
export function isUtilizationOverloaded(utilizationPercent: number): boolean {
  return Number.isFinite(utilizationPercent) && utilizationPercent > 100
}

/** 成员行（ResourceLoadItem.overallUtilizationPercent）聚合超载数。 */
export function countOverloadedMembers(rows: readonly ResourceLoadItem[]): number {
  return rows.filter((row) => isUtilizationOverloaded(row.overallUtilizationPercent)).length
}

export interface ProjectLoadSummaryModel {
  /** 团队行数（登记了负荷数据的成员）。 */
  memberCount: number
  /** 超载成员数（utilization > 100%）。 */
  overloadedCount: number
  /** 平均利用率（0~∞，四舍五入一位；无数据返回 null）。 */
  averageUtilizationPercent: number | null
}

/** 团队负荷聚合模型：无行 / 全空值输入安全（average 由 teamAverage 或行均值兜底）。 */
export function buildProjectLoadSummary(
  rows: readonly ResourceLoadItem[],
  teamAverageUtilizationPercent?: number | null,
): ProjectLoadSummaryModel {
  const memberCount = rows.length
  const overloadedCount = countOverloadedMembers(rows)
  let average: number | null = null
  if (
    typeof teamAverageUtilizationPercent === 'number' &&
    Number.isFinite(teamAverageUtilizationPercent)
  ) {
    average = teamAverageUtilizationPercent
  } else if (memberCount > 0) {
    let sum = 0
    let validCount = 0
    for (const row of rows) {
      if (Number.isFinite(row.overallUtilizationPercent)) {
        sum += row.overallUtilizationPercent
        validCount += 1
      }
    }
    average = validCount > 0 ? sum / validCount : null
  }
  return {
    memberCount,
    overloadedCount,
    averageUtilizationPercent: average === null ? null : Math.round(average * 10) / 10,
  }
}

// ---------------------------------------------------------------------------
// 资源类型分布（来自所选项目资源底册 resourcesApi.list）
// ---------------------------------------------------------------------------

export const GLOBAL_RESOURCE_TYPE_LABELS: Record<string, string> = {
  human: '人员',
  material: '物料',
  equipment: '设备',
  budget: '预算',
}

/** 资源类型中文标签：未知代码兜底返回原文。 */
export function globalResourceTypeLabel(type: string | null | undefined): string {
  if (!type) return '—'
  return GLOBAL_RESOURCE_TYPE_LABELS[type] ?? type
}

export interface ResourceTypeDistributionItem {
  type: string
  label: string
  count: number
  /** 0~100（分母为底册行数；空底册返回 null）。 */
  percentOfTotal: number | null
}

/** 类型分布聚合：按底册顺序 stable 输出；空底册返回空数组。 */
export function buildResourceTypeDistribution(
  resources: readonly Resource[],
): ResourceTypeDistributionItem[] {
  if (resources.length === 0) return []
  const counts = new Map<string, number>()
  for (const resource of resources) {
    counts.set(resource.resourceType, (counts.get(resource.resourceType) ?? 0) + 1)
  }
  return [...counts.entries()].map(([type, count]) => ({
    type,
    label: globalResourceTypeLabel(type),
    count,
    percentOfTotal: Math.round((count / resources.length) * 1000) / 10,
  }))
}

/** 活跃资源数（status='active' 计数）。 */
export function countActiveResources(resources: readonly Resource[]): number {
  return resources.filter((resource) => resource.status === 'active').length
}

/** 超载成员行模型（供「超载成员」top 列表渲染：名称 + 利用率 + 类型）。 */
export interface OverloadedMemberModel {
  resourceId: number
  resourceName: string
  utilizationPercent: number
}

export function listOverloadedMembers(rows: readonly ResourceLoadItem[]): OverloadedMemberModel[] {
  return rows
    .filter((row) => isUtilizationOverloaded(row.overallUtilizationPercent))
    .sort((a, b) => b.overallUtilizationPercent - a.overallUtilizationPercent)
    .map((row) => ({
      resourceId: row.resourceId,
      resourceName: row.resourceName,
      utilizationPercent: row.overallUtilizationPercent,
    }))
}

// ---------------------------------------------------------------------------
// 展示格式化
// ---------------------------------------------------------------------------

/** 利用率百分比展示：一位小数 + %；非法输入返回 '—'。 */
export function formatUtilizationPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${Math.round(value * 10) / 10}%`
}

/** 成员姓名首位大写缩写（头像占位）：空名返回 '?'。 */
export function memberInitials(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? ''
  if (trimmed === '') return '?'
  return trimmed.slice(0, 1).toUpperCase()
}
