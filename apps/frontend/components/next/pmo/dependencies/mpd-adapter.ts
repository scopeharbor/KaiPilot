// 跨项目依赖 PMO 页域内适配层（v3-ui-next-pmo-domain W7 · tasks 7.2/7.3）。
//
// 背景：既有 mpd hooks（useMpdList/Detail/Preview/Confirm/Graph）经 `apiFetch` 消费，
// `apiFetch` 对 `{ data: … }` 信封做一层解包（lib/api-client.ts），而 hooks/类型的契约
// 与旧页均按「完整信封」书写（org 批已实证的「信封错配」同类缺陷）。因此真实运行时：
// list → 裸数组（meta 丢失）、detail/preview/confirm → 裸载荷；测试与旧代码按信封形态
// mock。本适配器对两种形态统一归一，页面只消费归一结果，不修共享文件（铁律 4）。
//
// 另一层归一：后端真实契约（v3-multi-project-dependency-model：
// providerEndpoint/riskLevel/freshnessStatus…）与前端 CRUD 契约
//（v3-multi-project-dependency-crud：provider.label/risk/freshness 缺失…）字段形态不同，
// 行/详情/预览渲染走本文件的双形态解析（枚举标签取并集，值不在映射时回退原文，
// RL-14 确定性渲染）。

import {
  DEP_LIFECYCLE_LABELS,
  DEP_RISK_LABELS,
  DEP_CATEGORY_LABELS,
  DEP_ENDPOINT_TYPE_LABELS,
  DEPENDENCY_TYPE_LABELS,
  type DepListItem,
} from '@aiproj/types'

// ─── 形态别名（避免文件内直接依赖 @aiproj/types 大对象） ──────────────────────

/** 列表/详情行归一视图（页面唯一消费形态）。 */
export interface MpdRowView {
  id: string
  providerLabel: string
  consumerLabel: string
  providerType: string
  consumerType: string
  category: string
  type: string
  lagDays: number | null
  strength: string
  bufferDays: number | null
  status: string
  risk: string
  sourceMode: string
  /** 新鲜度（fresh/stale/unknown）；CRUD 契约行无该字段 → null */
  freshness: string | null
  freshnessCheckedAt: string | null
  evidenceSummary: string | null
  warningCodes: string[]
  createdAt: string | null
  updatedAt: string | null
}

export interface MpdListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface MpdListView {
  rows: MpdRowView[]
  /** 列表分页元信息。 */
  meta: MpdListMeta | null
}

// ─── 双形态端点标签解析 ────────────────────────────────────────────────────────

interface EndpointLike {
  label?: unknown
  isRedacted?: unknown
  type?: unknown
  // legacy 形态
  projectName?: unknown
  milestoneName?: unknown
  taskName?: unknown
  externalLabel?: unknown
  endpointType?: unknown
  redacted?: unknown
}

/** 提供方/消费方展示标签（两形态统一；redaction 显示「已脱敏」）。 */
export function resolveEndpointLabel(endpoint: EndpointLike | undefined | null): string {
  if (!endpoint) return '—'
  if (endpoint.isRedacted === true || endpoint.redacted === true) return '已脱敏'
  const crudLabel = endpoint.label
  if (typeof crudLabel === 'string' && crudLabel !== 'REDACTED' && crudLabel !== '') {
    return crudLabel
  }
  // legacy 形态：名称按端点类型取值（任务端点的归属项目名不作为标签）
  const type = String(endpoint.type ?? endpoint.endpointType ?? '')
  const nameOfType: Record<string, unknown> = {
    task: endpoint.taskName,
    milestone: endpoint.milestoneName,
    project: endpoint.projectName,
    external: endpoint.externalLabel,
    manual_external: endpoint.externalLabel,
  }
  const typedName = nameOfType[type]
  if (typeof typedName === 'string' && typedName !== '') return typedName
  const legacyLabel =
    endpoint.projectName ?? endpoint.milestoneName ?? endpoint.taskName ?? endpoint.externalLabel
  if (typeof legacyLabel === 'string' && legacyLabel !== '') return legacyLabel
  return type ? `${endpointTypeLabel(type)}#未命名` : '未命名'
}

