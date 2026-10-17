/**
 * v3-copilot-authoritative-page-context —— Copilot 权威页面语境共享契约。
 *
 * 定义版本化页面语境描述符（PageContextDescriptor）、权威事实（ContextFact）、
 * 回合响应侧上下文披露（CopilotPageContextDisclosure）、上界常量、每路由
 * filter allowlist、schema 校验与字节估算。
 *
 * 纪律：
 * - **浏览器永不序列化 DOM**：客户端只允许发送结构化可见状态（设计 §C / §H）。
 * - **未知键拒绝**：descriptor 未知顶层键、未知 filter 值形态一律 hard reject；
 *   未知 filter **键名**不拒绝，但进入 `ignoredFilters`（disclosure 标记），
 *   服务端不传给 SQL（设计 §C「未知 filter 忽略并在 disclosure 标记」）。
 * - **客户端 ID 仅作候选**：projectId/entity id 的授权由服务端重新解析
 *   （设计 Decision 2），本模块只做形状与上界校验。
 * - 本模块纯类型 + 确定性常量 + helpers，零运行时依赖，不含时钟与随机源。
 */

import {
  COPILOT_PANORAMA_FACET_NAMES,
  type CopilotPanoramaFacetName,
} from './copilot-context-assembly.js'
import { copilotStableSerialize } from './copilot-shared-contracts.js'
import { COPILOT_TURN_FORBIDDEN_KEYS, buildForbiddenKeyLabelPattern } from './copilot-turn.js'

// ===========================================================================
// 版本
// ===========================================================================

/** 当前支持的页面语境版本。 */
export const COPILOT_PAGE_CONTEXT_VERSION = 1 as const

/** 受支持的版本集合（版本兼容判定：不在集合内 → 版本不兼容，整体拒绝）。 */
export const COPILOT_PAGE_CONTEXT_SUPPORTED_VERSIONS: readonly number[] = [1]

// ===========================================================================
// 枚举 — 路由
// ===========================================================================

export const COPILOT_PAGE_CONTEXT_ROUTE_IDS = [
  'project-kanban',
  'project-list',
  'project-calendar',
  'project-timeline',
  'project-gantt',
  'project-wbs',
  'project-overview',
  'global',
] as const
export type CopilotPageContextRouteId = (typeof COPILOT_PAGE_CONTEXT_ROUTE_IDS)[number]

export function isCopilotPageContextRouteId(v: unknown): v is CopilotPageContextRouteId {
  return (COPILOT_PAGE_CONTEXT_ROUTE_IDS as readonly string[]).includes(v as string)
}

// ===========================================================================
// 上界常量
// ===========================================================================

/** pathname 上界。 */
export const COPILOT_PAGE_CONTEXT_MAX_PATHNAME_LENGTH = 512
/** viewId 上界。 */
export const COPILOT_PAGE_CONTEXT_MAX_VIEW_ID_LENGTH = 64
/** filter 条数上界。 */
export const COPILOT_PAGE_CONTEXT_MAX_FILTERS = 12
/** sort 条数上界。 */
export const COPILOT_PAGE_CONTEXT_MAX_SORT = 4
/** 选中实体引用上界（与提及引用上界同一数量级纪律）。 */
export const COPILOT_PAGE_CONTEXT_MAX_SELECTED_ENTITY_REFS = 8
/** routeRevision 上界（稳定路由指纹）。 */
export const COPILOT_PAGE_CONTEXT_ROUTE_REVISION_MAX_LENGTH = 64
/** 单个 filter value 字符串上界。 */
export const COPILOT_PAGE_CONTEXT_MAX_FILTER_VALUE_LENGTH = 128
/** 序列化后 descriptor 字节上界（确定性估算，防止恶意超长请求）。 */
export const COPILOT_PAGE_CONTEXT_DESCRIPTOR_MAX_BYTES = 4096

/** 单回合权威事实条数上界。 */
export const COPILOT_PAGE_CONTEXT_MAX_FACTS = 40
/** 单条事实值稳定序列化字符上界。 */
export const COPILOT_PAGE_CONTEXT_MAX_FACT_VALUE_CHARS = 800
/** factKey 上界。 */
export const COPILOT_PAGE_CONTEXT_MAX_FACT_KEY_LENGTH = 64
/** displayLabel 上界。 */
export const COPILOT_PAGE_CONTEXT_MAX_FACT_LABEL_LENGTH = 120
/** sourceRef 上界。 */
export const COPILOT_PAGE_CONTEXT_MAX_FACT_SOURCE_REF_LENGTH = 200
/** 全部事实稳定序列化字节上界（prompt 预算的确定性上限）。 */
export const COPILOT_PAGE_CONTEXT_FACTS_MAX_BYTES = 8192

