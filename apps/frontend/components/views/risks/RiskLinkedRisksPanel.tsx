'use client'

import { Badge } from '@/components/ui/Badge'
import { useRiskList } from '@/hooks/use-risks'
import type { Risk, RiskStatus } from '@/lib/api/risks'

const STATUS_LABELS: Record<RiskStatus, string> = {
  identified: '已识别',
  analyzing: '分析中',
  mitigating: '缓解中',
  resolved: '已解决',
  accepted: '已接受',
  closed: '已关闭',
}

const STATUS_VARIANT: Record<
  RiskStatus,
  'neutral' | 'info' | 'warning' | 'success' | 'primary' | 'danger'
> = {
  identified: 'neutral',
  analyzing: 'info',
  mitigating: 'warning',
  resolved: 'success',
  accepted: 'primary',
  closed: 'neutral',
}

interface RiskLinkedRisksPanelProps {
  projectId: number
  taskId: number
  onRiskClick?: (risk: Risk) => void
}

export function RiskLinkedRisksPanel({
  projectId,
  taskId,
  onRiskClick,
}: RiskLinkedRisksPanelProps) {
  const { data, isLoading } = useRiskList(projectId, { perPage: 100 })

  const linkedRisks = data?.data?.filter((r) => r.relatedTaskId === taskId) ?? []

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="h-4 bg-gray-100 rounded w-24 animate-pulse" />
        <div className="h-8 bg-gray-50 rounded" />
      </div>
    )
  }

  if (linkedRisks.length === 0) return null

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-gray-700">关联风险</h4>
      <div className="space-y-2">
        {linkedRisks.map((risk) => (
          <div
            key={risk.id}
            className="flex items-center justify-between p-2 rounded-md bg-gray-50 hover:bg-gray-100 cursor-pointer text-sm"
            onClick={() => onRiskClick?.(risk)}
          >
            <div className="flex-1 min-w-0">
              <div className="truncate font-medium text-gray-900">{risk.title}</div>
              <div className="text-xs text-gray-500">得分 {risk.score}</div>
            </div>
            <Badge variant={STATUS_VARIANT[risk.status]} className="ml-2 shrink-0">
              {STATUS_LABELS[risk.status]}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  )
}