export function resolveEndpointType(endpoint: EndpointLike | undefined | null): string {
  if (!endpoint) return ''
  return String(endpoint.type ?? endpoint.endpointType ?? '')
}

/** 判断某行/端点是否被服务端脱敏（受限态提示用）。 */
export function isRowRedacted(row: unknown): boolean {
  const r = (row ?? {}) as {
    provider?: EndpointLike
    consumer?: EndpointLike
    providerEndpoint?: EndpointLike
    consumerEndpoint?: EndpointLike
    isRedacted?: unknown
  }
  if (r.isRedacted === true) return true
  return (
    r.provider?.isRedacted === true ||
    r.consumer?.isRedacted === true ||
    r.providerEndpoint?.redacted === true ||
    r.consumerEndpoint?.redacted === true ||
    r.providerEndpoint?.isRedacted === true ||
    r.consumerEndpoint?.isRedacted === true
  )
}

// ─── 枚举并集标签与色阶（RL-14 静态枚举；未知值回退原文） ──────────────────────

export const MPD_ENDPOINT_TYPE_LABELS: Record<string, string> = {
  ...DEP_ENDPOINT_TYPE_LABELS,
  external: '外部引用',
}

export const MPD_CATEGORY_LABELS: Record<string, string> = {
  ...DEP_CATEGORY_LABELS,
  milestone: '里程碑',
  external: '外部',
}

export const MPD_TYPE_LABELS: Record<string, string> = DEPENDENCY_TYPE_LABELS

export const MPD_SOURCE_MODE_LABELS: Record<string, string> = {
  manual: '手动',
  detected: '检测',
  imported: '导入',
  rule_suggestion: '规则建议',
  ai_suggestion: 'AI 建议',
}

export const MPD_FRESHNESS_LABELS: Record<string, string> = {
  fresh: '新鲜',
  stale: '过期',
  unknown: '未知',
}

export type MpdTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

export interface MpdStatusMeta {
  label: string
  tone: MpdTone
}

/** 状态并集（legacy DEPENDENCY_STATUSES + CRUD 生命周期状态）。 */
export const MPD_STATUS_META: Record<string, MpdStatusMeta> = {
  draft: { label: '草稿', tone: 'neutral' },
  active: { label: '活跃', tone: 'success' },
  at_risk: { label: '风险', tone: 'warning' },
  blocked: { label: '阻塞', tone: 'danger' },
  resolved: { label: '已解决', tone: 'success' },
  archived: {
    label: DEP_LIFECYCLE_LABELS.archived ?? '已归档',
    tone: 'neutral',
  },
  deleted: {
    label: DEP_LIFECYCLE_LABELS.deleted ?? '已删除',
    tone: 'danger',
  },
}

export function statusMeta(value: string): MpdStatusMeta {
  return MPD_STATUS_META[value] ?? { label: value, tone: 'neutral' }
}

/** 风险等级（两契约同值集；色阶与图谱边同源）。 */
export const MPD_RISK_COLOR_VAR: Record<string, string> = {
  critical: 'var(--nx-status-danger)',
  high: 'var(--nx-chart-4)',
  medium: 'var(--nx-chart-2)',
  low: 'var(--nx-chart-1)',
  none: 'var(--nx-text-muted)',
}

export function riskMeta(value: string): { label: string; tone: MpdTone } {
  const fallback: Record<string, { label: string; tone: MpdTone }> = {
    critical: { label: '严重', tone: 'danger' },
    high: { label: '高', tone: 'warning' },
    medium: { label: '中', tone: 'info' },
    low: { label: '低', tone: 'info' },
    none: { label: '无', tone: 'neutral' },
  }
  return (
    fallback[value] ?? {
      label: DEP_RISK_LABELS[value as keyof typeof DEP_RISK_LABELS] ?? value,
      tone: 'neutral',
    }
  )
}

export function freshnessMeta(value: string | null | undefined): { label: string; tone: MpdTone } {
  if (!value) return { label: '未知', tone: 'neutral' }
  if (value === 'fresh') return { label: '新鲜', tone: 'success' }
  if (value === 'stale') return { label: '过期', tone: 'warning' }
  return { label: '未知', tone: 'neutral' }
}