// ===========================================================================
// 每路由 filter allowlist（设计 §C）
// ===========================================================================

/**
 * 每路由允许的 filter 键（闭合 allowlist）。
 *
 * - 路由 adapter 只发送 allowlist 内的键；
 * - 服务端以同一张表重校验：未知键进入 disclosure 的 `ignoredFilters`，
 *   不传给 SQL（设计 §C「禁止允许任意 filters key」）。
 */
export const COPILOT_PAGE_CONTEXT_ROUTE_FILTER_ALLOWLIST: Readonly<
  Record<CopilotPageContextRouteId, readonly string[]>
> = {
  'project-kanban': ['status', 'assignee', 'priority', 'label', 'keyword'],
  'project-list': ['status', 'assignee', 'priority', 'label', 'keyword', 'milestone'],
  'project-calendar': ['status', 'assignee', 'priority', 'keyword'],
  'project-timeline': ['status', 'milestone', 'keyword'],
  'project-gantt': ['status', 'milestone', 'keyword', 'criticalPath'],
  'project-wbs': ['parent', 'level', 'selection', 'keyword'],
  'project-overview': ['keyword'],
  global: ['keyword'],
}

/** 某路由允许的 sort 字段（未列入的字段名 → ignoredSort，不传给 SQL）。 */
export const COPILOT_PAGE_CONTEXT_ROUTE_SORT_ALLOWLIST: Readonly<
  Record<CopilotPageContextRouteId, readonly string[]>
> = {
  'project-kanban': ['rank', 'dueDate', 'priority', 'updatedAt'],
  'project-list': ['dueDate', 'priority', 'status', 'assigneeId', 'updatedAt', 'name'],
  'project-calendar': ['dueDate', 'priority', 'updatedAt'],
  'project-timeline': ['occurredAt', 'dueDate', 'updatedAt'],
  'project-gantt': ['startDate', 'dueDate', 'priority'],
  'project-wbs': ['parentId', 'level', 'sortOrder'],
  'project-overview': [],
  global: [],
}

/** 允许出现在 selectedEntityRefs / filter value 中的项目实体种类。 */
export const COPILOT_PAGE_CONTEXT_ENTITY_KINDS = ['task', 'risk', 'milestone', 'resource'] as const
export type CopilotPageEntityKind = (typeof COPILOT_PAGE_CONTEXT_ENTITY_KINDS)[number]

export function isCopilotPageEntityKind(v: unknown): v is CopilotPageEntityKind {
  return (COPILOT_PAGE_CONTEXT_ENTITY_KINDS as readonly string[]).includes(v as string)
}

// ===========================================================================
// 结构类型 — 页面语境描述符（设计 §C）
// ===========================================================================

export type CopilotPageContextFilterOp = 'eq' | 'in' | 'range'

export function isCopilotPageContextFilterOp(v: unknown): v is CopilotPageContextFilterOp {
  return v === 'eq' || v === 'in' || v === 'range'
}

export interface CopilotPageContextFilter {
  readonly key: string
  readonly op: CopilotPageContextFilterOp
  readonly value: string | readonly string[]
}

export interface CopilotPageContextSort {
  readonly field: string
  readonly direction: 'asc' | 'desc'
}

export interface CopilotPageContextTimeRange {
  readonly from?: string
  readonly to?: string
}

export interface CopilotPageEntityRef {
  readonly kind: CopilotPageEntityKind
  readonly id: number
}

/**
 * 版本化页面语境描述符 V1。
 *
 * 客户端只发送结构化可见状态：路由、项目、视图、筛选、排序、时间窗、
 * 选中实体引用与路由修订号；**不发送 DOM、HTML、React state 或整页 JSON**。
 * 任何 projectId / entity id 到达服务端都只作候选，授权由服务端重新解析。
 */
export interface CopilotPageContextDescriptorV1 {
  readonly version: 1
  readonly routeId: CopilotPageContextRouteId
  readonly pathname: string
  readonly projectId?: number
  readonly viewId?: string
  readonly filters?: readonly CopilotPageContextFilter[]
  readonly sort?: readonly CopilotPageContextSort[]
  readonly timeRange?: CopilotPageContextTimeRange
  readonly selectedEntityRefs?: readonly CopilotPageEntityRef[]
  readonly routeRevision: string
}

/** 版本化页面语境描述符（当前只有 V1）。 */
export type CopilotPageContextDescriptor = CopilotPageContextDescriptorV1

// ===========================================================================
// 结构类型 — 权威事实（设计 §C）
// ===========================================================================

/** 事实值形态：标量 / 字符串列表 / 数字分布（禁止嵌套对象与任意 JSON）。 */
export type CopilotContextFactValue =
  string | number | boolean | readonly string[] | Readonly<Record<string, number>>

