/**
 * v3-ui-next-org-portfolio-domains W5 · tasks 5.1 —— 资源争用检测展示层纯函数适配器。
 *
 * 新轨争用工作台（/next/organization/resource-contentions）的呈现侧纯函数底座：
 * - severity / reasonCode 中文标签与徽标语义色映射（info/warning/high/critical 与六类
 *   原因码，色阶全部取 `app/(next)/next-tokens.css` 既有令牌的固定 rgba 展开，
 *   杜绝臆造令牌与硬编码色值）；
 * - redaction 受限判定与中性文案（RL-05：展示层只消费「受限布尔 + 中性文案」，
 *   绝不自行推导可见性）；
 * - list/matrix 双视图行模型：列表行扁平化、矩阵行列网格模型（资源 × 日期单元格），
 *   颜色 + 文字双通道传达；
 * - URL 参数（severity/reasonCode/view/page）序列化/解析纯函数——URL query 是
 *   争用工作台筛选的唯一事实来源（restorable filters，design Decision 5）；
 * - 错误三态分类器（受限 403 / 中性 404 / 可重试 5xx），供证据/建议抽屉与工作台
 *   错误卡区分「受限（中性）」与「可重试」语义。
 *
 * 本文件为纯计算层：零网络、零 DOM、零 store 依赖。
 */
import type {
  ResourceContentionItem,
  ResourceContentionMatrix,
  ResourceContentionMatrixCell,
  ResourceContentionQuery,
  ResourceContentionReasonCode,
  ResourceContentionRedactionState,
  ResourceContentionSeverity,
} from '@aiproj/types'
import {
  RESOURCE_CONTENTION_REASON_CODE_VALUES,
  RESOURCE_CONTENTION_SEVERITY_VALUES,
} from '@aiproj/types'
import type { ApiError } from '@/lib/api-client'

// ─── Severity 徽标映射（双通道：色阶类名 + 文字标签） ──────────────────────

/** severity → 中文标签（与旧轨 resource-contentions 页同文案）。 */
export const CONTENTION_SEVERITY_LABELS: Record<ResourceContentionSeverity, string> = {
  info: '信息',
  warning: '提示',
  high: '高风险',
  critical: '严重',
}

/** severity 徽标语义色类名（令牌色固定透明度展开：0.45 发丝边框 / 0.14 底色）。 */
const SEVERITY_CHIP_TEXT: Record<ResourceContentionSeverity, string> = {
  info: 'text-[var(--nx-text-secondary)]',
  warning: 'text-[var(--nx-status-warning)]',
  high: 'text-[var(--nx-chart-5)]',
  critical: 'text-[var(--nx-status-danger)]',
}

const SEVERITY_CHIP_BORDER_BG: Record<ResourceContentionSeverity, string> = {
  info: 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]',
  warning: 'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)]',
  high: 'border-[rgba(248,113,113,0.45)] bg-[rgba(248,113,113,0.14)]',
  critical: 'border-[rgba(239,68,68,0.5)] bg-[rgba(239,68,68,0.16)]',
}

export interface ContentionSeverityMeta {
  severity: ResourceContentionSeverity
  label: string
  chipClass: string
}

/** severity 全量元数据（确定性静态映射）。 */
export const CONTENTION_SEVERITY_META: Record<ResourceContentionSeverity, ContentionSeverityMeta> =
  {
    info: {
      severity: 'info',
      label: CONTENTION_SEVERITY_LABELS.info,
      chipClass: `${SEVERITY_CHIP_BORDER_BG.info} ${SEVERITY_CHIP_TEXT.info}`,
    },
    warning: {
      severity: 'warning',
      label: CONTENTION_SEVERITY_LABELS.warning,
      chipClass: `${SEVERITY_CHIP_BORDER_BG.warning} ${SEVERITY_CHIP_TEXT.warning}`,
    },
    high: {
      severity: 'high',
      label: CONTENTION_SEVERITY_LABELS.high,
      chipClass: `${SEVERITY_CHIP_BORDER_BG.high} ${SEVERITY_CHIP_TEXT.high}`,
    },
    critical: {
      severity: 'critical',
      label: CONTENTION_SEVERITY_LABELS.critical,
      chipClass: `${SEVERITY_CHIP_BORDER_BG.critical} ${SEVERITY_CHIP_TEXT.critical}`,
    },
  }

