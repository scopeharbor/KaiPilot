'use client'

import * as React from 'react'
import {
  ChevronDown,
  Download,
  FileCode2,
  Image as ImageIcon,
  ImageDown,
  Loader2,
  Printer,
} from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import { exportNodeToJpeg, exportNodeToPng, exportNodeToSvg } from '@/lib/next/chart-export'

/**
 * 组织级报表多格式客户端汇出菜单（v3-ui-next-batch4-reports-change-queue W2 · tasks 2.5，
 * spec「纯客户端零网络多格式图表与报表汇出契约」）。
 *
 * - 100% 复用既有 `lib/next/chart-export.ts` 纯客户端引擎（RL-01 铁律：纯浏览器
 *   内存沙箱执行，skipFonts: true + cacheBust: false 杜绝网络抓取，断网可用）；
 * - 格式指令集：
 *   1. 矢量 SVG（exportNodeToSvg）：纯净矢量路径与清晰文字轮廓；
 *   2. 2x 超采样 PNG（exportNodeToPng，pixelRatio: 2）：视网膜高分屏无噪点；
 *   3. JPG 垫白打印模式（exportNodeToJpeg，强制 whiteBackdrop: true）：覆盖纯白
 *      底色（#ffffff）与高对比墨水字，发丝线保持中灰（WHITE_BACKDROP_TOKENS）；
 * - 垫白选项开关：支持显式勾选「垫白打印模式」，开启后各格式导出统一应用内联
 *   设计令牌覆盖；
 * - 捕获目标定位：优先消费宿主显式传入的 `targetRef`，缺省回退
 *   `[data-org-report-export-target]` 或 `[data-pmo-reports-lens]`；
 * - 防抖与容错：导出期间触发器 `aria-busy="true"`、旋转微动效并禁用；异常统一
 *   Toast「报表汇出失败，请稍后重试」，主界面不受影响。
 */

export type OrgReportExportKind = 'svg' | 'png' | 'jpeg'

export interface OrgReportExportMenuProps {
  /** 实体标识（组织名或组合名）：规范文件名的首段；缺省由引擎兜底「开项导出」 */
  entityName?: string
  /** 视图类型描述（规范文件名次段，如「PMO组合态势大盘」或「组织进度概览报表」） */
  viewType?: string
  /** 显式捕获目标 DOM 引用；缺省回退统一定位选择器 */
  targetRef?: React.RefObject<HTMLElement | null>
  /** 自定义触发器类名 */
  className?: string
  /** 默认开启垫白打印模式 */
  defaultWhiteBackdrop?: boolean
}

/** 组织报表统一捕获选择器 */
export const ORG_REPORT_EXPORT_SELECTORS = [
  '[data-org-report-export-target]',
  '[data-pmo-reports-lens]',
  '[data-chart-viewport-slot]',
] as const

const EXPORT_COMMANDS: ReadonlyArray<{
  kind: OrgReportExportKind
  label: string
  icon: typeof Download
  description: string
}> = [
  {
    kind: 'png',
    label: '导出高清图 (PNG - 2x超清)',
    icon: ImageIcon,
    description: '2x 超采样视网膜位图，适合演示文稿与高清屏幕',
  },
  {
    kind: 'svg',
    label: '导出矢量图 (SVG)',
    icon: FileCode2,
    description: '无限放大无损矢量格式，适合二次设计排版',
  },
  {
    kind: 'jpeg',
    label: '导出打印图 (JPG - 白底兼容)',
    icon: ImageDown,
    description: '默认垫白纸面底色，适合公文存档与通用图片查看器',
  },
]

export function OrgReportExportMenu({
  entityName,
  viewType = '组合态势报表',
  targetRef,
  className,
  defaultWhiteBackdrop = false,
}: OrgReportExportMenuProps) {
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState<OrgReportExportKind | null>(null)
  const [whiteBackdrop, setWhiteBackdrop] = React.useState(defaultWhiteBackdrop)
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  // 点击外部或按 Escape 关闭菜单
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
    if (targetRef?.current instanceof HTMLElement) {
      return targetRef.current
    }
    for (const selector of ORG_REPORT_EXPORT_SELECTORS) {
      const el = document.querySelector<HTMLElement>(selector)
      if (el instanceof HTMLElement) return el
    }
    return null
  }

  async function runExport(kind: OrgReportExportKind) {
    if (busy !== null) return
    setOpen(false)
    const target = resolveTarget()
    if (target === null) {
      toast({ variant: 'error', title: '报表汇出失败，请稍后重试' })
      return
    }

    setBusy(kind)
    try {
      // JPG 强制垫白，或用户显式勾选垫白打印
      const applyBackdrop = whiteBackdrop || kind === 'jpeg'
      const options = {
        entityName,
        viewType,
        whiteBackdrop: applyBackdrop,
      }

      if (kind === 'png') {
        await exportNodeToPng(target, { ...options, pixelRatio: 2 })
      } else if (kind === 'svg') {
        await exportNodeToSvg(target, options)
      } else {
        await exportNodeToJpeg(target, { ...options, backgroundColor: '#ffffff' })
      }
    } catch {
      toast({ variant: 'error', title: '报表汇出失败，请稍后重试' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      ref={rootRef}
      data-org-report-export-menu
      className={cn('relative inline-block', className)}
    >
      <button
        type="button"
        data-org-report-export-trigger
        aria-label="汇出报表"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy !== null}
        disabled={busy !== null}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy !== null ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--nx-accent)]" aria-hidden />
        ) : (
          <Download className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
        )}
        <span>{busy !== null ? '正在汇出...' : '汇出报表'}</span>
        <ChevronDown
          className={cn('h-3 w-3 opacity-60 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          data-org-report-export-dropdown
          aria-label="汇出格式选项"
          className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-1.5 shadow-xl"
        >
          <div className="border-b border-[var(--nx-border-hairline)] px-2.5 py-1.5">
            <p className="text-[11px] font-medium text-[var(--nx-text-primary)]">
              多格式客户端零网络汇出
            </p>
            <p className="text-[10px] text-[var(--nx-text-muted)]">
              本地内存沙箱渲染，断网可用，0 数据外发
            </p>
          </div>

          {/* 垫白打印模式切换项 */}
          <div className="flex items-center justify-between border-b border-[var(--nx-border-hairline)] px-2.5 py-2">
            <label
              htmlFor="org-export-white-backdrop"
              className="flex cursor-pointer items-center gap-2 text-xs text-[var(--nx-text-secondary)]"
            >
              <Printer className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
              <span>垫白打印模式 (高对比纯白)</span>
            </label>
            <input
              id="org-export-white-backdrop"
              type="checkbox"
              data-report-export-white-backdrop
              checked={whiteBackdrop}
              onChange={(e) => setWhiteBackdrop(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--nx-border-hairline)] text-[var(--nx-accent)] accent-[var(--nx-accent)] focus:ring-0 cursor-pointer"
            />
          </div>

          {/* 格式按钮列表 */}
          <div className="flex flex-col gap-0.5 py-1">
            {EXPORT_COMMANDS.map(({ kind, label, icon: Icon, description }) => (
              <button
                key={kind}
                type="button"
                role="menuitem"
                data-export-kind={kind}
                onClick={() => void runExport(kind)}
                className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-[var(--nx-bg-1)]"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-[var(--nx-text-primary)]">{label}</span>
                  <span className="text-[10px] leading-tight text-[var(--nx-text-muted)]">
                    {description}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