export function isCopilotContextFactValue(v: unknown): v is CopilotContextFactValue {
  if (v === null || v === undefined) return false
  switch (typeof v) {
    case 'string':
    case 'number':
    case 'boolean':
      return true
    case 'object': {
      if (Array.isArray(v)) return v.every((item) => typeof item === 'string')
      const entries = Object.entries(v)
      return entries.every(([, value]) => typeof value === 'number')
    }
    default:
      return false
  }
}

/** 事实切面：与 panorama 九切面同一词汇表（事实可能来自切面或检索结果）。 */
export type CopilotContextFactFacet = CopilotPanoramaFacetName

export const COPILOT_CONTEXT_FACT_SENSITIVITIES = ['low', 'internal'] as const
export type CopilotContextFactSensitivity = (typeof COPILOT_CONTEXT_FACT_SENSITIVITIES)[number]

export function isCopilotContextFactSensitivity(v: unknown): v is CopilotContextFactSensitivity {
  return (COPILOT_CONTEXT_FACT_SENSITIVITIES as readonly string[]).includes(v as string)
}

/**
 * 权威事实（设计 §C）。
 *
 * 约定（后端生产方必须遵守）：
 * - **聚合事实先于行级事实**：如 `tasks.total` / `tasks.byStatus` 必须在
 *   `task.rows` 之前——预算截断按数组序截断，先截断行级事实不破坏精确总数
 *   （设计 §F-6「不能先截断再算 total」）。
 * - `sourceRef` 可被 citations 展开；`observedAt` 为服务端采集时间。
 * - `sensitivity: 'internal'` 的事实不得进入低敏审计摘要。
 */
export interface CopilotContextFact {
  readonly factKey: string
  readonly value: CopilotContextFactValue
  /** 可引用标题（回答中可作为引用标签显示）。 */
  readonly displayLabel: string
  readonly facet: CopilotContextFactFacet
  readonly sourceRef: string
  readonly observedAt: string
  readonly sensitivity: CopilotContextFactSensitivity
  /** 行级裁剪标记（预算截断后为 true；聚合事实恒 false）。 */
  readonly truncated?: boolean
}

// ===========================================================================
// 结构类型 — 响应侧上下文披露（transparency，spec REQ）
// ===========================================================================

export const COPILOT_PAGE_CONTEXT_STATUSES = ['ready', 'context_unavailable'] as const
export type CopilotPageContextStatus = (typeof COPILOT_PAGE_CONTEXT_STATUSES)[number]

/**
 * 固定隐私说明文案（spec REQ：声明读取的是已授权产品数据而非屏幕像素/隐藏 DOM）。
 * 设计 §G。
 */
export const COPILOT_PAGE_CONTEXT_PRIVACY_NOTE =
  'Copilot 使用你有权限读取的项目数据与当前视图条件，不读取屏幕像素或隐藏页面内容。'

/**
 * 回合响应侧上下文披露（V1）。
 *
 * 服务端权威解析后的披露：项目/页面/已应用筛选/被忽略筛选/事实快照时间/
 * 上下文状态。客户端 ID 只作候选——披露里的 projectId 是服务端重新授权后的结果。
 */
export interface CopilotPageContextDisclosureV1 {
  readonly version: 1
  /** 服务端认定的路由（客户端提交、经重新解析）；无项目语境时为 'none'。 */
  readonly routeId: CopilotPageContextRouteId | 'none'
  readonly projectId?: number
  readonly viewId?: string
  /** 已应用筛选（服务端校验后,只含 allowlist 内键）。 */
  readonly filters: readonly CopilotPageContextFilter[]
  /** 被忽略的筛选（未知键/未知值——不传给 SQL，向用户披露）。 */
  readonly ignoredFilters: readonly CopilotPageContextFilter[]
  /** 已应用排序。 */
  readonly sortApplied: readonly CopilotPageContextSort[]
  readonly timeRange?: CopilotPageContextTimeRange
  /** 选中实体引用条数（只给计数，不给 ID——非泄露纪律）。 */
  readonly selectionCount: number
  /** 事实快照时间（服务端 observedAt 上界；回答标签据此标注）。 */
  readonly observedAt: string
  /** ready=拿到权威事实；context_unavailable=无法取得（不生成伪事实）。 */
  readonly status: CopilotPageContextStatus
  /** 固定隐私说明。 */
  readonly privacyNote: string
}

export type CopilotPageContextDisclosure = CopilotPageContextDisclosureV1

export function isCopilotPageContextStatus(v: unknown): v is CopilotPageContextStatus {
  return (COPILOT_PAGE_CONTEXT_STATUSES as readonly string[]).includes(v as string)
}

