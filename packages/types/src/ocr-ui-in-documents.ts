/**
 * V3 OCR UI In Documents — 文档工作台 OCR 状态类型、枚举与纯函数
 *
 * 定义 OCR 文档工作台所需的共享契约：源 DTO、工作区状态、允许动作、
 * 警告/阻止原因枚举、摘要 DTO 和纯函数（状态派生、动作解析、脱敏）。
 *
 * 消费现有 OCR 契约，不改变后端 OCR 生命周期、写入或隐私/权限决策引擎。
 */

import type {
  OcrDocumentJobStatus,
  OcrDocumentJobSummary,
  OcrDocumentWarningCode,
  OcrDocumentSourceKind,
} from './ocr-document-upload.js'
import type { OcrReviewStatus } from './ocr-review-confirmation.js'

// ---------------------------------------------------------------------------
// 枚举：工作区状态 / 允许动作 / 警告原因 / 阻止原因
// ---------------------------------------------------------------------------

/** OCR 文档工作台可见状态 */
export const OCR_DOCUMENT_WORKSPACE_STATUSES = [
  'unsupported',
  'no_job',
  'queued',
  'processing',
  'failed',
  'reviewable',
  'confirmed',
  'stale',
  'blocked',
  'degraded',
] as const
export type OcrDocumentWorkspaceStatus = (typeof OCR_DOCUMENT_WORKSPACE_STATUSES)[number]

/** OCR 文档工作台用户可见操作 */
export const OCR_DOCUMENT_WORKSPACE_ACTIONS = [
  'create_ocr',
  'retry_ocr',
  'review',
  'confirm',
  'search_index',
  'structured_extraction',
  'entity_linking',
  'export',
  'copy',
  'cleanup',
  'view_governance',
] as const
export type OcrDocumentWorkspaceAction = (typeof OCR_DOCUMENT_WORKSPACE_ACTIONS)[number]

/** OCR 工作台警告/信息原因枚举 */
export const OCR_DOCUMENT_WORKSPACE_WARNING_REASONS = [
  'partial_page_failure',
  'low_confidence',
  'provider_degradation',
  'cost_unknown',
  'stale_source',
  'retention_expiring',
  'privacy_constrained',
  'read_only',
] as const
export type OcrDocumentWorkspaceWarningReason =
  (typeof OCR_DOCUMENT_WORKSPACE_WARNING_REASONS)[number]

/** OCR 工作台阻止原因枚举 */
export const OCR_DOCUMENT_WORKSPACE_BLOCK_REASONS = [
  'retention_hold',
  'privacy_block',
  'lifecycle_expired',
  'lifecycle_purged',
  'permission_denied',
  'source_hidden',
  'unsupported_mime',
] as const
export type OcrDocumentWorkspaceBlockReason = (typeof OCR_DOCUMENT_WORKSPACE_BLOCK_REASONS)[number]

// ---------------------------------------------------------------------------
// DTO：源摘要 / 工作区行摘要 / 抽屉摘要
// ---------------------------------------------------------------------------

/** 文档工作台中的 OCR 行状态摘要 */
export interface OcrDocumentWorkspaceRowSummary {
  /** 源标识（附件 ID 或文档 ID） */
  sourceId: number
  /** 源类型 */
  sourceKind: OcrDocumentSourceKind
  /** 低敏源文件名（可能被脱敏） */
  sourceFileName: string | null
  /** MIME 类型 */
  sourceMimeType: string | null
  /** 是否为 OCR 支持的 MIME */
  isSupported: boolean
  /** 派生工作台状态 */
  status: OcrDocumentWorkspaceStatus
  /** 最近 OCR 作业（可选，无作业时为 null） */
  latestJobId: number | string | null
  /** 最近作业状态 */
  latestJobStatus: OcrDocumentJobStatus | null
  /** 作业创建时间 */
  latestJobCreatedAt: string | null
  /** 页面进度：已完成页数 */
  succeededPages: number | null
  /** 页面进度：总页数 */
  totalPages: number | null
  /** 警告代码列表 */
  warningCodes: OcrDocumentWarningCode[]
  /** 工作台级警告原因 */
  warningReasons: OcrDocumentWorkspaceWarningReason[]
  /** 阻止原因（仅 blocked/degraded 状态） */
  blockReason: OcrDocumentWorkspaceBlockReason | null
  /** 当前允许的操作 */
  allowedActions: OcrDocumentWorkspaceAction[]
  /** 成本摘要（低敏） */
  estimatedCost: number | null
  /** 成本货币 */
  costCurrency: string | null
  /** 是否源 stale */
  isStale: boolean
  /** 如有已接受提取 */
  hasAcceptedExtraction: boolean
  /** 已接受提取 ID */
  acceptedExtractionId: number | string | null
}