/** 未知 severity 回退（脏数据仍可渲染为中性标签，不抛错）。 */
export function severityMetaOf(severity: string | undefined | null): ContentionSeverityMeta | null {
  if (!severity) return null
  return CONTENTION_SEVERITY_META[severity as ResourceContentionSeverity] ?? null
}

/** severity 筛选选项（全部 + 各级别，按严重度降序展示）。 */
export const CONTENTION_SEVERITY_FILTER_OPTIONS: ReadonlyArray<{
  value: ResourceContentionSeverity | ''
  label: string
}> = [
  { value: '', label: '全部严重度' },
  { value: 'critical', label: CONTENTION_SEVERITY_LABELS.critical },
  { value: 'high', label: CONTENTION_SEVERITY_LABELS.high },
  { value: 'warning', label: CONTENTION_SEVERITY_LABELS.warning },
  { value: 'info', label: CONTENTION_SEVERITY_LABELS.info },
]

// ─── Reason Code 标签映射 ────────────────────────────────────────────────

/** reasonCode → 中文标签（与旧轨 resource-contentions 页同文案）。 */
export const CONTENTION_REASON_LABELS: Record<ResourceContentionReasonCode, string> = {
  'cross-project-overload': '跨项目过载',
  'unavailable-allocation': '不可用分配',
  'critical-skill-contention': '关键技能争用',
  'duplicate-reservation': '重复预留',
  'demand-window-contention': '需求窗口争用',
  'draft-allocation-contention': '调配草案冲突',
}

/** 原因码筛选选项（全部 + 六类原因）。 */
export const CONTENTION_REASON_FILTER_OPTIONS: ReadonlyArray<{
  value: ResourceContentionReasonCode | ''
  label: string
}> = [
  { value: '', label: '全部原因' },
  { value: 'cross-project-overload', label: CONTENTION_REASON_LABELS['cross-project-overload'] },
  { value: 'unavailable-allocation', label: CONTENTION_REASON_LABELS['unavailable-allocation'] },
  {
    value: 'critical-skill-contention',
    label: CONTENTION_REASON_LABELS['critical-skill-contention'],
  },
  { value: 'duplicate-reservation', label: CONTENTION_REASON_LABELS['duplicate-reservation'] },
  {
    value: 'demand-window-contention',
    label: CONTENTION_REASON_LABELS['demand-window-contention'],
  },
  {
    value: 'draft-allocation-contention',
    label: CONTENTION_REASON_LABELS['draft-allocation-contention'],
  },
]

/** 原因码是否可读（未知码回退原文标签，用于脏数据兜底）。 */
export function reasonLabelOf(reasonCode: string | undefined | null): string {
  if (!reasonCode) return '未知原因'
  return CONTENTION_REASON_LABELS[reasonCode as ResourceContentionReasonCode] ?? reasonCode
}

// ─── Redaction 受限判定与中性文案（RL-05） ──────────────────────────────

/** redactionState → 中性文案（旧轨同款五态）。 */
export const CONTENTION_REDACTION_LABELS: Record<ResourceContentionRedactionState, string> = {
  visible: '可见',
  redacted: '已脱敏',
  forbidden: '无权限',
  unavailable: '不可用',
  partial: '部分可见',
}

/** 受限态判定：非 visible 一律视为受限（展示层不得自行推断可见性）。 */
export function isContentionRedacted(state: ResourceContentionRedactionState | undefined): boolean {
  return Boolean(state && state !== 'visible')
}

/** 受限中性占位文案（EyeOff + 该文案并排呈现）。 */
export const CONTENTION_REDACTED_PLACEHOLDER = '不可见'

/** 受限资源/项目名称中性呈现：受限态下绝不回显名称原文。 */
export function formatContentionSubjectName(
  name: string | null | undefined,
  redacted: boolean,
): string {
  if (redacted || !name || name.trim() === '') return CONTENTION_REDACTED_PLACEHOLDER
  return name
}

