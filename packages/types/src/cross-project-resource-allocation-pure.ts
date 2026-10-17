// @aiproj/types —— 跨项目资源分配纯函数（前后端共享，零运行时依赖）。
import type {
  CrossProjectAllocationConflict,
  CrossProjectAllocationConflictSeverity,
  CrossProjectAllocationDraftStatus,
  CrossProjectAllocationQueryShape,
  CrossProjectAllocationWarningCode,
} from './cross-project-resource-allocation.js'
import {
  CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_ORDER,
  CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_VALUES,
  CROSS_PROJECT_ALLOCATION_DRAFT_STATUS_VALUES,
  CROSS_PROJECT_ALLOCATION_MAX_DATE_WINDOW_DAYS,
  CROSS_PROJECT_ALLOCATION_MAX_PER_PAGE,
  CROSS_PROJECT_ALLOCATION_MAX_PROJECT_SCOPE,
  CROSS_PROJECT_ALLOCATION_MAX_TOP_N,
  CROSS_PROJECT_ALLOCATION_MAX_SEARCH_LENGTH,
  CROSS_PROJECT_ALLOCATION_SORT_KEY_VALUES,
  CROSS_PROJECT_ALLOCATION_WARNING_CODE_VALUES,
} from './cross-project-resource-allocation.js'

// ─── Query Normalization ───────────────────────────────────────────────────────

/** 将有界查询规整化为安全参数，拒绝超界值 */
export function normalizeCrossProjectAllocationQuery(
  partial: Partial<CrossProjectAllocationQueryShape>,
): CrossProjectAllocationQueryShape {
  const page = Math.max(1, partial.page ?? 1)
  const perPage = Math.min(
    CROSS_PROJECT_ALLOCATION_MAX_PER_PAGE,
    Math.max(1, partial.perPage ?? 20),
  )
  const topN = Math.min(CROSS_PROJECT_ALLOCATION_MAX_TOP_N, Math.max(1, partial.topN ?? 10))
  const dateWindow = normalizeDateWindow(partial.dateWindow)
  const projectIds = (partial.projectIds ?? []).slice(0, CROSS_PROJECT_ALLOCATION_MAX_PROJECT_SCOPE)
  const search = (partial.search ?? '').slice(0, CROSS_PROJECT_ALLOCATION_MAX_SEARCH_LENGTH) || null

  const sortKey = CROSS_PROJECT_ALLOCATION_SORT_KEY_VALUES.includes(partial.sort as any)
    ? (partial.sort as CrossProjectAllocationQueryShape['sort'])
    : 'created_at'

  return {
    organizationId: partial.organizationId ?? 0,
    projectIds,
    dateWindow,
    resourceTypes: partial.resourceTypes ?? [],
    roles: partial.roles ?? [],
    skillTags: partial.skillTags ?? [],
    departments: partial.departments ?? [],
    loadStatuses: partial.loadStatuses ?? [],
    conflictSeverities: (partial.conflictSeverities ?? []).filter((s) =>
      CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_VALUES.includes(s as any),
    ) as CrossProjectAllocationConflictSeverity[],
    draftStatuses: (partial.draftStatuses ?? []).filter((s) =>
      CROSS_PROJECT_ALLOCATION_DRAFT_STATUS_VALUES.includes(s as any),
    ) as CrossProjectAllocationDraftStatus[],
    search,
    sort: sortKey,
    sortDir: partial.sortDir === 'asc' ? 'asc' : 'desc',
    page,
    perPage,
    topN,
    freshnessThresholdMinutes: Math.max(1, partial.freshnessThresholdMinutes ?? 60),
  }
}

function normalizeDateWindow(dw: Partial<{ from: string; to: string }> | undefined): {
  from: string
  to: string
} {
  const now = new Date()
  const defaultFrom = now.toISOString().slice(0, 10)
  const defaultTo = new Date(now.getTime() + 90 * 86400000).toISOString().slice(0, 10)

  const from = dw?.from ?? defaultFrom
  const to = dw?.to ?? defaultTo

  // clamp to max window
  const fromMs = Date.parse(from)
  const toMs = Date.parse(to)
  if (!Number.isNaN(fromMs) && !Number.isNaN(toMs)) {
    const diffDays = Math.ceil((toMs - fromMs) / 86400000)
    if (diffDays > CROSS_PROJECT_ALLOCATION_MAX_DATE_WINDOW_DAYS) {
      const clampedTo = new Date(fromMs + CROSS_PROJECT_ALLOCATION_MAX_DATE_WINDOW_DAYS * 86400000)
      return { from, to: clampedTo.toISOString().slice(0, 10) }
    }
  }

  return { from, to }
}