export function endpointTypeLabel(value: string): string {
  return MPD_ENDPOINT_TYPE_LABELS[value] ?? value
}

export function categoryLabel(value: string): string {
  return MPD_CATEGORY_LABELS[value] ?? value
}

export function dependencyTypeLabel(value: string): string {
  return MPD_TYPE_LABELS[value.toUpperCase() as keyof typeof MPD_TYPE_LABELS] ?? value
}

export function sourceModeLabel(value: string): string {
  return MPD_SOURCE_MODE_LABELS[value] ?? value
}

// ─── 行归一（list 响应两种信封形态 × 两种字段契约） ─────────────────────────────

function normalizeRowPayload(row: unknown): MpdRowView {
  const r = (row ?? {}) as Record<string, unknown> & {
    provider?: EndpointLike
    consumer?: EndpointLike
    providerEndpoint?: EndpointLike
    consumerEndpoint?: EndpointLike
  }
  const provider = r.provider ?? r.providerEndpoint
  const consumer = r.consumer ?? r.consumerEndpoint
  const id = String(r.id ?? '')
  const status = String(r.status ?? '')
  const createdAt = typeof r.createdAt === 'string' ? r.createdAt : null
  const updatedAt = typeof r.updatedAt === 'string' ? r.updatedAt : null

  // legacy 证据引用列表 → 摘要串；CRUD evidenceSummary → 摘要串
  let evidenceSummary: string | null = null
  if (typeof r.evidenceSummary === 'string' && r.evidenceSummary !== '') {
    evidenceSummary = r.evidenceSummary
  }
  if (Array.isArray(r.evidenceRefs)) {
    const parts = (r.evidenceRefs as Array<{ summary?: unknown }>)
      .map((ref) => (typeof ref?.summary === 'string' && ref.summary !== '' ? ref.summary : null))
      .filter((part): part is string => part !== null)
    if (parts.length > 0) evidenceSummary = parts.join('；')
  }

  const warningCodes = Array.isArray(r.warningCodes)
    ? (r.warningCodes as unknown[]).map((code) => String(code))
    : []

  return {
    id,
    providerLabel: resolveEndpointLabel(provider),
    consumerLabel: resolveEndpointLabel(consumer),
    providerType: resolveEndpointType(provider),
    consumerType: resolveEndpointType(consumer),
    category: String(r.category ?? ''),
    type: String(r.type ?? ''),
    lagDays:
      typeof r.lagDays === 'number'
        ? r.lagDays
        : r.lagDays === null || r.lagDays === undefined
          ? null
          : Number(r.lagDays),
    strength: String(r.strength ?? ''),
    bufferDays:
      typeof r.bufferDays === 'number'
        ? r.bufferDays
        : r.bufferDays === null || r.bufferDays === undefined
          ? null
          : Number(r.bufferDays),
    status,
    risk: String(r.risk ?? r.riskLevel ?? ''),
    sourceMode: String(r.sourceMode ?? ''),
    freshness:
      typeof r.freshness === 'string' && r.freshness !== ''
        ? r.freshness
        : typeof r.freshnessStatus === 'string'
          ? r.freshnessStatus
          : null,
    freshnessCheckedAt:
      typeof r.freshnessCheckedAt === 'string' && r.freshnessCheckedAt !== ''
        ? r.freshnessCheckedAt
        : null,
    evidenceSummary,
    warningCodes,
    createdAt,
    updatedAt,
  }
}

export function isDepListItem(row: unknown): row is DepListItem {
  const r = row as DepListItem | null | undefined
  return !!r && typeof r === 'object' && 'provider' in r && 'consumer' in r
}

function normalizeMeta(payload: unknown): MpdListMeta | null {
  const meta = (payload as { meta?: unknown } | null)?.meta
  if (!meta || typeof meta !== 'object') return null
  const m = meta as { total?: unknown; page?: unknown; perPage?: unknown; totalPages?: unknown }
  if (typeof m.total !== 'number') return null
  return {
    total: m.total,
    page: typeof m.page === 'number' ? m.page : 1,
    perPage: typeof m.perPage === 'number' ? m.perPage : 20,
    totalPages:
      typeof m.totalPages === 'number'
        ? m.totalPages
        : Math.max(1, Math.ceil(m.total / (typeof m.perPage === 'number' ? m.perPage : 20))),
  }
}

