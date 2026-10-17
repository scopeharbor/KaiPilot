'use client'

import * as React from 'react'
import {
  ChevronDown,
  Download,
  FileCode2,
  FileDown,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  ImageDown,
  Loader2,
  Table,
} from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { downloadReportFile, exportReport } from '@/lib/api/reports'
import { v2PeriodicCreateExport, v2PeriodicDownloadExport } from '@/lib/api/reports-v2'
import {
  buildExportFilename,
  copyBlobToClipboard,
  downloadBlob,
  exportNodeToBlob,
  exportNodeToJpeg,
  exportNodeToSvg,
} from '@/lib/next/chart-export'

/**
 * 报表中心统一双轨汇出下拉菜单（v3-ui-next-reports-domain W3 · tasks 3.1-3.3）。
 *
 * 双轨清晰分组（spec「双轨汇出引擎整合与服务端/客户端边界界定」）：
 * - 「文档归档导出（服务端）」：PDF / Excel (XLSX) / Markdown / CSV。按目标实体
 *   分派既有后端端点：预设报表快照（V1，仅 markdown/csv）走 `exportReport` +
 *   `downloadReportFile`；AI 周期报表版本（V2，四格式齐备）走
 *   `v2PeriodicCreateExport` + `v2PeriodicDownloadExport`。二进制流经
 *   `apiRawFetch` 由两个 API 模块内部完成（严禁 apiFetchEnvelope 解析 JSON 破坏流），
 *   文件名以响应头 Content-Disposition 为权威，缺省回落规范文件名；
 * - 「即时图表快照（客户端）」：SVG 矢量 / 2x 超采样 PNG / 白底 JPG。复用统一客户端
 *   汇出引擎 `lib/next/chart-export`（skipFonts: true + cacheBust: false + 系统中文字体栈），
 *   100% 本地内存沙箱零网络请求（RL-01）；PNG 优先写入剪贴板，环境不支持时平滑
 *   降级本地下载并 Toast 提示；JPG 强制 `whiteBackdrop: true` 垫白高对比度打印；
 *
 * RBAC 阶梯（RL-15）：`report:export` 缺失 → 触发器整体禁用；`report:download`
 * 缺失 → 服务端组各条目禁用（客户端组仅需 export）。操作防抖：执行期触发器与
 * 条目全部禁用（aria-busy）杜绝连击；异常统一 Toast 且不影响报表工作面。
 *
 * 装配契约（供 W1 ReportsToolbar / W2 版本审阅面板消费）：
 * - `target`：服务端导出目标（preset-report 快照 / periodic-version 版本）；
 * - 客户端捕获目标：优先 `targetRef`，缺省回退 DOM 首个
 *   `[data-report-export-target]`——快照卡与审阅章节容器须标注该属性。
 */

export type ReportExportServerTarget =
  { kind: 'preset-report'; reportId: number } | { kind: 'periodic-version'; versionId: number }

export type ReportServerExportFormat = 'pdf' | 'xlsx' | 'markdown' | 'csv'
export type ReportClientExportFormat = 'svg' | 'png' | 'jpeg'

export type ReportExportBusyFormat = ReportServerExportFormat | ReportClientExportFormat

/** 服务端导出格式行元数据（格式 → 中文标签 / 文件扩展名）。 */
export const SERVER_EXPORT_FORMATS: readonly {
  format: ReportServerExportFormat
  label: string
  ext: string
}[] = [
  { format: 'pdf', label: 'PDF 文档', ext: 'pdf' },
  { format: 'xlsx', label: 'Excel 电子表格 (XLSX)', ext: 'xlsx' },
  { format: 'markdown', label: 'Markdown 纯文本', ext: 'md' },
  { format: 'csv', label: 'CSV 数据表', ext: 'csv' },
]

/** V1 预设快照后端仅支持 markdown / csv（V2 周期版本四格式齐备）。 */
const PRESET_SUPPORTED_FORMATS: ReadonlySet<ReportServerExportFormat> = new Set(['markdown', 'csv'])

export const REPORT_EXPORT_VIEW_TYPE_FALLBACK = '报表视图'