// ─── State Transition Validation ───────────────────────────────────────────────

const VALID_TRANSITIONS: Record<
  CrossProjectAllocationDraftStatus,
  readonly CrossProjectAllocationDraftStatus[]
> = {
  draft: ['previewed', 'cancelled'],
  previewed: ['confirmed', 'draft', 'cancelled', 'expired'],
  confirmed: ['applied', 'cancelled', 'expired'],
  applied: [],
  cancelled: [],
  expired: [],
  failed: [],
}

/** 验证状态迁移是否合法 */
export function canTransitionDraftStatus(
  from: CrossProjectAllocationDraftStatus,
  to: CrossProjectAllocationDraftStatus,
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

/** 返回合法目标状态列表 */
export function allowedDraftTransitions(
  from: CrossProjectAllocationDraftStatus,
): readonly CrossProjectAllocationDraftStatus[] {
  return VALID_TRANSITIONS[from] ?? []
}

// ─── Warning Validation ────────────────────────────────────────────────────────

/** 验证 warning code 是否在封闭枚举内 */
export function isValidWarningCode(code: string): code is CrossProjectAllocationWarningCode {
  return CROSS_PROJECT_ALLOCATION_WARNING_CODE_VALUES.includes(
    code as CrossProjectAllocationWarningCode,
  )
}

// ─── Conflict Severity Classification ──────────────────────────────────────────

/** 按严重度排序冲突列表（降序） */
export function sortConflictsBySeverity(
  conflicts: CrossProjectAllocationConflict[],
): CrossProjectAllocationConflict[] {
  return [...conflicts].sort(
    (a, b) =>
      (CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_ORDER[b.severity] ?? 0) -
      (CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_ORDER[a.severity] ?? 0),
  )
}

/** 返回冲突列表中最高严重度等级 */
export function maxConflictSeverity(
  conflicts: CrossProjectAllocationConflict[],
): CrossProjectAllocationConflictSeverity | null {
  if (conflicts.length === 0) return null
  let max: CrossProjectAllocationConflictSeverity = 'info'
  let maxScore = -1
  for (const c of conflicts) {
    const score = CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_ORDER[c.severity] ?? -1
    if (score > maxScore) {
      maxScore = score
      max = c.severity
    }
  }
  return max
}

// ─── Preview Hash ──────────────────────────────────────────────────────────────

/** 生成稳定的 preview hash（纯函数，不依赖 crypto 实现细节） */
export function computePreviewFingerprint(parts: string[]): string {
  // 使用确定性拼接 + 简单 hash（Fowler–Noll–Vo FNV-1a 32-bit 折叠）
  const joined = parts.join('\x00')
  let hash = 2166136261
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  // 返回 hex
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ─── Idempotency Hash ───────────────────────────────────────────────────────────

/** 生成 idempotency key hash */
export function computeIdempotencyHash(key: string): string {
  const trimmed = key.trim()
  if (trimmed.length === 0) return ''
  // FNV-1a 32-bit hash，避免 BigInt 依赖
  let hash = 2166136261
  for (let i = 0; i < trimmed.length; i++) {
    hash ^= trimmed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ─── Evidence Hash ─────────────────────────────────────────────────────────────

/** 基于多个源签名生成 evidence hash */
export function computeAllocationEvidenceHash(signatures: Record<string, string>): string {
  const keys = Object.keys(signatures).sort()
  const parts = keys.map((k) => `${k}:${signatures[k]}`)
  return computePreviewFingerprint(parts)
}

// ─── Query Shape Hash ──────────────────────────────────────────────────────────

/** 为 query shape 生成稳定 hash */
export function computeQueryShapeHash(query: CrossProjectAllocationQueryShape): string {
  const parts = [
    String(query.organizationId),
    [...query.projectIds].sort().join(','),
    query.dateWindow.from,
    query.dateWindow.to,
    [...query.resourceTypes].sort().join(','),
    [...query.roles].sort().join(','),
    [...query.skillTags].sort().join(','),
    [...query.departments].sort().join(','),
    [...query.loadStatuses].sort().join(','),
    [...query.conflictSeverities].sort().join(','),
    [...query.draftStatuses].sort().join(','),
    query.search ?? '',
    query.sort,
    query.sortDir,
    String(query.page),
    String(query.perPage),
    String(query.topN),
    String(query.freshnessThresholdMinutes),
  ]
  return computePreviewFingerprint(parts)
}