// ===========================================================================
// descriptor schema 校验（设计 §C：未知字段、长度、非法 ID、版本兼容）
// ===========================================================================

export interface CopilotPageContextValidationResult {
  readonly ok: boolean
  /** 合法描述符（ok 时）。 */
  readonly descriptor?: CopilotPageContextDescriptorV1
  /** 被忽略的筛选（未知键——disclosure 标记，不传给 SQL）。 */
  readonly ignoredFilters: readonly CopilotPageContextFilter[]
  /** 被忽略的排序（未知字段）。 */
  readonly ignoredSort: readonly CopilotPageContextSort[]
  /** 违规清单（ok=false 时，字段级原因）。 */
  readonly violations: readonly string[]
}

const FILTER_VALUE_MAX = COPILOT_PAGE_CONTEXT_MAX_FILTER_VALUE_LENGTH

function isDateLike(v: unknown): boolean {
  if (typeof v !== 'string' || v.length === 0 || v.length > 32) return false
  const parsed = Date.parse(v)
  return Number.isFinite(parsed)
}

function isPositiveInteger(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

/**
 * 校验并规范化页面语境描述符。
 *
 * 硬拒绝（violations）：未知顶层键、版本不兼容、routeId 非法、pathname/viewId
 * 超界、projectId/entity id 非法（非正整数）、filter/sort 形状非法（缺字段、
 * 非法 op/value 形态、value 超长）、timeRange 日期非法、selectedEntityRefs
 * 超界、routeRevision 缺失或超界、序列化后超字节上界。
 *
 * 软忽略（ignored*，disclosure 标记）：filter 键不在路由 allowlist、
 * sort 字段不在路由 allowlist。**未知键不拒绝但绝不传给 SQL。**
 */
export function validatePageContextDescriptor(raw: unknown): CopilotPageContextValidationResult {
  const violations: string[] = []
  const ignoredFilters: CopilotPageContextFilter[] = []
  const ignoredSort: CopilotPageContextSort[] = []

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, ignoredFilters, ignoredSort, violations: ['descriptor 必须是对象'] }
  }
  const record = raw as Record<string, unknown>

  // ── 未知顶层键（设计 Decision 1：Unknown keys are rejected）────
  const KNOWN_TOP_KEYS = new Set<string>([
    'version',
    'routeId',
    'pathname',
    'projectId',
    'viewId',
    'filters',
    'sort',
    'timeRange',
    'selectedEntityRefs',
    'routeRevision',
  ])
  const unknownKeys = Object.keys(record).filter((key) => !KNOWN_TOP_KEYS.has(key))
  for (const key of unknownKeys) {
    violations.push(`未知字段：${key}`)
  }

  // ── 版本兼容 ──────────────────────────────────────────────────
  if (!isPositiveInteger(record.version)) {
    violations.push('版本缺失或非法')
  } else if (
    !(COPILOT_PAGE_CONTEXT_SUPPORTED_VERSIONS as readonly number[]).includes(Number(record.version))
  ) {
    violations.push(
      `版本不兼容：${String(record.version)}（支持 ${COPILOT_PAGE_CONTEXT_SUPPORTED_VERSIONS.join('/')}）`,
    )
  }

  // ── routeId ───────────────────────────────────────────────────
  if (!isCopilotPageContextRouteId(record.routeId)) {
    violations.push('routeId 非法')
  }

  // ── pathname ──────────────────────────────────────────────────
  if (typeof record.pathname !== 'string' || record.pathname.length === 0) {
    violations.push('pathname 缺失')
  } else if (record.pathname.length > COPILOT_PAGE_CONTEXT_MAX_PATHNAME_LENGTH) {
    violations.push('pathname 超长')
  }

  // ── projectId（客户端仅作候选；服务端重新授权）────────────────
  if (record.projectId !== undefined && !isPositiveInteger(record.projectId)) {
    violations.push('projectId 非法（必须为正整数）')
  }

  // ── viewId ────────────────────────────────────────────────────
  if (
    record.viewId !== undefined &&
    (typeof record.viewId !== 'string' ||
      record.viewId.length === 0 ||
      record.viewId.length > COPILOT_PAGE_CONTEXT_MAX_VIEW_ID_LENGTH)
  ) {
    violations.push('viewId 非法或超长')
  }

  // ── routeRevision（必填，稳定路由指纹）────────────────────────
  if (typeof record.routeRevision !== 'string' || record.routeRevision.length === 0) {
    violations.push('routeRevision 缺失')
  } else if (record.routeRevision.length > COPILOT_PAGE_CONTEXT_ROUTE_REVISION_MAX_LENGTH) {
    violations.push('routeRevision 超长')
  }

  // ── routeId 可为空集合时 allowlist 查表（未知路由已在上面拒绝）──
  const routeId = isCopilotPageContextRouteId(record.routeId)
    ? (record.routeId as CopilotPageContextRouteId)
    : null
  const allowedFilterKeys = routeId ? COPILOT_PAGE_CONTEXT_ROUTE_FILTER_ALLOWLIST[routeId] : []
  const allowedSortFields = routeId ? COPILOT_PAGE_CONTEXT_ROUTE_SORT_ALLOWLIST[routeId] : []

  // ── filters ───────────────────────────────────────────────────
  const appliedFilters: CopilotPageContextFilter[] = []
  if (record.filters !== undefined) {
    if (!Array.isArray(record.filters)) {
      violations.push('filters 必须是数组')
    } else {
      if (record.filters.length > COPILOT_PAGE_CONTEXT_MAX_FILTERS) {
        violations.push(`filters 超出上界（≤${COPILOT_PAGE_CONTEXT_MAX_FILTERS}）`)
      }
      for (const [index, entry] of record.filters.entries()) {
        if (typeof entry !== 'object' || entry === null) {
          violations.push(`filters[${index}] 必须是对象`)
          continue
        }
        const filter = entry as Record<string, unknown>
        if (typeof filter.key !== 'string' || filter.key.length === 0) {
          violations.push(`filters[${index}] 缺少合法 key`)
          continue
        }
        if (!isCopilotPageContextFilterOp(filter.op)) {
          violations.push(`filters[${index}] op 非法`)
          continue
        }
        const value = filter.value
        const valueOk =
          typeof value === 'string'
            ? value.length > 0 && value.length <= FILTER_VALUE_MAX
            : Array.isArray(value) &&
              value.length > 0 &&
              value.every(
                (item) =>
                  typeof item === 'string' && item.length > 0 && item.length <= FILTER_VALUE_MAX,
              )
        if (!valueOk) {
          violations.push(`filters[${index}] value 非法或超长`)
          continue
        }

        // 未知键（allowlist 之外）→ 软忽略并披露，绝不传给 SQL
        const candidate: CopilotPageContextFilter = {
          key: filter.key,
          op: filter.op as CopilotPageContextFilterOp,
          value: value as string | string[],
        }
        if (allowedFilterKeys.includes(filter.key)) {
          appliedFilters.push(candidate)
        } else {
          ignoredFilters.push(candidate)
        }
      }
    }
  }

  // ── sort ──────────────────────────────────────────────────────
  const appliedSort: CopilotPageContextSort[] = []
  if (record.sort !== undefined) {
    if (!Array.isArray(record.sort)) {
      violations.push('sort 必须是数组')
    } else {
      if (record.sort.length > COPILOT_PAGE_CONTEXT_MAX_SORT) {
        violations.push(`sort 超出上界（≤${COPILOT_PAGE_CONTEXT_MAX_SORT}）`)
      }
      for (const [index, entry] of record.sort.entries()) {
        if (typeof entry !== 'object' || entry === null) {
          violations.push(`sort[${index}] 必须是对象`)
          continue
        }
        const sort = entry as Record<string, unknown>
        if (typeof sort.field !== 'string' || sort.field.length === 0) {
          violations.push(`sort[${index}] 缺少合法 field`)
          continue
        }
        if (sort.direction !== 'asc' && sort.direction !== 'desc') {
          violations.push(`sort[${index}] direction 非法`)
          continue
        }
        const candidate: CopilotPageContextSort = {
          field: sort.field,
          direction: sort.direction as 'asc' | 'desc',
        }
        if (allowedSortFields.includes(sort.field)) {
          appliedSort.push(candidate)
        } else {
          ignoredSort.push(candidate)
        }
      }
    }
  }

  // ── timeRange ─────────────────────────────────────────────────
  let timeRange: CopilotPageContextTimeRange | undefined
  if (record.timeRange !== undefined) {
    if (typeof record.timeRange !== 'object' || record.timeRange === null) {
      violations.push('timeRange 非法')
    } else {
      const range = record.timeRange as Record<string, unknown>
      const from = range.from === undefined ? undefined : range.from
      const to = range.to === undefined ? undefined : range.to
      if (from !== undefined && !isDateLike(from)) {
        violations.push('timeRange.from 非法日期')
      }
      if (to !== undefined && !isDateLike(to)) {
        violations.push('timeRange.to 非法日期')
      }
      if (from !== undefined || to !== undefined) {
        timeRange = {
          ...(from !== undefined ? { from: String(from) } : {}),
          ...(to !== undefined ? { to: String(to) } : {}),
        }
      }
    }
  }

  // ── selectedEntityRefs ────────────────────────────────────────
  let selectedEntityRefs: CopilotPageEntityRef[] | undefined
  if (record.selectedEntityRefs !== undefined) {
    if (!Array.isArray(record.selectedEntityRefs)) {
      violations.push('selectedEntityRefs 必须是数组')
    } else {
      if (record.selectedEntityRefs.length > COPILOT_PAGE_CONTEXT_MAX_SELECTED_ENTITY_REFS) {
        violations.push(
          `selectedEntityRefs 超出上界（≤${COPILOT_PAGE_CONTEXT_MAX_SELECTED_ENTITY_REFS}）`,
        )
      }
      let refs: CopilotPageEntityRef[] = []
      for (const [index, entry] of record.selectedEntityRefs.entries()) {
        if (typeof entry !== 'object' || entry === null) {
          violations.push(`selectedEntityRefs[${index}] 必须是对象`)
          continue
        }
        const ref = entry as Record<string, unknown>
        if (!isCopilotPageEntityKind(ref.kind)) {
          violations.push(`selectedEntityRefs[${index}] kind 非法`)
          continue
        }
        if (!isPositiveInteger(ref.id)) {
          violations.push(`selectedEntityRefs[${index}] id 非法（必须为正整数）`)
          continue
        }
        refs.push({ kind: ref.kind as CopilotPageEntityKind, id: ref.id as number })
      }
      selectedEntityRefs = refs.length > 0 ? refs : undefined
    }
  }

  // ── 序列化字节上界 ────────────────────────────────────────────
  const serialized = copilotStableSerialize(record)
  if (serialized.length > COPILOT_PAGE_CONTEXT_DESCRIPTOR_MAX_BYTES) {
    violations.push(`descriptor 序列化超字节上界（≤${COPILOT_PAGE_CONTEXT_DESCRIPTOR_MAX_BYTES}B）`)
  }

  if (violations.length > 0) {
    return { ok: false, ignoredFilters, ignoredSort, violations }
  }

  const descriptor: CopilotPageContextDescriptorV1 = {
    version: 1,
    routeId: record.routeId as CopilotPageContextRouteId,
    pathname: record.pathname as string,
    ...(record.projectId !== undefined ? { projectId: record.projectId as number } : {}),
    ...(record.viewId !== undefined ? { viewId: record.viewId as string } : {}),
    ...(appliedFilters.length > 0 ? { filters: appliedFilters } : {}),
    ...(appliedSort.length > 0 ? { sort: appliedSort } : {}),
    ...(timeRange !== undefined ? { timeRange } : {}),
    ...(selectedEntityRefs !== undefined ? { selectedEntityRefs } : {}),
    routeRevision: record.routeRevision as string,
  }

  return { ok: true, descriptor, ignoredFilters, ignoredSort, violations: [] }
}

