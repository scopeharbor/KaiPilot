import { useQuery } from '@tanstack/react-query'
import {
  fetchResourceSkillMatrixSummary,
  fetchResourceSkillMatrix,
  fetchResourceSkillMatrixCoverage,
  fetchResourceSkillMatrixGaps,
  fetchResourceSkillMatrixCandidates,
  fetchResourceSkillMatrixSkillDetail,
  fetchResourceSkillMatrixDrillDown,
  resourceSkillMatrixKeys,
} from '@/lib/api/resource-skill-matrix'
import type { ResourceSkillMatrixQuery } from '@aiproj/types'

export function useResourceSkillMatrixSummary(
  organizationId: number,
  query?: ResourceSkillMatrixQuery,
) {
  return useQuery({
    queryKey: resourceSkillMatrixKeys.summary(organizationId, query),
    queryFn: () => fetchResourceSkillMatrixSummary(organizationId, query),
    staleTime: 60_000,
  })
}

export function useResourceSkillMatrix(organizationId: number, query?: ResourceSkillMatrixQuery) {
  return useQuery({
    queryKey: resourceSkillMatrixKeys.matrix(organizationId, query),
    queryFn: () => fetchResourceSkillMatrix(organizationId, query),
    staleTime: 60_000,
  })
}

export function useResourceSkillMatrixCoverage(
  organizationId: number,
  query?: ResourceSkillMatrixQuery,
) {
  return useQuery({
    queryKey: resourceSkillMatrixKeys.coverage(organizationId, query),
    queryFn: () => fetchResourceSkillMatrixCoverage(organizationId, query),
    staleTime: 120_000,
  })
}

export function useResourceSkillMatrixGaps(
  organizationId: number,
  query?: ResourceSkillMatrixQuery,
) {
  return useQuery({
    queryKey: resourceSkillMatrixKeys.gaps(organizationId, query),
    queryFn: () => fetchResourceSkillMatrixGaps(organizationId, query),
    staleTime: 60_000,
  })
}

export function useResourceSkillMatrixCandidates(
  organizationId: number,
  skillKey: string,
  query?: ResourceSkillMatrixQuery,
) {
  return useQuery({
    queryKey: resourceSkillMatrixKeys.candidates(organizationId, skillKey, query),
    queryFn: () => fetchResourceSkillMatrixCandidates(organizationId, skillKey, query),
    staleTime: 60_000,
    enabled: !!skillKey,
  })
}

export function useResourceSkillMatrixSkillDetail(
  organizationId: number,
  skillKey: string | undefined,
) {
  return useQuery({
    queryKey: resourceSkillMatrixKeys.skillDetail(organizationId, skillKey ?? ''),
    queryFn: () => fetchResourceSkillMatrixSkillDetail(organizationId, skillKey!),
    staleTime: 120_000,
    enabled: !!skillKey,
  })
}

export function useResourceSkillMatrixDrillDown(
  organizationId: number,
  itemType: 'resource' | 'task_requirement' | 'project' | undefined,
  skillKey: string | undefined,
) {
  return useQuery({
    queryKey: resourceSkillMatrixKeys.drillDown(organizationId, itemType ?? '', skillKey ?? ''),
    queryFn: () => fetchResourceSkillMatrixDrillDown(organizationId, itemType!, skillKey!),
    staleTime: 60_000,
    enabled: !!itemType && !!skillKey,
  })
}
