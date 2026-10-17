/**
 * 组织资源池呈现侧纯函数适配器（v3-ui-next-org-portfolio-domains W4 · tasks 4.1）。
 *
 * - 零 UI / 零 DOM / 零网络依赖：中文标签、--nx-* 令牌色阶、超载判定、容量矩阵
 *   行模型、受限列脱敏判定均为纯函数，jsdom 单测直接调用；
 * - 色阶常量只引用 next-tokens.css 令牌名（消费方以 `var(--nx-*)` 注入），
 *   严禁在组件内硬编码色值；超载「过载」文字徽标与颜色构成双通道（RL-15）；
 * - 脱敏纪律：只消费后端 DTO 下发的受限标记（redacted / null 列 / metric.status），
 *   前端不自行推断可见性（RL-05）。
 */
import type {
  OrganizationResourcePoolLoadStatus,
  OrganizationResourcePoolConflictSeverity,
  OrganizationResourcePoolViewMode,
  OrganizationResourcePoolCapacityMatrix,
  OrganizationResourcePoolCapacityMatrixRow,
  OrganizationResourcePoolCapacityCell,
  OrganizationResourcePoolMetric,
} from '@aiproj/types'

// ─── 负载状态中文标签（与旧轨 LOAD_LABELS 同义） ───────────────────────────

export const POOL_LOAD_LABELS: Readonly<Record<OrganizationResourcePoolLoadStatus, string>> = {
  idle: '空闲',
  normal: '正常',
  high: '高负载',
  overloaded: '过载',
  unavailable: '不可用',
}

/** 负载状态 → --nx-* 令牌（额定内冷蓝 / 高负载黄 / 超载警戒红 / 中性灰）。 */
export const POOL_LOAD_TONES: Readonly<Record<OrganizationResourcePoolLoadStatus, string>> = {
  idle: '--nx-text-secondary',
  normal: '--nx-chart-1',
  high: '--nx-status-warning',
  overloaded: '--nx-status-danger',
  unavailable: '--nx-text-muted',
}

export function getPoolLoadLabel(status: OrganizationResourcePoolLoadStatus): string {
  return POOL_LOAD_LABELS[status] ?? status
}

export function getPoolLoadTone(status: OrganizationResourcePoolLoadStatus): string {
  return POOL_LOAD_TONES[status] ?? '--nx-text-muted'
}

// ─── 冲突严重度标签与色阶 ──────────────────────────────────────────────────

export const POOL_CONFLICT_SEVERITY_LABELS: Readonly<
  Record<OrganizationResourcePoolConflictSeverity, string>
> = {
  info: '信息',
  warning: '警告',
  error: '错误',
  critical: '严重',
}

export const POOL_CONFLICT_SEVERITY_TONES: Readonly<
  Record<OrganizationResourcePoolConflictSeverity, string>
> = {
  info: '--nx-chart-1',
  warning: '--nx-status-warning',
  error: '--nx-status-danger',
  critical: '--nx-status-danger',
}

export function getPoolConflictSeverityLabel(
  severity: OrganizationResourcePoolConflictSeverity,
): string {
  return POOL_CONFLICT_SEVERITY_LABELS[severity] ?? severity
}

export function getPoolConflictSeverityTone(
  severity: OrganizationResourcePoolConflictSeverity,
): string {
  return POOL_CONFLICT_SEVERITY_TONES[severity] ?? '--nx-text-muted'
}

// ─── 视图 Tab 标签（URL `view` 参数白名单同义） ────────────────────────────

export const POOL_VIEW_LABELS: Readonly<Record<OrganizationResourcePoolViewMode, string>> = {
  matrix: '容量矩阵',
  list: '资源底册',
  skills: '技能',
  conflicts: '冲突',
  demand_gaps: '需求缺口',
  trend: '趋势',
}

// ─── 超载判定（>100%） ─────────────────────────────────────────────────────

/**
 * 超载判定：利用率严格大于 100% 即超载（tasks 4.1 边界：100% 不算、
 * 100.5% 算）；后端下发的 loadStatus === 'overloaded' 亦视为超载。
 */
export function isPoolOverloaded(
  utilizationPercent: number,
  loadStatus?: OrganizationResourcePoolLoadStatus,
): boolean {
  if (utilizationPercent > 100) return true
  return loadStatus === 'overloaded'
}

/** 容量单元超载判定：利用率 >100% 或单元状态为 overloaded，或带冲突标记。 */
export function isPoolCellOverloaded(cell: {
  utilizationPercent: number
  loadStatus: OrganizationResourcePoolLoadStatus
  conflictFlags?: readonly OrganizationResourcePoolConflictSeverity[]
}): boolean {
  return (
    isPoolOverloaded(cell.utilizationPercent, cell.loadStatus) ||
    (cell.conflictFlags?.length ?? 0) > 0
  )
}

// ─── 数值格式化 ────────────────────────────────────────────────────────────

/** 小时格式化（旧轨 fmtHours 同义：整数 0 显示 0h，其余保留 1 位小数）。 */
export function formatPoolHours(hours: number): string {
  if (!Number.isFinite(hours)) return '—'
  return hours === 0 ? '0h' : `${hours.toFixed(1)}h`
}

