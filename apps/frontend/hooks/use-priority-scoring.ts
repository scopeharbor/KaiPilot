/**
 * PMO Priority Scoring —— TanStack Query hooks
 *
 * v3-pmo-priority-scoring-model §5.1
 */
import { useQuery } from '@tanstack/react-query'
import {
  priorityScoringKeys,
  fetchPriorityScoringSummary,
  fetchPriorityScoringProjects,
  fetchPriorityScoringGroups,
  fetchPriorityScoringWeights,
  fetchPriorityScoringDetail,
} from '@/lib/api/pmo-priority-scoring'

export function usePriorityScoringSummary(scoreVersion?: string) {
  return useQuery({
    queryKey: priorityScoringKeys.summary(scoreVersion),
    queryFn: () => fetchPriorityScoringSummary(scoreVersion),
    staleTime: 60_000,
  })
}

export function usePriorityScoringProjects(
  query: {
    page?: number
    perPage?: number
    sort?: string
    priorityLevels?: string[]
    scoreVersion?: string
    groupBy?: string
  } = {},
) {
  return useQuery({
    queryKey: priorityScoringKeys.projects(query),
    queryFn: () => fetchPriorityScoringProjects(query),
    staleTime: 30_000,
  })
}

export function usePriorityScoringGroups(query: {
  groupBy: string
  scoreVersion?: string
  page?: number
  perPage?: number
}) {
  return useQuery({
    queryKey: priorityScoringKeys.groups(query.groupBy, query.scoreVersion),
    queryFn: () => fetchPriorityScoringGroups(query),
    staleTime: 60_000,
  })
}

export function usePriorityScoringWeights(scoreVersion?: string) {
  return useQuery({
    queryKey: priorityScoringKeys.weights(scoreVersion),
    queryFn: () => fetchPriorityScoringWeights(scoreVersion),
    staleTime: 5 * 60_000,
  })
}

export function usePriorityScoringDetail(
  projectId: number | null,
  query: { scoreVersion?: string; includeGroupSlices?: boolean } = {},
) {
  return useQuery({
    queryKey: priorityScoringKeys.detail(projectId!, query.scoreVersion),
    queryFn: () => fetchPriorityScoringDetail(projectId!, query),
    enabled: projectId !== null && projectId > 0,
    staleTime: 60_000,
  })
}
