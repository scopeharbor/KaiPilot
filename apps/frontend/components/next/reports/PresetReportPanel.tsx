'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type {
  CreateReportRequest,
  Report,
  ReportGenerateFilters,
  ReportTemplate,
} from '@aiproj/types'
import { REPORT_TEMPLATES } from '@aiproj/types'
import { useCreateReport, useReportDetail, useReportList } from '@/hooks/use-reports'
import { usePermissions } from '@/hooks/use-permissions'
import { useMotionPreference } from '@/hooks/use-motion-preference'
import { resolveScrollBehavior } from '@/lib/next/motion/scroll-behavior'
import { ReportSnapshotView } from './ReportSnapshotView'

/**
 * 模式 1：预设报表主面板（v3-ui-next-reports-domain W1 · tasks 1.3）。
 *
 * 双栏自适应架构：
 * - 左栏：4 类白名单模板单选卡组（progress/delay/workload/milestone）→
 *   参数过滤表单（标题/日期跨度/输出选项）→ 已生成报表历史底册（useReportList）；
 * - 右栏：选定报表经 useReportDetail 拉取后由 ReportSnapshotView 承载渲染，
 *   支持「重新生成」（带入原过滤参数，须 report:create 权限）。
 *
 * 权限与红线：
 * - report:create 缺失 → 生成表单只读态 + 主按钮置灰（design 权限矩阵），
 *   历史浏览与快照阅读照常（report:view 通道）；
 * - 生成请求仅由用户显式点击触发（RL-01：AI/系统绝不代签）；提交成功后
 *   useCreateReport 失效列表缓存即时刷新历史，并自动选中新建条目；
 * - 加载/空态/错误三态齐全：骨架屏、空态引导、错误卡 + 重新加载。
 */

const TEMPLATE_LABELS: Record<ReportTemplate, { name: string; hint: string }> = {
  progress: { name: '项目进度', hint: '任务状态分布 · 完成率 · WBS 汇总' },
  delay: { name: '延期分析', hint: '逾期任务 · 即将到期 · 依赖告警' },
  workload: { name: '资源工作量', hint: '按负责人聚合工时 · 过载清单' },
  milestone: { name: '里程碑达成', hint: '关键节点达成度 · 偏差与风险' },
}

const HISTORY_TEMPLATE_LABELS: Record<ReportTemplate, string> = {
  progress: '进度',
  delay: '延期',
  workload: '工作量',
  milestone: '里程碑',
}

export interface PresetReportPanelProps {
  projectId: number
  /**
   * 外部指定选中快照（W4 容器跨模式保留 / 汇出目标追踪）；外部非空值优先于
   * 内部选中并即时覆盖（与 ReportVersionReviewPanel 的 selectedVersionId 同构）。
   */
  selectedReportId?: number | null
  /** 选中快照变化回调（供容器追踪汇出目标与 URL 状态）。 */
  onSelectedReportChange?: (reportId: number | null) => void
}