/** 工作区筛选配置 */
export interface OcrDocumentWorkspaceFilters {
  status: OcrDocumentWorkspaceStatus | null
  isSupported: boolean | null
  search: string | null
}

/** 排序配置 */
export type OcrDocumentWorkspaceSortField =
  'sourceFileName' | 'status' | 'latestJobCreatedAt' | 'estimatedCost'

export type SortDirection = 'asc' | 'desc'

export interface OcrDocumentWorkspaceSortConfig {
  field: OcrDocumentWorkspaceSortField
  direction: SortDirection
}

// ---------------------------------------------------------------------------
// 纯函数：工作台状态派生
// ---------------------------------------------------------------------------

/** 检查 MIME 类型是否 OCR 支持 */
const OCR_SUPPORTED_MIME_PATTERNS = [/^image\/(png|jpeg|jpg|tiff|bmp|webp)$/, /^application\/pdf$/]

export function isOcrSupportedMime(mimeType: string | null): boolean {
  if (!mimeType) return false
  return OCR_SUPPORTED_MIME_PATTERNS.some((p) => p.test(mimeType))
}

/**
 * 从作业列表中选择与给定源关联的最新作业。
 * 确定性：按 updatedAt 降序，平局时按 createdAt 降序，最后按 id 降序。
 */
export function selectLatestOcrJobForSource(
  jobs: ReadonlyArray<OcrDocumentJobSummary>,
  sourceAttachmentId: number,
): OcrDocumentJobSummary | null {
  if (jobs.length === 0) return null

  const sourceJobs = jobs.filter((j) => j.sourceAttachmentId === sourceAttachmentId)
  if (sourceJobs.length === 0) return null

  // 按 updatedAt desc → createdAt desc → id desc
  return (
    [...sourceJobs].sort((a, b) => {
      const updatedDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      if (updatedDiff !== 0) return updatedDiff
      const createdDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      if (createdDiff !== 0) return createdDiff
      return Number(b.id) - Number(a.id)
    })[0] ?? null
  )
}

/**
 * 派生 OCR 文档工作台状态。
 * 根据 MIME 支持、作业列表、接受提取状态、stale/retention/privacy 上下文得出。
 */
export function deriveOcrDocumentWorkspaceStatus(params: {
  isSupported: boolean
  job: OcrDocumentJobSummary | null
  isStale: boolean
  hasAcceptedExtraction: boolean
  blockReason: OcrDocumentWorkspaceBlockReason | null
  reviewStatus: OcrReviewStatus | null
}): OcrDocumentWorkspaceStatus {
  if (!params.isSupported) return 'unsupported'
  if (params.blockReason) {
    if (params.blockReason === 'privacy_block' || params.blockReason === 'source_hidden') {
      return 'blocked'
    }
    if (
      params.blockReason === 'retention_hold' ||
      params.blockReason === 'lifecycle_expired' ||
      params.blockReason === 'lifecycle_purged'
    ) {
      return 'blocked'
    }
    if (params.blockReason === 'permission_denied') return 'degraded'
    if (params.blockReason === 'unsupported_mime') return 'unsupported'
    return 'degraded'
  }
  if (!params.job) return 'no_job'

  const status = params.job.status

  if (status === 'queued' || status === 'normalizing') return 'queued'
  if (status === 'processing') return 'processing'
  if (status === 'failed') return 'failed'
  if (status === 'canceled') return 'failed'

  if (status === 'reviewable') {
    if (params.isStale) return 'stale'
    if (params.hasAcceptedExtraction) return 'confirmed'
    return 'reviewable'
  }

  if (params.isStale) return 'stale'

  return 'degraded'
}