// ─── 日期展示（UTC 日历日） ───────────────────────────────────────────────

/** ISO 时间串 → `YYYY-MM-DD`（UTC 日历日）；非法输入截断前 10 位。 */
export function formatContentionDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** 时间窗口文案（from ~ to，缺失侧以「—」占位）。 */
export function formatContentionWindow(
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  return `${formatContentionDate(from)} ~ ${formatContentionDate(to)}`
}

// ─── List 视图行模型 ─────────────────────────────────────────────────────

/** 列表行扁平模型（列表视图渲染与 aria 标签同源）。 */
export interface ContentionListRowModel {
  contentionId: string
  /** 资源显示名（受限态为中性占位）。 */
  resourceDisplay: string
  /** 资源名是否受限（EyeOff 依据）。 */
  resourceRedacted: boolean
  /** 负载百分比（null = 不可用；受限态恒为 null）。 */
  loadPercent: number | null
  /** 关联项目名清单（受限/缺失返回空数组）。 */
  projectNames: string[]
  projectCount: number | null
  from: string
  to: string
  severity: ResourceContentionSeverity
  severityLabel: string
  severityChipClass: string
  reasonCode: ResourceContentionReasonCode
  reasonLabel: string
  description: string
  remediationHint: string | null
  redactionState: ResourceContentionRedactionState
  redacted: boolean
  redactionLabel: string
  createdAt: string
}

/** 争用条目 → 列表行模型（受限态中性化，不泄露数值）。 */
export function buildContentionListRow(item: ResourceContentionItem): ContentionListRowModel {
  const redacted = isContentionRedacted(item.redactionState)
  const severityMeta = severityMetaOf(item.severity)
  const projectCount = item.projectIds && item.projectIds.length > 0 ? item.projectIds.length : null
  return {
    contentionId: item.contentionId,
    resourceDisplay: formatContentionSubjectName(item.resourceName, redacted),
    resourceRedacted: redacted || !item.resourceName,
    loadPercent: redacted ? null : item.loadPercent,
    projectNames: redacted ? [] : (item.projectNames ?? []),
    projectCount: redacted ? null : projectCount,
    from: item.from,
    to: item.to,
    severity: severityMeta?.severity ?? item.severity,
    severityLabel: severityMeta?.label ?? item.severity,
    severityChipClass: severityMeta?.chipClass ?? CONTENTION_SEVERITY_META.info.chipClass,
    reasonCode: item.reasonCode,
    reasonLabel: reasonLabelOf(item.reasonCode),
    description: item.description,
    remediationHint: item.remediationHint,
    redactionState: item.redactionState,
    redacted,
    redactionLabel: CONTENTION_REDACTION_LABELS[item.redactionState] ?? '不可见',
    createdAt: item.createdAt,
  }
}

// ─── Matrix 视图行/网格模型 ─────────────────────────────────────────────

/** 矩阵单元格展示模型。 */
export interface ContentionMatrixCellModel {
  date: string
  /** 是否承载实际争用信号（severity 非空）。 */
  hasSignal: boolean
  severityLabel: string | null
  severityChipClass: string | null
  loadPercent: number | null
  contentionCount: number
  redacted: boolean
}

/** 矩阵行展示模型。 */
export interface ContentionMatrixRowModel {
  resourceId: number
  resourceDisplay: string
  roleDisplay: string | null
  totalContentions: number
  /** 受限行不渲染任何计数（null）。 */
  totalContentionsDisplay: number | null
  maxSeverityLabel: string | null
  maxSeverityChipClass: string | null
  cells: ContentionMatrixCellModel[]
  redacted: boolean
  redactionLabel: string
}

/** 矩阵列头（日期轴，由首行 cells 派生）。 */
export interface ContentionMatrixColumn {
  date: string
}

export interface ContentionMatrixModel {
  from: string
  to: string
  columns: ContentionMatrixColumn[]
  rows: ContentionMatrixRowModel[]
}

