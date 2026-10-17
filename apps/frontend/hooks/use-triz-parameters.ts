'use client'

import { useQuery } from '@tanstack/react-query'
import { trizCopilotApi, type TrizParameterItem } from '@/lib/api/triz-copilot'

export const trizParameterKeys = {
  all: ['triz-copilot'] as const,
  parameters: (projectId: number) => [...trizParameterKeys.all, 'parameters', projectId] as const,
}

/**
 * 矛盾参数动态拉取 Hook（v3-triz-copilot-followups B5 · tasks 9.1）。
 *
 * 包装后端只读端点 `GET /api/v1/projects/:projectId/triz-copilot/parameters`：
 * 39 项参数元数据（只读、纯静态知识库）。
 * 配置 `staleTime: Infinity` 与 `gcTime: 1000 * 60 * 60`（1 小时长缓存）。
 */
export function useTrizParameters(projectId: number) {
  return useQuery<TrizParameterItem[]>({
    queryKey: trizParameterKeys.parameters(projectId),
    queryFn: async () => {
      const envelope = await trizCopilotApi.getParameters(projectId)
      return envelope.data
    },
    enabled: typeof projectId === 'number' && Number.isFinite(projectId) && projectId > 0,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60,
  })
}
