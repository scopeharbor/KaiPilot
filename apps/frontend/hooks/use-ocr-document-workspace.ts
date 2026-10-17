'use client'

import { useMemo, useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ocrDocumentApi } from '@/lib/api/ocr-document'
import { fileKeys, attachmentKeys, type Attachment } from '@/lib/api/files'
import { ocrDocumentKeys } from '@/hooks/use-ocr-document'
import { usePermissions } from '@/hooks/use-permissions'
import {
  selectLatestOcrJobForSource,
  deriveOcrDocumentWorkspaceStatus,
  resolveOcrDocumentWorkspaceActions,
  isOcrSupportedMime,
  redactSourceTitle,
  sortOcrWorkspaceRows,
  filterOcrWorkspaceRows,
  type OcrDocumentWorkspaceRowSummary,
  type OcrDocumentWorkspaceFilters,
  type OcrDocumentWorkspaceSortConfig,
  type OcrDocumentWorkspaceBlockReason,
} from '@aiproj/types'

/**
 * OCR 文档工作台 Hook —— 将文件/附件列表与 OCR 作业数据组合成工作台行摘要。
 *
 * 用法：
 *   const workspace = useOcrDocumentWorkspace(projectId, attachments)
 *   // workspace.rows — 每行 OCR 摘要
 *   // workspace.sortedRows — 排序后的摘要
 *   // workspace.filteredRows — 筛选后的摘要
 *   // workspace.invalidateAll — 刷新所有相关查询
 */

interface UseOcrDocumentWorkspaceResult {
  /** 所有附件行（带 OCR 派生状态） */
  rows: OcrDocumentWorkspaceRowSummary[]
  /** 按当前配置排序和筛选后的行 */
  displayRows: OcrDocumentWorkspaceRowSummary[]
  /** 是否有任何行有 OCR 作业 */
  hasAnyOcrActivity: boolean
  /** OCR 作业总数 */
  totalOcrJobs: number
  /** 等待审查的源数 */
  reviewableCount: number
  /** 已确认的源数 */
  confirmedCount: number
  /** 处理中源数 */
  processingCount: number
  /** 失败源数 */
  failedCount: number
  /** 阻止源数 */
  blockedCount: number
  /** 加载中 */
  isLoading: boolean
  /** 刷新所有查询 */
  invalidateAll: () => void
  /** 加载更多作业 */
  hasMoreJobs: boolean
  /** 是否需要加载 OCR 作业 */
  shouldLoadJobs: boolean
}

/** 为每个附件派生工作的默认参数 */
interface UseOcrDocumentWorkspaceOptions {
  /** 是否该源对 OCR 隐藏（权限/隐私） */
  isSourceHidden?: (attachmentId: number) => boolean
  /** 该源是否有活跃隐私阻止 */
  isPrivacyBlocked?: (attachmentId: number) => boolean
  /** 该源是否有保留策略阻止 */
  isRetentionHold?: (attachmentId: number) => boolean
  /** 是否为只读用户 */
  isReadOnly?: boolean
  /** 下游（search_index/structured_extraction/entity_linking）是否可用 */
  isDownstreamEligible?: () => boolean
}

