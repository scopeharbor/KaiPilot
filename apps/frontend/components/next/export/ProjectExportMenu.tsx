'use client'

import * as React from 'react'
import {
  ChevronDown,
  Download,
  FileCode2,
  Image as ImageIcon,
  ImageDown,
  Loader2,
  Share2,
} from 'lucide-react'
import { useKanbanColumns } from '@/hooks/use-kanban'
import { toast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import { exportNodeToJpeg, exportNodeToPng, exportNodeToSvg } from '@/lib/next/chart-export'
import type { KanbanBoardData } from '@/lib/next/share-card-metrics'
import type { ProjectSpaceLensId } from '@/components/next/project-space/LensSwitcher'
import { ChartShareCardModal } from '@/components/next/export/ChartShareCardModal'
import { KanbanShareCardTemplate } from '@/components/next/export/KanbanShareCardTemplate'

/**
 * 项目空间工作面「汇出」下拉菜单（v3-ui-next-chart-export W2 / 接入点一；
 * v3-ui-next-remaining-lenses W5 5.4 全镜头适配）。
 *
 * - 镜头感知：消费宿主传入的 `activeLens`（受控通道）；缺省时于菜单开启瞬间从
 *   DOM 激活态切换器项解析当前镜头（再回落看板），据此映射规范中文视图名
 *   （`LENS_VIEW_TYPE_MAP`）驱动引擎生成
 *   `[项目名]-[镜头中文名]-[YYYYMMDD]_[HHmmss].[ext]` 规范文件名；
 * - 捕获目标：优先消费宿主传入的 `targetRef`，缺省回退按
 *   `[data-project-space-lens-slot]`（六镜头统一工作面容器）定位，再兼容
 *   `[data-project-space-board-slot]` / `[data-project-space-gantt-slot]` 旧选择器（design §7）；
 * - 指令集：全部镜头呈现 PNG 2x 超清 / SVG 矢量 / JPG 白底 3 项标准导出；
 *   「1200×630 看板分享卡」仅在看板镜头（`activeLens === 'kanban'`）下展示（spec 隔离）；
 * - 全部导出走统一引擎 `lib/next/chart-export`（W1 契约，纯客户端零网络请求，
 *   引擎已内置 skipFonts:true + cacheBust:false 与 JPG #ffffff 垫白）；
 * - 分享卡度量严格来自 TanStack Query 缓存中的权威看板列（RL-04：与看板首屏
 *   同查询键，缓存命中零重复请求），经 `KanbanShareCardTemplate` 装配进
 *   `ChartShareCardModal`（W1 契约：children 数据区模板）；
 * - 操作防抖：导出期间触发器 `aria-busy="true"`、旋转微动效并禁用，杜绝连击；
 *   异常统一 Toast「图表汇出失败，请稍后重试」且主工作面不受影响（spec 容错）。
 */

/** 镜头 → 规范中文视图名（汇出文件名 `[实体]-[视图名]-[时间戳]` 的中间段）。 */
export const LENS_VIEW_TYPE_MAP: Record<ProjectSpaceLensId, string> = {
  kanban: '看板工作面',
  gantt: '甘特图时间远眺',
  wbs: 'WBS结构俯瞰',
  list: '任务列表',
  calendar: '项目日历',
  timeline: '时间线流向',
}

export interface ProjectExportMenuProps {
  projectId: number
  /** 实体标识（项目名称）：用于规范文件名与分享卡标题。 */
  entityName?: string
  /** 显式捕获目标 DOM 引用；缺省回退当前镜头工作面容器。 */
  targetRef?: React.RefObject<HTMLElement | null>
  /** 当前激活镜头；缺省从 DOM（激活态切换器项）解析，再回落看板。 */
  activeLens?: ProjectSpaceLensId
}

export type ProjectExportKind = 'png' | 'svg' | 'jpeg'

const SHARE_CARD_COMMAND = { kind: 'share-card', label: '生成 1200×630 看板分享卡' } as const

const EXPORT_COMMANDS: ReadonlyArray<{
  kind: ProjectExportKind | 'share-card'
  label: string
  labelKanban: string
}> = [
  { kind: 'png', label: '导出快照 (PNG - 2x超清)', labelKanban: '导出看板快照 (PNG - 2x超清)' },
  { kind: 'svg', label: '导出矢量图 (SVG)', labelKanban: '导出看板矢量图 (SVG)' },
  { kind: 'jpeg', label: '导出兼容图 (JPG - 白底)', labelKanban: '导出兼容图 (JPG - 白底)' },
]

const kindIcon: Record<ProjectExportKind | 'share-card', typeof Download> = {
  png: ImageIcon,
  svg: FileCode2,
  jpeg: ImageDown,
  'share-card': Share2,
}

/** 镜头 id 白名单校验（DOM 解析结果仅接受合法镜头）。 */
function isLensId(value: string | null | undefined): value is ProjectSpaceLensId {
  return value !== null && value !== undefined && value in LENS_VIEW_TYPE_MAP
}

/** 从 DOM 解析当前激活镜头（激活态切换器项），无则回落看板。 */
function resolveLensFromDom(): ProjectSpaceLensId {
  if (typeof document === 'undefined') return 'kanban'
  const pressed = document.querySelector<HTMLElement>('[data-lens-option][aria-pressed="true"]')
  const pressedId = pressed?.getAttribute('data-lens-option')
  return isLensId(pressedId) ? pressedId : 'kanban'
}

export function ProjectExportMenu({
  projectId,
  entityName,
  targetRef,
  activeLens: activeLensProp,
}: ProjectExportMenuProps) {
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState<ProjectExportKind | null>(null)
  const [shareCardOpen, setShareCardOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  // DOM 镜头快照：仅当宿主未显式传 activeLens 时启用（菜单开启瞬间解析，
  // 保证与已提交的 LensSwitcher 激活态一致；显式 prop 走受控通道）。
  const [domLens, setDomLens] = React.useState<ProjectSpaceLensId | null>(null)

  /** 当前镜头：显式 prop 优先，其次开启瞬间的 DOM 解析快照，最后回落看板。 */
  const activeLens = activeLensProp ?? domLens ?? 'kanban'

  const refreshDomLens = React.useCallback(() => {
    if (activeLensProp !== undefined) return
    setDomLens(resolveLensFromDom())
  }, [activeLensProp])

  // RL-04：看板度量直接读取 TanStack Query 缓存中的权威任务列（与看板首屏同键，
  // 缓存命中即零额外请求；仅反映「当前已加载」的任务卡片，spec 要求 2.3）。
  const columnQueries = useKanbanColumns(
    projectId,
    { perPage: 25 },
    { pending: 1, in_progress: 1, completed: 1, other: 1 },
  )
  const kanbanTasks: KanbanBoardData = React.useMemo(
    () => ({
      pendingTasks: columnQueries[0]?.data?.data ?? [],
      inProgressTasks: columnQueries[1]?.data?.data ?? [],
      completedTasks: columnQueries[2]?.data?.data ?? [],
      otherTasks: columnQueries[3]?.data?.data ?? [],
    }),
    [
      columnQueries[0]?.data,
      columnQueries[1]?.data,
      columnQueries[2]?.data,
      columnQueries[3]?.data,
    ],
  )

  // 指令集随镜头派生：分享卡选项仅看板镜头展示（spec「格式选项与分享卡隔离」）；
  // 看板镜头沿用「导出看板快照」历史文案，其余镜头呈现标准 3 项指令。
  const visibleCommands = React.useMemo(
    () =>
      activeLens === 'kanban'
        ? [
            ...EXPORT_COMMANDS.map(({ kind, labelKanban }) => ({ kind, label: labelKanban })),
            SHARE_CARD_COMMAND,
          ]
        : EXPORT_COMMANDS.map(({ kind, label }) => ({ kind, label })),
    [activeLens],
  )

  const viewType = LENS_VIEW_TYPE_MAP[activeLens]

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
    // 优先统一镜头插槽（六镜头均标注），其次兼容看板 / 甘特专用插槽（design §7）。
    return (
      document.querySelector<HTMLElement>('[data-project-space-lens-slot]') ??
      document.querySelector<HTMLElement>('[data-project-space-board-slot]') ??
      document.querySelector<HTMLElement>('[data-project-space-gantt-slot]')
    )
  }

  async function runExport(kind: ProjectExportKind) {
    if (busy !== null) return
    refreshDomLens()
    setOpen(false)
    const target = resolveTarget()
    if (target === null) {
      toast({ variant: 'error', title: '图表汇出失败，请稍后重试' })
      return
    }
    setBusy(kind)
    try {
      const options = { entityName, viewType }
      if (kind === 'png') await exportNodeToPng(target, options)
      else if (kind === 'svg') await exportNodeToSvg(target, options)
      else await exportNodeToJpeg(target, options)
    } catch {
      toast({ variant: 'error', title: '图表汇出失败，请稍后重试' })
    } finally {
      setBusy(null)
    }
  }

  function openShareCard() {
    refreshDomLens()
    setOpen(false)
    setShareCardOpen(true)
  }

  function toggleOpen() {
    refreshDomLens()
    setOpen((current) => !current)
  }

  return (
    <div ref={rootRef} data-project-export-menu className="relative">
      <button
        type="button"
        data-project-export-trigger
        aria-label="汇出看板"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy !== null}
        disabled={busy !== null}
        onClick={toggleOpen}
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
          aria-label="汇出看板选项"
          data-project-export-panel
          className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
        >
          {visibleCommands.map((command) => {
            const Icon = kindIcon[command.kind]
            return (
              <button
                key={command.kind}
                type="button"
                role="menuitem"
                data-project-export-item
                data-export-kind={command.kind}
                disabled={busy !== null}
                onClick={() => {
                  if (command.kind === 'share-card') openShareCard()
                  else void runExport(command.kind)
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-0)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
                {command.label}
              </button>
            )
          })}
        </div>
      ) : null}

      <ChartShareCardModal
        open={shareCardOpen}
        onOpenChange={setShareCardOpen}
        title="看板分享卡"
        entityName={entityName ?? ''}
        viewType={viewType}
      >
        <KanbanShareCardTemplate boardData={kanbanTasks} />
      </ChartShareCardModal>
    </div>
  )
}

export default ProjectExportMenu