/**
 * 解析 OCR 文档工作台中源行的当前允许操作。
 * 从状态、角色、源支持、下游资格推导。
 */
export function resolveOcrDocumentWorkspaceActions(params: {
  status: OcrDocumentWorkspaceStatus
  isSupported: boolean
  isReadOnly: boolean
  hasAcceptedExtraction: boolean
  downstreamEligible: boolean
  blockReason: OcrDocumentWorkspaceBlockReason | null
}): OcrDocumentWorkspaceAction[] {
  if (params.isReadOnly) {
    // 只读用户仅查看权限
    const actions: OcrDocumentWorkspaceAction[] = ['view_governance']
    return actions
  }

  if (params.blockReason) {
    // 被阻止时仅可查看治理
    return ['view_governance']
  }

  if (!params.isSupported || params.status === 'unsupported') return []

  const actions: OcrDocumentWorkspaceAction[] = ['view_governance']

  switch (params.status) {
    case 'no_job':
      actions.push('create_ocr')
      break
    case 'failed':
      actions.push('retry_ocr', 'create_ocr')
      break
    case 'queued':
    case 'processing':
      // 进行中无直接操作
      break
    case 'reviewable':
      actions.push('review', 'retry_ocr')
      break
    case 'confirmed':
      actions.push('review', 'retry_ocr', 'export', 'copy')
      if (params.downstreamEligible) {
        actions.push('search_index', 'structured_extraction', 'entity_linking')
      }
      break
    case 'stale':
      actions.push('retry_ocr', 'review')
      break
    case 'blocked':
    case 'degraded':
      break
  }

  return actions
}

// ---------------------------------------------------------------------------
// 纯函数：低敏脱敏
// ---------------------------------------------------------------------------

/**
 * 脱敏源标题（隐藏源时使用）。
 * 仅返回通用描述，不暴露真实文件名。
 */
export function redactSourceTitle(params: {
  sourceKind: OcrDocumentSourceKind
  isHidden: boolean
  originalFileName: string | null
}): string {
  if (params.isHidden) {
    return params.sourceKind === 'upload' ? '已上传文件' : '附件'
  }
  return params.originalFileName ?? '未命名文件'
}

/**
 * 脱敏 OCR 文本计数（隐私阻止时返回 null）。
 */
export function redactOcrTextCount(params: {
  isPrivacyBlocked: boolean
  textCount: number | null
}): number | null {
  if (params.isPrivacyBlocked) return null
  return params.textCount
}

/**
 * 脱敏警告元数据。
 * 对不可见源移除低置信度以外的具体警告。
 */
export function redactWarningMetadata(params: {
  isHidden: boolean
  warningCodes: OcrDocumentWarningCode[]
}): OcrDocumentWarningCode[] {
  if (params.isHidden) return []
  return params.warningCodes
}

/**
 * 脱敏阻止原因文本（仅返回允许的低敏描述）。
 */
export function redactDenialReason(params: {
  blockReason: OcrDocumentWorkspaceBlockReason
  isHidden: boolean
}): string {
  if (params.isHidden) return '源不可访问'

  const lowSensitiveLabels: Record<OcrDocumentWorkspaceBlockReason, string> = {
    retention_hold: '保留策略限制',
    privacy_block: '隐私策略限制',
    lifecycle_expired: '生命周期已到期',
    lifecycle_purged: '数据已清除',
    permission_denied: '权限不足',
    source_hidden: '源不可访问',
    unsupported_mime: '不支持的文件类型',
  }

  return lowSensitiveLabels[params.blockReason] ?? '不可用'
}

