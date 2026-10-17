'use client'

import * as React from 'react'
import {
  ChevronDown,
  Download,
  FileCode2,
  Image as ImageIcon,
  ImageDown,
  Loader2,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { toast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import {
  exportNodeToJpeg,
  exportNodeToPng,
  exportNodeToSvg,
  type ChartExportProgress,
} from '@/lib/next/chart-export'

/** 图表馆位图导出像素比（PNG / JPG）。 */
const EXPORT_PIXEL_RATIO = 3

const PROGRESS_STEPS: ReadonlyArray<{ phase: ChartExportProgress['phase']; label: string }> = [
  { phase: 'prepare', label: '展开完整画布' },
  { phase: 'render', label: '高清重新渲染' },
  { phase: 'done', label: '生成文件' },
]

const KIND_LABEL: Record<ChartExportKind, string> = {
  png: 'PNG 高清图',
  svg: 'SVG 矢量图',
  jpeg: 'JPG 兼容图',
}

/** 导出进度层：完整重渲染大图可能要数十秒，给出阶段、尺寸与分块进度（导出一开始即显示）。 */
function ExportProgressOverlay({
  kind,
  progress,
}: {
  kind: ChartExportKind
  progress: ChartExportProgress | null
}) {
  const phase = progress?.phase ?? 'prepare'
  const activeIndex = PROGRESS_STEPS.findIndex((step) => step.phase === phase)
  const size =
    progress?.width && progress.height
      ? `${Math.round(progress.width * (progress.pixelRatio ?? 1)).toLocaleString()} × ${Math.round(
          progress.height * (progress.pixelRatio ?? 1),
        ).toLocaleString()} 像素`
      : null
  const tiles =
    progress?.tileTotal && progress.tileTotal > 1
      ? `第 ${progress.tileIndex} / ${progress.tileTotal} 块（超出单张画布上限，按原清晰度分块）`
      : null
  return createPortal(
    <div
      data-next-track
      data-chart-export-progress
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-[var(--z-toast)] flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="w-80 rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-5 text-[var(--nx-text-primary)] shadow-2xl">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--nx-space-cyan)]" aria-hidden />
          正在导出{KIND_LABEL[kind]}
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--nx-bg-1)]">
          <div
            className="h-full rounded-full bg-[var(--nx-space-cyan)] transition-[width] duration-500 ease-out"
            style={{
              width: `${Math.max(12, ((activeIndex + (phase === 'done' ? 1 : 0.5)) / PROGRESS_STEPS.length) * 100)}%`,
            }}
          />
        </div>
        <ol className="mt-3 space-y-1.5 text-xs">
          {PROGRESS_STEPS.map((step, index) => (
            <li
              key={step.phase}
              data-export-step={step.phase}
              data-state={
                index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending'
              }
              className={cn(
                'flex items-center gap-2',
                index < activeIndex
                  ? 'text-[var(--nx-text-secondary)]'
                  : index === activeIndex
                    ? 'text-[var(--nx-text-primary)]'
                    : 'text-[var(--nx-text-muted)]',
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  index < activeIndex
                    ? 'bg-[var(--nx-status-success)]'
                    : index === activeIndex
                      ? 'animate-pulse bg-[var(--nx-space-cyan)]'
                      : 'bg-[var(--nx-border-hairline)]',
                )}
              />
              {step.label}
            </li>
          ))}
        </ol>
        {size || progress?.nodeCount || tiles ? (
          <p className="mt-3 space-y-0.5 text-[11px] text-[var(--nx-text-muted)]">
            {progress?.nodeCount ? (
              <span className="block">{progress.nodeCount} 个节点全部导出</span>
            ) : null}
            {size ? <span className="block">输出 {size}</span> : null}
            {tiles ? <span className="block">{tiles}</span> : null}
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

/**
 * 图表馆镜头统一「汇出」下拉菜单（v3-ui-next-chart-gallery W5 · tasks 5.1）。
 *
 * - 挂载点：`[chartId]` 页面将本组件注入 ChartLensToolbar 的 exportSlot
 *   （渲染于 `[data-chart-export-mount]`），7 项正式镜头共享；
 * - 捕获目标：优先显式 `targetRef`，缺省回退
 *   `[data-chart-viewport-slot]`（镜头统一视口容器，design §5）；
 * - 指令集：SVG 纯净矢量 / PNG 3x 超采样 / JPG 白底垫底 3 项标准导出，全部走
 *   统一客户端零网络引擎 `lib/next/chart-export`（RL-01：纯浏览器内存沙箱，
 *   文件名 `[项目名]-[图表名]-[YYYYMMDD]_[HHmmss].[ext]` 由引擎 buildExportFilename
 *   生成，viewType 由镜头注册表 exportViewLabel 提供）；
 * - 防抖与容错：导出期间触发器 `aria-busy="true"` + 旋转微动效并禁用，异常
 *   Toast「图表汇出失败，请稍后重试」，主镜头不崩溃（spec 容错）。
 */
export interface ChartExportMenuProps {
  /** 实体标识（项目名称）：规范文件名的首段；空值由引擎兜底「开项导出」。 */
  entityName?: string
  /** 视图描述段（注册表 exportViewLabel，如「鱼骨图因果分析」）。 */
  viewType?: string
  /** 显式捕获目标；缺省回退 [data-chart-viewport-slot]。 */
  targetRef?: React.RefObject<HTMLElement | null>
}

export type ChartExportKind = 'png' | 'svg' | 'jpeg'

/** 镜头视口统一捕获选择器（与 [chartId] 页面视口容器契约一致）。 */
export const CHART_VIEWPORT_SELECTOR = '[data-chart-viewport-slot]'

const EXPORT_COMMANDS: ReadonlyArray<{ kind: ChartExportKind; label: string }> = [
  { kind: 'svg', label: '导出矢量图 (SVG)' },
  { kind: 'png', label: '导出高清图 (PNG - 3x超清)' },
  { kind: 'jpeg', label: '导出兼容图 (JPG - 白底)' },
]

const kindIcon: Record<ChartExportKind, typeof Download> = {
  png: ImageIcon,
  svg: FileCode2,
  jpeg: ImageDown,
}

export function ChartExportMenu({ entityName, viewType, targetRef }: ChartExportMenuProps) {
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState<ChartExportKind | null>(null)
  const [progress, setProgress] = React.useState<ChartExportProgress | null>(null)
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  // 菜单关闭：点击菜单外区域或按 Escape。
  React.useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function resolveTarget(): HTMLElement | null {
    const direct = targetRef?.current
    if (direct instanceof HTMLElement) return direct
    return document.querySelector<HTMLElement>(CHART_VIEWPORT_SELECTOR)
  }

  async function runExport(kind: ChartExportKind) {
    if (busy !== null) return
    setOpen(false)
    const target = resolveTarget()
    if (target === null) {
      toast({ variant: 'error', title: '图表汇出失败，请稍后重试' })
      return
    }
    setBusy(kind)
    setProgress(null)
    try {
      // 完整重渲染：导出整张图（全部节点 / 滚动区外内容），与屏幕当前缩放和滚动位置无关
      // 图表馆统一 3 倍像素：放大打印 / 投屏也看得清；超出画布上限时按原像素比分块，不降采样
      const options = {
        entityName,
        viewType,
        pixelRatio: EXPORT_PIXEL_RATIO,
        fullContent: true,
        onProgress: setProgress,
      }
      if (kind === 'png') await exportNodeToPng(target, options)
      else if (kind === 'svg') await exportNodeToSvg(target, options)
      else await exportNodeToJpeg(target, options)
    } catch {
      toast({ variant: 'error', title: '图表汇出失败，请稍后重试' })
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  return (
    <div ref={rootRef} data-chart-export-menu className="relative">
      {busy !== null ? <ExportProgressOverlay kind={busy} progress={progress} /> : null}
      <button
        type="button"
        data-chart-export-trigger
        aria-label="汇出图表"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy !== null}
        disabled={busy !== null}
        onClick={() => setOpen((current) => !current)}
        className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy !== null ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Download className="h-3.5 w-3.5" aria-hidden />
        )}
        汇出
        <ChevronDown
          className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="汇出图表选项"
          data-chart-export-panel
          className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
        >
          {EXPORT_COMMANDS.map((command) => {
            const Icon = kindIcon[command.kind]
            return (
              <button
                key={command.kind}
                type="button"
                role="menuitem"
                data-chart-export-item
                data-export-kind={command.kind}
                disabled={busy !== null}
                onClick={() => void runExport(command.kind)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-0)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
                {command.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export default ChartExportMenu
