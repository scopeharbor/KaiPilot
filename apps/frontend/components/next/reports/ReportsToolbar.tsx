'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, FileText } from 'lucide-react'

/**
 * 报表中心顶部工具条（v3-ui-next-reports-domain W1 · tasks 1.1）。
 *
 * - 左侧：「← 返回项目主空间」入口（直达 /next/projects/:id，无刷新平滑返回）
 *   与项目坐标回显（项目名称 + #PROJ-ID 编码 + 报表中心域标题）；
 * - 中部：预设报表 / AI 周期报表 / 版本审查 三区胶囊模式切换器（受控组件，
 *   状态与 URL ?tab= 同步由 ReportsWorkspaceContainer 负责）；
 * - 右侧：双轨汇出下拉插槽（data-reports-export-mount，W3 ReportExportDropdown
 *   经 exportSlot 注入；缺省不渲染汇出区）；
 * - 纯展示组件，零网络请求；数据属性供集成测试与汇出引擎定位。
 */

export type ReportsTabId = 'preset' | 'periodic' | 'versions'

/** 三大协同模式的静态白名单（design「报表中心三区模式架构」）。 */
export const REPORTS_TABS: ReadonlyArray<{ id: ReportsTabId; label: string; hint: string }> = [
  { id: 'preset', label: '预设报表', hint: '进度 / 延期 / 工作量 / 里程碑模板快照' },
  { id: 'periodic', label: 'AI 周期报表', hint: '周报 / 月报参数配置与异步生成作业' },
  { id: 'versions', label: '版本审查', hint: 'AI 草稿章节审阅与人工签署' },
]

/** URL ?tab= 白名单判定：非法/缺省回落 preset（由调用方决定）。 */
export function isReportsTabId(value: string | null): value is ReportsTabId {
  return value !== null && REPORTS_TABS.some((option) => option.id === value)
}

export interface ReportsToolbarProps {
  projectId: number
  projectName: string
  /** 项目编码；缺省回退 #PROJ-<id>。 */
  projectCode?: string | null
  activeTab: ReportsTabId
  onTabChange: (tab: ReportsTabId) => void
  /** 双轨汇出下拉插槽（W3 ReportExportDropdown 挂载点）。 */
  exportSlot?: ReactNode
}

export function ReportsToolbar({
  projectId,
  projectName,
  projectCode,
  activeTab,
  onTabChange,
  exportSlot,
}: ReportsToolbarProps) {
  return (
    <header
      data-reports-toolbar
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-2.5 md:px-4"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Link
          href={`/next/projects/${projectId}`}
          aria-label="返回项目主空间"
          data-reports-back-to-space
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        <FileText className="h-4 w-4 shrink-0 text-[var(--nx-accent)]" aria-hidden />
        <h2
          data-reports-toolbar-title
          className="shrink-0 text-sm font-semibold text-[var(--nx-text-primary)]"
        >
          报表中心
        </h2>
        <span
          data-reports-space-title
          className="hidden min-w-0 truncate text-xs text-[var(--nx-text-secondary)] sm:inline-block"
        >
          {projectName}
        </span>
        <span
          data-reports-space-code
          className="shrink-0 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
        >
          #{projectCode ?? `PROJ-${projectId}`}
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <div
          role="tablist"
          aria-label="报表中心工作模式"
          data-reports-tablist
          className="inline-flex items-center rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-0.5"
        >
          {REPORTS_TABS.map((option) => {
            const selected = option.id === activeTab
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                id={`reports-tab-${option.id}`}
                aria-controls={`reports-panel-${option.id}`}
                aria-selected={selected}
                title={option.hint}
                data-reports-tab-trigger={option.id}
                onClick={() => onTabChange(option.id)}
                className={[
                  'h-7 rounded-md px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] md:px-3',
                  selected
                    ? 'bg-[var(--nx-accent)] font-medium text-[var(--nx-workspace-bg)] shadow-sm'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
                ].join(' ')}
              >
                {option.label}
              </button>
            )
          })}
        </div>

        {/* W3 汇出插槽：双轨汇出下拉（服务端文档级 + 客户端零网络图片快照）。 */}
        <div data-reports-export-mount className="flex shrink-0 items-center">
          {exportSlot ?? null}
        </div>
      </div>
    </header>
  )
}

export default ReportsToolbar
