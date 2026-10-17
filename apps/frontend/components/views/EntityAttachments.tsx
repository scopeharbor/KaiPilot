'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { attachmentsApi, attachmentKeys, fileKeys } from '@/lib/api/files'
import type { Attachment } from '@/lib/api/files'

interface EntityAttachmentsProps {
  projectId: number
  entityType: string
  entityId: number
  /** 是否只读模式（无 file:manage 权限）。 */
  readonly?: boolean
}

/**
 * 可复用实体附件组件。
 * 输入 projectId、entityType、entityId，复用附件 API。
 * 可嵌入 TaskDetailDrawer、风险、里程碑、变更等详情区域。
 * 支持深色主题和长文件名不重叠布局。
 *
 * 接入指南（预留接口）：
 * - TaskDetailDrawer：已完成嵌入（见 5.2）
 * - MilestoneDetail：可直接使用 <EntityAttachments projectId={id} entityType="milestone" entityId={milestoneId} />
 * - RiskDetail：可直接使用 <EntityAttachments projectId={id} entityType="risk" entityId={riskId} />
 * - DocumentDetail：可直接使用 <EntityAttachments projectId={id} entityType="document" entityId={documentId} />
 * - ChangeRequestDetail：可直接使用 <EntityAttachments projectId={id} entityType="change_request" entityId={crId} />
 * 注意：各详情页面不存在时不要强行扩范围，等对应页面实现后接入。
 */
export function EntityAttachments({
  projectId,
  entityType,
  entityId,
  readonly = false,
}: EntityAttachmentsProps) {
  const queryClient = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // 查询实体附件
  const { data, isLoading } = useQuery({
    queryKey: attachmentKeys.entity(projectId, entityType, entityId),
    queryFn: () => attachmentsApi.list(projectId, { entityType, entityId }),
    enabled: !!projectId && !!entityType && !!entityId,
  })

  // 上传
  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true)
      setUploadError(null)

      try {
        await attachmentsApi.upload(projectId, { entityType, entityId }, file)

        // 失效相关查询
        queryClient.invalidateQueries({
          queryKey: attachmentKeys.entity(projectId, entityType, entityId),
        })
        queryClient.invalidateQueries({ queryKey: attachmentKeys.lists(projectId) })
        queryClient.invalidateQueries({ queryKey: fileKeys.lists(projectId) })
      } catch (error) {
        const message = (error as { message?: string })?.message || '上传失败'
        setUploadError(message)
      } finally {
        setUploading(false)
      }
    },
    [projectId, entityType, entityId, queryClient],
  )

  // 删除
  const deleteMutation = useMutation({
    mutationFn: (attachmentId: number) => attachmentsApi.delete(projectId, attachmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: attachmentKeys.entity(projectId, entityType, entityId),
      })
      queryClient.invalidateQueries({ queryKey: attachmentKeys.lists(projectId) })
      queryClient.invalidateQueries({ queryKey: fileKeys.lists(projectId) })
    },
  })

  const attachments = data?.data ?? []

  return (
    <div className="space-y-2 sm:space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">附件</h3>
        {!readonly && (
          <label className="cursor-pointer text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
            {uploading ? '上传中...' : '上传附件'}
            <input
              type="file"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleUpload(file)
                e.target.value = ''
              }}
            />
          </label>
        )}
      </div>

      {uploadError && (
        <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {uploadError}
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">加载中...</p>
      ) : attachments.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">暂无附件</p>
      ) : (
        <div className="space-y-1">
          {attachments.map((att: Attachment) => (
            <div
              key={att.id}
              className="flex items-center justify-between gap-2 rounded bg-gray-50 px-2 py-1.5 dark:bg-gray-800 sm:px-3 sm:py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex-shrink-0">📎</span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{att.fileName}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatFileSize(att.fileSize)}
                    {att.uploader?.fullName && ` · ${att.uploader.fullName}`}
                  </p>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1.5 sm:gap-2">
                <a
                  href={attachmentsApi.getDownloadUrl(projectId, att.id)}
                  className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  下载
                </a>
                {!readonly && (
                  <button
                    onClick={() => deleteMutation.mutate(att.id)}
                    className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
