'use client'

import type {
  DelaySnapshot,
  MilestoneSnapshot,
  ProgressSnapshot,
  ReportSnapshot,
  WorkloadSnapshot,
} from '@aiproj/types'

/**
 * 快照渲染器 —— tasks 6.3。
 *
 * 严格从已保存的 `ReportSnapshot` 读取，不重新拉取源数据；这是 spec
 * 「快照可追溯」的直接体现——列表所示为报表生成时刻的数字，与当前项目状态可以不一致。
 */

function StatGrid({ items }: { items: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it, i) => (
        <div key={i} className="rounded-md border border-border bg-gray-50 px-3 py-2 text-sm">
          <dt className="text-gray-500">{it.label}</dt>
          <dd className="mt-0.5 text-lg font-semibold text-gray-900">{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function DataTable<T>({
  columns,
  rows,
  emptyLabel = '暂无数据',
}: {
  columns: Array<{ key: keyof T | string; header: string; render?: (row: T) => React.ReactNode }>
  rows: T[]
  emptyLabel?: string
}) {
  if (!rows.length) return <p className="text-sm text-gray-500">{emptyLabel}</p>
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((c) => (
              <th
                key={String(c.key)}
                scope="col"
                className="px-3 py-2 text-left font-medium text-gray-600"
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr key={i} className="odd:bg-white even:bg-gray-50/50">
              {columns.map((c) => (
                <td key={String(c.key)} className="px-3 py-2 text-gray-800">
                  {c.render
                    ? c.render(row)
                    : (((row as Record<string, unknown>)[c.key as string] as React.ReactNode) ??
                      '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProgressBody({ s, includeDetails }: { s: ProgressSnapshot; includeDetails: boolean }) {
  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: '总进度', value: `${s.summary.overallProgressPercent}%` },
          { label: '总任务', value: s.summary.totalTasks },
          { label: '已完成', value: s.summary.completedTasks },
          { label: '阻塞中', value: s.summary.blockedTasks },
        ]}
      />
      {includeDetails && (
        <>
          <section>
            <h4 className="mb-2 text-sm font-semibold text-gray-800">WBS 分支进度</h4>
            <DataTable
              columns={[
                { key: 'code', header: '编码' },
                { key: 'name', header: '名称' },
                { key: 'totalTasks', header: '任务' },
                { key: 'completedTasks', header: '已完成' },
                {
                  key: 'progressPercent',
                  header: '进度',
                  render: (r) => `${r.progressPercent}%`,
                },
              ]}
              rows={s.wbsSummaries}
            />
          </section>
          <section>
            <h4 className="mb-2 text-sm font-semibold text-gray-800">关键任务</h4>
            <DataTable
              columns={[
                { key: 'title', header: '任务' },
                { key: 'status', header: '状态' },
                {
                  key: 'progressPercent',
                  header: '进度',
                  render: (r) => `${r.progressPercent}%`,
                },
                { key: 'assigneeName', header: '负责人' },
                { key: 'dueDate', header: '截止' },
              ]}
              rows={s.criticalTasks}
            />
          </section>
        </>
      )}
    </div>
  )
}

function DelayBody({ s, includeDetails }: { s: DelaySnapshot; includeDetails: boolean }) {
  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: '逾期任务', value: s.summary.overdueTasks },
          { label: '即将到期', value: s.summary.upcomingTasks },
          { label: '延期率', value: `${s.summary.delayRatePercent}%` },
          { label: '平均延期天数', value: s.summary.averageOverdueDays },
        ]}
      />
      {includeDetails && (
        <>
          <section>
            <h4 className="mb-2 text-sm font-semibold text-gray-800">逾期任务</h4>
            <DataTable
              columns={[
                { key: 'title', header: '任务' },
                { key: 'assigneeName', header: '负责人' },
                { key: 'plannedEndDate', header: '计划结束' },
                { key: 'overdueDays', header: '逾期天数' },
                {
                  key: 'onCriticalPath',
                  header: '关键路径',
                  render: (r) => (r.onCriticalPath ? '是' : '否'),
                },
              ]}
              rows={s.overdueTasks}
            />
          </section>
          <section>
            <h4 className="mb-2 text-sm font-semibold text-gray-800">即将到期</h4>
            <DataTable
              columns={[
                { key: 'title', header: '任务' },
                { key: 'assigneeName', header: '负责人' },
                { key: 'plannedEndDate', header: '计划结束' },
                { key: 'daysUntilDue', header: '距到期天数' },
              ]}
              rows={s.upcomingTasks}
            />
          </section>
        </>
      )}
    </div>
  )
}

function WorkloadBody({ s, includeDetails }: { s: WorkloadSnapshot; includeDetails: boolean }) {
  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: '负责人数', value: s.summary.totalAssignees },
          { label: '计划工时', value: `${s.summary.totalPlannedHours}h` },
          { label: '实际工时', value: `${s.summary.totalActualHours}h` },
          {
            label: '无负责人任务',
            value: s.summary.unassigned.totalTasks,
          },
        ]}
      />
      {includeDetails && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-gray-800">按负责人</h4>
          <DataTable
            columns={[
              { key: 'displayName', header: '负责人' },
              { key: 'totalTasks', header: '任务' },
              { key: 'completedTasks', header: '已完成' },
              { key: 'inProgressTasks', header: '进行中' },
              {
                key: 'plannedHours',
                header: '计划/实际 h',
                render: (r) => `${r.plannedHours} / ${r.actualHours}`,
              },
              {
                key: 'overloadHint',
                header: '过载',
                render: (r) => (r.overloadHint ? '⚠︎' : '—'),
              },
            ]}
            rows={s.byAssignee}
          />
        </section>
      )}
    </div>
  )
}

