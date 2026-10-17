'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FilePlus2, FileText, Folder, FolderPlus, Loader2, RefreshCw } from 'lucide-react'
import { filesApi, fileKeys, type Document } from '@/lib/api/files'
import { formatFileTime } from '@/lib/next/files/file-helpers'

/**
 * 轻量文档 / 文件夹组织面板（v3-ui-next-resource-team-domains W3 · tasks 3.7，
 * design §4「轻量文档与文件夹组织」）。
 *
 * - 消费既有 `GET /projects/:id/files`（filesApi.list，根级 parentId=null），
 *   呈现文件夹与文档条目（类型徽章 + 更新时间）；
 * - 具备 file:manage（props.canManage）时提供内联新建入口（filesApi.create，
 *   文件夹 / 文档双按钮，名称非空与长度前端即时校验）；
 * - 加载骨架 / 空态 / 错误重试三态闭环；只读用户隐藏全部新建入口（RL-06）。
 */

export interface FileDocumentsOrganizerProps {
  projectId: number
  /** file:manage 判定：false 时隐藏全部新建入口。 */
  canManage: boolean
}

const DOCUMENT_TYPE_LABELS: Record<Document['documentType'], string> = {
  folder: '文件夹',
  document: '文档',
  template: '模板',
}

function errorMessageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

export function FileDocumentsOrganizer({ projectId, canManage }: FileDocumentsOrganizerProps) {
  const queryClient = useQueryClient()
  const [name, setName] = React.useState('')
  const [createError, setCreateError] = React.useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: fileKeys.list(projectId, { parentId: null }),
    queryFn: () => filesApi.list(projectId, { parentId: null, perPage: 100 }),
    enabled: projectId > 0,
  })

  const documents = data?.data ?? []

  const createMutation = useMutation({
    mutationFn: ({
      documentName,
      documentType,
    }: {
      documentName: string
      documentType: 'folder' | 'document'
    }) =>
      filesApi.create(projectId, {
        name: documentName,
        documentType,
        parentId: null,
        content: documentType === 'document' ? '' : null,
      }),
    onSuccess: () => {
      setName('')
      setCreateError(null)
      void queryClient.invalidateQueries({ queryKey: fileKeys.lists(projectId) })
    },
    onError: (error) => {
      setCreateError(errorMessageOf(error, '创建失败，请重试'))
    },
  })

  const submitCreate = (documentType: 'folder' | 'document') => {
    const trimmed = name.trim()
    if (!trimmed) {
      setCreateError('请输入文件夹或文档名称')
      return
    }
    if (trimmed.length > 80) {
      setCreateError('名称过长（最多 80 字符）')
      return
    }
    setCreateError(null)
    createMutation.mutate({ documentName: trimmed, documentType })
  }

  return (
    <section
      data-file-documents-panel
      aria-busy={isLoading || createMutation.isPending}
      className="flex flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">文档与文件夹</h3>
          <span
            data-file-documents-total
            className="font-mono text-[10px] text-[var(--nx-text-muted)]"
          >
            共 {documents.length} 项
          </span>
        </div>
        {createError ? (
          <p
            role="alert"
            aria-label="新建失败"
            data-file-documents-create-error
            className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
          >
            {createError}
          </p>
        ) : null}
      </div>

      {/* 内联新建入口（仅 file:manage） */}
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="file-document-name-input"
            data-file-documents-name-input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submitCreate('document')
              }
            }}
            placeholder="输入名称后新建文件夹或文档"
            aria-label="新建文件夹或文档名称"
            className="h-8 w-full max-w-xs rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          />
          <button
            type="button"
            data-file-documents-create-folder
            disabled={createMutation.isPending}
            onClick={() => submitCreate('folder')}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)] disabled:opacity-50"
          >
            <FolderPlus className="h-3.5 w-3.5" aria-hidden />
            新建文件夹
          </button>
          <button
            type="button"
            data-file-documents-create-document
            disabled={createMutation.isPending}
            onClick={() => submitCreate('document')}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
          >
            <FilePlus2 className="h-3.5 w-3.5" aria-hidden />
            新建文档
          </button>
        </div>
      ) : null}

      {/* 加载骨架 */}
      {isLoading ? (
        <div
          data-file-documents-skeleton
          className="flex flex-col gap-2"
          role="status"
          aria-label="正在加载文档与文件夹"
          aria-busy="true"
        >
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3 py-1.5">
              <div className="h-6 w-6 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
              <div className="h-2.5 w-1/2 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
            </div>
          ))}
        </div>
      ) : null}

      {/* 错误 + 重试 */}
      {!isLoading && isError ? (
        <div
          data-file-documents-error
          role="alert"
          className="flex items-center justify-between gap-3 rounded-sm border border-[var(--nx-status-danger)]/40 bg-[rgba(239,68,68,0.06)] px-3 py-2.5"
        >
          <p className="text-[11px] text-[var(--nx-text-secondary)]">
            文档与文件夹加载失败，请稍后重试。
          </p>
          <button
            type="button"
            data-file-documents-retry
            onClick={() => void refetch()}
            className="flex h-7 items-center gap-1.5 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            重试
          </button>
        </div>
      ) : null}

      {/* 空态 */}
      {!isLoading && !isError && documents.length === 0 ? (
        <p
          data-file-documents-empty
          className="py-3 text-center text-[11px] text-[var(--nx-text-muted)]"
        >
          暂无文件夹与文档，{canManage ? '可在上方输入名称新建首个条目。' : '等待项目负责人创建。'}
        </p>
      ) : null}

      {/* 条目列表 */}
      {!isLoading && !isError && documents.length > 0 ? (
        <ul className="flex flex-col">
          {documents.map((document) => (
            <li
              key={document.id}
              data-file-document-row={document.id}
              data-file-document-type={document.documentType}
              className="flex items-center gap-3 border-b border-[var(--nx-border-hairline)]/60 py-2 last:border-b-0"
            >
              {document.documentType === 'folder' ? (
                <Folder className="h-4 w-4 shrink-0 text-[var(--nx-text-secondary)]" aria-hidden />
              ) : (
                <FileText className="h-4 w-4 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
              )}
              <span
                data-file-document-name
                className="min-w-0 flex-1 truncate text-[13px] text-[var(--nx-text-primary)]"
                title={document.name}
              >
                {document.name}
              </span>
              <span className="shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]">
                {DOCUMENT_TYPE_LABELS[document.documentType] ?? document.documentType}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--nx-text-muted)]">
                {formatFileTime(document.updatedAt ?? document.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {createMutation.isPending ? (
        <p className="flex items-center gap-1.5 text-[10px] text-[var(--nx-text-muted)]">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          创建中…
        </p>
      ) : null}
    </section>
  )
}

export default FileDocumentsOrganizer
