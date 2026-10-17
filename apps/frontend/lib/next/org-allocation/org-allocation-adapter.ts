// 跨项目资源调配呈现侧纯函数适配器（v3-ui-next-org-portfolio-domains W7 · tasks 7.1）。
//
// 仅供新轨组织级「跨项目调配草案工作台」使用（/next/organization/
// cross-project-resource-allocation）：零 UI / 零 DOM / 零网络依赖，
// 全部输入输出类型取自 `@aiproj/types` 共享契约（RL-04 契约同源）。
//
// - 草案 / 调配项 / 冲突 / 应用结果 / 候选来源的中文标签与徽标档位映射；
// - 冲突严重度排序（与共享包 SEVERITY_ORDER 同口径）；
// - 候选资源按项目 / 技能分组的纯函数（供候选池面板呈现）；
// - URL 状态（?draft=）解析 / 序列化纯函数（restorable filters）；
// - 日期窗口默认值（新建草案）与展示格式化。
import {
  CROSS_PROJECT_ALLOCATION_APPLY_RESULT_STATUSES,
  CROSS_PROJECT_ALLOCATION_CANDIDATE_SOURCES,
  CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_ORDER,
  CROSS_PROJECT_ALLOCATION_ITEM_STATUSES,
  CROSS_PROJECT_ALLOCATION_ITEM_TYPES,
} from '@aiproj/types'
import type {
  CrossProjectAllocationCandidateResource,
  CrossProjectAllocationConflictSeverity,
  CrossProjectAllocationDraft,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 草案状态（draft/previewed/confirmed/applied/cancelled/expired/failed）
// ---------------------------------------------------------------------------

/** 状态代码 → 简体中文标签。未知代码兜底返回原文（永不崩溃）。 */
export const ALLOCATION_DRAFT_STATUS_LABELS: Record<string, string> = {
  draft: '草案',
  previewed: '已预览',
  confirmed: '已确认',
  applied: '已应用',
  cancelled: '已取消',
  expired: '已过期',
  failed: '失败',
}

/** 徽标档位：neutral 中性灰 / muted 弱化 / info 冷蓝 / warning 琥珀 / success 绿 / danger 红。 */
export type AllocationTone = 'neutral' | 'muted' | 'info' | 'warning' | 'success' | 'danger'

const DRAFT_STATUS_TONES: Record<string, AllocationTone> = {
  draft: 'neutral',
  previewed: 'info',
  confirmed: 'warning',
  applied: 'success',
  cancelled: 'muted',
  expired: 'warning',
  failed: 'danger',
}

export function allocationDraftStatusLabel(status: string | null | undefined): string {
  if (!status) return '—'
  return ALLOCATION_DRAFT_STATUS_LABELS[status] ?? status
}

export function allocationDraftStatusTone(status: string | null | undefined): AllocationTone {
  if (!status) return 'neutral'
  return DRAFT_STATUS_TONES[status] ?? 'neutral'
}

/** 草案是否处于「可编排」状态（可改 items / 可取消；预览/确认/应用按各自状态推进）。 */
export function isAllocationDraftEditable(status: string | null | undefined): boolean {
  return status === 'draft' || status === 'previewed'
}

/** 是否仍可取消（applied / cancelled / expired 终态除外）。 */
export function isAllocationDraftCancellable(status: string | null | undefined): boolean {
  if (!status) return false
  return !['applied', 'cancelled', 'expired'].includes(status)
}

// ---------------------------------------------------------------------------
// 调配项类型 / 状态
// ---------------------------------------------------------------------------

export const ALLOCATION_ITEM_TYPE_LABELS: Record<string, string> = {
  [CROSS_PROJECT_ALLOCATION_ITEM_TYPES.ALLOCATE]: '分配',
  [CROSS_PROJECT_ALLOCATION_ITEM_TYPES.REALLOCATE]: '重新分配',
  [CROSS_PROJECT_ALLOCATION_ITEM_TYPES.REMOVE]: '移除',
  [CROSS_PROJECT_ALLOCATION_ITEM_TYPES.MAP_RESOURCE]: '资源映射',
}

export function allocationItemTypeLabel(type: string | null | undefined): string {
  if (!type) return '—'
  return ALLOCATION_ITEM_TYPE_LABELS[type] ?? type
}

export const ALLOCATION_ITEM_STATUS_LABELS: Record<string, string> = {
  [CROSS_PROJECT_ALLOCATION_ITEM_STATUSES.PENDING]: '待处理',
  [CROSS_PROJECT_ALLOCATION_ITEM_STATUSES.CONFLICT]: '冲突',
  [CROSS_PROJECT_ALLOCATION_ITEM_STATUSES.READY]: '就绪',
  [CROSS_PROJECT_ALLOCATION_ITEM_STATUSES.APPLIED]: '已应用',
  [CROSS_PROJECT_ALLOCATION_ITEM_STATUSES.FAILED]: '失败',
  [CROSS_PROJECT_ALLOCATION_ITEM_STATUSES.SKIPPED]: '已跳过',
}

export function allocationItemStatusLabel(status: string | null | undefined): string {
  if (!status) return '—'
  return ALLOCATION_ITEM_STATUS_LABELS[status] ?? status
}

// ---------------------------------------------------------------------------
// 冲突严重度
// ---------------------------------------------------------------------------

export const ALLOCATION_CONFLICT_SEVERITY_LABELS: Record<string, string> = {
  info: '提示',
  warning: '警告',
  error: '错误',
  critical: '严重',
}

export const ALLOCATION_CONFLICT_SEVERITY_TONES: Record<string, AllocationTone> = {
  info: 'neutral',
  warning: 'warning',
  error: 'danger',
  critical: 'danger',
}

export function conflictSeverityLabel(severity: string | null | undefined): string {
  if (!severity) return '—'
  return ALLOCATION_CONFLICT_SEVERITY_LABELS[severity] ?? severity
}

export function conflictSeverityTone(severity: string | null | undefined): AllocationTone {
  if (!severity) return 'neutral'
  return ALLOCATION_CONFLICT_SEVERITY_TONES[severity] ?? 'neutral'
}

/** 严重度排序比较器：critical(3) > error(2) > warning(1) > info(0)。 */
export function compareConflictSeverity(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const l = (left as CrossProjectAllocationConflictSeverity | undefined) ?? 'info'
  const r = (right as CrossProjectAllocationConflictSeverity | undefined) ?? 'info'
  return (
    (CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_ORDER[l] ?? 0) -
    (CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_ORDER[r] ?? 0)
  )
}

/** 冲突列表按严重度降序排序（稳定，泛型保留行附加字段，供预览/行内列表使用）。 */
export function sortConflictsBySeverity<T extends { severity: string }>(
  conflicts: ReadonlyArray<T>,
): T[] {
  return [...conflicts].sort((a, b) => compareConflictSeverity(b.severity, a.severity))
}

// ---------------------------------------------------------------------------
// 应用结果状态
// ---------------------------------------------------------------------------

export const ALLOCATION_APPLY_RESULT_LABELS: Record<string, string> = {
  [CROSS_PROJECT_ALLOCATION_APPLY_RESULT_STATUSES.SUCCESS]: '成功',
  [CROSS_PROJECT_ALLOCATION_APPLY_RESULT_STATUSES.PARTIAL]: '部分成功',
  [CROSS_PROJECT_ALLOCATION_APPLY_RESULT_STATUSES.FAILED]: '失败',
  [CROSS_PROJECT_ALLOCATION_APPLY_RESULT_STATUSES.STALE]: '已过期',
}

export function applyResultLabel(status: string | null | undefined): string {
  if (!status) return '—'
  return ALLOCATION_APPLY_RESULT_LABELS[status] ?? status
}

export function applyResultTone(status: string | null | undefined): AllocationTone {
  if (status === CROSS_PROJECT_ALLOCATION_APPLY_RESULT_STATUSES.SUCCESS) return 'success'
  if (status === CROSS_PROJECT_ALLOCATION_APPLY_RESULT_STATUSES.PARTIAL) return 'warning'
  if (status === CROSS_PROJECT_ALLOCATION_APPLY_RESULT_STATUSES.STALE) return 'warning'
  if (status === CROSS_PROJECT_ALLOCATION_APPLY_RESULT_STATUSES.FAILED) return 'danger'
  return 'neutral'
}

// ---------------------------------------------------------------------------
// 候选来源
// ---------------------------------------------------------------------------

export const ALLOCATION_CANDIDATE_SOURCE_LABELS: Record<string, string> = {
  [CROSS_PROJECT_ALLOCATION_CANDIDATE_SOURCES.RULE]: '规则',
  [CROSS_PROJECT_ALLOCATION_CANDIDATE_SOURCES.AI]: 'AI',
  [CROSS_PROJECT_ALLOCATION_CANDIDATE_SOURCES.MANUAL]: '人工',
  [CROSS_PROJECT_ALLOCATION_CANDIDATE_SOURCES.IMPORTED]: '导入',
}

export function candidateSourceLabel(source: string | null | undefined): string {
  if (!source) return '—'
  return ALLOCATION_CANDIDATE_SOURCE_LABELS[source] ?? source
}

export function isAiSourcedCandidate(source: string | null | undefined): boolean {
  return source === CROSS_PROJECT_ALLOCATION_CANDIDATE_SOURCES.AI
}

// ---------------------------------------------------------------------------
// 候选分组（候选池面板：按项目 / 按技能）
// ---------------------------------------------------------------------------

export interface CandidateProjectGroup {
  projectId: number
  projectName: string
  items: CrossProjectAllocationCandidateResource[]
}

/** 按来源项目分组（保留候选原始相对顺序）。projectName 缺失时以 #id 兜底。 */
export function groupCandidatesByProject(
  candidates: readonly CrossProjectAllocationCandidateResource[],
): CandidateProjectGroup[] {
  const groups = new Map<number, CandidateProjectGroup>()
  for (const candidate of candidates) {
    const group = groups.get(candidate.sourceProjectId)
    if (group) {
      group.items.push(candidate)
    } else {
      groups.set(candidate.sourceProjectId, {
        projectId: candidate.sourceProjectId,
        projectName: candidate.sourceProjectName || `项目 #${candidate.sourceProjectId}`,
        items: [candidate],
      })
    }
  }
  return [...groups.values()]
}

export interface CandidateSkillGroup {
  skill: string
  items: CrossProjectAllocationCandidateResource[]
}

/**
 * 按技能标签分组（候选可命中多个技能，允许跨组重复出现；
 * 无技能候选落入空组 key ''）。
 */
export function groupCandidatesBySkill(
  candidates: readonly CrossProjectAllocationCandidateResource[],
): CandidateSkillGroup[] {
  const groups = new Map<string, CandidateSkillGroup>()
  for (const candidate of candidates) {
    const tags = candidate.skillTags.length > 0 ? candidate.skillTags : ['']
    for (const tag of tags) {
      const group = groups.get(tag)
      if (group) {
        group.items.push(candidate)
      } else {
        groups.set(tag, { skill: tag, items: [candidate] })
      }
    }
  }
  return [...groups.values()]
}

/** 按技能关键词过滤候选（大小写不敏感子串；空关键词返回原数组）。 */
export function filterCandidatesBySkillKeyword(
  candidates: readonly CrossProjectAllocationCandidateResource[],
  keyword: string | null | undefined,
): CrossProjectAllocationCandidateResource[] {
  const kw = keyword?.trim().toLowerCase()
  if (!kw) return [...candidates]
  return candidates.filter((candidate) =>
    candidate.skillTags.some((tag) => tag.toLowerCase().includes(kw)),
  )
}

// ---------------------------------------------------------------------------
// URL 状态（restorable filters：?draft=<id> 为唯一事实来源）
// ---------------------------------------------------------------------------

const DRAFT_ID_RE = /^[1-9]\d*$/

/** 解析 URL draft 参数：非法 / 非正整数一律 null（调用方据此不发起详情请求）。 */
export function parseAllocationDraftIdParam(raw: string | null | undefined): number | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!DRAFT_ID_RE.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

/** 序列化查询串：无选中草案返回空串（等价于清空 draft 参数）。 */
export function serializeAllocationUrlState(draftId: number | null): string {
  return draftId === null ? '' : `?draft=${draftId}`
}

// ---------------------------------------------------------------------------
// 日期窗口（新建草案默认值 90 天；纯函数，now 可注入便于单测）
// ---------------------------------------------------------------------------

export interface AllocationDateWindow {
  from: string
  to: string
}

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 默认窗口：今天 → +90 天（与共享契约 CROSS_PROJECT_ALLOCATION_DEFAULT_DATE_WINDOW_DAYS 对齐）。 */
export function createDefaultAllocationDateWindow(
  now: Date = new Date(),
  windowDays = 90,
): AllocationDateWindow {
  const from = toDateInputValue(now)
  const toDate = new Date(now.getTime())
  toDate.setDate(toDate.getDate() + windowDays)
  return { from, to: toDateInputValue(toDate) }
}

/** ISO 时间串 → 展示用短日期（yyyy-mm-dd）；非法输入返回 '—'。 */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return toDateInputValue(date)
}