function MilestoneBody({ s, includeDetails }: { s: MilestoneSnapshot; includeDetails: boolean }) {
  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: '总里程碑', value: s.summary.totalMilestones },
          { label: '已完成', value: s.summary.completedMilestones },
          { label: '逾期', value: s.summary.overdueMilestones },
          { label: '即将到期', value: s.summary.upcomingMilestones },
        ]}
      />
      {includeDetails && (
        <>
          <section>
            <h4 className="mb-2 text-sm font-semibold text-gray-800">里程碑</h4>
            <DataTable
              columns={[
                { key: 'name', header: '名称' },
                { key: 'plannedDate', header: '计划日期' },
                { key: 'status', header: '状态' },
                {
                  key: 'linkedTaskProgressPercent',
                  header: '关联任务完成度',
                  render: (r) => `${r.linkedTaskProgressPercent}%`,
                },
                { key: 'overdueDays', header: '逾期天数' },
              ]}
              rows={s.milestones}
            />
          </section>
          {s.risks.length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-semibold text-gray-800">风险摘要</h4>
              <DataTable
                columns={[
                  { key: 'name', header: '里程碑' },
                  { key: 'reason', header: '原因' },
                ]}
                rows={s.risks}
              />
            </section>
          )}
        </>
      )}
    </div>
  )
}

export function ReportSnapshotRenderer({
  snapshot,
  includeDetails = true,
}: {
  snapshot: ReportSnapshot
  includeDetails?: boolean
}) {
  switch (snapshot.template) {
    case 'progress':
      return <ProgressBody s={snapshot} includeDetails={includeDetails} />
    case 'delay':
      return <DelayBody s={snapshot} includeDetails={includeDetails} />
    case 'workload':
      return <WorkloadBody s={snapshot} includeDetails={includeDetails} />
    case 'milestone':
      return <MilestoneBody s={snapshot} includeDetails={includeDetails} />
    default: {
      // exhaustive
      const _exhaustive: never = snapshot
      void _exhaustive
      return null
    }
  }
}
