'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Inbox, Loader2, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { attachmentsApi, attachmentKeys, type Attachment } from '@/lib/api/files'
import {
  FILE_CATEGORY_TABS,
  fileKindCategoryOf,
  fileVisualOf,
  formatFileSize,
  formatFileTime,
} from '@/lib/next/files/file-helpers'
import { cn } from '@/lib/utils'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'

/**
 * 项目附件与交付物底册（v3-ui-next-resource-team-domains W3 · tasks 3.3，
 * design §4.1/§4.3「附件底册结构化展示与类型语义映射 / 安全下载与受控删除」）。
 *
 * - 消费既有 `GET /projects/:id/attachments`（attachmentsApi.list），列表按上传
 *   时间倒序稳定排序（新附件首行，RL-04 与后端权威数据一致）；
 * - 文件大类 Tab（全部/文档/表格/图片/压缩包）+ 文件名不区分大小写模糊检索，
 *   均为纯客户端即时收敛，零额外网络请求；
 * - 安全下载：`attachmentsApi.getDownloadUrl` 生成受控下载链接（文件名/图标双
 *   入口），下载鉴权由服务端端点承担；
 * - 受控删除：仅具备 file:manage（props.canManage）时行操作暴露删除入口，二次
 *   确认弹窗后才发 DELETE（RL-06）；只读成员删除入口物理隐藏；
 * - 三态闭环：加载骨架屏（aria-busy）/ 语义化空态 / 错误可重试。
 */

export interface FileAttachmentListProps {
  projectId: number
  /** file:manage 判定：false 时删除入口物理隐藏，仅保留下载（RL-06）。 */
  canManage: boolean
}

type AttachmentCategoryFilter = (typeof FILE_CATEGORY_TABS)[number]['id']

/** 从 API 抛错（含 ApiError / { code, message } / Error）中提取人读信息。 */
function errorMessageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