// ---------------------------------------------------------------------------
// 载荷归一化（直连 lib/api 的形态收敛）
// ---------------------------------------------------------------------------

/**
 * 单对象端点载荷收敛（与兄弟域 org-contentions adapter 的 `asSinglePayload`
 * 同口径）：`lib/api` 的类型声明仍按 `{ data: T }` 信封书写，而 `apiFetch`
 * （`lib/api-client.ts`）对单层 `{ data: ... }` 响应自动解包——真实后端下
 * 单对象端点运行时值为**裸载荷**（无 data 键）；历史双信封夹具或未来服务端
 * 信封形态下运行时值为 `{ data: T }`。两态均收敛到载荷本体，杜绝
 * `.then((r) => r.data)` 二次解包（hooks 层共享文件不动，收敛收口在域内）。
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

// ---------------------------------------------------------------------------
// 列表载荷归一化（数据层历史信封差异防御：数组直出 / {data,meta} 信封两态）
// ---------------------------------------------------------------------------

export interface NormalizedDraftList {
  rows: CrossProjectAllocationDraft[]
  total: number | null
}

/**
 * 草案列表载荷归一化：兼容「数组直出」「{data,meta} 信封」两种历史形态
 * （数据层 hooks 复用既有 `useListCrossProjectAllocationDrafts`，不在此修正），
 * 未知形态一律回退空列表（永不崩溃）。
 */
