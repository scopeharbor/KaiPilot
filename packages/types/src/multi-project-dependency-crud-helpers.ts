/**
 * multi-project-dependency-crud 共享辅助函数
 *
 * 纯函数，零运行时依赖。覆盖：
 * - 过滤器归一化与稳定哈希
 * - 状态迁移验证
 * - 过期预览警告分类
 * - 幂等键哈希
 * - Redaction 标记
 * - 枚举防漂移
 */

import type {
  DepCrudWarningCode,
  DepLifecycleStatus,
  DepListFilters,
  DepCreatePreviewInput,
  DepUpdatePreviewInput,
} from './multi-project-dependency-crud.js'
import {
  DEP_CRUD_WARNING_CODES,
  DEP_CRUD_LIFECYCLE_STATUSES,
  DEP_LIST_DEFAULT_PER_PAGE,
  DEP_LIST_MAX_PER_PAGE,
  DEP_LIST_SORT_KEYS,
} from './multi-project-dependency-crud.js'

// ─── 简单哈希 (Fowler–Noll–Vo, 32-bit) ────────────────────────

export function crudHash(input: string): string {
  let hash = 0x811c9dc5 >>> 0
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

// ─── 过滤器归一化 ──────────────────────────────────────────────

export function normalizeDepListFilters(raw: DepListFilters): DepListFilters {
  const filters: DepListFilters = {}

  if (raw.projectIds && raw.projectIds.length > 0) {
    filters.projectIds = [...raw.projectIds].sort((a, b) => a - b)
  }
  if (raw.status && raw.status.length > 0) {
    filters.status = [...raw.status].sort()
  }
  if (raw.endpointType) filters.endpointType = raw.endpointType
  if (raw.category) filters.category = raw.category
  if (raw.type) filters.type = raw.type
  if (raw.riskLevel) filters.riskLevel = raw.riskLevel
  if (raw.sourceMode) filters.sourceMode = raw.sourceMode
  if (raw.freshness) filters.freshness = raw.freshness
  if (raw.dateFrom) filters.dateFrom = raw.dateFrom
  if (raw.dateTo) filters.dateTo = raw.dateTo
  if (raw.search) filters.search = raw.search

  filters.page = normalizePage(raw.page)
  filters.perPage = normalizePerPage(raw.perPage)

  if (raw.sort && DEP_LIST_SORT_KEYS.includes(raw.sort as any)) {
    filters.sort = raw.sort
  }

  return filters
}

function normalizePage(p?: number): number {
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 1) return 1
  return Math.floor(p)
}

function normalizePerPage(pp?: number): number {
  if (typeof pp !== 'number' || !Number.isFinite(pp) || pp < 1) return DEP_LIST_DEFAULT_PER_PAGE
  return Math.min(Math.floor(pp), DEP_LIST_MAX_PER_PAGE)
}

// ─── 稳定查询哈希 ──────────────────────────────────────────────

export function computeDepFilterHash(filters: DepListFilters): string {
  const normalized = normalizeDepListFilters(filters)
  const canonical = JSON.stringify(normalized, Object.keys(normalized).sort())
  return crudHash(canonical)
}

// ─── 状态迁移验证 ──────────────────────────────────────────────

const VALID_TRANSITIONS: Record<DepLifecycleStatus, DepLifecycleStatus[]> = {
  active: ['archived'],
  archived: ['active', 'deleted'],
  deleted: [],
}

export function isValidLifecycleTransition(
  from: DepLifecycleStatus,
  to: DepLifecycleStatus,
): boolean {
  if (!DEP_CRUD_LIFECYCLE_STATUSES.includes(from)) return false
  if (!DEP_CRUD_LIFECYCLE_STATUSES.includes(to)) return false
  return (VALID_TRANSITIONS[from] as DepLifecycleStatus[]).includes(to)
}

export function getValidTransitions(from: DepLifecycleStatus): DepLifecycleStatus[] {
  if (!DEP_CRUD_LIFECYCLE_STATUSES.includes(from)) return []
  return [...(VALID_TRANSITIONS[from] as DepLifecycleStatus[])]
}

// ─── 过期预览警告分类 ──────────────────────────────────────────

export function isStalePreviewWarning(code: DepCrudWarningCode): boolean {
  return code === 'STALE_PREVIEW' || code === 'FRESHNESS_EXPIRED' || code === 'PERMISSION_CHANGED'
}

export function classifyPreviewWarnings(codes: DepCrudWarningCode[]): {
  stale: DepCrudWarningCode[]
  blocking: DepCrudWarningCode[]
  advisory: DepCrudWarningCode[]
} {
  const stale: DepCrudWarningCode[] = []
  const blocking: DepCrudWarningCode[] = []
  const advisory: DepCrudWarningCode[] = []

  for (const c of codes) {
    if (isStalePreviewWarning(c)) {
      stale.push(c)
    } else if (c === 'CYCLE_DETECTED' || c === 'DUPLICATE_ACTIVE_KEY') {
      blocking.push(c)
    } else {
      advisory.push(c)
    }
  }
  return { stale, blocking, advisory }
}

// ─── 幂等键哈希 ────────────────────────────────────────────────