/** 百分比格式化（取整）。 */
export function formatPoolPercent(percent: number): string {
  if (!Number.isFinite(percent)) return '—'
  return `${Math.round(percent)}%`
}

// ─── 受限列脱敏判定与中性文案 ──────────────────────────────────────────────

/** 受限列的统一中性文案（RL-05：不泄露存在性与数值线索）。 */
export const POOL_RESTRICTED_TEXT = '不可见'

/**
 * 指标级受限判定：metric.status 为 forbidden / redacted / unavailable 时，
 * 消费方渲染中性「不可见」卡（EyeOff + POOL_RESTRICTED_TEXT），绝不渲染数值。
 */
export function isPoolMetricRestricted(
  metric: Pick<OrganizationResourcePoolMetric, 'status'>,
): boolean {
  return (
    metric.status === 'forbidden' || metric.status === 'redacted' || metric.status === 'unavailable'
  )
}

/** 资源行（底册/容量矩阵）身份列受限判定：后端 redacted 标记或名称缺席。 */
export function isPoolRowIdentityRestricted(row: {
  redacted: boolean
  resourceName: string | null
}): boolean {
  return row.redacted || row.resourceName === null
}

/** 技能列受限判定：行级 redacted 时技能明细随身份一并脱敏。 */
export function isPoolSkillColumnRestricted(row: { redacted: boolean }): boolean {
  return row.redacted
}

/** 受限身份列中性占位文案（行级）。 */
export function getPoolRowRestrictedLabel(): string {
  return '已脱敏'
}

// ─── 容量矩阵行模型 ────────────────────────────────────────────────────────

export interface PoolCapacityCellModel {
  date: string
  capacityHours: number
  allocatedHours: number
  remainingHours: number
  utilizationPercent: number
  loadStatus: OrganizationResourcePoolLoadStatus
  /** 展示文本（百分比，双通道文字通道）。 */
  text: string
  /** 是否超载（红高亮 + 「过载」文字）。 */
  overloaded: boolean
  /** --nx-* 令牌名（双通道颜色通道）。 */
  tone: string
}

export interface PoolCapacityRowModel {
  resourceId: number
  /** 受限行显示中性占位（EyeOff 态），不渲染名称。 */
  restricted: boolean
  name: string | null
  role: string | null
  loadStatus: OrganizationResourcePoolLoadStatus
  loadLabel: string
  loadTone: string
  overloaded: boolean
  totalCapacityHours: number
  totalAllocatedHours: number
  totalRemainingHours: number
  utilizationPercent: number
  utilizationText: string
  cells: PoolCapacityCellModel[]
}

function buildCellModel(cell: OrganizationResourcePoolCapacityCell): PoolCapacityCellModel {
  const overloaded = isPoolCellOverloaded(cell)
  return {
    date: cell.date,
    capacityHours: cell.capacityHours,
    allocatedHours: cell.allocatedHours,
    remainingHours: cell.remainingHours,
    utilizationPercent: cell.utilizationPercent,
    loadStatus: cell.loadStatus,
    text: formatPoolPercent(cell.utilizationPercent),
    overloaded,
    tone: overloaded ? POOL_LOAD_TONES.overloaded : getPoolLoadTone(cell.loadStatus),
  }
}

/** 容量矩阵 → 呈现行模型（含受限行判定与逐日单元色阶/超载标记）。 */
export function buildPoolCapacityRows(
  matrix: OrganizationResourcePoolCapacityMatrix,
): PoolCapacityRowModel[] {
  return matrix.rows.map(buildPoolCapacityRowModel)
}

export function buildPoolCapacityRowModel(
  row: OrganizationResourcePoolCapacityMatrixRow,
): PoolCapacityRowModel {
  const restricted = isPoolRowIdentityRestricted(row)
  const overloaded = isPoolOverloaded(row.utilizationPercent, row.loadStatus)
  return {
    resourceId: row.resourceId,
    restricted,
    name: row.resourceName,
    role: restricted ? null : row.role,
    loadStatus: row.loadStatus,
    loadLabel: getPoolLoadLabel(row.loadStatus),
    loadTone: overloaded ? POOL_LOAD_TONES.overloaded : getPoolLoadTone(row.loadStatus),
    overloaded,
    totalCapacityHours: row.totalCapacityHours,
    totalAllocatedHours: row.totalAllocatedHours,
    totalRemainingHours: row.totalRemainingHours,
    utilizationPercent: row.utilizationPercent,
    utilizationText: formatPoolPercent(row.utilizationPercent),
    cells: row.cells.map(buildCellModel),
  }
}

/** 矩阵日期列头：取所有行单元日期的并集去重（保序）。 */
export function collectPoolMatrixDates(matrix: OrganizationResourcePoolCapacityMatrix): string[] {
  const seen: string[] = []
  for (const row of matrix.rows) {
    for (const cell of row.cells) {
      if (!seen.includes(cell.date)) seen.push(cell.date)
    }
  }
  return seen
}