// ===========================================================================
// ContextFact schema 校验
// ===========================================================================

/** 事实值是否含禁存/敏感内容（复用回合契约的禁存键与值级标签检测）。 */
export function containsForbiddenContextFactValue(value: unknown): boolean {
  const serialized = JSON.stringify(value ?? null)
  for (const key of COPILOT_TURN_FORBIDDEN_KEYS) {
    if (serialized.includes(`"${key}":`)) return true
  }
  return buildForbiddenKeyLabelPattern().test(serialized)
}

export interface CopilotContextFactValidationResult {
  readonly ok: boolean
  readonly fact?: CopilotContextFact
  readonly violations: readonly string[]
}

/**
 * 校验一条权威事实：factKey/displayLabel/sourceRef 上界、facet 与 sensitivity
 * 闭合集合、value 形态与禁存内容、observedAt 可解析、truncated 布尔。
 */
export function validateCopilotContextFact(raw: unknown): CopilotContextFactValidationResult {
  const violations: string[] = []
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, violations: ['fact 必须是对象'] }
  }
  const record = raw as Record<string, unknown>

  if (typeof record.factKey !== 'string' || record.factKey.length === 0) {
    violations.push('factKey 缺失')
  } else if (record.factKey.length > COPILOT_PAGE_CONTEXT_MAX_FACT_KEY_LENGTH) {
    violations.push('factKey 超长')
  }

  const value = record.value
  if (!isCopilotContextFactValue(value)) {
    violations.push('value 形态非法（只允许 标量/字符串列表/数字分布）')
  } else if (containsForbiddenContextFactValue(value)) {
    violations.push('value 含禁存内容')
  } else {
    const serialized = copilotStableSerialize(value).length
    if (serialized > COPILOT_PAGE_CONTEXT_MAX_FACT_VALUE_CHARS) {
      violations.push('value 超长')
    }
  }

  if (
    typeof record.displayLabel !== 'string' ||
    record.displayLabel.length === 0 ||
    record.displayLabel.length > COPILOT_PAGE_CONTEXT_MAX_FACT_LABEL_LENGTH
  ) {
    violations.push('displayLabel 非法或超长')
  }

  if (!(COPILOT_PANORAMA_FACET_NAMES as readonly string[]).includes(record.facet as string)) {
    violations.push('facet 非法')
  }

  if (
    typeof record.sourceRef !== 'string' ||
    record.sourceRef.length === 0 ||
    record.sourceRef.length > COPILOT_PAGE_CONTEXT_MAX_FACT_SOURCE_REF_LENGTH
  ) {
    violations.push('sourceRef 非法或超长')
  }

  if (typeof record.observedAt !== 'string' || !isDateLike(record.observedAt)) {
    violations.push('observedAt 非法日期')
  }

  if (!isCopilotContextFactSensitivity(record.sensitivity)) {
    violations.push('sensitivity 非法')
  } else if (record.sensitivity === 'internal') {
    // internal 事实本身合法；禁存约束由 DLP 层负责，此处只校验形态。
  }

  if (record.truncated !== undefined && typeof record.truncated !== 'boolean') {
    violations.push('truncated 必须是布尔')
  }

  if (violations.length === 0) {
    return {
      ok: true,
      fact: {
        factKey: record.factKey as string,
        value: value as CopilotContextFactValue,
        displayLabel: record.displayLabel as string,
        facet: record.facet as CopilotContextFactFacet,
        sourceRef: record.sourceRef as string,
        observedAt: record.observedAt as string,
        sensitivity: record.sensitivity as CopilotContextFactSensitivity,
        ...(record.truncated !== undefined ? { truncated: record.truncated as boolean } : {}),
      },
      violations: [],
    }
  }
  return { ok: false, violations }
}