export function normalizeDraftListPayload(payload: unknown): NormalizedDraftList {
  if (Array.isArray(payload)) return { rows: payload, total: null }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.data)) {
      const meta =
        record.meta && typeof record.meta === 'object'
          ? (record.meta as Record<string, unknown>)
          : null
      const total = typeof meta?.total === 'number' ? meta.total : null
      return { rows: record.data as CrossProjectAllocationDraft[], total }
    }
  }
  return { rows: [], total: null }
}

export interface NormalizedCandidateList {
  rows: CrossProjectAllocationCandidateResource[]
  total: number | null
  hasMore: boolean | null
}

/** 候选载荷归一化：语义同 normalizeDraftListPayload（数组直出 / 信封两态兼容）。 */
export function normalizeCandidatesPayload(payload: unknown): NormalizedCandidateList {
  if (Array.isArray(payload)) {
    return { rows: payload, total: payload.length, hasMore: null }
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.data)) {
      const meta =
        record.meta && typeof record.meta === 'object'
          ? (record.meta as Record<string, unknown>)
          : null
      return {
        rows: record.data as CrossProjectAllocationCandidateResource[],
        total: typeof meta?.total === 'number' ? meta.total : null,
        hasMore: typeof meta?.hasMore === 'boolean' ? meta.hasMore : null,
      }
    }
  }
  return { rows: [], total: null, hasMore: null }
}

/** 草案行摘要（列表行统一模型）：名称 / 状态 / 项目范围数 / 警告数 / 创建时间。 */
export interface AllocationDraftRowModel {
  draft: CrossProjectAllocationDraft
  id: number
  name: string
  statusLabel: string
  statusTone: AllocationTone
  editable: boolean
  cancellable: boolean
  scopeProjectCount: number
  warningCount: number
  createdAtLabel: string
}

export function toAllocationDraftRowModel(
  draft: CrossProjectAllocationDraft,
): AllocationDraftRowModel {
  return {
    draft,
    id: Number(draft.id),
    name: draft.name,
    statusLabel: allocationDraftStatusLabel(draft.status),
    statusTone: allocationDraftStatusTone(draft.status),
    editable: isAllocationDraftEditable(draft.status),
    cancellable: isAllocationDraftCancellable(draft.status),
    scopeProjectCount: draft.queryShape?.projectIds?.length ?? 0,
    warningCount: draft.warnings?.length ?? 0,
    createdAtLabel: formatShortDate(draft.createdAt),
  }
}
