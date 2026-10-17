import AuditLog from '#models/audit_log'
import {
  isOcrPermissionAction,
  isOcrPermissionDecisionResult,
  isOcrPermissionReasonCode,
  type OcrAuditSummary,
  type OcrPaginationMeta,
} from '@aiproj/types'

/**
 * OCR 权限/审计 —— 有界只读审计查询助手（v3-ocr-permission-and-audit §3.8/§3.9）。
 *
 * 只对既有 `audit_logs` 做 SELECT，绝不 update/delete（AuditLog 模型本身已禁止
 * 更新/删除，双保险）。所有过滤均有界：perPage 上限、时间窗上限、结果集上限。
 *
 * 说明：`metadata` 为 JSON 列，`metadata.action`/`result`/`reasonCodes` 为 JSON 内字段，
 * 无法用 SQL 直接索引过滤。因此先按 SQL 真实列（projectId/userId/createdAt/action 动词）
 * 有界取集，再在内存中按 OCR 动作键/结果/原因码过滤，最后切片分页。
 */
const MAX_PER_PAGE = 100
const DEFAULT_PER_PAGE = 20
const MAX_TIME_WINDOW_DAYS = 90
const MAX_RESULT_CAP = 1000

export interface OcrPermissionAuditQueryParams {
  /** 组织隔离必填：仅按 projectId 过滤会跨组织泄露同 id 项目的审计行 */
  readonly organizationId: number
  readonly projectId: number
  readonly userId?: number | null
  readonly action?: string | null
  readonly result?: string | null
  readonly reasonCode?: string | null
  readonly from?: string | null
  readonly to?: string | null
  readonly page?: number
  readonly perPage?: number
}

export interface OcrPermissionAuditQueryResult {
  readonly data: OcrAuditSummary[]
  readonly meta: OcrPaginationMeta
}

/** 计算有界分页元信息。 */
export function computeBoundedPaginationMeta(
  total: number,
  page: number,
  perPage: number,
): OcrPaginationMeta {
  const safePerPage = Math.max(1, Math.min(perPage, MAX_PER_PAGE))
  const safePage = Math.max(1, page)
  return {
    total,
    page: safePage,
    perPage: safePerPage,
    totalPages: Math.max(0, Math.ceil(total / safePerPage)),
  }
}

/** 只读查询 OCR 权限/审计摘要（有界、确定排序：createdAt desc, id desc）。 */
export async function queryOcrPermissionAudit(
  params: OcrPermissionAuditQueryParams,
): Promise<OcrPermissionAuditQueryResult> {
  const perPage = Math.max(1, Math.min(params.perPage ?? DEFAULT_PER_PAGE, MAX_PER_PAGE))
  const page = Math.max(1, params.page ?? 1)

  const query = AuditLog.query()
    .where('organizationId', params.organizationId)
    .where('projectId', params.projectId)
    .where('entityType', 'ocr')
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(MAX_RESULT_CAP)

  if (typeof params.userId === 'number') {
    query.where('userId', params.userId)
  }
  if (params.from) {
    query.where('createdAt', '>=', params.from)
  }
  if (params.to) {
    query.where('createdAt', '<=', params.to)
  }

  const rows = await query.select(
    'id',
    'action',
    'userId',
    'organizationId',
    'projectId',
    'entityType',
    'entityId',
    'metadata',
    'createdAt',
  )

  // 内存过滤 JSON 内字段（OCR 动作键 / 结果 / 原因码 / 审计专用事件）
  const filtered = rows.filter((row) => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>
    const event = typeof meta.event === 'string' ? meta.event : ''
    // 兼容两种落库形式：语义事件（ocr.permission.*）与 AuditEvent 常量（OCR_PERMISSION_*）。
    if (!event.startsWith('ocr.permission.') && !event.startsWith('OCR_PERMISSION_')) return false
    if (params.action && meta.action !== params.action) return false
    if (params.result && meta.result !== params.result) return false
    if (params.reasonCode) {
      const codes = Array.isArray(meta.reasonCodes) ? (meta.reasonCodes as string[]) : []
      if (!codes.includes(params.reasonCode)) return false
    }
    return true
  })

  const total = filtered.length
  const start = (page - 1) * perPage
  const pageRows = filtered.slice(start, start + perPage)

  const data: OcrAuditSummary[] = pageRows.map((row) => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>
    const action = isOcrPermissionAction(meta.action) ? meta.action : 'permission_status_read'
    const result = isOcrPermissionDecisionResult(meta.result) ? meta.result : 'denied'
    const reasonCodes = Array.isArray(meta.reasonCodes)
      ? (meta.reasonCodes as unknown[]).filter(isOcrPermissionReasonCode)
      : []
    const event = normalizeOcrAuditEvent(meta.event)
    return {
      id: row.id,
      event: event as never,
      action,
      result,
      reasonCodes,
      actorRef: { type: 'user', id: Number(row.userId ?? 0) },
      projectRef: { type: 'project', id: Number(row.projectId ?? params.projectId) },
      sourceRef:
        typeof meta.sourceRefKind === 'string' && typeof meta.sourceHash === 'string'
          ? { type: 'ocr_source', id: 0, kind: meta.sourceRefKind }
          : null,
      artifactRef:
        typeof meta.artifactRefId === 'number'
          ? { type: 'ocr_artifact', id: meta.artifactRefId, kind: 'accepted_extraction' }
          : null,
      sourceHash: typeof meta.sourceHash === 'string' ? meta.sourceHash : null,
      contentHash: typeof meta.contentHash === 'string' ? meta.contentHash : null,
      decisionHash: typeof meta.decisionHash === 'string' ? meta.decisionHash : null,
      createdAt: row.createdAt.toISO() ?? new Date().toISOString(),
      metadata: meta,
    }
  })

  return { data, meta: computeBoundedPaginationMeta(total, page, perPage) }
}

/** 归一化审计事件：`OCR_PERMISSION_DENIAL` → `ocr.permission.denial`。 */
function normalizeOcrAuditEvent(value: unknown): string {
  if (typeof value !== 'string') return 'ocr.permission.status_read'
  if (value.startsWith('OCR_PERMISSION_')) {
    return `ocr.permission.${value.slice('OCR_PERMISSION_'.length).toLowerCase()}`
  }
  return value
}

/** 校验审计查询参数是否越界（返回原因码；空数组 = 合法）。 */
export function validateOcrAuditQueryBounds(params: {
  readonly perPage?: number
  readonly from?: string | null
  readonly to?: string | null
}): string[] {
  const errors: string[] = []
  if (typeof params.perPage === 'number' && params.perPage > MAX_PER_PAGE) {
    errors.push(`perPage 超过上限 ${MAX_PER_PAGE}`)
  }
  if (params.from && params.to) {
    const fromMs = Date.parse(params.from)
    const toMs = Date.parse(params.to)
    if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
      const days = (toMs - fromMs) / (1000 * 60 * 60 * 24)
      if (days > MAX_TIME_WINDOW_DAYS) {
        errors.push(`时间窗超过 ${MAX_TIME_WINDOW_DAYS} 天`)
      }
    }
  }
  return errors
}