// ---------------------------------------------------------------------------
// 类型守卫
// ---------------------------------------------------------------------------

export function isOcrDocumentWorkspaceStatus(value: unknown): value is OcrDocumentWorkspaceStatus {
  return (
    typeof value === 'string' &&
    (OCR_DOCUMENT_WORKSPACE_STATUSES as readonly string[]).includes(value)
  )
}

export function isOcrDocumentWorkspaceAction(value: unknown): value is OcrDocumentWorkspaceAction {
  return (
    typeof value === 'string' &&
    (OCR_DOCUMENT_WORKSPACE_ACTIONS as readonly string[]).includes(value)
  )
}

export function isOcrDocumentWorkspaceBlockReason(
  value: unknown,
): value is OcrDocumentWorkspaceBlockReason {
  return (
    typeof value === 'string' &&
    (OCR_DOCUMENT_WORKSPACE_BLOCK_REASONS as readonly string[]).includes(value)
  )
}

// ---------------------------------------------------------------------------
// 纯函数：筛选 / 排序
// ---------------------------------------------------------------------------

/**
 * 按状态排序权重（用于行排序）。
 * 较低值 = 较高优先级。
 */
const STATUS_SORT_WEIGHTS: Record<OcrDocumentWorkspaceStatus, number> = {
  reviewable: 0,
  processing: 1,
  queued: 2,
  failed: 3,
  stale: 4,
  confirmed: 5,
  no_job: 6,
  degraded: 7,
  blocked: 8,
  unsupported: 9,
}

export function getStatusSortWeight(status: OcrDocumentWorkspaceStatus): number {
  return STATUS_SORT_WEIGHTS[status] ?? 10
}

/**
 * 对 OCR 工作台行摘要按指定配置排序（稳定排序）。
 */
export function sortOcrWorkspaceRows(
  rows: ReadonlyArray<OcrDocumentWorkspaceRowSummary>,
  config: OcrDocumentWorkspaceSortConfig,
): OcrDocumentWorkspaceRowSummary[] {
  const multiplier = config.direction === 'desc' ? -1 : 1

  return [...rows].sort((a, b) => {
    let cmp = 0

    switch (config.field) {
      case 'sourceFileName': {
        const nameA = a.sourceFileName ?? ''
        const nameB = b.sourceFileName ?? ''
        cmp = nameA.localeCompare(nameB, 'zh-CN')
        break
      }
      case 'status': {
        cmp = getStatusSortWeight(a.status) - getStatusSortWeight(b.status)
        break
      }
      case 'latestJobCreatedAt': {
        const timeA = a.latestJobCreatedAt ? new Date(a.latestJobCreatedAt).getTime() : 0
        const timeB = b.latestJobCreatedAt ? new Date(b.latestJobCreatedAt).getTime() : 0
        cmp = timeA - timeB
        break
      }
      case 'estimatedCost': {
        const costA = a.estimatedCost ?? 0
        const costB = b.estimatedCost ?? 0
        cmp = costA - costB
        break
      }
    }

    return cmp * multiplier
  })
}

/**
 * 按工作台状态筛选行。
 * 不修改原始数据。
 */
export function filterOcrWorkspaceRows(
  rows: ReadonlyArray<OcrDocumentWorkspaceRowSummary>,
  filters: OcrDocumentWorkspaceFilters,
): OcrDocumentWorkspaceRowSummary[] {
  let result = [...rows]

  if (filters.status !== null) {
    result = result.filter((r) => r.status === filters.status)
  }

  if (filters.isSupported !== null) {
    result = result.filter((r) => r.isSupported === filters.isSupported)
  }

  if (filters.search) {
    const search = filters.search.toLowerCase()
    result = result.filter((r) => (r.sourceFileName ?? '').toLowerCase().includes(search))
  }

  return result
}
