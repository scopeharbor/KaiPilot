'use client'

import { useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { GitPullRequest, GitBranch, GitCommit, Clock } from 'lucide-react'
import {
  useLinkCandidates,
  useConfirmLinkCandidate,
  useIgnoreLinkCandidate,
} from '@/hooks/use-link-candidates'
import type { LinkCandidateDto } from '@aiproj/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

interface LinkCandidatesPanelProps {
  projectId: number
  taskId: number
}

export function LinkCandidatesPanel({ projectId, taskId }: LinkCandidatesPanelProps) {
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const canMutate = hasPermission('task:update') || hasPermission('task:update:self')
  const { data, isLoading, isError } = useLinkCandidates(projectId, taskId, 'pending')
  const confirmMutation = useConfirmLinkCandidate(projectId, taskId)
  const ignoreMutation = useIgnoreLinkCandidate(projectId, taskId)
  const [actionLoading, setActionLoading] = useState<Record<number, boolean>>({})

  const candidates = data?.data ?? []
  const total = data?.meta?.total ?? 0

  const handleConfirm = async (candidate: LinkCandidateDto) => {
    if (!canMutate) return
    setActionLoading((prev) => ({ ...prev, [candidate.id]: true }))
    try {
      await confirmMutation.mutateAsync({ candidateId: candidate.id })
    } finally {
      setActionLoading((prev) => ({ ...prev, [candidate.id]: false }))
    }
  }

  const handleIgnore = async (candidate: LinkCandidateDto) => {
    if (!canMutate) return
    setActionLoading((prev) => ({ ...prev, [candidate.id]: true }))
    try {
      await ignoreMutation.mutateAsync({ candidateId: candidate.id })
    } finally {
      setActionLoading((prev) => ({ ...prev, [candidate.id]: false }))
    }
  }

  // 无候选时不显示该区块
  if (!isLoading && !isError && total === 0) {
    return null
  }

  if (isLoading && total === 0) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-amber-800">自动检测</h3>
        <LoadingSpinner className="h-8 w-8" />
      </section>
    )
  }

  if (isError) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-amber-800">自动检测</h3>
        <p className="text-sm text-danger">候选加载失败</p>
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-amber-800">
          检测到关联候选
          {total > 0 && (
            <Badge variant="outline" className="ml-2 text-xs">
              {total}
            </Badge>
          )}
        </h3>
      </div>

      <p className="text-xs text-gray-500">
        以下是从代码仓库事件中检测到的可能关联。请逐条确认或忽略。
        确认后将在本任务下创建正式外部链接。
      </p>

      <ul className="space-y-2">
        {candidates.map((candidate) => (
          <CandidateCard
            key={candidate.id}
            candidate={candidate}
            canMutate={canMutate}
            onConfirm={() => handleConfirm(candidate)}
            onIgnore={() => handleIgnore(candidate)}
            actionLoading={actionLoading[candidate.id] ?? false}
          />
        ))}
      </ul>
    </section>
  )
}

function CandidateCard({
  candidate,
  canMutate,
  onConfirm,
  onIgnore,
  actionLoading,
}: {
  candidate: LinkCandidateDto
  canMutate: boolean
  onConfirm: () => void
  onIgnore: () => void
  actionLoading: boolean
}) {
  const eventTypeIcon =
    candidate.eventType === 'pull_request' ? (
      <GitPullRequest className="h-4 w-4" />
    ) : candidate.eventType === 'branch' ? (
      <GitBranch className="h-4 w-4" />
    ) : (
      <GitCommit className="h-4 w-4" />
    )

  const eventTypeLabel =
    candidate.eventType === 'pull_request'
      ? 'Pull Request'
      : candidate.eventType === 'branch'
        ? '分支'
        : '提交'

  // 计算年龄
  const createdAt = new Date(candidate.createdAt)
  const ageHours = Math.floor((Date.now() - createdAt.getTime()) / 3600000)
  const ageLabel =
    ageHours < 1 ? '刚刚' : ageHours < 24 ? `${ageHours}小时前` : `${Math.floor(ageHours / 24)}天前`

  return (
    <li className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 text-amber-600">{eventTypeIcon}</div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900">
                {candidate.repositoryFullName}
              </span>
              <Badge variant="info" className="text-xs">
                {eventTypeLabel} #{candidate.objectId}
              </Badge>
              <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">
                候选中
              </Badge>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              匹配任务: <span className="font-mono text-amber-700">{candidate.taskReference}</span>
              {candidate.taskTitle && (
                <span className="text-gray-500"> — {candidate.taskTitle}</span>
              )}
            </p>
            {candidate.evidences.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {candidate.evidences.map((ev, i) => (
                  <Badge key={i} variant="outline" className="text-xs text-gray-500">
                    {ev.sourceField}: &quot;{ev.matchedPreview}&quot;
                  </Badge>
                ))}
              </div>
            )}
            <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {ageLabel}
              </span>
              <span>规则 v{candidate.evidences[0]?.ruleVersion ?? 1}</span>
              <span>
                置信度:{' '}
                {candidate.confidenceClass === 'high'
                  ? '高'
                  : candidate.confidenceClass === 'medium'
                    ? '中'
                    : '低'}
              </span>
            </div>
          </div>
        </div>

        {canMutate && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onIgnore}
              disabled={actionLoading}
              className="text-gray-500"
            >
              忽略
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onConfirm}
              disabled={actionLoading}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {actionLoading ? <LoadingSpinner className="h-4 w-4" /> : '确认关联'}
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}
