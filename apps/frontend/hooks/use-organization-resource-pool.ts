import { useQuery } from '@tanstack/react-query'
import {
  organizationResourcePoolApi,
  organizationResourcePoolKeys,
} from '@/lib/api/organization-resource-pool'
import { useCurrentOrganizationId } from './use-organization-dashboard'
import type { OrganizationResourcePoolQuery } from '@aiproj/types'

/**
 * 组织资源池 summary（v3-organization-resource-pool §6.1）。
 */
export function useOrganizationResourcePoolSummary(query?: OrganizationResourcePoolQuery) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: organizationResourcePoolKeys.summary(organizationId ?? 0, query),
    queryFn: () => organizationResourcePoolApi.summary(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

export function useOrganizationResourcePoolResources(query?: OrganizationResourcePoolQuery) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: organizationResourcePoolKeys.resources(organizationId ?? 0, query),
    queryFn: () => organizationResourcePoolApi.resources(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

export function useOrganizationResourcePoolSkills(query?: OrganizationResourcePoolQuery) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: organizationResourcePoolKeys.skills(organizationId ?? 0, query),
    queryFn: () => organizationResourcePoolApi.skills(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

export function useOrganizationResourcePoolCapacity(query?: OrganizationResourcePoolQuery) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: organizationResourcePoolKeys.capacity(organizationId ?? 0, query),
    queryFn: () => organizationResourcePoolApi.capacity(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

export function useOrganizationResourcePoolConflicts(query?: OrganizationResourcePoolQuery) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: organizationResourcePoolKeys.conflicts(organizationId ?? 0, query),
    queryFn: () => organizationResourcePoolApi.conflicts(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

export function useOrganizationResourcePoolDemandGaps(query?: OrganizationResourcePoolQuery) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: organizationResourcePoolKeys.demandGaps(organizationId ?? 0, query),
    queryFn: () => organizationResourcePoolApi.demandGaps(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}
