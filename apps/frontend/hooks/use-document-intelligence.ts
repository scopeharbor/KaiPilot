'use client'

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  documentIntelligenceApi,
  documentIntelligenceKeys,
  type DocumentIntelligenceListParams,
} from '@/lib/api/document-intelligence'
import { ocrDocumentKeys } from '@/hooks/use-ocr-document'
import { ocrReviewKeys } from '@/hooks/use-ocr-review'
import { ocrSearchIndexKeys } from '@/hooks/use-ocr-search-index'
import { ocrStructuredExtractionKeys } from '@/hooks/use-ocr-structured-extraction'
import { ocrEntityLinkingKeys } from '@/hooks/use-ocr-entity-linking'
import type { DocumentIntelligenceSourceKind, DocumentIntelligenceSurface } from '@aiproj/types'

/**
 * 文档智能工作台数据层（v3-document-intelligence-workbench §4.1 / §5.11）。
 *
 * 红线：
 * - 完全消费服务端权威 read model：accepted / downstream / 治理状态一律来自后端，
 *   前端不再用 `job.status === 'reviewable'` 猜测，也不再固定拉 `perPage: 200`。
 * - 面板成功后只按 surface 精确失效对应 query keys，禁止 `invalidateQueries()` 全局清空。
 */

/** 来源清单查询 */
export function useDocumentIntelligenceSources(
  projectId: number,
  params?: DocumentIntelligenceListParams,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: documentIntelligenceKeys.sourceList(projectId, params),
    queryFn: ({ signal }) => documentIntelligenceApi.listSources(projectId, params, { signal }),
    enabled: (options?.enabled ?? true) && Number.isFinite(projectId) && projectId > 0,
    staleTime: 10_000,
    refetchInterval: options?.refetchInterval ?? false,
  })
}

/** 来源详情查询（深链恢复；服务端重新裁决可见性与入口） */
export function useDocumentIntelligenceSourceDetail(
  projectId: number,
  sourceKind: DocumentIntelligenceSourceKind | null,
  sourceId: number | null,
  options?: { enabled?: boolean },
) {
  const enabled =
    (options?.enabled ?? true) &&
    Number.isFinite(projectId) &&
    projectId > 0 &&
    sourceKind !== null &&
    sourceId !== null &&
    sourceId > 0

  return useQuery({
    queryKey: documentIntelligenceKeys.sourceDetail(
      projectId,
      (sourceKind ?? 'attachment') as DocumentIntelligenceSourceKind,
      sourceId ?? 0,
    ),
    queryFn: ({ signal }) =>
      documentIntelligenceApi.sourceDetail(
        projectId,
        sourceKind as DocumentIntelligenceSourceKind,
        sourceId as number,
        { signal },
      ),
    enabled,
    staleTime: 10_000,
    retry: false,
  })
}

/**
 * surface → owning query key 前缀映射（§5.11）。
 *
 * 每个 owning 面板确认成功后，只失效工作台的 source list/detail 与该 surface 自己的
 * owning keys；其它 surface 的缓存保持不动。
 */
export function resolveOwningInvalidationKeys(
  surface: DocumentIntelligenceSurface,
  ctx: { projectId: number; jobId?: number | null },
): readonly unknown[][] {
  switch (surface) {
    case 'review':
      return ctx.jobId
        ? [
            [...ocrReviewKeys.review(ctx.projectId, ctx.jobId)],
            [...ocrReviewKeys.acceptedExtractions(ctx.projectId, ctx.jobId)],
            [...ocrDocumentKeys.list(ctx.projectId)],
          ]
        : [[...ocrDocumentKeys.list(ctx.projectId)]]
    case 'search_index':
      return [[...ocrSearchIndexKeys.all(ctx.projectId)]]
    case 'structured_extraction':
      return [[...ocrStructuredExtractionKeys.all(ctx.projectId)]]
    case 'entity_linking':
      return [[...ocrEntityLinkingKeys.all]]
    // 只读 surface 不写入，因此无 owning 失效
    case 'document_reader':
    case 'governance':
      return []
    default:
      return []
  }
}

/** 工作台缓存失效器（精确 invalidation，禁止全局清空） */
export function useDocumentIntelligenceInvalidation(projectId: number) {
  const queryClient = useQueryClient()

  const invalidateWorkbench = useCallback(
    (source?: { sourceKind: DocumentIntelligenceSourceKind; sourceId: number } | null) => {
      void queryClient.invalidateQueries({ queryKey: documentIntelligenceKeys.sources(projectId) })
      if (source) {
        void queryClient.invalidateQueries({
          queryKey: documentIntelligenceKeys.sourceDetail(
            projectId,
            source.sourceKind,
            source.sourceId,
          ),
        })
      }
    },
    [queryClient, projectId],
  )

  const invalidateAfterPanelSuccess = useCallback(
    (
      surface: DocumentIntelligenceSurface,
      ctx: {
        sourceKind: DocumentIntelligenceSourceKind
        sourceId: number
        jobId?: number | null
      },
    ) => {
      invalidateWorkbench({ sourceKind: ctx.sourceKind, sourceId: ctx.sourceId })
      for (const key of resolveOwningInvalidationKeys(surface, {
        projectId,
        jobId: ctx.jobId ?? null,
      })) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    },
    [queryClient, projectId, invalidateWorkbench],
  )

  return useMemo(
    () => ({ invalidateWorkbench, invalidateAfterPanelSuccess }),
    [invalidateWorkbench, invalidateAfterPanelSuccess],
  )
}