function buildCellModel(cell: ResourceContentionMatrixCell): ContentionMatrixCellModel {
  const redacted = isContentionRedacted(cell.redactionState)
  // 受限单元格一律中性化：不保留 severity 信号与任何数值（RL-05，不泄露存在性与程度）。
  const severityMeta = redacted ? null : severityMetaOf(cell.severity ?? undefined)
  return {
    date: formatContentionDate(cell.date),
    hasSignal: redacted ? false : Boolean(cell.severity),
    severityLabel: severityMeta?.label ?? null,
    severityChipClass: severityMeta?.chipClass ?? null,
    loadPercent: redacted ? null : cell.loadPercent,
    contentionCount: redacted ? 0 : cell.contentionCount,
    redacted,
  }
}

/** 争用矩阵响应 → 网格模型（列 = 日期轴；受限单元格仅中性占位）。 */
export function buildContentionMatrixModel(
  matrix: ResourceContentionMatrix,
): ContentionMatrixModel {
  const columns: ContentionMatrixColumn[] =
    matrix.rows[0]?.cells.map((cell) => ({ date: formatContentionDate(cell.date) })) ?? []
  const rows: ContentionMatrixRowModel[] = matrix.rows.map((row) => {
    const redacted = isContentionRedacted(row.redactionState)
    const maxSeverityMeta = severityMetaOf(row.maxSeverity ?? undefined)
    return {
      resourceId: row.resourceId,
      resourceDisplay: formatContentionSubjectName(row.resourceName, redacted),
      roleDisplay: redacted ? null : row.role,
      totalContentions: row.totalContentions,
      totalContentionsDisplay: redacted ? null : row.totalContentions,
      maxSeverityLabel: maxSeverityMeta?.label ?? null,
      maxSeverityChipClass: maxSeverityMeta?.chipClass ?? null,
      cells: row.cells.map(buildCellModel),
      redacted,
      redactionLabel: CONTENTION_REDACTION_LABELS[row.redactionState] ?? '不可见',
    }
  })
  return { from: matrix.from, to: matrix.to, columns, rows }
}

// ─── URL 状态解析/序列化（restorable filters） ─────────────────────────

/** 争用工作台可恢复视图（list/matrix 双视图）。 */
export const CONTENTION_URL_VIEWS = ['list', 'matrix'] as const
export type ContentionUrlView = (typeof CONTENTION_URL_VIEWS)[number]

export const CONTENTION_DEFAULT_VIEW: ContentionUrlView = 'matrix'
export const CONTENTION_DEFAULT_PAGE = 1

export interface ContentionUrlState {
  view: ContentionUrlView
  severity: ResourceContentionSeverity | ''
  reasonCode: ResourceContentionReasonCode | ''
  page: number
}

/** URL 值 → 合法枚举（非法/脏值一律回落默认，绝不原样外发）。 */
function narrowSeverity(raw: string | null): ResourceContentionSeverity | '' {
  if (raw && (RESOURCE_CONTENTION_SEVERITY_VALUES as readonly string[]).includes(raw)) {
    return raw as ResourceContentionSeverity
  }
  return ''
}

function narrowReason(raw: string | null): ResourceContentionReasonCode | '' {
  if (raw && (RESOURCE_CONTENTION_REASON_CODE_VALUES as readonly string[]).includes(raw)) {
    return raw as ResourceContentionReasonCode
  }
  return ''
}

/** URLSearchParams → 工作台状态（非法值回落默认；page 收敛正整数）。 */
export function parseContentionUrlState(searchParams: URLSearchParams): ContentionUrlState {
  const rawView = searchParams.get('view')
  const view: ContentionUrlView = (CONTENTION_URL_VIEWS as readonly string[]).includes(
    rawView ?? '',
  )
    ? (rawView as ContentionUrlView)
    : CONTENTION_DEFAULT_VIEW
  const rawPage = Number(searchParams.get('page') ?? CONTENTION_DEFAULT_PAGE)
  const page =
    Number.isFinite(rawPage) && rawPage >= 1 ? Math.trunc(rawPage) : CONTENTION_DEFAULT_PAGE
  return {
    view,
    severity: narrowSeverity(searchParams.get('severity')),
    reasonCode: narrowReason(searchParams.get('reasonCode')),
    page,
  }
}