export interface ReportExportDropdownProps {
  projectId: number
  /** 服务端导出目标（预设快照 / 周期版本）；缺省时服务端分组呈现引导占位。 */
  target?: ReportExportServerTarget | null
  /** 导出文件名实体标识（项目名称或报表标题）。 */
  entityName?: string
  /** 客户端汇出视图中文名（规范文件名中段），缺省「报表视图」。 */
  viewType?: string
  /** 显式捕获目标；缺省回退 DOM 首个 [data-report-export-target]。 */
  targetRef?: React.RefObject<HTMLElement | null>
  /** 周期版本草稿导出放行（后端要求 draftOverride 时置 true）。 */
  draftOverride?: boolean
  /** 宿主级禁用（如数据未就绪）。 */
  disabled?: boolean
}

/** 客户端捕获目标解析：显式 ref 优先，其次 DOM 首个汇出目标标注。 */
function resolveCaptureTarget(
  targetRef: React.RefObject<HTMLElement | null> | undefined,
): HTMLElement | null {
  const direct = targetRef?.current
  if (direct instanceof HTMLElement) return direct
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLElement>('[data-report-export-target]')
}

/** 从 Content-Disposition 解析权威文件名（filename*=UTF-8 或 filename= 两种形态）。 */
function parseDispositionFilename(disposition: string | null): string | null {
  if (!disposition) return null
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  const plain = /filename="?([^";]+)"?/i.exec(disposition)
  const raw = extended?.[1] ?? plain?.[1]
  if (!raw) return null
  try {
    return decodeURIComponent(raw.trim())
  } catch {
    return raw.trim()
  }
}

/** 从 v2PeriodicCreateExport 信封中提取 exportId（结构不符绝不臆测）。 */
function extractCreatedExportId(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null
  const data = (payload as { data?: { exportId?: unknown } }).data
  const exportId = data?.exportId
  return typeof exportId === 'number' && Number.isInteger(exportId) && exportId > 0
    ? exportId
    : null
}

