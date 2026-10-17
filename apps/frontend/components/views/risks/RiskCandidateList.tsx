'use client'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import PermissionGuard from '@/components/PermissionGuard'
import { Clock, AlertTriangle } from 'lucide-react'
import type { RiskSignalCandidate, RiskLevel } from '@/lib/api/risks-v2'

const SEVERITY_VARIANTS: Record<RiskLevel, 'neutral' | 'warning' | 'danger'> = {
  low: 'neutral',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
}

const SEVERITY_LABELS: Record<RiskLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
}

const EXPIRED_CLASSES = 'opacity-50 border-dashed border-gray-300 bg-gray-50 pointer-events-none'

interface RiskCandidateListProps {
  candidates: RiskSignalCandidate[]
  onAccept: (candidate: RiskSignalCandidate) => void
  onReject: (candidate: RiskSignalCandidate) => void
  isPendingAction?: boolean
}

export function RiskCandidateList({
  candidates,
  onAccept,
  onReject,
  isPendingAction,
}: RiskCandidateListProps) {
  if (candidates.length === 0) {
    return <div className="text-center py-8 text-gray-400 text-sm">无规则风险候选</div>
  }

  return (
    <div className="space-y-3">
      {candidates.map((candidate) => {
        const isExpired = candidate.status === 'expired'
        const isHandled = candidate.status === 'accepted' || candidate.status === 'rejected'

        return (
          <div
            key={candidate.id}
            className={`p-4 rounded-lg border ${
              isExpired ? EXPIRED_CLASSES : isHandled ? 'opacity-50' : 'border-border'
            }`}
          >
            {/* 头部：建议行动 + 严重度 */}
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900">
                    {candidate.recommendedAction.slice(0, 100)}
                  </span>
                  <Badge variant={SEVERITY_VARIANTS[candidate.severity]}>
                    {SEVERITY_LABELS[candidate.severity]}
                  </Badge>
                  {isExpired && (
                    <Badge variant="neutral">
                      <Clock className="h-3 w-3 mr-0.5" />
                      已过期
                    </Badge>
                  )}
                  {isHandled && (
                    <Badge variant="neutral">
                      {candidate.status === 'accepted' ? '已采纳' : '已拒绝'}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* 规则来源 */}
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
              <span>规则: {candidate.ruleId}</span>
              <span>v{candidate.ruleVersion}</span>
              <span>来源: {candidate.source}</span>
            </div>

            {/* 置信度进度条 */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-gray-500 shrink-0">置信度</span>
              <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    candidate.confidence >= 0.7
                      ? 'bg-green-500'
                      : candidate.confidence >= 0.4
                        ? 'bg-amber-500'
                        : 'bg-gray-400'
                  }`}
                  style={{ width: `${Math.round(candidate.confidence * 100)}%` }}
                />
              </div>
              <span className="text-xs text-gray-500 w-8 text-right">
                {Math.round(candidate.confidence * 100)}%
              </span>
            </div>

            {/* 证据项 */}
            {candidate.evidence.length > 0 && (
              <div className="space-y-1 mb-3">
                <span className="text-xs text-gray-500 font-medium">证据</span>
                {candidate.evidence.map((ev, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 text-xs text-gray-600 bg-gray-50 rounded p-2"
                  >
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />
                    <span>
                      {ev.title}: {ev.detail}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 过期时间 */}
            {candidate.expiresAt && (
              <div className="text-xs text-gray-400 mb-2">
                过期时间：{new Date(candidate.expiresAt).toLocaleString('zh-CN')}
              </div>
            )}

            {/* 操作按钮 */}
            {!isExpired && !isHandled && (
              <PermissionGuard
                require="risk:manage"
                fallback={
                  <div className="flex items-center gap-1 text-xs text-gray-400 mt-2">
                    <Clock className="h-3 w-3" />
                    无风险操作权限
                  </div>
                }
              >
                <div className="flex gap-2 mt-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => onAccept(candidate)}
                    disabled={isPendingAction}
                  >
                    采纳
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onReject(candidate)}
                    disabled={isPendingAction}
                  >
                    拒绝
                  </Button>
                </div>
              </PermissionGuard>
            )}
          </div>
        )
      })}
    </div>
  )
}
