'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import {
  buildExportFilename,
  copyBlobToClipboard,
  exportNodeToBlob,
  exportNodeToJpeg,
  exportNodeToPng,
  type ChartExportOptions,
} from '@/lib/next/chart-export'
import { ShareCardCanvas } from './ShareCardCanvas'

/** 预览等比缩放系数：1200×630 → 384×201.6（保持 1.91:1）。 */
const PREVIEW_SCALE = 0.32

/** 模态内自包含旋转微动效（不依赖审查工作面的 nx-review-spin 注入）。 */
const NX_EXPORT_CSS = `
.nx-export-spin {
  animation: nx-export-spin 0.9s linear infinite;
}
@keyframes nx-export-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .nx-export-spin {
    animation: none !important;
  }
}
`

export interface ChartShareCardModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 弹窗标题（如 看板分享卡 / 反幻觉自检报告卡）。 */
  title: string
  /** 实体标识（项目全称或草案编号），Header 主标与导出文件名共用。 */
  entityName: string
  /** 视图类型胶囊徽章（如 看板工作面 / 反幻觉自检报告）。 */
  viewType: string
  /** 文件名「视图类型」段（缺省 '分享卡'）。 */
  filenameViewType?: string
  /** 1200×630 卡片数据区模板（KanbanShareCardTemplate / ValidationReportShareCardTemplate）。 */
  children: ReactNode
}

type ExportAction = 'png' | 'jpeg' | 'copy'

const sharedButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid var(--nx-border-hairline)',
  backgroundColor: 'var(--nx-bg-1)',
  color: 'var(--nx-text-primary)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
}

/**
 * 分享卡预览与导出模态框（design §5 交互 / spec §1200×630 分享卡模板 §3）。
 *
 * - 居中预览：1200×630 卡片按 0.32 等比缩放呈现（真实节点满尺寸挂载供截屏）；
 * - 三动作：下载 PNG / 下载 JPG（白底垫底）/ 复制到剪贴板（引擎内平滑降级）；
 * - 操作在途：按钮 `aria-busy` + 禁止连点，导出异常 Toast 化且主界面不崩溃；
 * - 关闭：Esc / 关闭按钮 / 遮罩点击，卸载即销毁预览节点。
 * - 纯客户端零网络：卡片节点经引擎内存沙箱序列化，无任何外发请求（RL-01）。
 */
export function ChartShareCardModal({
  open,
  onOpenChange,
  title,
  entityName,
  viewType,
  filenameViewType = '分享卡',
  children,
}: ChartShareCardModalProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState<ExportAction | null>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])

  if (!open) return null

  async function run(action: ExportAction) {
    if (busy !== null || !cardRef.current) return
    setBusy(action)
    try {
      const exportOptions: ChartExportOptions = { entityName, viewType: filenameViewType }
      if (action === 'png') {
        await exportNodeToPng(cardRef.current, exportOptions)
      } else if (action === 'jpeg') {
        await exportNodeToJpeg(cardRef.current, exportOptions)
      } else {
        const blob = await exportNodeToBlob(cardRef.current, 'png', exportOptions)
        await copyBlobToClipboard(blob, buildExportFilename(entityName, filenameViewType, 'png'))
      }
    } catch {
      toast({ variant: 'error', title: '图表汇出失败，请稍后重试' })
    } finally {
      setBusy(null)
    }
  }

  const actionButtons: Array<{ action: ExportAction; label: string }> = [
    { action: 'png', label: '下载分享卡 (PNG)' },
    { action: 'jpeg', label: '下载兼容图 (JPG)' },
    { action: 'copy', label: '复制卡片到剪贴板' },
  ]

  return (
    <div
      data-chart-share-modal
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false)
      }}
    >
      <style data-nx-export-css>{NX_EXPORT_CSS}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: '100%',
          maxWidth: 760,
          borderRadius: 12,
          border: '1px solid var(--nx-border-focus)',
          backgroundColor: 'var(--nx-workspace-surface)',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '14px 18px',
            borderBottom: '1px solid var(--nx-border-hairline)',
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--nx-text-primary)',
            }}
          >
            {title}
          </h2>
          <span
            style={{
              marginLeft: 'auto',
              color: 'var(--nx-text-muted)',
              fontSize: 10,
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            1200 × 630 · 1.91:1
          </span>
          <button
            type="button"
            data-share-card-modal-close
            aria-label="关闭"
            onClick={() => onOpenChange(false)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 6,
              border: '1px solid var(--nx-border-hairline)',
              backgroundColor: 'transparent',
              color: 'var(--nx-text-secondary)',
              cursor: 'pointer',
            }}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div style={{ padding: '18px 18px 14px' }}>
          <div
            data-share-card-preview
            style={{
              width: 1200 * PREVIEW_SCALE,
              height: 630 * PREVIEW_SCALE,
              margin: '0 auto',
              overflow: 'hidden',
              borderRadius: 8,
              border: '1px solid var(--nx-border-hairline)',
            }}
          >
            <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
              <div ref={cardRef} style={{ width: 1200, height: 630 }}>
                <ShareCardCanvas entityName={entityName} viewType={viewType}>
                  {children}
                </ShareCardCanvas>
              </div>
            </div>
          </div>
        </div>

        <footer
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 10,
            padding: '12px 18px 18px',
          }}
        >
          {actionButtons.map(({ action, label }) => {
            const isBusy = busy === action
            return (
              <button
                key={action}
                type="button"
                data-export-action={action}
                aria-busy={isBusy}
                disabled={busy !== null}
                onClick={() => void run(action)}
                style={sharedButtonStyle}
              >
                {isBusy ? <Loader2 className="nx-export-spin h-3.5 w-3.5" aria-hidden /> : null}
                {label}
              </button>
            )
          })}
        </footer>
      </div>
    </div>
  )
}

export default ChartShareCardModal
