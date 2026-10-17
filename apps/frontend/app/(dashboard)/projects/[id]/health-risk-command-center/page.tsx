'use client'

import { useParams } from 'next/navigation'
import { useProjectHealthRiskCommandCenter } from '@/hooks/use-project-health-risk-command-center'
import { CommandCenterView, CommandCenterSkeleton } from '@/components/project/CommandCenterView'

/**
 * /projects/[id]/health-risk-command-center —— 项目健康风险指挥中心（§6.1）。
 *
 * 状态机：loading 同形骨架 → ready / empty / partial / stale 由视图内分区表达；
 * mandatory 失败整页 error + 重试；不使用内容中央 spinner。
 */
export default function HealthRiskCommandCenterPage() {
  const params = useParams()
  const rawId = Number(params?.id)
  const projectId = Number.isFinite(rawId) && rawId > 0 ? rawId : null

  const query = useProjectHealthRiskCommandCenter(projectId)

  // enabled=false（非法 id）或首载：同形骨架
  if (query.isPending && !query.data) {
    return <CommandCenterSkeleton />
  }

  return <CommandCenterView projectId={projectId ?? 0} query={query} />
}
