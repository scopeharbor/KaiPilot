'use client'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table'
import type { AuditLogEntry } from '@/lib/api/audit-logs'
import { actionLabel, entityTypeLabel, eventLabel, severityLabel } from '@/lib/audit-labels'

interface Props {
  data: AuditLogEntry[] | undefined
  isLoading: boolean
  hasMore: boolean
  onLoadMore: () => void
  isLoadingMore: boolean
  onRowClick: (entry: AuditLogEntry) => void
}

const severityVariant = {
  info: 'neutral' as const,
  warning: 'warning' as const,
  error: 'danger' as const,
  critical: 'danger' as const,
}

/** 操作人显示：优先实名，回退「用户#id」，无用户为「系统」。 */
function actorText(entry: AuditLogEntry): string {
  if (entry.userName) return entry.userName
  if (entry.userId != null) return `用户#${entry.userId}`
  return '系统'
}

/** 实体显示：项目实体→项目名；其他→中文类型（附 #id）。 */
function entityText(entry: AuditLogEntry): string {
  if (entry.entityName) return entry.entityName
  if (!entry.entityType) return '-'
  const label = entityTypeLabel(entry.entityType)
  return entry.entityId != null ? `${label} #${entry.entityId}` : label
}

/** 组织显示：优先中文名，回退「组织#id」。 */
function orgText(entry: AuditLogEntry): string {
  if (entry.organizationName) return entry.organizationName
  if (entry.organizationId != null) return `组织#${entry.organizationId}`
  return '-'
}

export function AuditLogTable({
  data,
  isLoading,
  hasMore,
  onLoadMore,
  isLoadingMore,
  onRowClick,
}: Props) {
  if (isLoading) {
    return (
      <Card variant="outlined" className="space-y-3 p-[var(--card-pad)]">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </Card>
    )
  }

  if (!data || data.length === 0) {
    return (
      <Card
        variant="outlined"
        className="flex items-center justify-center p-8 text-sm text-gray-500"
      >
        暂无审计记录
      </Card>
    )
  }

  return (
    <Card variant="outlined" className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">时间</TableHead>
            <TableHead className="whitespace-nowrap pr-2">事件</TableHead>
            <TableHead className="whitespace-nowrap pl-2">操作</TableHead>
            <TableHead className="whitespace-nowrap">级别</TableHead>
            <TableHead className="whitespace-nowrap">操作人</TableHead>
            <TableHead>实体</TableHead>
            <TableHead>组织</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((entry) => (
            <TableRow key={entry.id} className="cursor-pointer" onClick={() => onRowClick(entry)}>
              <TableCell className="text-xs text-gray-500 whitespace-nowrap">
                {new Date(entry.createdAt).toLocaleString('zh-CN')}
              </TableCell>
              <TableCell className="pr-2 font-medium text-gray-800 whitespace-nowrap">
                {eventLabel(entry.event) || '-'}
              </TableCell>
              <TableCell className="pl-2">
                <Badge variant="neutral">{actionLabel(entry.action)}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={severityVariant[entry.severity]}>
                  {severityLabel(entry.severity)}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-gray-600 whitespace-nowrap">
                {actorText(entry)}
              </TableCell>
              <TableCell className="text-sm text-gray-600">{entityText(entry)}</TableCell>
              <TableCell className="text-sm text-gray-600">{orgText(entry)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {hasMore && (
        <div className="flex justify-center p-4">
          <Button variant="outline" onClick={onLoadMore} disabled={isLoadingMore}>
            {isLoadingMore ? '加载中...' : '加载更多'}
          </Button>
        </div>
      )}
    </Card>
  )
}