export function FileAttachmentList({ projectId, canManage }: FileAttachmentListProps) {
  const queryClient = useQueryClient()

  const [search, setSearch] = React.useState('')
  const [category, setCategory] = React.useState<AttachmentCategoryFilter>('all')
  const [deletingAttachment, setDeletingAttachment] = React.useState<Attachment | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: attachmentKeys.list(projectId, {}),
    queryFn: () => attachmentsApi.list(projectId, {}),
    enabled: projectId > 0,
  })

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: number) => attachmentsApi.delete(projectId, attachmentId),
    onSuccess: () => {
      setDeletingAttachment(null)
      setActionError(null)
      void queryClient.invalidateQueries({ queryKey: attachmentKeys.lists(projectId) })
    },
    onError: (error) => {
      setDeletingAttachment(null)
      setActionError(errorMessageOf(error, '文件删除失败，请重试'))
    },
  })

  // 删除二次确认弹层：在途删除拒绝 Escape 关闭（与「取消」按钮 disabled 同口径）。
  const deleteDialogRef = React.useRef<HTMLDivElement | null>(null)
  useDialogA11y({
    ref: deleteDialogRef,
    open: deletingAttachment !== null,
    onClose: () => setDeletingAttachment(null),
    canClose: () => !deleteMutation.isPending,
  })

  // 附件清单：倒序（新 → 旧），保证上传成功后的新附件位于列表首行。
  const attachments = React.useMemo(() => {
    const list = data?.data ?? []
    return [...list].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
  }, [data])

  const filteredRows = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    return attachments.filter((attachment) => {
      if (
        category !== 'all' &&
        fileKindCategoryOf(fileVisualOf(attachment.mimeType, attachment.fileName).kind) !== category
      ) {
        return false
      }
      if (query && !attachment.fileName.toLowerCase().includes(query)) return false
      return true
    })
  }, [attachments, category, search])

  const clearFilters = () => {
    setSearch('')
    setCategory('all')
  }
  const openDeleteDialog = (attachment: Attachment) => {
    setActionError(null)
    setDeletingAttachment(attachment)
  }

  const downloadUrlOf = (attachment: Attachment) =>
    attachmentsApi.getDownloadUrl(projectId, attachment.id)

  return (
    <section
      data-file-attachment-list
      aria-busy={isLoading || isFetching}
      className="flex flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      {/* 区块标题 + 汇总 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">附件与交付物底册</h3>
          <span
            data-file-attachment-total
            className="font-mono text-[10px] text-[var(--nx-text-muted)]"
          >
            共 {filteredRows.length} 个
          </span>
        </div>
        {actionError ? (
          <p
            role="alert"
            aria-label="文件操作失败"
            data-file-action-error
            className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
          >
            {actionError}
          </p>
        ) : null}
      </div>

      {/* 搜索 + 大类 Tab（纯客户端即时收敛，零额外请求） */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--nx-text-muted)]"
          />
          <input
            id="file-attachment-search"
            data-file-search
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="按文件名模糊搜索…"
            aria-label="搜索文件名"
            className="h-8 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] pl-8 pr-3 text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          />
        </div>
        <div
          role="tablist"
          aria-label="文件大类过滤"
          data-file-category-tabs
          className="flex w-fit items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-1"
        >
          {FILE_CATEGORY_TABS.map((tab) => {
            const active = category === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                data-file-tab={tab.id}
                aria-selected={active}
                onClick={() => setCategory(tab.id)}
                className={cn(
                  'h-6 rounded-sm px-2.5 text-[11px] transition-colors',
                  active
                    ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                    : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* 加载骨架屏：表头占位 + 5 行发丝线骨架条 */}
      {isLoading ? (
        <div
          data-file-list-skeleton
          className="flex flex-col gap-2"
          role="status"
          aria-label="正在加载附件清单"
          aria-busy="true"
        >
          <div className="flex items-center gap-3 border-b border-[var(--nx-border-hairline)] pb-2">
            {[0, 1, 2, 3, 4].map((column) => (
              <div
                key={column}
                className={cn(
                  'h-2 animate-pulse rounded-sm bg-[var(--nx-bg-1)]',
                  column === 0 ? 'w-1/3' : column === 4 ? 'w-12' : 'w-16',
                )}
              />
            ))}
          </div>
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-3 py-2">
              <div className="h-8 w-8 shrink-0 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
              <div className="h-2.5 w-1/3 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
              <div className="h-2.5 w-14 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
              <div className="h-2.5 w-16 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
              <div className="h-2.5 w-12 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
              <div className="ml-auto h-2.5 w-16 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
            </div>
          ))}
        </div>
      ) : null}

      {/* 查询错误：错误卡 + 重试 */}
      {!isLoading && isError ? (
        <div
          data-file-list-error
          role="alert"
          className="flex flex-col items-center gap-3 rounded-md border border-[var(--nx-status-danger)]/40 bg-[rgba(239,68,68,0.06)] px-6 py-8 text-center"
        >
          <p className="text-[13px] text-[var(--nx-text-secondary)]">
            附件清单加载失败，请稍后重试。
          </p>
          <button
            type="button"
            data-file-list-retry
            onClick={() => void refetch()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重试加载
          </button>
        </div>
      ) : null}

      {/* 语义化空态：项目尚无任何附件 */}
      {!isLoading && !isError && attachments.length === 0 ? (
        <div
          data-file-list-empty
          className="flex flex-col items-center gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <Inbox className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <div>
            <p className="text-[13px] font-medium text-[var(--nx-text-primary)]">
              当前项目暂无交付物与附件
            </p>
            <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
              将文件拖入上方释放区，或点击选择文件上传首个交付物。
            </p>
          </div>
        </div>
      ) : null}

      {/* 本地筛选无匹配（有附件但被过滤收敛为空） */}
      {!isLoading && !isError && attachments.length > 0 && filteredRows.length === 0 ? (
        <div
          data-file-list-no-match
          className="flex flex-col items-center gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-8 text-center"
        >
          <p className="text-[13px] text-[var(--nx-text-secondary)]">
            未找到与当前搜索/分类匹配的文件。
          </p>
          <button
            type="button"
            data-file-filter-reset
            onClick={clearFilters}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            清除搜索与分类
          </button>
        </div>
      ) : null}

      {/* 数据底册表格 */}
      {!isLoading && !isError && filteredRows.length > 0 ? (
        <div className="overflow-x-auto">
          <table
            data-file-table
            aria-label="项目附件底册"
            className="w-full border-collapse text-left"
          >
            <thead>
              <tr className="border-b border-[var(--nx-border-hairline)]">
                {['文件', '大小', '上传者', '版本', '上传时间', '操作'].map((header) => (
                  <th
                    key={header}
                    scope="col"
                    className="whitespace-nowrap px-2 py-2 text-[10px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((attachment) => {
                const visual = fileVisualOf(attachment.mimeType, attachment.fileName)
                const Icon = visual.icon
                const downloadUrl = downloadUrlOf(attachment)
                return (
                  <tr
                    key={attachment.id}
                    data-file-attachment-row={attachment.id}
                    className="border-b border-[var(--nx-border-hairline)]/60 transition-colors hover:bg-[var(--nx-bg-1)]/60"
                  >
                    {/* 文件名：语义图标 + 名称（防溢出省略，可点名称直接下载） */}
                    <td className="max-w-64 px-2 py-2">
                      <div className="flex items-center gap-2.5">
                        <span
                          data-file-icon-kind={visual.kind}
                          data-file-icon-color={visual.color}
                          aria-hidden
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]"
                          style={{ color: visual.color }}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <a
                            data-file-name-download={attachment.id}
                            href={downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`下载 ${attachment.fileName}`}
                            className="block max-w-52 truncate text-[13px] font-medium text-[var(--nx-text-primary)] transition-colors hover:text-[var(--nx-accent)]"
                          >
                            {attachment.fileName}
                          </a>
                          <p className="text-[10px] text-[var(--nx-text-muted)]">{visual.label}</p>
                        </div>
                      </div>
                    </td>
                    <td
                      data-file-size
                      className="whitespace-nowrap px-2 py-2 font-mono text-[11px] text-[var(--nx-text-secondary)]"
                    >
                      {formatFileSize(attachment.fileSize)}
                    </td>
                    <td data-file-uploader className="px-2 py-2">
                      <p className="max-w-36 truncate text-[12px] text-[var(--nx-text-secondary)]">
                        {attachment.uploader?.fullName ?? attachment.uploader?.email ?? '—'}
                      </p>
                      {attachment.uploader?.email && attachment.uploader.fullName ? (
                        <p className="max-w-36 truncate font-mono text-[10px] text-[var(--nx-text-muted)]">
                          {attachment.uploader.email}
                        </p>
                      ) : null}
                    </td>
                    <td data-file-version className="whitespace-nowrap px-2 py-2">
                      <span className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                        v{attachment.currentVersion ?? 1}
                      </span>
                    </td>
                    <td
                      data-file-uploaded-at
                      className="whitespace-nowrap px-2 py-2 font-mono text-[11px] text-[var(--nx-text-muted)]"
                    >
                      {formatFileTime(attachment.createdAt)}
                    </td>
                    <td className="px-2 py-2">
                      <div data-file-row-actions className="flex items-center gap-1">
                        <a
                          data-file-download={attachment.id}
                          href={downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`下载 ${attachment.fileName}`}
                          title="安全下载"
                          className="flex h-7 w-7 items-center justify-center rounded-sm border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden />
                        </a>
                        {canManage ? (
                          <button
                            type="button"
                            data-file-delete-open={attachment.id}
                            aria-label={`删除 ${attachment.fileName}`}
                            disabled={deleteMutation.isPending}
                            onClick={() => openDeleteDialog(attachment)}
                            className="flex h-7 w-7 items-center justify-center rounded-sm border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-status-danger)] hover:text-[var(--nx-status-danger)] disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* 两步确认删除弹窗（RL-06） */}
      {deletingAttachment ? (
        <div data-file-delete-dialog-overlay className="fixed inset-0 z-50" role="presentation">
          <button
            type="button"
            aria-label="关闭删除确认弹窗"
            tabIndex={-1}
            onClick={() => setDeletingAttachment(null)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="确认删除文件"
            data-file-delete-dialog
            ref={deleteDialogRef}
            tabIndex={-1}
            className="absolute left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
          >
            <header className="border-b border-[var(--nx-border-hairline)] px-5 py-4">
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">确认删除文件</h3>
            </header>
            <div className="px-5 py-4">
              <p className="text-[13px] text-[var(--nx-text-secondary)]">
                文件删除后不可恢复，请确认是否移除「{deletingAttachment.fileName}」？
              </p>
              <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
                该操作将同步删除服务端物理文件与全部历史版本。
              </p>
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
              <button
                type="button"
                data-file-delete-cancel
                onClick={() => setDeletingAttachment(null)}
                disabled={deleteMutation.isPending}
                className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-file-delete-confirm
                aria-label={`确认删除 ${deletingAttachment.fileName}`}
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deletingAttachment.id)}
                className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.12)] px-4 text-xs font-medium text-[var(--nx-status-danger)] transition-colors hover:bg-[var(--nx-status-danger)] hover:text-white disabled:opacity-50"
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                )}
                确认删除
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {/* 只读提示（RL-06 说明，非破坏性入口） */}
      {!canManage && !isLoading && attachments.length > 0 ? (
        <p data-file-readonly-hint className="text-right text-[10px] text-[var(--nx-text-muted)]">
          只读模式：如需上传或删除文件，请联系项目负责人授予 file:manage 权限。
        </p>
      ) : null}
    </section>
  )
}

export default FileAttachmentList
