'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { documentMarkdownApi, documentContentApi, fileKeys } from '@/lib/api/files'
import type {
  MarkdownImportConfirmRequest,
  MarkdownImportPreviewRequest,
  MarkdownExportSingleRequest,
  MarkdownExportTreeRequest,
} from '@aiproj/types'

/**
 * 项目文档 Markdown 导入/导出 TanStack Query hooks
 * （v3-document-markdown-import-export §6.2）。
 * preview 只读不写库；confirm 成功后失效项目文件列表与文档详情缓存。
 */

/** 导入预览 mutation：只读，无查询失效。 */
export function useMarkdownImportPreview(projectId: number) {
  return useMutation({
    mutationFn: (input: MarkdownImportPreviewRequest) =>
      documentMarkdownApi.previewImport(projectId, input),
  })
}

/** 导入确认 mutation：成功后失效项目文件列表与目标文档详情。 */
export function useMarkdownImportConfirm(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: MarkdownImportConfirmRequest) =>
      documentMarkdownApi.confirmImport(projectId, input),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: fileKeys.lists(projectId) })
      queryClient.invalidateQueries({ queryKey: fileKeys.documents(projectId) })
      if (result.mode === 'replace' && result.documentId) {
        queryClient.invalidateQueries({
          queryKey: fileKeys.document(projectId, result.documentId),
        })
      }
    },
  })
}

/** 单文档导出 mutation：只读，无查询失效。 */
export function useMarkdownExportSingle(projectId: number) {
  return useMutation({
    mutationFn: (input: MarkdownExportSingleRequest) =>
      documentMarkdownApi.exportSingle(projectId, input),
  })
}

/** 选中树 bundle 导出 mutation：只读，无查询失效。 */
export function useMarkdownExportTree(projectId: number) {
  return useMutation({
    mutationFn: (input: MarkdownExportTreeRequest) =>
      documentMarkdownApi.exportTree(projectId, input),
  })
}

// ─── 文档内容只读（v3-document-code-block-support §5.1）────────

/** 读取文档正文与代码块元数据（只读查询）。 */
export function useDocumentContent(projectId: number, documentId: number | null) {
  return useQuery({
    queryKey: fileKeys.document(projectId, documentId!),
    queryFn: () => documentContentApi.get(projectId, documentId!),
    enabled: !!projectId && !!documentId && documentId > 0,
    staleTime: 5 * 60 * 1000,
  })
}
