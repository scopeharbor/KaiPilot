'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMarkdownExportSingle, useMarkdownExportTree } from '@/hooks/use-document-markdown'
import { Button } from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/Dialog'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import {
  copyExportContent,
  downloadSingleExport,
  downloadTreeExport,
  toMarkdownApiError,
} from '@/lib/markdown-export-helpers'

/** 导出状态文案：只提供下载/复制，不涉及任何写入（§7.6）。 */
export const EXPORT_READONLY_COPY = '导出为只读操作：内容来自文档当前版本，不会修改任何项目数据。'

export interface MarkdownExportDialogProps {
  projectId: number
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'single' | 'tree'
  /** single 模式的目标文档 id。 */
  documentId?: number
  /** tree 模式的选中节点 id（含子文件夹；由调用方按当前视图计算）。 */
  treeIds?: number[]
  /** tree 模式的选中范围说明（如「当前文件夹」）。 */
  treeLabel?: string
}

/** 导出结果对话框：单文档或选中树 bundle，含下载/复制与错误状态（§7.4）。 */
export function MarkdownExportDialog({
  projectId,
  open,
  onOpenChange,
  mode,
  documentId,
  treeIds,
  treeLabel,
}: MarkdownExportDialogProps) {
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const singleMutation = useMarkdownExportSingle(projectId)
  const treeMutation = useMarkdownExportTree(projectId)

  const isPending = singleMutation.isPending || treeMutation.isPending
  const result = mode === 'single' ? singleMutation.data : treeMutation.data

  useEffect(() => {
    if (!open) {
      setError(null)
      setCopied(false)
      singleMutation.reset()
      treeMutation.reset()
      return
    }
    setError(null)
    setCopied(false)
    const onError = (e: unknown) => {
      const apiErr = toMarkdownApiError(e)
      setError(apiErr.message || (apiErr.code === 'PERMISSION_DENIED' ? '无权导出' : '导出失败'))
    }
    if (mode === 'single' && documentId !== undefined) {
      singleMutation.mutate({ documentId }, { onError })
    } else if (mode === 'tree' && treeIds && treeIds.length > 0) {
      treeMutation.mutate({ selectedIds: treeIds }, { onError })
    }
    // 依赖表刻意不含两个 mutation：它们每次渲染都是新引用，纳入会造成重复请求。
    // 注：本仓库未装 eslint-plugin-react-hooks，写 eslint-disable 反而会因规则不存在而报错。
  }, [open, mode, documentId, treeIds])

  const summary = useMemo(() => {
    if (!result || mode !== 'tree' || !('manifest' in result)) return null
    const m = result.manifest
    return `导出 ${m.exportedCount} 个文档${m.skippedCount ? `，跳过 ${m.skippedCount} 个` : ''}${m.deniedCount ? `，拒绝 ${m.deniedCount} 个` : ''}`
  }, [result, mode])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'single'
              ? '导出文档（Markdown）'
              : `导出选中树${treeLabel ? `（${treeLabel}）` : ''}`}
          </DialogTitle>
          <DialogDescription>{EXPORT_READONLY_COPY}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {isPending && <p className="text-gray-500 dark:text-gray-400">正在生成导出内容…</p>}

          {error && (
            <Alert variant="danger" data-testid="md-export-error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result && !error && (
            <div className="space-y-2 rounded border border-gray-200 p-3 dark:border-gray-700">
              <p className="truncate" data-testid="md-export-filename">
                <span className="text-gray-500 dark:text-gray-400">文件名：</span>
                <span className="font-medium">{result.filename}</span>
              </p>
              <p>
                <span className="text-gray-500 dark:text-gray-400">大小：</span>
                {(result.byteCount ?? 0).toLocaleString('zh-CN')} 字节
              </p>
              {summary && <p data-testid="md-export-manifest">{summary}</p>}
              <p
                className="font-mono text-xs text-gray-500 dark:text-gray-400"
                data-testid="md-export-hash"
              >
                {/* 单文档导出给 contentHash，树导出给 bundleHash，二者互斥，需按 in 判别 */}
                {'bundleHash' in result ? result.bundleHash : result.contentHash}
              </p>
            </div>
          )}

          {copied && (
            <p
              className="text-xs text-green-700 dark:text-green-400"
              data-testid="md-export-copied"
            >
              已复制到剪贴板
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          {result && !error && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={async () => {
                  if (mode === 'single') {
                    await copyExportContent(singleMutation.data!.content)
                  } else {
                    await copyExportContent(treeMutation.data!.content)
                  }
                  setCopied(true)
                }}
                data-testid="md-export-copy"
              >
                复制内容
              </Button>
              <Button
                type="button"
                disabled={isPending}
                onClick={() => {
                  if (mode === 'single') {
                    downloadSingleExport(singleMutation.data!)
                  } else {
                    downloadTreeExport(treeMutation.data!)
                  }
                }}
                data-testid="md-export-download"
              >
                下载
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
