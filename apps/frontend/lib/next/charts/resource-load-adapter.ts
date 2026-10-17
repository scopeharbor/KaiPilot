/**
 * 资源负荷镜头纯函数适配层（v3-ui-next-chart-gallery W2 · tasks 2.1/2.2）。
 *
 * - 默认「最近 30 天滑动窗口」与本地日历键计算（注入 now 以获得确定性）；
 * - Trend 视图数据映射：每日柱体拆分为「正常分配」（--nx-chart-1）与「超额负荷」
 *   （--nx-status-danger 红堆叠），100% 额定容量警戒基准线取趋势窗口的日容量；
 * - Team 视图数据映射：成员容量构成（正常/超额/未利用）堆叠条形 + 精确数字行；
 * - 纯函数、零 DOM、零网络（RL-01 只读分析），jsdom 测试直接调用。
 *
 * 颜色常量 = next-tokens.css 令牌数值展开（与 echarts-core nx-dark 主题同源）；
 * 严禁在组件内另行硬编码色值。
 */
import type { ResourceLoadItem, TrendDay } from '@/lib/api/resources'

/** --nx-chart-1 正常分配（冷蓝）。 */
export const NX_NORMAL_COLOR = '#38bdf8'
/** --nx-status-danger 超负荷（警戒红）。 */
export const NX_OVERLOAD_COLOR = '#ef4444'
/** 未利用容量的中性半透冷灰（发丝线同族）。 */
export const NX_HEADROOM_COLOR = 'rgba(255, 255, 255, 0.14)'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 本地日历键 'YYYY-MM-DD'。 */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 平移到 n 天前的本地日期（跨月/跨年安全，注入 now 保证测试确定性）。 */
export function shiftDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

export interface LoadWindow {
  from: string
  to: string
  /** 窗口包含的自然日数量（含首尾）。 */
  days: number
}

/**
 * 默认资源负荷窗口：最近 30 天（含今天）滑动窗口，对齐
 * design §3.2「默认展示 30 天滑动窗口」。
 */
export function createDefaultLoadWindow(now: Date = new Date(), windowDays = 30): LoadWindow {
  const to = now
  const from = shiftDays(now, -(windowDays - 1))
  return {
    from: localDateKey(from),
    to: localDateKey(to),
    days: windowDays,
  }
}

/** 已解析窗口差值（本地日历整天数）；非法输入返回 null。 */
export function windowDayCount(from: string, to: string): number | null {
  const re = /^(\d{4})-(\d{2})-(\d{2})$/
  const a = re.exec(from)
  const b = re.exec(to)
  if (!a || !b) return null
  const startMs = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]))
  const endMs = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]))
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return null
  return Math.round((endMs - startMs) / 86_400_000) + 1
}

// ---------------------------------------------------------------------------
// Trend 视图映射
// ---------------------------------------------------------------------------

export interface TrendBarDay {
  /** 日历日期（xAxis 类别原文）。 */
  date: string
  /** 正常分配工时 = min(总分配, 额定容量)。 */
  normalHours: number
  /** 超额负荷工时 = max(0, 总分配 - 额定容量)，仅利用率 >100% 时为正。 */
  overloadHours: number
  /** 单日额定容量（趋势端点按活跃资源汇总）。 */
  capacityHours: number
  utilizationPercent: number
  totalHours: number
}

export interface TrendBarModel {
  categories: string[]
  days: TrendBarDay[]
  /** markLine yAxis 阈值：首个非零日容量；全零窗口返回 null（不画警戒线）。 */
  capacityMarkValue: number | null
}

/** TrendDay[] → 柱体构成模型（正常/超额拆分，警戒线阈值取常量日容量）。 */
export function buildTrendBarModel(days: TrendDay[]): TrendBarModel {
  const mapped: TrendBarDay[] = days.map((day) => {
    const overloadHours = Math.max(0, day.totalHours - day.capacityHours)
    const normalHours = Math.max(0, day.totalHours - overloadHours)
    return {
      date: day.date,
      normalHours,
      overloadHours,
      capacityHours: day.capacityHours,
      utilizationPercent: day.utilizationPercent,
      totalHours: day.totalHours,
    }
  })
  const capacityMarkValue = mapped.find((day) => day.capacityHours > 0)?.capacityHours ?? null
  return {
    categories: mapped.map((day) => day.date),
    days: mapped,
    capacityMarkValue,
  }
}