// ===========================================================================
// 确定性字节估算与事实预算
// ===========================================================================

/** 确定性字节估算：descriptor 稳定序列化长度。 */
export function estimatePageContextDescriptorBytes(
  descriptor: CopilotPageContextDescriptor,
): number {
  return copilotStableSerialize(descriptor).length
}

/** 确定性字节估算：单条事实稳定序列化长度。 */
export function estimateContextFactBytes(fact: CopilotContextFact): number {
  return copilotStableSerialize(fact).length
}

export interface CopilotContextFactsBudgetInput {
  /** 事实条数上界（默认 COPILOT_PAGE_CONTEXT_MAX_FACTS）。 */
  readonly maxFacts?: number
  /** 事实字节上界（默认 COPILOT_PAGE_CONTEXT_FACTS_MAX_BYTES）。 */
  readonly maxBytes?: number
}

export interface CopilotContextFactsBudgetResult {
  readonly kept: readonly CopilotContextFact[]
  /** 被预算省略的事实条数（不静默丢弃——调用方应在 disclosure 标记）。 */
  readonly omittedCount: number
  /** 被标记 truncated 的条数（行级裁剪）。 */
  readonly truncatedCount: number
  readonly totalBytes: number
  /** 是否触及字节上界。 */
  readonly hitByteLimit: boolean
}

