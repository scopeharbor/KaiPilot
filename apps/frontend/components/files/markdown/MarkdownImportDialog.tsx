'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMarkdownImportPreview, useMarkdownImportConfirm } from '@/hooks/use-document-markdown'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Textarea } from '@/components/ui/Textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/Dialog'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { toMarkdownApiError } from '@/lib/markdown-export-helpers'
import type { Document } from '@/lib/api/files'
import type { MarkdownWarning } from '@aiproj/types'

/** 导入确认文案：明确「显式保存」，不出现自动写入用语（§7.6）。 */
export const IMPORT_CONFIRM_COPY =
  '我确认要导入此 Markdown 内容。此操作仅保存当前文档，不会修改其他任何项目数据。'
export const STALE_REVIEW_COPY = '源文档已被他人修改，请重新预览后再确认导入。'

export interface MarkdownImportDialogProps {
  projectId: number
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 全部文档（用于 replace 目标选择）。 */
  documents: Document[]
  /** 默认目标文件夹（create 模式）。 */
  defaultParentId: number | null
}

/** 导入预览对话框：粘贴/文件输入 → 服务端预览 → 显式确认后写入（§7.2/7.3）。 */
export function MarkdownImportDialog({
  projectId,
  open,
  onOpenChange,
  documents,
  defaultParentId,
}: MarkdownImportDialogProps) {
  const [mode, setMode] = useState<'create' | 'replace'>('create')
  const [content, setContent] = useState('')
  const [originalFilename, setOriginalFilename] = useState<string | undefined>(undefined)
  const [targetDocumentId, setTargetDocumentId] = useState<string>('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const previewMutation = useMarkdownImportPreview(projectId)
  const confirmMutation = useMarkdownImportConfirm(projectId)

  const replaceTargets = useMemo(
    () => documents.filter((d) => d.documentType === 'document'),
    [documents],
  )

  useEffect(() => {
    if (!open) {
      setMode('create')
      setContent('')
      setOriginalFilename(undefined)
      setTargetDocumentId('')
      setConfirmed(false)
      setError(null)
      previewMutation.reset()
      confirmMutation.reset()
    }
    // 依赖表只取 open：本效应仅在对话框开合时重置本地状态与 mutation。
    // 注：本仓库未装 eslint-plugin-react-hooks，写 eslint-disable 反而会因规则不存在而报错。
  }, [open])

  const handleFile = useCallback((file: File | undefined) => {
    if (!file) return
    setOriginalFilename(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      setContent(text.replace(/^\uFEFF/, ''))
    }
    reader.readAsText(file, 'utf-8')
  }, [])

  const runPreview = useCallback(() => {
    setError(null)
    previewMutation.mutate(
      mode === 'create'
        ? { mode, content, originalFilename }
        : {
            mode,
            content,
            originalFilename,
            targetDocumentId: Number(targetDocumentId),
          },
      {
        onError: (e) => {
          const apiErr = toMarkdownApiError(e)
          setError(apiErr.message || '预览失败')
        },
      },
    )
  }, [mode, content, originalFilename, targetDocumentId, previewMutation])

  const staleBlocked = useMemo(() => {
    const e = confirmMutation.error ?? previewMutation.error
    if (!e) return false
    const details = toMarkdownApiError(e).details as
      { latestSourceDocumentHash?: string } | undefined
    return mode === 'replace' && !!details?.latestSourceDocumentHash
  }, [confirmMutation.error, previewMutation.error, mode])

  const preview = previewMutation.data
  const canConfirm =
    !!preview && confirmed && content.trim().length > 0 && (mode === 'create' || !!targetDocumentId)

  const confirm = useCallback(() => {
    if (!preview) return
    setError(null)
    confirmMutation.mutate(
      mode === 'create'
        ? { mode, content, confirmed: true, previewHash: preview.previewHash }
        : {
            mode,
            content,
            targetDocumentId: Number(targetDocumentId),
            confirmed: true,
            previewHash: preview.previewHash,
            expectedSourceDocumentHash: preview.sourceDocumentHash ?? undefined,
          },
      {
        onSuccess: () => {
          onOpenChange(false)
        },
        onError: (e) => {
          const apiErr = toMarkdownApiError(e)
          const details = apiErr.details as { latestSourceDocumentHash?: string } | undefined
          if (details?.latestSourceDocumentHash) {
            // stale 由独立警告块展示（§7.3）
            setError(null)
          } else {
            setError(apiErr.message || '导入失败')
          }
        },
      },
    )
  }, [preview, mode, content, targetDocumentId, confirmMutation, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导入 Markdown 文档</DialogTitle>
          <DialogDescription>
            先预览后确认：系统会检测标题、格式警告与来源状态，确认后才会写入文档。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Select
              value={mode}
              onValueChange={(v) => {
                setMode(v as 'create' | 'replace')
                setPreviewReset()
              }}
            >
              <SelectTrigger className="w-40" data-testid="md-import-mode">
                <SelectValue placeholder="导入方式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="create">新建文档</SelectItem>
                <SelectItem value="replace">替换已有文档</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              选择 .md 文件
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,text/markdown"
              className="hidden"
              onChange={(e) => {
                handleFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>

          {mode === 'create' ? (
            <p className="text-xs text-gray-500 dark:text-gray-400" data-testid="md-create-folder">
              将创建到当前文件夹{defaultParentId === null ? '（根目录）' : ''}
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <label className="text-sm">替换目标</label>
              <Select value={targetDocumentId} onValueChange={(v) => setTargetDocumentId(v)}>
                <SelectTrigger className="flex-1" data-testid="md-replace-target">
                  <SelectValue placeholder="选择要替换的文档" />
                </SelectTrigger>
                <SelectContent>
                  {replaceTargets.map((doc) => (
                    <SelectItem key={doc.id} value={String(doc.id)}>
                      {doc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="在此粘贴 Markdown 内容，或从文件读取…"
            rows={8}
            className="font-mono text-xs"
            data-testid="md-import-content"
          />

          {error && (
            <Alert variant="danger" data-testid="md-import-error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {staleBlocked && (
            <Alert variant="warning" data-testid="md-stale-block">
              <AlertDescription>{STALE_REVIEW_COPY}</AlertDescription>
            </Alert>
          )}

          {preview && (
            <div className="space-y-2 rounded border border-gray-200 p-3 text-sm dark:border-gray-700">
              <p data-testid="md-preview-title">
                推断标题：<span className="font-medium">{preview.inferredTitle ?? '（无）'}</span>
              </p>
              {preview.warnings.length > 0 ? (
                <ul className="space-y-1">
                  {preview.warnings.map((w, i) => (
                    <MarkdownWarningItem key={`${w.code}-${i}`} warning={w} />
                  ))}
                </ul>
              ) : (
                <p className="text-green-700 dark:text-green-400" data-testid="md-no-warnings">
                  未检测到格式警告
                </p>
              )}
              {preview.sourceDocumentHash && (
                <p
                  className="text-xs text-gray-500 dark:text-gray-400"
                  data-testid="md-source-hash"
                >
                  来源哈希：{preview.sourceDocumentHash}
                </p>
              )}
            </div>
          )}

          <label className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(v) => setConfirmed(v === true)}
              disabled={!preview}
              data-testid="md-confirm-checkbox"
            />
            <span>{IMPORT_CONFIRM_COPY}</span>
          </label>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={runPreview}
            disabled={content.trim().length === 0 || previewMutation.isPending || staleBlocked}
            data-testid="md-preview-button"
          >
            {previewMutation.isPending ? '预览中…' : staleBlocked ? '需重新预览' : '预览'}
          </Button>
          <Button
            type="button"
            onClick={confirm}
            disabled={!canConfirm || confirmMutation.isPending}
            data-testid="md-confirm-button"
          >
            {confirmMutation.isPending ? '导入中…' : '确认导入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  function setPreviewReset() {
    previewMutation.reset()
    setTargetDocumentId('')
    setConfirmed(false)
    setError(null)
  }
}

function MarkdownWarningItem({ warning }: { warning: MarkdownWarning }) {
  return (
    <li className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
      <span className="font-mono">{warning.code}</span>
      <span className="min-w-0 truncate">{warning.message}</span>
    </li>
  )
}
