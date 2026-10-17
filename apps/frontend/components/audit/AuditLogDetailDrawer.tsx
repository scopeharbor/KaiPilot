'use client'

import { Badge } from '@/components/ui/Badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/Sheet'
import { Skeleton } from '@/components/ui/Skeleton'
import { useQuery } from '@tanstack/react-query'
import { auditLogKeys, auditLogsApi, type AuditLogEntry } from '@/lib/api/audit-logs'
import { actionLabel, entityTypeLabel, eventLabel, severityLabel } from '@/lib/audit-labels'

interface Props {
  entry: AuditLogEntry | null
  open: boolean
  onClose: () => void
}

export function AuditLogDetailDrawer({ entry, open, onClose }: Props) {
  const detail = useQuery({
    queryKey: auditLogKeys.detail(entry?.id ?? 0),
    queryFn: () => auditLogsApi.show(entry!.id),
    enabled: !!entry && open,
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <SheetContent side="right" className="w-[480px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>审计日志详情</SheetTitle>
        </SheetHeader>

        {detail.isLoading ? (
          <div className="space-y-4 mt-6">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : detail.data ? (
          <div className="mt-6 space-y-5 text-sm">
            <Section label="事件" value={eventLabel(detail.data.event) || '-'} />
            <Section label="操作" value={actionLabel(detail.data.action)} />
            <Section
              label="级别"
              value={
                <Badge
                  variant={
                    detail.data.severity === 'critical' || detail.data.severity === 'error'
                      ? 'danger'
                      : detail.data.severity === 'warning'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {severityLabel(detail.data.severity)}
                </Badge>
              }
            />
            <Section
              label="操作人"
              value={
                detail.data.userName ??
                (detail.data.userId != null ? `用户#${detail.data.userId}` : '系统')
              }
            />
            <Section
              label="组织"
              value={
                detail.data.organizationName ??
                (detail.data.organizationId != null ? `组织#${detail.data.organizationId}` : '-')
              }
            />
            <Section label="项目" value={detail.data.projectName ?? '-'} />
            <Section
              label="实体"
              value={
                detail.data.entityName ??
                (detail.data.entityType
                  ? `${entityTypeLabel(detail.data.entityType)}${detail.data.entityId != null ? ` #${detail.data.entityId}` : ''}`
                  : '-')
              }
            />
            <Section label="时间" value={new Date(detail.data.createdAt).toLocaleString('zh-CN')} />

            {detail.data.changes ? (
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">变更前后</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">变更前</p>
                    <pre className="bg-gray-50 rounded p-2 text-xs overflow-x-auto max-h-40">
                      {JSON.stringify(detail.data.changes.before ?? {}, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">变更后</p>
                    <pre className="bg-gray-50 rounded p-2 text-xs overflow-x-auto max-h-40">
                      {JSON.stringify(detail.data.changes.after ?? {}, null, 2)}
                    </pre>
                  </div>
                </div>
                {detail.data.changes.truncated && (
                  <p className="text-xs text-amber-600 mt-1">（数据已截断）</p>
                )}
              </div>
            ) : (
              <div className="text-gray-400 italic py-2">该记录无变更前后值</div>
            )}

            <div>
              <h4 className="font-semibold text-gray-800 mb-2">上下文</h4>
              <pre className="bg-gray-50 rounded p-2 text-xs overflow-x-auto max-h-60">
                {JSON.stringify(detail.data.metadata ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function Section({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-gray-500 min-w-20 shrink-0">{label}</span>
      <span className="text-gray-800">{value}</span>
    </div>
  )
}
