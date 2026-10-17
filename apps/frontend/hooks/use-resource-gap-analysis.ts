import { useQuery } from '@tanstack/react-query'
import { resourceGapApi, resourceGapKeys } from '@/lib/api/resource-gap-analysis'
import { useCurrentOrganizationId } from './use-organization-dashboard'
import type { ResourceGapQuery } from '@aiproj/types'

/**
 * 资源缺口分析 TanStack Query hooks（v3-resource-gap-analysis §8.1）。
 */

/** 缺口分析摘要 */
export function useResourceGapSummary(query?: ResourceGapQuery) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: resourceGapKeys.summary(organizationId ?? 0, query),
    queryFn: () => resourceGapApi.summary(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

/** 缺口分析 by-role 维度 */
export function useResourceGapByRole(query?: ResourceGapQuery) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: resourceGapKeys.byRole(organizationId ?? 0, query),
    queryFn: () => resourceGapApi.byRole(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

/** 缺口分析 by-skill 维度 */
export function useResourceGapBySkill(query?: ResourceGapQuery) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: resourceGapKeys.bySkill(organizationId ?? 0, query),
    queryFn: () => resourceGapApi.bySkill(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

/** 缺口分析 by-timebucket 维度 */
export function useResourceGapByTimebucket(query?: ResourceGapQuery) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: resourceGapKeys.byTimebucket(organizationId ?? 0, query),
    queryFn: () => resourceGapApi.byTimebucket(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

/** 缺口分析 by-project 维度 */
export function useResourceGapByProject(query?: ResourceGapQuery) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: resourceGapKeys.byProject(organizationId ?? 0, query),
    queryFn: () => resourceGapApi.byProject(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

/** 缺口分析 by-portfolio 维度 */
export function useResourceGapByPortfolio(query?: ResourceGapQuery) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: resourceGapKeys.byPortfolio(organizationId ?? 0, query),
    queryFn: () => resourceGapApi.byPortfolio(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

/** 缺口原因解释 */
export function useResourceGapExplanation(gapId: string, includeAi?: boolean) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: resourceGapKeys.explanation(organizationId ?? 0, gapId, includeAi),
    queryFn: () => resourceGapApi.explanation(organizationId as number, gapId, includeAi),
    enabled: organizationId !== null && gapId.length > 0,
    staleTime: 120_000,
  })
}

/** 缺口下钻 */
export function useResourceGapDrillDown(gapId: string, sourceCapability?: string) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: resourceGapKeys.drillDown(organizationId ?? 0, gapId, sourceCapability),
    queryFn: () => resourceGapApi.drillDown(organizationId as number, gapId, sourceCapability),
    enabled: organizationId !== null && gapId.length > 0,
    staleTime: 120_000,
  })
}
