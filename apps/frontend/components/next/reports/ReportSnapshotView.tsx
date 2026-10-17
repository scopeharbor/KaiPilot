'use client'

import type { ReactNode } from 'react'
import { AlertTriangle, Info, RefreshCw } from 'lucide-react'
import type {
  DelaySnapshot,
  MilestoneSnapshot,
  ProgressSnapshot,
  Report,
  ReportSnapshot,
  ReportTemplate,
  ReportWarning,
  WorkloadSnapshot,
} from '@aiproj/types'
import { MONO_FONT_STACK } from '@/lib/next/chart-export'

/**
 * 预设报表快照高保真渲染器（v3-ui-next-reports-domain W1 · tasks 1.2）。
 *
 * - 严格从已保存快照 `report.dataSnapshot` 读取（冻结数据，不重新拉取源数据）：
 *   快照展示的是生成时刻的数字，与项目当前状态可能不一致（RL-07 诚实披露：
 *   界面以「快照冻结」微标与数据采信边界提示显式声明）；
 * - 按 4 大白名单模板（progress / delay / workload / milestone）渲染
 *   KPI 汇总统计卡、明细数据表格与数据摘要；
 * - 所有度量数字采用 MONO_FONT_STACK（JetBrains Mono 优先）并右对齐，
 *   保证工时/延期等数据纵向列对齐（精确档仪器排版）；
 * - 顶部提供快照创建人与时间戳微标，以及基于原过滤参数（config）重新生成的
 *   「重新生成」行动按钮（由父级注入 onRegenerate，缺失权限时不渲染）；
 * - 零网络请求；根节点暴露 data-report-snapshot-surface 供客户端视觉汇出定位。
 */

const TEMPLATE_LABELS: Record<ReportTemplate, string> = {
  progress: '进度报表',
  delay: '延期分析',
  workload: '工作量',
  milestone: '里程碑',
}

/** 快照冻结声明（RL-07 诚实披露）：数据是生成时刻的冻结副本。 */
const SNAPSHOT_FREEZE_NOTE = '该快照冻结于生成时刻，与项目当前实时数据可能不一致'

export interface ReportSnapshotViewProps {
  report: Report
  /** 具备 report:create 权限时注入「重新生成」（带入原参数），缺省隐藏。 */
  onRegenerate?: () => void
  regenerating?: boolean
}

export function ReportSnapshotView({
  report,
  onRegenerate,
  regenerating = false,
}: ReportSnapshotViewProps) {
  const snapshot = report.dataSnapshot
  const warnings = snapshot.snapshotMetadata.warnings ?? []
  const snapshotTime =
    snapshot.snapshotMetadata.generatedAt ?? report.generatedAt ?? report.createdAt
  const authorId = snapshot.snapshotMetadata.generatedBy ?? report.generatedBy

  return (
    <article
      data-report-snapshot-view
      className="flex flex-col gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 md:p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              data-report-snapshot-template={snapshot.template}
              className="shrink-0 rounded border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-accent)]"
            >
              {TEMPLATE_LABELS[snapshot.template]}
            </span>
            <h3
              data-report-snapshot-title
              className="truncate text-base font-semibold text-[var(--nx-text-primary)]"
            >
              {report.title}
            </h3>
          </div>
          <p
            data-report-snapshot-meta
            className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--nx-text-muted)]"
          >
            <time dateTime={snapshotTime}>{formatDateTime(snapshotTime)}</time>
            <span aria-hidden>·</span>
            <span data-report-snapshot-author>
              {authorId != null ? `创建人 #${authorId}` : '系统自动生成'}
            </span>
            <span aria-hidden>·</span>
            <span className="rounded border border-[var(--nx-border-hairline)] px-1 py-px font-mono text-[10px]">
              v{snapshot.snapshotMetadata.templateVersion}
            </span>
          </p>
          <p data-report-snapshot-freeze className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
            {SNAPSHOT_FREEZE_NOTE}
          </p>
        </div>

        {onRegenerate && (
          <button
            type="button"
            data-report-regenerate
            onClick={onRegenerate}
            disabled={regenerating}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {regenerating ? '重新生成中…' : '重新生成'}
          </button>
        )}
      </header>

      {/* 快照冻结内容：KPI 统计卡 + 模板明细表格（客户端视觉汇出捕获目标） */}
      <div data-report-snapshot-surface data-report-export-target className="flex flex-col gap-5">
        <SnapshotBody snapshot={snapshot} />
        <SnapshotWarnings warnings={warnings} />
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
// 快照主体：四模板分发
// ---------------------------------------------------------------------------