export function ReportExportDropdown({
  projectId,
  target = null,
  entityName,
  viewType,
  targetRef,
  draftOverride = false,
  disabled = false,
}: ReportExportDropdownProps) {
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState<ReportExportBusyFormat | null>(null)
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  const canExport = useAuthStore((state) => state.hasPermission('report:export'))
  const canDownload = useAuthStore((state) => state.hasPermission('report:download'))
  const exportViewType = viewType ?? REPORT_EXPORT_VIEW_TYPE_FALLBACK

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

  // ---------------------------------------------------------------------------
  // 服务端文档导出（RL-01：服务端生成 → apiRawFetch 二进制流 → 本地下载调度）
  // ---------------------------------------------------------------------------

  async function runServerExport(format: ReportServerExportFormat) {
    if (busy !== null || !target) return
    setOpen(false)
    setBusy(format)
    try {
      if (target.kind === 'preset-report') {
        // V1 预设快照端点仅支持 markdown/csv；pdf/xlsx 属 V2 周期版本导出能力
        if (format !== 'markdown' && format !== 'csv') {
          toast({
            variant: 'error',
            title: '该格式仅周期报表版本支持',
            description: '请切换到版本审阅后导出',
          })
          return
        }
        await exportReport(target.reportId, { format })
        const { blob, filename } = await downloadReportFile(target.reportId, format)
        downloadBlob(blob, filename)
      } else {
        const created = await v2PeriodicCreateExport(projectId, target.versionId, {
          format,
          draftOverride,
        })
        const exportId = extractCreatedExportId(created)
        if (exportId === null) {
          throw new Error('导出任务响应缺少 exportId')
        }
        const response = await v2PeriodicDownloadExport(projectId, exportId)
        if (!response.ok) {
          throw new Error(`下载失败（HTTP ${response.status}）`)
        }
        const blob = await response.blob()
        const dispositionName = parseDispositionFilename(
          response.headers.get('Content-Disposition'),
        )
        const ext = SERVER_EXPORT_FORMATS.find((row) => row.format === format)?.ext ?? format
        const filename = dispositionName ?? buildExportFilename(entityName, exportViewType, ext)
        downloadBlob(blob, filename)
      }
    } catch {
      toast({ variant: 'error', title: '服务端导出失败，请稍后重试' })
    } finally {
      setBusy(null)
    }
  }

  // ---------------------------------------------------------------------------
  // 客户端即时图表汇出（RL-01 零网络铁律：skipFonts/cacheBust 由引擎内置）
  // ---------------------------------------------------------------------------

  async function runClientExport(format: ReportClientExportFormat) {
    if (busy !== null) return
    setOpen(false)
    const node = resolveCaptureTarget(targetRef)
    if (node === null) {
      toast({ variant: 'error', title: '未找到可汇出的报表区域，请稍后重试' })
      return
    }
    setBusy(format)
    try {
      if (format === 'svg') {
        await exportNodeToSvg(node, { entityName, viewType: exportViewType })
      } else if (format === 'png') {
        const blob = await exportNodeToBlob(node, 'png', { entityName, viewType: exportViewType })
        const fallbackName = buildExportFilename(entityName, exportViewType, 'png')
        await copyBlobToClipboard(blob, fallbackName)
      } else {
        await exportNodeToJpeg(node, {
          entityName,
          viewType: exportViewType,
          whiteBackdrop: true,
        })
      }
    } catch {
      toast({ variant: 'error', title: '图表汇出失败，请稍后重试' })
    } finally {
      setBusy(null)
    }
  }

  const itemDisabled = busy !== null || disabled

  return (
    <div ref={rootRef} data-report-export-menu className="relative">
      <button
        type="button"
        data-report-export-trigger
        aria-label="汇出报表"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy !== null}
        disabled={itemDisabled || !canExport}
        title={!canExport ? '缺少 report:export 权限，请联系管理员开通' : undefined}
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
          aria-label="报表汇出选项"
          data-report-export-panel
          className="absolute right-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
        >
          {/* 服务端文档归档组 */}
          <p
            data-report-export-group-caption
            data-export-group="server"
            className="px-3 pb-1 pt-2 text-[10px] font-medium tracking-wider text-[var(--nx-text-muted)]"
          >
            文档归档导出（服务端）
          </p>
          <p className="px-3 pb-1 text-[10px] leading-3 text-[var(--nx-text-muted)]">
            后端生成全量文档，下载完整分页排版
          </p>
          {target === null ? (
            <div
              data-report-export-placeholder
              className="px-3 py-2 text-xs text-[var(--nx-text-muted)]"
            >
              请先在视图中选定报表或版本
            </div>
          ) : (
            SERVER_EXPORT_FORMATS.map((row) => {
              const Icon = SERVER_GROUP_ICONS[row.format]
              const presetSupported =
                target.kind === 'periodic-version' || PRESET_SUPPORTED_FORMATS.has(row.format)
              const locked = !canExport || !canDownload || !presetSupported
              const lockTitle = !canDownload
                ? '缺少 report:download 权限，请联系管理员开通'
                : !presetSupported
                  ? '当前报表仅支持 Markdown / CSV，请切换到周期报表版本导出'
                  : undefined
              return (
                <button
                  key={row.format}
                  type="button"
                  role="menuitem"
                  data-report-export-item
                  data-export-group="server"
                  data-export-format={row.format}
                  disabled={itemDisabled || locked}
                  title={lockTitle}
                  onClick={() => void runServerExport(row.format)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-0)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
                  {row.label}
                  <span className="ml-auto font-mono text-[10px] uppercase text-[var(--nx-text-muted)]">
                    {row.ext}
                  </span>
                </button>
              )
            })
          )}

          <div className="my-1 border-t border-[var(--nx-border-hairline)]" />

          {/* 客户端即时图表快照组 */}
          <p
            data-report-export-group-caption
            data-export-group="client"
            className="px-3 pb-1 pt-2 text-[10px] font-medium tracking-wider text-[var(--nx-text-muted)]"
          >
            即时图表快照（客户端）
          </p>
          <p className="px-3 pb-1 text-[10px] leading-3 text-[var(--nx-text-muted)]">
            纯客户端本地生成，断网可用，零数据外发
          </p>
          {CLIENT_EXPORT_FORMATS.map((row) => {
            const Icon = CLIENT_GROUP_ICONS[row.format]
            return (
              <button
                key={row.format}
                type="button"
                role="menuitem"
                data-report-export-item
                data-export-group="client"
                data-export-format={row.format}
                disabled={itemDisabled || !canExport}
                onClick={() => void runClientExport(row.format)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-0)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
                {row.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

const CLIENT_EXPORT_FORMATS: readonly { format: ReportClientExportFormat; label: string }[] = [
  { format: 'svg', label: 'SVG 矢量图' },
  { format: 'png', label: 'PNG 2x 分享图（复制 / 降级下载）' },
  { format: 'jpeg', label: 'JPG 白底打印图' },
]

const SERVER_GROUP_ICONS = {
  pdf: FileDown,
  xlsx: FileSpreadsheet,
  markdown: FileText,
  csv: Table,
} as const

const CLIENT_GROUP_ICONS = {
  svg: FileCode2,
  png: ImageIcon,
  jpeg: ImageDown,
} as const

export default ReportExportDropdown
