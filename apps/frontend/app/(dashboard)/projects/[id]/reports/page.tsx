'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { BarChart3 } from 'lucide-react'
import type { CreateReportRequest, Report, ReportTemplate } from '@aiproj/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { PermissionGuard } from '@/components/PermissionGuard'
import { usePermissions } from '@/hooks/use-permissions'
import { ReportTemplateSelector } from '@/components/views/reports/ReportTemplateSelector'
import { ReportGenerateForm } from '@/components/views/reports/ReportGenerateForm'
import { ReportHistoryList } from '@/components/views/reports/ReportHistoryList'
import { ReportDetailPreview } from '@/components/views/reports/ReportDetailPreview'
import { useCreateReport, useReportDetail, useReportList } from '@/hooks/use-reports'

export default function ProjectReportsPage() {
  const params = useParams()
  const projectId = Number(params.id)
  const [template, setTemplate] = useState<ReportTemplate>('progress')
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null)
  const { can } = usePermissions()
  const canView = can('report:view')
  const listQuery = useReportList(projectId, { perPage: 20 })
  const detailQuery = useReportDetail(selectedReportId)
  const createMutation = useCreateReport(projectId)
  const reports = useMemo<Report[]>(() => listQuery.data?.data ?? [], [listQuery.data])
  const activeReport = detailQuery.data?.data ?? null

  async function handleGenerate(payload: CreateReportRequest) {
    const res = await createMutation.mutateAsync(payload)
    setSelectedReportId(res.data.id)
  }

  function handleRegenerate() {
    if (!activeReport) return
    void handleGenerate({
      template: activeReport.template,
      title: activeReport.title ? `${activeReport.title}（重新生成）` : undefined,
      filters: activeReport.config,
      formatConfig: activeReport.formatConfig ?? undefined,
    })
  }

  if (!canView) {
    return (
      <div className="py-12">
        <EmptyState
          illustration="report"
          icon={BarChart3}
          title="暂无报告权限"
          description="请联系项目管理员为你开通 report:view 权限。"
        />
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>选择模板</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ReportTemplateSelector value={template} onChange={setTemplate} />
          </CardContent>
        </Card>

        <PermissionGuard require="report:create">
          <Card>
            <CardHeader>
              <CardTitle>生成报告</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ReportGenerateForm
                template={template}
                onSubmit={handleGenerate}
                submitting={createMutation.isPending}
              />
              {createMutation.isError && (
                <div role="alert" className="mt-3 text-sm text-danger">
                  生成失败：{errorText(createMutation.error)}
                </div>
              )}
            </CardContent>
          </Card>
        </PermissionGuard>

        <Card>
          <CardHeader>
            <CardTitle>报告历史</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ReportHistoryList
              reports={reports}
              loading={listQuery.isLoading}
              activeReportId={selectedReportId}
              onSelect={(report) => setSelectedReportId(report.id)}
            />
          </CardContent>
        </Card>
      </div>

      <div>
        {detailQuery.isFetching && !activeReport ? (
          <Skeleton className="h-80 w-full" />
        ) : activeReport ? (
          <ReportDetailPreview
            report={activeReport}
            onRegenerate={handleRegenerate}
            regenerating={createMutation.isPending}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-border py-16">
            <EmptyState
              illustration="report"
              icon={BarChart3}
              title="选择一份报告"
              description="从左侧历史记录选择报告，或先选择模板生成新的项目报告。"
            />
          </div>
        )}
      </div>
    </div>
  )
}

function errorText(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message
  }
  return '未知错误'
}