function SnapshotBody({ snapshot }: { snapshot: ReportSnapshot }) {
  switch (snapshot.template) {
    case 'progress':
      return <ProgressBody snapshot={snapshot} />
    case 'delay':
      return <DelayBody snapshot={snapshot} />
    case 'workload':
      return <WorkloadBody snapshot={snapshot} />
    case 'milestone':
      return <MilestoneBody snapshot={snapshot} />
    default: {
      // exhaustive：新增模板必须显式补渲染器，杜绝静默空白
      const _exhaustive: never = snapshot
      void _exhaustive
      return null
    }
  }
}

function ProgressBody({ snapshot }: { snapshot: ProgressSnapshot }) {
  const { summary } = snapshot
  return (
    <div className="space-y-5">
      <StatGrid
        items={[
          { label: '总进度', value: formatPercent(summary.overallProgressPercent) },
          { label: '总任务', value: String(summary.totalTasks) },
          { label: '已完成', value: String(summary.completedTasks) },
          { label: '阻塞中', value: String(summary.blockedTasks) },
        ]}
      />
      <Section title="任务状态分布">
        <DataTable
          columns={[
            { key: 'status', header: '状态' },
            { key: 'count', header: '数量', numeric: true },
            { key: 'ratio', header: '占比', numeric: true, render: (row) => `${row.ratio}%` },
          ]}
          rows={snapshot.statusDistribution}
        />
      </Section>
      <Section title="WBS 分支进度">
        <DataTable
          columns={[
            { key: 'code', header: '编码' },
            { key: 'name', header: '名称' },
            { key: 'totalTasks', header: '任务数', numeric: true },
            { key: 'completedTasks', header: '已完成', numeric: true },
            {
              key: 'progressPercent',
              header: '进度',
              numeric: true,
              render: (row) => `${row.progressPercent}%`,
            },
          ]}
          rows={snapshot.wbsSummaries}
        />
      </Section>
      <Section title="关键任务">
        <DataTable
          columns={[
            { key: 'title', header: '任务' },
            { key: 'status', header: '状态' },
            {
              key: 'progressPercent',
              header: '进度',
              numeric: true,
              render: (row) => `${row.progressPercent}%`,
            },
            { key: 'assigneeName', header: '负责人', render: (row) => row.assigneeName ?? '—' },
            { key: 'dueDate', header: '截止日', render: (row) => row.dueDate ?? '—' },
          ]}
          rows={snapshot.criticalTasks}
        />
      </Section>
      {snapshot.blockers.length > 0 && (
        <Section title="阻塞项">
          <ul className="space-y-1.5">
            {snapshot.blockers.map((blocker) => (
              <li
                key={blocker.taskId}
                className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2 text-xs text-[var(--nx-text-secondary)]"
              >
                <span className="text-[var(--nx-text-primary)]">{blocker.title}</span>
                <span className="text-[var(--nx-text-muted)]"> · {blocker.reason}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}

function DelayBody({ snapshot }: { snapshot: DelaySnapshot }) {
  const { summary } = snapshot
  return (
    <div className="space-y-5">
      <StatGrid
        items={[
          { label: '逾期任务', value: String(summary.overdueTasks) },
          { label: '即将到期', value: String(summary.upcomingTasks) },
          { label: '延期率', value: formatPercent(summary.delayRatePercent) },
          { label: '平均延期天数', value: formatDecimal(summary.averageOverdueDays) },
        ]}
      />
      <Section title="逾期任务明细">
        <DataTable
          columns={[
            { key: 'title', header: '任务' },
            { key: 'assigneeName', header: '负责人', render: (row) => row.assigneeName ?? '—' },
            {
              key: 'plannedEndDate',
              header: '计划结束',
              render: (row) => row.plannedEndDate ?? '—',
            },
            { key: 'overdueDays', header: '逾期天数', numeric: true },
            {
              key: 'onCriticalPath',
              header: '关键路径',
              render: (row) => (row.onCriticalPath ? '是' : '否'),
            },
          ]}
          rows={snapshot.overdueTasks}
        />
      </Section>
      <Section title="即将到期任务">
        <DataTable
          columns={[
            { key: 'title', header: '任务' },
            { key: 'assigneeName', header: '负责人', render: (row) => row.assigneeName ?? '—' },
            {
              key: 'plannedEndDate',
              header: '计划结束',
              render: (row) => row.plannedEndDate ?? '—',
            },
            { key: 'daysUntilDue', header: '距到期天数', numeric: true },
          ]}
          rows={snapshot.upcomingTasks}
        />
      </Section>
      {snapshot.dependencyWarnings.length > 0 && (
        <Section title="依赖告警">
          <DataTable
            columns={[
              { key: 'fromTaskId', header: '前置任务', numeric: true },
              { key: 'toTaskId', header: '后继任务', numeric: true },
              { key: 'reason', header: '告警原因' },
            ]}
            rows={snapshot.dependencyWarnings}
          />
        </Section>
      )}
    </div>
  )
}

function WorkloadBody({ snapshot }: { snapshot: WorkloadSnapshot }) {
  const { summary } = snapshot
  return (
    <div className="space-y-5">
      <StatGrid
        items={[
          { label: '负责人数', value: String(summary.totalAssignees) },
          { label: '计划工时', value: formatHours(summary.totalPlannedHours) },
          { label: '实际工时', value: formatHours(summary.totalActualHours) },
          {
            label: '未分配任务',
            value: `${summary.unassigned.totalTasks} 项 / ${formatHours(summary.unassigned.plannedHours)}`,
          },
        ]}
      />
      <Section title="按负责人聚合">
        <DataTable
          columns={[
            { key: 'displayName', header: '负责人' },
            { key: 'totalTasks', header: '任务数', numeric: true },
            { key: 'completedTasks', header: '已完成', numeric: true },
            { key: 'inProgressTasks', header: '进行中', numeric: true },
            { key: 'notStartedTasks', header: '未开始', numeric: true },
            {
              key: 'hours',
              header: '计划 / 实际 h',
              numeric: true,
              render: (row) =>
                `${formatDecimal(row.plannedHours)} / ${formatDecimal(row.actualHours)}`,
            },
            {
              key: 'overloadHint',
              header: '过载',
              render: (row) => (row.overloadHint ? '⚠ 是' : '—'),
            },
          ]}
          rows={snapshot.byAssignee}
        />
      </Section>
    </div>
  )
}

function MilestoneBody({ snapshot }: { snapshot: MilestoneSnapshot }) {
  const { summary } = snapshot
  return (
    <div className="space-y-5">
      <StatGrid
        items={[
          { label: '总里程碑', value: String(summary.totalMilestones) },
          { label: '已完成', value: String(summary.completedMilestones) },
          { label: '逾期', value: String(summary.overdueMilestones) },
          { label: '即将到期', value: String(summary.upcomingMilestones) },
        ]}
      />
      <Section title="里程碑清单">
        <DataTable
          columns={[
            { key: 'name', header: '里程碑' },
            { key: 'plannedDate', header: '计划日期', render: (row) => row.plannedDate ?? '—' },
            { key: 'status', header: '状态' },
            {
              key: 'linkedTaskProgressPercent',
              header: '关联任务完成度',
              numeric: true,
              render: (row) => `${row.linkedTaskProgressPercent}%`,
            },
            { key: 'overdueDays', header: '逾期天数', numeric: true },
          ]}
          rows={snapshot.milestones}
        />
      </Section>
      {snapshot.risks.length > 0 && (
        <Section title="里程碑风险">
          <DataTable
            columns={[
              { key: 'name', header: '里程碑' },
              { key: 'reason', header: '风险原因' },
            ]}
            rows={snapshot.risks}
          />
        </Section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 基础呈现块
// ---------------------------------------------------------------------------

/** KPI 汇总统计卡：数字强制 MONO_FONT_STACK 并右对齐（design「精确档仪器排版」）。 */
function StatGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <dl data-report-kpis className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          data-report-kpi
          className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2.5"
        >
          <dt className="text-[11px] text-[var(--nx-text-muted)]">{item.label}</dt>
          <dd
            className="mt-1 text-lg leading-tight text-[var(--nx-text-primary)]"
            style={{ fontFamily: MONO_FONT_STACK }}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--nx-text-secondary)]">
        {title}
      </h4>
      {children}
    </section>
  )
}

interface TableColumn<T> {
  key: string
  header: string
  /** 度量数字列：MONO_FONT_STACK + 右对齐（design「等宽数字垂直对齐」）。 */
  numeric?: boolean
  render?: (row: T) => ReactNode
}

/** 仪器化明细表：发丝线边框、固定暗灰表头；空数据输出「暂无数据」。 */
function DataTable<T>({ columns, rows }: { columns: Array<TableColumn<T>>; rows: T[] }) {
  if (rows.length === 0) {
    return <p className="py-2 text-xs text-[var(--nx-text-muted)]">暂无数据</p>
  }
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--nx-border-hairline)]">
      <table className="min-w-full text-xs">
        <thead className="bg-[var(--nx-bg-1)]">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={[
                  'whitespace-nowrap border-b border-[var(--nx-border-hairline)] px-2.5 py-2 font-medium text-[var(--nx-text-secondary)]',
                  column.numeric === true ? 'text-right' : 'text-left',
                ].join(' ')}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--nx-border-hairline)]">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-[var(--nx-bg-0)] even:bg-[var(--nx-bg-1)]">
              {columns.map((column) => (
                <td
                  key={column.key}
                  data-report-numeric={column.numeric === true ? 'true' : undefined}
                  className={[
                    'whitespace-nowrap px-2.5 py-2 text-[var(--nx-text-secondary)]',
                    column.numeric === true
                      ? 'text-right text-[var(--nx-text-primary)]'
                      : 'text-left',
                  ].join(' ')}
                  style={column.numeric === true ? { fontFamily: MONO_FONT_STACK } : undefined}
                >
                  {column.render
                    ? column.render(row)
                    : (((row as Record<string, unknown>)[column.key] as ReactNode) ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 快照 warnings（RL-07 诚实披露）：数据采信边界提示，按严重度着色。 */
function SnapshotWarnings({ warnings }: { warnings: ReportWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <section
      data-report-snapshot-warnings
      className="space-y-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2.5"
    >
      <h4 className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--nx-text-secondary)]">
        <Info className="h-3.5 w-3.5" aria-hidden />
        数据采信边界
      </h4>
      <ul className="space-y-1">
        {warnings.map((warning, index) => (
          <li
            key={index}
            data-warning-level={warning.level}
            className={[
              'flex items-start gap-1.5 text-xs',
              warning.level === 'critical'
                ? 'text-[var(--nx-status-danger)]'
                : warning.level === 'warning'
                  ? 'text-[var(--nx-status-warning)]'
                  : 'text-[var(--nx-text-muted)]',
            ].join(' ')}
          >
            {warning.level === 'critical' ? (
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            )}
            {warning.message}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 格式化工具
// ---------------------------------------------------------------------------

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

/** 整数原样，小数保留 1 位（平均延期天数等）。 */
function formatDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatPercent(value: number): string {
  return `${formatDecimal(value)}%`
}

function formatHours(value: number): string {
  return `${formatDecimal(value)}h`
}

export default ReportSnapshotView