// ===========================================================================
// routeRevision 指纹（确定性；前端 adapter 与后端 resolver 共用同一语义）
// ===========================================================================

/**
 * FNV-1a 32 位确定性哈希（十六进制 8 位，带 `pc:` 前缀）。
 *
 * 本模块私有实现：barrel 中既有多个 fnv1aHash 且存在命名冲突史，不依赖它们。
 */
export function fnv1aPageContextHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `pc:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export interface CopilotPageContextRevisionInput {
  readonly pathname: string
  readonly filters: readonly CopilotPageContextFilter[]
  readonly sort: readonly CopilotPageContextSort[]
  readonly timeRange?: CopilotPageContextTimeRange
  readonly selection: readonly CopilotPageEntityRef[]
}

/**
 * 派生确定性 routeRevision（设计 §C`routeRevision`）。
 *
 * 对**结构化可见状态**做稳定序列化后哈希：同页面同指纹；任意可见状态
 * （pathname/filter/sort/timeRange/selection）变化即变化。只含结构化状态，
 * 不含 DOM。长度恒 ≤ `COPILOT_PAGE_CONTEXT_ROUTE_REVISION_MAX_LENGTH`。
 */
export function deriveCopilotPageRouteRevision(input: CopilotPageContextRevisionInput): string {
  const payload = copilotStableSerialize({
    pathname: input.pathname,
    filters: input.filters,
    sort: input.sort,
    timeRange: input.timeRange,
    selection: input.selection.map((ref) => `${ref.kind}:${ref.id}`).sort(),
  })
  return fnv1aPageContextHash(payload)
}

// ===========================================================================
// facet 选择（design §E：按用户问法选择相关切面，控制 prompt 大小）
// ===========================================================================

interface FacetKeywordRule {
  readonly facets: readonly CopilotPanoramaFacetName[]
  /** 优先级的低数值 = 更高优先级（同分时取高优先级组）。 */
  readonly priority: number
  readonly keywords: readonly string[]
}

const COPILOT_FACET_KEYWORD_RULES: readonly FacetKeywordRule[] = [
  {
    facets: ['risk', 'dependency', 'taskStatus'],
    priority: 1,
    keywords: ['风险', '阻塞', '卡住', '卡在', '受阻', '危险', '问题', 'blocked', 'blocker'],
  },
  {
    facets: ['taskStatus', 'milestone'],
    priority: 2,
    keywords: [
      '进度',
      '完成',
      '进展',
      '百分比',
      '做到',
      '做完',
      '剩',
      '情况',
      '概况',
      '总览',
      '状态',
    ],
  },
  {
    facets: ['resource', 'taskStatus'],
    priority: 3,
    keywords: ['忙', '负载', '分配', '谁负责', '超配', '人手', '资源', 'assigned'],
  },
  {
    facets: ['milestone', 'dependency', 'taskStatus'],
    priority: 4,
    keywords: ['排期', '延期', '延迟', '逾期', '里程碑', '交期', '什么时候', 'sprint', 'due'],
  },
  {
    facets: ['activity', 'change'],
    priority: 5,
    keywords: ['最近', '动态', '活动', '更新', '变化', '记录', 'recent'],
  },
]

/** 选中实体/当前卡片问法（附带其详情的相关切面）。 */
const COPILOT_FACET_SELECTION_KEYWORDS = [
  '选中',
  '这张',
  '这个任务',
  '当前任务',
  '当前卡片',
  '这条',
] as const

/**
 * 按用户问法选择相关 facet（design §E；确定性、可测试）。
 *
 * - 关键词命中最多的一组胜出（同分取 priority 数值小者）；
 * - 「选中/当前任务」问法额外附带选中实体详情相关切面；
 * - 普通问候/知识问答无命中 → 返回空数组（不强制项目事实，design §F-8）。
 */
export function deriveCopilotFacetSelection(
  normalizedText: string,
): readonly CopilotPanoramaFacetName[] {
  const text = normalizedText.toLowerCase()
  let best: FacetKeywordRule | null = null
  let bestHits = 0

  for (const rule of COPILOT_FACET_KEYWORD_RULES) {
    const hits = rule.keywords.filter((keyword) => text.includes(keyword.toLowerCase())).length
    if (hits === 0) continue
    if (hits > bestHits || (hits === bestHits && best !== null && rule.priority < best.priority)) {
      best = rule
      bestHits = hits
    }
  }

  const facets: CopilotPanoramaFacetName[] = best ? [...best.facets] : []
  const mentionsSelection = COPILOT_FACET_SELECTION_KEYWORDS.some((keyword) =>
    text.includes(keyword),
  )
  if (mentionsSelection) {
    for (const facet of ['taskStatus', 'dependency', 'risk'] as const) {
      if (!facets.includes(facet)) facets.push(facet)
    }
  }
  return facets
}

/**
 * 确定性事实预算：按数组序保留直到任一上界（条数/字节）。
 *
 * 契约：**聚合事实必须先于行级事实**（生产方约定）。预算只按序截断，
 * 因此精确总数不会被明细截断破坏（设计 §F-6）。被截断的余下事实计数
 * 返回给调用方，由响应侧 disclosure 呈现，不静默丢弃。
 */
export function budgetContextFacts(
  facts: readonly CopilotContextFact[],
  input: CopilotContextFactsBudgetInput = {},
): CopilotContextFactsBudgetResult {
  const maxFacts = input.maxFacts ?? COPILOT_PAGE_CONTEXT_MAX_FACTS
  const maxBytes = input.maxBytes ?? COPILOT_PAGE_CONTEXT_FACTS_MAX_BYTES

  const withBytes = facts.map((fact) => ({ fact, bytes: estimateContextFactBytes(fact) }))
  const kept: CopilotContextFact[] = []
  let totalBytes = 0
  let hitByteLimit = false
  let truncatedCount = 0

  for (const { fact, bytes } of withBytes) {
    if (kept.length >= maxFacts) break
    if (totalBytes + bytes > maxBytes) {
      hitByteLimit = true
      break
    }
    totalBytes += bytes
    if (fact.truncated === true) truncatedCount++
    kept.push(fact)
  }

  return {
    kept,
    omittedCount: facts.length - kept.length,
    truncatedCount,
    totalBytes: withBytes.reduce((sum, entry) => sum + entry.bytes, 0),
    hitByteLimit,
  }
}