/** 工作台状态 → URLSearchParams（空值不落参，保持 URL 洁净可分享）。 */
export function serializeContentionUrlState(state: ContentionUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.view !== CONTENTION_DEFAULT_VIEW) params.set('view', state.view)
  if (state.severity !== '') params.set('severity', state.severity)
  if (state.reasonCode !== '') params.set('reasonCode', state.reasonCode)
  if (state.page > 1) params.set('page', String(state.page))
  return params
}

/** 工作台状态 → 数据层查询（缺省值不落 query，交由服务端默认）。 */
export function contentionStateToQuery(state: ContentionUrlState): ResourceContentionQuery {
  return {
    severity: state.severity === '' ? undefined : state.severity,
    reasonCode: state.reasonCode === '' ? undefined : state.reasonCode,
    page: state.page,
    perPage: 20,
  }
}

/** 当前状态是否携带激活筛选（重置按钮可见性依据）。 */
export function hasActiveContentionFilters(state: ContentionUrlState): boolean {
  return state.severity !== '' || state.reasonCode !== ''
}

// ─── 错误三态分类（受限 403 中性 / 404 中性 / 5xx 可重试） ─────────────

export type ApiErrorKind = 'forbidden' | 'not_found' | 'server' | 'network' | 'unknown'

/**
 * 错误三态分类器：403/PERMISSION_DENIED → 受限（渲染中性限制态，RL-05 不泄露
 * 证据存在性）；404/RESOURCE_NOT_FOUND → 中性未找到；5xx/网络错误 → 可重试。
 */
export function classifyApiError(error: unknown): { kind: ApiErrorKind; status: number | null } {
  const apiError = error as Partial<ApiError> | null | undefined
  const status =
    apiError && typeof apiError.status === 'number' ? (apiError.status as number) : null
  const code = apiError?.code
  if (status === 403 || code === 'PERMISSION_DENIED') return { kind: 'forbidden', status }
  if (status === 404 || code === 'RESOURCE_NOT_FOUND') return { kind: 'not_found', status }
  if (status !== null && status >= 500) return { kind: 'server', status }
  if (error instanceof Error && error.message.includes('fetch')) return { kind: 'network', status }
  if (error instanceof Error) return { kind: 'network', status }
  return { kind: 'unknown', status }
}

/** 中性受限文案（证据/建议抽屉 403 态共用；不含任何存在性暗示）。 */
export const CONTENTION_RESTRICTED_COPY = {
  title: '受限内容不可见',
  description: '当前条目涉及受限维度，需对应资源明细权限方可查看。',
}

/** 中性未找到文案（RL-05：跨组织/不存在统一中性语义）。 */
export const CONTENTION_NOT_FOUND_COPY = {
  title: '未找到争用记录',
  description: '记录不存在或已被移除（统一中性处理，不泄露跨组织数据存在性）。',
}

/** 5xx 可重试文案。 */
export const CONTENTION_SERVER_ERROR_COPY = {
  title: '加载失败，请重试',
  description: '服务暂时不可用或网络异常，可稍后重试。',
}

/** 错误对象 → 可展示文本（api-client 抛出的 ApiError 形如 {status,code,message}）。 */
export function resolveErrorMessageText(error: unknown, fallback = ''): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim() !== '') return message
  }
  if (error instanceof Error) return error.message
  return fallback
}

/**
 * lib/api 单对象端点（apiFetch 自动解包 data 信封）与其类型声明（仍按信封声明）
 * 的相容器：运行时值为负载本体（无 data 键）→ 原样返回；若服务端响应为真信封
 * （含 data 键）→ 取 data。两态均收敛到负载类型，杜绝 `.data` 二重解包串档。
 */
export function asSinglePayload<T>(value: T | { data: T }): T {
  if (
    value !== null &&
    typeof value === 'object' &&
    'data' in value &&
    (value as { data?: unknown }).data !== undefined
  ) {
    return (value as { data: T }).data
  }
  return value as T
}