export function PresetReportPanel({
  projectId,
  selectedReportId,
  onSelectedReportChange,
}: PresetReportPanelProps) {
  const { can } = usePermissions()
  const canCreate = can('report:create')
  const reducedMotion = useMotionPreference()

  // 模板选择 + 生成参数（与旧轨等价的能力面：标题 + 日期跨度 + 输出选项）
  const [template, setTemplate] = useState<ReportTemplate>('progress')
  const [title, setTitle] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [includeDetails, setIncludeDetails] = useState(true)
  const [includeWarnings, setIncludeWarnings] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)

  // 当前预览的快照：外部指定优先（容器跨模式保留），内部变更即时上报
  const [internalReportId, setInternalReportId] = useState<number | null>(selectedReportId ?? null)
  const selectedReportIdInternal = selectedReportId != null ? selectedReportId : internalReportId

  useEffect(() => {
    if (selectedReportId != null && selectedReportId !== internalReportId) {
      setInternalReportId(selectedReportId)
    }
  }, [selectedReportId, internalReportId])

  /** 统一选中入口：更新内部态并上报容器（汇出目标 / 跨模式保留）。 */
  function selectReport(reportId: number | null) {
    setInternalReportId(reportId)
    if (reportId !== selectedReportId) onSelectedReportChange?.(reportId)
  }

  const listQuery = useReportList(projectId, { perPage: 20 })
  const detailQuery = useReportDetail(selectedReportIdInternal)
  const createMutation = useCreateReport(projectId)

  const reports = useMemo<Report[]>(() => listQuery.data?.data ?? [], [listQuery.data])

  /** 提交生成：校验 → POST → 成功即选中新建快照（列表由 hook 失效自动刷新）。 */
  async function handleGenerate(payload: CreateReportRequest) {
    setFormError(null)
    if (!canCreate) return
    try {
      const res = await createMutation.mutateAsync(payload)
      selectReport(res.data.id)
    } catch {
      // 错误详情经 createMutation.isError 就近呈现
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (fromDate && toDate && fromDate > toDate) {
      setFormError('起始日期不能晚于结束日期')
      return
    }
    const filters: ReportGenerateFilters = {}
    if (fromDate) filters.fromDate = fromDate
    if (toDate) filters.toDate = toDate
    void handleGenerate({
      template,
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
      formatConfig: { includeDetails, includeWarnings, locale: 'zh-CN' },
    })
  }

  function handleRegenerate(activeReport: Report) {
    void handleGenerate({
      template: activeReport.template,
      title: activeReport.title ? `${activeReport.title}（重新生成）` : undefined,
      filters: activeReport.config,
      formatConfig: activeReport.formatConfig ?? undefined,
    })
  }

  const activeReport = detailQuery.data?.data ?? null
  const filtersDisabled = !canCreate || createMutation.isPending
  const submitting = createMutation.isPending

  return (
    <div
      data-preset-report-panel
      className="grid items-start gap-4 xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)]"
    >
      {/* ------------------------------------------------- 左栏：配置与历史 */}
      <aside className="flex min-w-0 flex-col gap-4">
        {/* 模板白名单单选卡组 */}
        <section
          data-report-template-section
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
        >
          <h3 className="text-[13px] font-medium text-[var(--nx-text-primary)]">选择预设模板</h3>
          <div
            role="radiogroup"
            aria-label="报表模板"
            data-report-template-list
            className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            {REPORT_TEMPLATES.map((tpl) => {
              const active = tpl === template
              const label = TEMPLATE_LABELS[tpl]
              return (
                <button
                  key={tpl}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-report-template={tpl}
                  onClick={() => setTemplate(tpl)}
                  className={[
                    'rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                    active
                      ? 'border-[var(--nx-accent)] bg-[var(--nx-bg-1)]'
                      : 'border-[var(--nx-border-hairline)] hover:border-[var(--nx-border-focus)]',
                  ].join(' ')}
                >
                  <div className="text-xs font-medium text-[var(--nx-text-primary)]">
                    {label.name}
                  </div>
                  <div className="mt-0.5 text-[10px] leading-snug text-[var(--nx-text-muted)]">
                    {label.hint}
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        {/* 参数过滤 + 生成 */}
        <section
          data-report-generate-section
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[13px] font-medium text-[var(--nx-text-primary)]">生成报表</h3>
            {!canCreate && (
              <span
                data-reports-readonly-note
                className="rounded border border-[var(--nx-status-warning)] px-1.5 py-0.5 text-[10px] text-[var(--nx-status-warning)]"
                title="缺少 report:create 权限"
              >
                只读 · 缺少 report:create 权限
              </span>
            )}
          </div>
          <form onSubmit={handleSubmit} className="mt-3 space-y-3" aria-label="生成报表参数">
            <div className="space-y-1">
              <label
                htmlFor="report-filter-title"
                className="block text-xs text-[var(--nx-text-secondary)]"
              >
                报表标题（可选）
              </label>
              <input
                id="report-filter-title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="留空自动命名"
                maxLength={255}
                disabled={filtersDisabled}
                className="h-8 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label
                  htmlFor="report-filter-from"
                  className="block text-xs text-[var(--nx-text-secondary)]"
                >
                  起始日期
                </label>
                <input
                  id="report-filter-from"
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  disabled={filtersDisabled}
                  className="h-8 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="report-filter-to"
                  className="block text-xs text-[var(--nx-text-secondary)]"
                >
                  结束日期
                </label>
                <input
                  id="report-filter-to"
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  disabled={filtersDisabled}
                  className="h-8 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--nx-text-secondary)]">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={includeDetails}
                  onChange={(event) => setIncludeDetails(event.target.checked)}
                  disabled={filtersDisabled}
                  className="h-3.5 w-3.5 accent-[var(--nx-accent)]"
                />
                包含明细分节
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={includeWarnings}
                  onChange={(event) => setIncludeWarnings(event.target.checked)}
                  disabled={filtersDisabled}
                  className="h-3.5 w-3.5 accent-[var(--nx-accent)]"
                />
                包含数据边界提示
              </label>
            </div>

            {formError && (
              <p
                role="alert"
                data-report-form-error
                className="text-xs text-[var(--nx-status-danger)]"
              >
                {formError}
              </p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="submit"
                data-report-generate-submit
                disabled={filtersDisabled}
                title={canCreate ? undefined : '缺少 report:create 权限'}
                className={[
                  'inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-accent)] bg-[var(--nx-accent)] px-3.5 text-xs text-[var(--nx-workspace-bg)] transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                ].join(' ')}
              >
                <RefreshCw
                  className={submitting ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'}
                  aria-hidden
                />
                {submitting ? '生成中…' : '生成报表'}
              </button>
            </div>
          </form>
          {createMutation.isError && (
            <p
              role="alert"
              data-report-generate-error
              className="mt-2 rounded-md border border-[var(--nx-status-danger)] bg-[var(--nx-bg-1)] px-2.5 py-2 text-xs text-[var(--nx-status-danger)]"
            >
              生成失败：{errorText(createMutation.error, '未知错误')}
            </p>
          )}
        </section>

        {/* 历史底册 */}
        <section
          data-report-history-section
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
        >
          <h3 className="text-[13px] font-medium text-[var(--nx-text-primary)]">历史底册</h3>
          <div className="mt-3">
            {listQuery.isPending ? (
              <div
                data-report-history-skeleton
                role="status"
                aria-busy="true"
                aria-label="正在加载报表历史"
                className="space-y-2"
              >
                {[0, 1, 2].map((row) => (
                  <div
                    key={row}
                    className="h-14 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
                  />
                ))}
              </div>
            ) : listQuery.isError ? (
              <div
                data-report-history-error
                role="alert"
                className="flex flex-col items-start gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3"
              >
                <p className="text-xs text-[var(--nx-text-secondary)]">历史记录加载失败。</p>
                <button
                  type="button"
                  data-report-history-retry
                  onClick={() => void listQuery.refetch()}
                  className="inline-flex h-7 items-center rounded border border-[var(--nx-border-focus)] px-2.5 text-xs text-[var(--nx-accent)] hover:border-[var(--nx-accent)]"
                >
                  重新加载
                </button>
              </div>
            ) : reports.length === 0 ? (
              <div
                data-report-history-empty
                className="rounded-md border border-dashed border-[var(--nx-border-hairline)] p-4 text-center"
              >
                <p className="text-xs text-[var(--nx-text-muted)]">暂未生成任何报表快照</p>
                <button
                  type="button"
                  data-report-empty-cta
                  onClick={() => {
                    const firstTemplate = document.querySelector<HTMLElement>(
                      '[data-report-template-section]',
                    )
                    firstTemplate?.scrollIntoView({
                      behavior: resolveScrollBehavior(reducedMotion),
                      block: 'nearest',
                    })
                  }}
                  className="mt-2 inline-flex h-7 items-center rounded border border-[var(--nx-accent)] px-2.5 text-xs text-[var(--nx-accent)] hover:bg-[var(--nx-bg-1)]"
                >
                  选择上方模板生成第一份报表
                </button>
              </div>
            ) : (
              <ul data-report-history-list className="divide-y divide-[var(--nx-border-hairline)]">
                {reports.map((report) => {
                  const active = report.id === selectedReportIdInternal
                  return (
                    <li key={report.id}>
                      <button
                        type="button"
                        data-report-history-item={report.id}
                        aria-current={active ? 'true' : undefined}
                        onClick={() => selectReport(report.id)}
                        className={[
                          'flex w-full items-center justify-between gap-3 rounded px-2 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                          active ? 'bg-[var(--nx-bg-1)]' : 'hover:bg-[var(--nx-bg-1)]/60',
                        ].join(' ')}
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span
                              data-report-history-template={report.template}
                              className="shrink-0 rounded border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] px-1 py-px text-[10px] text-[var(--nx-accent)]"
                            >
                              {HISTORY_TEMPLATE_LABELS[report.template]}
                            </span>
                            <span className="truncate text-xs font-medium text-[var(--nx-text-primary)]">
                              {report.title}
                            </span>
                          </span>
                          <span className="mt-1 block text-[10px] text-[var(--nx-text-muted)]">
                            <time dateTime={report.generatedAt ?? report.createdAt}>
                              {formatDateTime(report.generatedAt ?? report.createdAt)}
                            </time>
                            {report.generatedBy != null && <> · 生成者 #{report.generatedBy}</>}
                          </span>
                        </span>
                        {report.fileFormat && (
                          <span className="shrink-0 rounded border border-[var(--nx-border-hairline)] px-1 py-px font-mono text-[10px] uppercase text-[var(--nx-text-muted)]">
                            {report.fileFormat}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      </aside>

      {/* ------------------------------------------------- 右栏：快照主视窗 */}
      <section data-report-snapshot-slot className="min-w-0" aria-label="报表快照预览区">
        {selectedReportIdInternal === null ? (
          <div
            data-report-snapshot-empty
            className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-10 text-center"
          >
            <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">报表快照视窗</h3>
            <p className="text-xs text-[var(--nx-text-muted)]">
              从左侧历史底册选择一份快照，或选定模板与参数后点击「生成报表」，预览将在此展开。
            </p>
          </div>
        ) : detailQuery.isPending ? (
          <div
            data-report-snapshot-loading
            role="status"
            aria-busy="true"
            aria-label="正在加载报表快照"
            className="space-y-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 md:p-5"
          >
            <div className="h-5 w-1/2 animate-pulse rounded bg-[var(--nx-bg-1)]" />
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              {[0, 1, 2, 3].map((card) => (
                <div
                  key={card}
                  className="h-16 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
                />
              ))}
            </div>
            <div className="h-40 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
          </div>
        ) : detailQuery.isError ? (
          <div
            data-report-snapshot-error
            role="alert"
            className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-10 text-center"
          >
            <AlertTriangle className="h-7 w-7 text-[var(--nx-status-warning)]" aria-hidden />
            <p className="text-sm text-[var(--nx-text-primary)]">快照内容加载失败</p>
            <button
              type="button"
              data-report-snapshot-retry
              onClick={() => void detailQuery.refetch()}
              className="inline-flex h-8 items-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3.5 text-xs text-[var(--nx-accent)] hover:border-[var(--nx-accent)]"
            >
              重新加载
            </button>
          </div>
        ) : activeReport ? (
          <ReportSnapshotView
            report={activeReport}
            onRegenerate={canCreate ? () => handleRegenerate(activeReport) : undefined}
            regenerating={submitting}
          />
        ) : (
          <div
            data-report-snapshot-loading
            role="status"
            aria-busy="true"
            aria-label="正在加载报表快照"
            className="space-y-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 md:p-5"
          >
            <div className="h-5 w-1/2 animate-pulse rounded bg-[var(--nx-bg-1)]" />
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              {[0, 1, 2, 3].map((card) => (
                <div
                  key={card}
                  className="h-16 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
                />
              ))}
            </div>
            <div className="h-40 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
          </div>
        )}
      </section>
    </div>
  )
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function errorText(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message
  }
  return fallback
}

export default PresetReportPanel