/**
 * useMpdList 载荷归一：
 * - 信封 `{ data: rows, meta }`；
 * - 行内字段兼容 legacy 与 CRUD 双契约。
 */
export function normalizeMpdListPayload(payload: unknown): MpdListView {
  if (payload === null || payload === undefined) return { rows: [], meta: null }
  const maybe = payload as { data?: unknown; meta?: unknown }
  if (maybe && Array.isArray(maybe.data)) {
    return {
      rows: maybe.data.map(normalizeRowPayload),
      meta: normalizeMeta(payload),
    }
  }
  // 兜底：不认识的形态按空数据处理（页面走空态，不抛错）
  return { rows: [], meta: null }
}

/** 详情载荷归一（信封 {data: dep} 或裸实体）。 */
export function normalizeMpdDetailPayload(payload: unknown): MpdRowView | null {
  if (payload === null || payload === undefined) return null
  let entity: unknown = payload
  if (!Array.isArray(payload)) {
    const maybe = payload as { data?: unknown }
    if (
      maybe &&
      typeof maybe === 'object' &&
      maybe.data !== undefined &&
      typeof maybe.data === 'object' &&
      maybe.data !== null &&
      !('providerEndpoint' in maybe) &&
      !('provider' in maybe)
    ) {
      entity = maybe.data
    }
  }
  return normalizeRowPayload(entity)
}

/** 预览载荷归一（信封 {data: snapshot} 或裸快照；兼容 legacy 与 CRUD 双契约）。 */
export interface MpdPreviewView {
  previewId: string
  operation: string
  providerLabel: string
  consumerLabel: string
  isRedacted: boolean
  /** 变更对照（字段中文标签 + from/to 展示值）。 */
  diffRows: Array<{ field: string; from: string; to: string }>
  warnings: string[]
  confirmationHash: string
  expiresAt: string | null
  idempotencyGuidance: string
}

function previewFieldLabel(field: string): string {
  const map: Record<string, string> = {
    status: '状态',
    risk: '风险等级',
    riskLevel: '风险等级',
    category: '分类',
    type: '依赖类型',
    lagDays: '延迟天数',
    strength: '强度',
    bufferDays: '缓冲天数',
    evidenceSummary: '证据摘要',
    ownerUserId: '负责人',
    sourceMode: '来源模式',
  }
  return map[field] ?? field
}

function previewFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  const v = String(value)
  if (field === 'status' || field === 'riskLevel' || field === 'risk') return statusMeta(v).label
  if (field === 'category') return categoryLabel(v)
  if (field === 'type') return dependencyTypeLabel(v)
  return v
}