export function computeIdempotencyKeyHash(
  orgId: string,
  actorId: string,
  operation: string,
  previewId: string,
  confirmationHash: string,
): string {
  const payload = [orgId, actorId, operation, previewId, confirmationHash]
    .filter(Boolean)
    .join('::')
  return crudHash(payload)
}

// ─── 确认哈希 ──────────────────────────────────────────────────

export function computeConfirmationHash(
  previewId: string,
  freshnessSignature: string,
  proposedDiff: Record<string, unknown>,
  timestamp: number,
): string {
  const payload = JSON.stringify({
    pid: previewId,
    sig: freshnessSignature,
    diff: proposedDiff,
    ts: timestamp,
  })
  return crudHash(payload)
}

// ─── Redaction 辅助 ─────────────────────────────────────────────

export function redactedLabel(): string {
  return 'REDACTED'
}

export function isRedactedLabel(value: unknown): boolean {
  return value === 'REDACTED'
}

// ─── 枚举漂移检查 ──────────────────────────────────────────────

export function isKnownWarningCode(code: string): code is DepCrudWarningCode {
  return (DEP_CRUD_WARNING_CODES as readonly string[]).includes(code)
}

export function isKnownLifecycleStatus(s: string): s is DepLifecycleStatus {
  return (DEP_CRUD_LIFECYCLE_STATUSES as readonly string[]).includes(s)
}

// ─── Create/Update 预览差异计算 ─────────────────────────────────

export interface DepCreateDiff {
  providerEndpointType: { from: null; to: string }
  providerProjectId: { from: null; to: number | null }
  providerMilestoneId: { from: null; to: number | null }
  providerTaskId: { from: null; to: number | null }
  providerExternalLabel: { from: null; to: string | null }
  providerExternalKey: { from: null; to: string | null }
  consumerEndpointType: { from: null; to: string }
  consumerProjectId: { from: null; to: number | null }
  consumerMilestoneId: { from: null; to: number | null }
  consumerTaskId: { from: null; to: number | null }
  consumerExternalLabel: { from: null; to: string | null }
  consumerExternalKey: { from: null; to: string | null }
  category: { from: null; to: string }
  type: { from: null; to: string | undefined }
  lagDays: { from: null; to: number }
  strength: { from: null; to: string }
  bufferDays: { from: null; to: number }
  riskLevel: { from: null; to: string }
  sourceMode: { from: null; to: string }
}

export function computeCreateProposedDiff(
  input: DepCreatePreviewInput,
): Record<string, { from: null; to: unknown }> {
  return {
    providerEndpointType: { from: null, to: input.providerEndpointType },
    providerProjectId: { from: null, to: input.providerProjectId ?? null },
    providerMilestoneId: { from: null, to: input.providerMilestoneId ?? null },
    providerTaskId: { from: null, to: input.providerTaskId ?? null },
    providerExternalLabel: { from: null, to: input.providerExternalLabel ?? null },
    providerExternalKey: { from: null, to: input.providerExternalKey ?? null },
    consumerEndpointType: { from: null, to: input.consumerEndpointType },
    consumerProjectId: { from: null, to: input.consumerProjectId ?? null },
    consumerMilestoneId: { from: null, to: input.consumerMilestoneId ?? null },
    consumerTaskId: { from: null, to: input.consumerTaskId ?? null },
    consumerExternalLabel: { from: null, to: input.consumerExternalLabel ?? null },
    consumerExternalKey: { from: null, to: input.consumerExternalKey ?? null },
    category: { from: null, to: input.category },
    type: { from: null, to: input.type },
    lagDays: { from: null, to: input.lagDays ?? 0 },
    strength: { from: null, to: input.strength ?? 'hard' },
    bufferDays: { from: null, to: input.bufferDays ?? 0 },
    riskLevel: { from: null, to: input.riskLevel ?? 'none' },
    sourceMode: { from: null, to: input.sourceMode ?? 'manual' },
  }
}

export function computeUpdateProposedDiff(
  input: DepUpdatePreviewInput,
  current: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {}
  const updatableFields = [
    'category',
    'type',
    'lagDays',
    'strength',
    'bufferDays',
    'riskLevel',
  ] as const
  for (const field of updatableFields) {
    const newVal = (input as any)[field as string]
    if (newVal !== undefined && newVal !== current[field as string]) {
      diff[field as string] = {
        from: current[field as string] ?? null,
        to: newVal,
      }
    }
  }
  return diff
}

// ─── 重复 Active Key ────────────────────────────────────────────

export function buildDuplicateActiveKey(
  providerType: string,
  providerId: string,
  consumerType: string,
  consumerId: string,
  depType: string,
  category: string,
): string {
  const normalized = [providerType, providerId, consumerType, consumerId, depType, category]
    .sort()
    .join(':')
  return crudHash(normalized)
}

// ─── 自依赖检查 ────────────────────────────────────────────────

export function isSelfDependency(
  providerEndpoint: { id: string; type: string },
  consumerEndpoint: { id: string; type: string },
): boolean {
  return (
    providerEndpoint.id === consumerEndpoint.id && providerEndpoint.type === consumerEndpoint.type
  )
}
