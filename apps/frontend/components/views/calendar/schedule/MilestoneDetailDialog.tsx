'use client'

import { Flag } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { Badge } from '@/components/ui/Badge'
import type { CalendarItem } from '@/lib/calendar-types'
import { statusLabel } from './CalendarItemChip'

interface MilestoneDetailDialogProps {
  milestone: CalendarItem | null
  onOpenChange: (open: boolean) => void
}

/**
 * 里程碑只读详情弹层（复用日历项数据，不新建平行业务模型）。
 * 里程碑写入仍走正式里程碑更新链路（此处仅查看 + 跳转入口）。
 */
export function MilestoneDetailDialog({ milestone, onOpenChange }: MilestoneDetailDialogProps) {
  const open = milestone !== null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        {milestone && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Flag className="h-4 w-4 text-primary" aria-hidden />
                {milestone.name}
              </DialogTitle>
              <DialogDescription>里程碑详情（只读）</DialogDescription>
            </DialogHeader>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">状态</dt>
                <dd>
                  <Badge variant={milestone.isOverdue ? 'danger' : 'neutral'}>
                    {statusLabel(milestone.displayStatus ?? milestone.status)}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">目标日期</dt>
                <dd className="font-medium">
                  {milestone.dateRange.end ?? milestone.dateRange.start ?? '未设置'}
                </dd>
              </div>
              {milestone.isOverdue && (
                <p className="text-xs text-red-600">该里程碑目标日期已过且未达成，处于逾期状态。</p>
              )}
            </dl>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
