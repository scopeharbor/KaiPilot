'use client'

import { useMemo } from 'react'
import type { Report, ReportTemplate } from '@aiproj/types'
import { FileText } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'

const TEMPLATE_LABEL: Record<ReportTemplate, string> = {
  progress: '进度',
  delay: '延期',
  workload: '工作量',
  milestone: '里程碑',
}

export interface ReportHistoryListProps {
  reports: Report[]
  loading?: boolean
  activeReportId?: number | null
  onSelect: (report: Report) => void
}

export function ReportHistoryList({
  reports,
  loading = false,
  activeReportId,
  onSelect,
}: ReportHistoryListProps) {
  const items = useMemo(() => reports, [reports])

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((k) => (
          <Skeleton key={k} className="h-16 w-full" />
        ))}
      </div>
    )
  }

  if (!items.length) {
    return (
      <EmptyState
        illustration="report"
        icon={FileText}
        title="暂无报表历史"
        description="生成第一份报告后，这里会保留可预览和导出的历史记录。"
      />
    )
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-white">
      {items.map((report) => {
        const active = report.id === activeReportId
        return (
          <li key={report.id}>
            <button
              type="button"
              onClick={() => onSelect(report)}
              aria-current={active ? 'true' : undefined}
              className={[
                'flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors',
                active ? 'bg-primary-50' : 'hover:bg-gray-50',
              ].join(' ')}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant="primary">{TEMPLATE_LABEL[report.template]}</Badge>
                  <span className="truncate font-medium text-gray-900">{report.title}</span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                  <time dateTime={report.generatedAt ?? report.createdAt}>
                    {formatDateTime(report.generatedAt ?? report.createdAt)}
                  </time>
                  {report.generatedBy && <span>生成者 #{report.generatedBy}</span>}
                </div>
              </div>
              {report.fileFormat && (
                <Badge variant="outline" className="uppercase">
                  {report.fileFormat}
                </Badge>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '暂无时间'
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
