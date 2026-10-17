import { useQuery } from '@tanstack/react-query'
import { resourceContentionApi, resourceContentionKeys } from '@/lib/api/resource-contentions'
import { useCurrentOrganizationId } from './use-organization-dashboard'
import type { ResourceContentionQuery } from '@aiproj/types'

/**
 * 资源争用检测 hooks（v3-resource-contention-detection §5.1）。
 *
 * 全部使用 TanStack Query v5，server state，组织隔离。
 * 读端点无副作用。
 */

/** 争用摘要 */
export function useResourceContentionSummary(query?: ResourceContentionQuery) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: resourceContentionKeys.summary(organizationId ?? 0, query),
    queryFn: () => resourceContentionApi.summary(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

/** 争用列表（可分页） */
export function useResourceContentionItems(query?: ResourceContentionQuery) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: resourceContentionKeys.items(organizationId ?? 0, query),
    queryFn: () => resourceContentionApi.items(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

/** 争用矩阵 */
export function useResourceContentionMatrix(query?: ResourceContentionQuery) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: resourceContentionKeys.matrix(organizationId ?? 0, query),
    queryFn: () => resourceContentionApi.matrix(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

/** 争用详情 */
export function useResourceContentionDetail(
  contentionId: string | null,
  query?: { from?: string; to?: string },
) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: resourceContentionKeys.detail(organizationId ?? 0, contentionId ?? ''),
    queryFn: () => resourceContentionApi.detail(organizationId as number, contentionId!, query),
    enabled: organizationId !== null && contentionId !== null,
    staleTime: 60_000,
  })
}

/** 低敏证据 */
export function useResourceContentionEvidence(contentionId: string | null) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: resourceContentionKeys.evidence(organizationId ?? 0, contentionId ?? ''),
    queryFn: () => resourceContentionApi.evidence(organizationId as number, contentionId!),
    enabled: organizationId !== null && contentionId !== null,
    staleTime: 60_000,
  })
}

/** 建议预览 */
export function useResourceContentionSuggestions(
  contentionId: string | null,
  kind: 'rule' | 'ai' = 'rule',
) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: resourceContentionKeys.suggestions(organizationId ?? 0, contentionId ?? ''),
    queryFn: () => resourceContentionApi.suggestions(organizationId as number, contentionId!, kind),
    enabled: organizationId !== null && contentionId !== null,
    staleTime: 30_000,
  })
}