export function normalizeMpdPreviewPayload(payload: unknown): MpdPreviewView | null {
  if (payload === null || payload === undefined) return null
  let entity: unknown = payload
  if (!Array.isArray(payload)) {
    const maybe = payload as { data?: unknown }
    if (
      maybe &&
      typeof maybe === 'object' &&
      maybe.data !== null &&
      typeof maybe.data === 'object' &&
      'previewId' in (maybe.data as object)
    ) {
      entity = maybe.data
    }
  }
  const p = entity as Record<string, unknown> & {
    providerSummary?: EndpointLike
    consumerSummary?: EndpointLike
    providerEndpoint?: EndpointLike
    consumerEndpoint?: EndpointLike
    proposedDiff?: Record<string, { from: unknown; to: unknown }>
    diff?: { before?: unknown; after?: unknown; changedFields?: unknown }
    warnings?: unknown
    warningCodes?: unknown
  }
  const previewId = typeof p.previewId === 'string' ? p.previewId : ''
  if (!previewId) return null
  const operation = String(p.operation ?? '')

  // 变更对照（CRUD proposedDiff 或 legacy diff.before/after）
  const diffRows: MpdPreviewView['diffRows'] = []
  if (p.proposedDiff && typeof p.proposedDiff === 'object') {
    for (const [field, change] of Object.entries(p.proposedDiff)) {
      diffRows.push({
        field: previewFieldLabel(field),
        from: previewFieldValue(field, change?.from),
        to: previewFieldValue(field, change?.to),
      })
    }
  } else if (p.diff && typeof p.diff === 'object') {
    const changedFields = Array.isArray(p.diff.changedFields)
      ? (p.diff.changedFields as unknown[]).map((f) => String(f))
      : []
    const before = (p.diff.before ?? {}) as Record<string, unknown>
    const after = (p.diff.after ?? {}) as Record<string, unknown>
    for (const field of changedFields) {
      diffRows.push({
        field: previewFieldLabel(field),
        from: previewFieldValue(field, before[field]),
        to: previewFieldValue(field, after[field]),
      })
    }
  }

  const warnings = Array.isArray(p.warnings)
    ? (p.warnings as unknown[]).map((w) => String(w))
    : Array.isArray(p.warningCodes)
      ? (p.warningCodes as unknown[]).map((w) => String(w))
      : []

  const provider = p.providerSummary ?? p.providerEndpoint
  const consumer = p.consumerSummary ?? p.consumerEndpoint
  return {
    previewId,
    operation,
    providerLabel: resolveEndpointLabel(provider),
    consumerLabel: resolveEndpointLabel(consumer),
    isRedacted:
      provider?.isRedacted === true || consumer?.isRedacted === true || p.isRedacted === true,
    diffRows,
    warnings,
    confirmationHash: String(p.confirmationHash ?? ''),
    expiresAt: typeof p.expiresAt === 'string' ? p.expiresAt : null,
    idempotencyGuidance: String(p.idempotencyGuidance ?? ''),
  }
}

/** 确认结果归一（legacy {data, idempotentReplay} / CRUD {dependency, auditEventId, isReplay}）。 */
export interface MpdConfirmView {
  ok: boolean
  isReplay: boolean
  dependencyId: string | null
  auditEventId: string | null
}

export function normalizeMpdConfirmPayload(payload: unknown): MpdConfirmView | null {
  if (payload === null || payload === undefined) return null
  let entity: unknown = payload
  if (!Array.isArray(payload)) {
    const maybe = payload as { data?: unknown }
    if (
      maybe &&
      typeof maybe === 'object' &&
      maybe.data !== null &&
      typeof maybe.data === 'object'
    ) {
      entity = maybe.data
    }
  }
  const c = entity as {
    dependency?: unknown
    data?: unknown
    idempotentReplay?: unknown
    isReplay?: unknown
    auditEventId?: unknown
  }
  const dependency = c.dependency ?? c.data
  const depId =
    dependency && typeof dependency === 'object' && 'id' in dependency
      ? String((dependency as { id: unknown }).id)
      : null
  return {
    ok: true,
    isReplay: c.idempotentReplay === true || c.isReplay === true,
    dependencyId: depId,
    auditEventId: typeof c.auditEventId === 'string' ? c.auditEventId : null,
  }
}

/** 图谱响应归一（信封 GraphResponseEnvelope 或 apiFetch 解包后的裸响应）。 */
export function normalizeMpdGraphPayload<T>(payload: unknown): { inner: T | null } {
  if (payload === null || payload === undefined) return { inner: null }
  if (!Array.isArray(payload)) {
    const maybe = payload as { data?: unknown; featureDisabled?: unknown }
    // 信封形态 { data: { nodes… } } → 取 data；裸响应（本身含 nodes）→ 原样
    if (
      maybe &&
      typeof maybe === 'object' &&
      maybe.data !== null &&
      typeof maybe.data === 'object'
    ) {
      if ('nodes' in (maybe.data as object)) {
        return { inner: maybe.data as T }
      }
    }
  }
  return { inner: payload as T }
}

export function formatMpdDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 生成一次确认的幂等键（与旧页同风格，避免依赖 crypto.randomUUID 环境差异）。 */
export function createIdempotencyKey(operation: string): string {
  return `mpd-${operation}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