/** xAxis 日期标签抽样间隔：窗口 >18 天时每 ~5 天标一次（防重叠）。 */
export function dateLabelInterval(count: number): number {
  if (count <= 18) return 0
  return Math.max(1, Math.ceil(count / 8) - 1)
}

/** Trend Tooltip 主体 HTML（暗黑控制台微标；纯函数便于单测）。 */
export function formatTrendTooltipHtml(day: TrendBarDay): string {
  const rows = [
    `<div style="color:#f1f5f9;font-weight:600;margin-bottom:4px">${day.date}</div>`,
    `<div>分配工时：<b style="color:#f1f5f9">${formatHours(day.totalHours)}</b> h</div>`,
    `<div>额定容量：${formatHours(day.capacityHours)} h</div>`,
    `<div>利用率：<b style="color:${day.utilizationPercent > 100 ? NX_OVERLOAD_COLOR : '#f1f5f9'}">${day.utilizationPercent}%</b></div>`,
  ]
  if (day.overloadHours > 0) {
    rows.push(
      `<div style="color:${NX_OVERLOAD_COLOR}">⚠ 超负荷 ${formatHours(day.overloadHours)} h</div>`,
    )
  }
  return rows.join('')
}

/** 工时展示：去多余小数尾零（8 → '8'，8.5 → '8.5'）。 */
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

// ---------------------------------------------------------------------------
// Team 视图映射
// ---------------------------------------------------------------------------

export interface TeamMemberRow {
  resourceId: number
  resourceName: string
  role: string
  dailyCapacityHours: number
  /** 窗口内额定容量总和（h）。 */
  totalCapacityHours: number
  /** 窗口内分配工时总和（h）。 */
  totalAllocatedHours: number
  /** 窗口平均利用率（%）。 */
  utilizationPercent: number
  /** 是否超负荷（平均利用率 > 100%）。 */
  overloaded: boolean
  /** 无任何分配（纯空闲）。 */
  idle: boolean
}

/** ResourceLoadItem[] → 团队精确数字行（总容量/总分配/平均利用率）。 */
export function buildTeamRows(items: ResourceLoadItem[]): TeamMemberRow[] {
  return items.map((item) => {
    let totalCapacityHours = 0
    let totalAllocatedHours = 0
    for (const day of item.days) {
      totalCapacityHours += day.capacityHours
      totalAllocatedHours += day.allocatedHours
    }
    const utilizationPercent =
      totalCapacityHours > 0
        ? Math.round((totalAllocatedHours / totalCapacityHours) * 10_000) / 100
        : 0
    return {
      resourceId: item.resourceId,
      resourceName: item.resourceName,
      role: item.role,
      dailyCapacityHours: item.dailyCapacityHours,
      totalCapacityHours,
      totalAllocatedHours,
      utilizationPercent,
      overloaded: utilizationPercent > 100,
      idle: totalAllocatedHours <= 0,
    }
  })
}

/** 成员角色 → 中文标签（未知名兜底原文）。 */
export function resourceRoleLabel(role: string): string {
  switch (role) {
    case 'owner':
      return '负责人'
    case 'project_manager':
      return '项目经理'
    case 'team_lead':
      return '团队负责人'
    case 'member':
      return '成员'
    case 'viewer':
      return '观察者'
    default:
      return role
  }
}

/** 行数据 → 堆叠柱三序列数值（正常/超额/未利用容量）。 */
export function buildTeamComposition(row: TeamMemberRow): {
  normal: number
  overload: number
  headroom: number
} {
  return {
    normal: Math.min(row.totalAllocatedHours, row.totalCapacityHours),
    overload: Math.max(0, row.totalAllocatedHours - row.totalCapacityHours),
    headroom: Math.max(0, row.totalCapacityHours - row.totalAllocatedHours),
  }
}