export function useOcrDocumentWorkspace(
  projectId: number,
  attachments: Attachment[],
  options: UseOcrDocumentWorkspaceOptions = {},
): UseOcrDocumentWorkspaceResult {
  const queryClient = useQueryClient()
  const { hasPermission } = usePermissions()

  const isReadOnly =
    options.isReadOnly ?? (!hasPermission('file:manage') && hasPermission('file:view'))

  const isDownstreamEligible = options.isDownstreamEligible?.() ?? hasPermission('file:manage')

  // OCR 作业列表查询
  // 拉取足够多的作业以覆盖所有附件
  const { data: ocrJobsData, isLoading: ocrJobsLoading } = useQuery({
    queryKey: ocrDocumentKeys.list(projectId),
    queryFn: () => ocrDocumentApi.list(projectId, { perPage: 200 }),
    enabled: projectId > 0 && attachments.length > 0,
    staleTime: 10_000,
  })

  const ocrJobs = ocrJobsData?.data ?? []
  const totalOcrJobs = ocrJobsData?.meta?.total ?? ocrJobs.length

  // 组合附件列表与 OCR 作业数据 → 派生行摘要
  const rows: OcrDocumentWorkspaceRowSummary[] = useMemo(() => {
    if (attachments.length === 0) return []

    return attachments.map((att) => {
      const isSupported = isOcrSupportedMime(att.mimeType)
      const latestJob = selectLatestOcrJobForSource(ocrJobs, att.id)

      // 检查是否存在已接受提取（从 latestJob 无法直接获取，
      // 这里简化：如果有 job 且状态表明已完成，则为 false；
      // 实际通过下游面板查询时获取真实状态）
      const hasAcceptedExtraction = latestJob !== null && latestJob.status === 'reviewable'
      // 注意：这里的 hasAcceptedExtraction 需要在真实场景中通过
      // useOcrDocumentExtractions 查询来获取。简化为基于 job 判断。

      const isHidden = options.isSourceHidden?.(att.id) ?? false
      const isPrivacyBlocked = options.isPrivacyBlocked?.(att.id) ?? false
      const isRetentionHeld = options.isRetentionHold?.(att.id) ?? false

      let blockReason: OcrDocumentWorkspaceBlockReason | null = null
      if (isHidden) {
        blockReason = 'source_hidden'
      } else if (isPrivacyBlocked) {
        blockReason = 'privacy_block'
      } else if (isRetentionHeld) {
        blockReason = 'retention_hold'
      } else if (!isSupported) {
        blockReason = 'unsupported_mime'
      }

      const status = deriveOcrDocumentWorkspaceStatus({
        isSupported,
        job: latestJob,
        isStale: latestJob?.warningCodes?.includes('STALE_SOURCE') ?? false,
        hasAcceptedExtraction,
        blockReason,
        reviewStatus: null,
      })

      const actions = resolveOcrDocumentWorkspaceActions({
        status,
        isSupported,
        isReadOnly,
        hasAcceptedExtraction,
        downstreamEligible: isDownstreamEligible,
        blockReason,
      })

      return {
        sourceId: att.id,
        sourceKind: 'attachment',
        sourceFileName: redactSourceTitle({
          sourceKind: 'attachment',
          isHidden,
          originalFileName: att.fileName,
        }),
        sourceMimeType: att.mimeType,
        isSupported,
        status,
        latestJobId: latestJob?.id ?? null,
        latestJobStatus: latestJob?.status ?? null,
        latestJobCreatedAt: latestJob?.createdAt ?? null,
        succeededPages: latestJob?.succeededPages ?? null,
        totalPages: latestJob?.pageCount ?? null,
        warningCodes: latestJob?.warningCodes ?? [],
        warningReasons: [],
        blockReason,
        allowedActions: actions,
        estimatedCost: latestJob?.costSummary?.estimatedCost ?? null,
        costCurrency: latestJob?.costSummary?.currency ?? null,
        isStale: latestJob?.warningCodes?.includes('STALE_SOURCE') ?? false,
        hasAcceptedExtraction,
        acceptedExtractionId: null,
      } satisfies OcrDocumentWorkspaceRowSummary
    })
  }, [attachments, ocrJobs, isReadOnly, isDownstreamEligible, options])

  // 派生计数
  const reviewableCount = rows.filter((r) => r.status === 'reviewable').length
  const confirmedCount = rows.filter((r) => r.status === 'confirmed').length
  const processingCount = rows.filter(
    (r) => r.status === 'processing' || r.status === 'queued',
  ).length
  const failedCount = rows.filter((r) => r.status === 'failed').length
  const blockedCount = rows.filter((r) => r.status === 'blocked' || r.status === 'degraded').length

  const hasAnyOcrActivity = ocrJobs.length > 0
  const shouldLoadJobs = attachments.length > 0
  const hasMoreJobs = ocrJobsData?.meta ? ocrJobsData.meta.total > ocrJobsData.meta.perPage : false

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ocrDocumentKeys.all })
    queryClient.invalidateQueries({ queryKey: fileKeys.lists(projectId) })
    queryClient.invalidateQueries({ queryKey: attachmentKeys.lists(projectId) })
  }, [queryClient, projectId])

  // 默认筛选和排序
  const [filters] = useState<OcrDocumentWorkspaceFilters>({
    status: null,
    isSupported: null,
    search: null,
  })
  const [sortConfig] = useState<OcrDocumentWorkspaceSortConfig>({
    field: 'latestJobCreatedAt',
    direction: 'desc',
  })

  const displayRows = useMemo(() => {
    const filtered = filterOcrWorkspaceRows(rows, filters)
    return sortOcrWorkspaceRows(filtered, sortConfig)
  }, [rows, filters, sortConfig])

  return {
    rows,
    displayRows,
    hasAnyOcrActivity,
    totalOcrJobs,
    reviewableCount,
    confirmedCount,
    processingCount,
    failedCount,
    blockedCount,
    isLoading: ocrJobsLoading,
    invalidateAll,
    hasMoreJobs,
    shouldLoadJobs,
  }
}

/**
 * OCR 工作台查询 key（供外部使用，便于拼接）。
 */
export const ocrDocumentWorkspaceKeys = {
  all: ['ocr-document-workspace'] as const,
  rows: (projectId: number) => [...ocrDocumentWorkspaceKeys.all, 'rows', projectId] as const,
  summary: (projectId: number) => [...ocrDocumentWorkspaceKeys.all, 'summary', projectId] as const,
}
