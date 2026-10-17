/**
 * PMO Priority Scoring —— 前端 API client 函数
 *
 * v3-pmo-priority-scoring-model §5.1
 *
 * 使用 apiFetch 封装所有 PMO 优先级评分端点调用。
 */
import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'

import type {
  PriorityScoringSummary,
  PriorityScoringListResponse,
  PriorityGroupSliceResponse,
  PriorityWeightVersion,
  PriorityScoreDetail,
} from '@aiproj/types'

// 路径相对 API_BASE_URL（已含 /api/v1），故此处不再重复前缀。
const BASE = '/pmo/priority-scoring'

// ─── Query Keys ──────────────────────────────────────────────

export const priorityScoringKeys = {
  all: ['pmo', 'priority-scoring'] as const,
  summary: (version?: string) => [...priorityScoringKeys.all, 'summary', version] as const,
  projects: (params: Record<string, unknown> = {}) =>
    [...priorityScoringKeys.all, 'projects', params] as const,
  groups: (groupBy: string, version?: string) =>
    [...priorityScoringKeys.all, 'groups', groupBy, version] as const,
  weights: (version?: string) => [...priorityScoringKeys.all, 'weights', version] as const,
  detail: (projectId: number, version?: string) =>
    [...priorityScoringKeys.all, 'detail', projectId, version] as const,
}

// ─── Fetch Functions ─────────────────────────────────────────

/** 评分摘要 */
export async function fetchPriorityScoringSummary(scoreVersion?: string) {
  const params = new URLSearchParams()
  if (scoreVersion) params.set('scoreVersion', scoreVersion)
  const qs = params.toString()
  return apiFetch<PriorityScoringSummary>(`${BASE}/summary${qs ? `?${qs}` : ''}`)
}

/** 项目评分列表 */
export async function fetchPriorityScoringProjects(
  query: {
    page?: number
    perPage?: number
    sort?: string
    priorityLevels?: string[]
    scoreVersion?: string
    groupBy?: string
  } = {},
) {
  const params = new URLSearchParams()
  if (query.page) params.set('page', String(query.page))
  if (query.perPage) params.set('perPage', String(query.perPage))
  if (query.sort) params.set('sort', query.sort)
  if (query.priorityLevels?.length) {
    for (const level of query.priorityLevels) {
      params.append('priorityLevels', level)
    }
  }
  if (query.scoreVersion) params.set('scoreVersion', query.scoreVersion)
  if (query.groupBy) params.set('groupBy', query.groupBy)
  const qs = params.toString()
  return apiFetchEnvelope<PriorityScoringListResponse>(`${BASE}/projects${qs ? `?${qs}` : ''}`)
}

/** 分组切片 */
export async function fetchPriorityScoringGroups(query: {
  groupBy: string
  scoreVersion?: string
  page?: number
  perPage?: number
}) {
  const params = new URLSearchParams()
  params.set('groupBy', query.groupBy)
  if (query.scoreVersion) params.set('scoreVersion', query.scoreVersion)
  if (query.page) params.set('page', String(query.page))
  if (query.perPage) params.set('perPage', String(query.perPage))
  return apiFetchEnvelope<PriorityGroupSliceResponse>(`${BASE}/groups?${params.toString()}`)
}

/** 权重版本说明 */
export async function fetchPriorityScoringWeights(scoreVersion?: string) {
  const params = new URLSearchParams()
  if (scoreVersion) params.set('scoreVersion', scoreVersion)
  const qs = params.toString()
  return apiFetch<PriorityWeightVersion>(`${BASE}/weights${qs ? `?${qs}` : ''}`)
}

/** 项目评分详情 */
export async function fetchPriorityScoringDetail(
  projectId: number,
  query: { scoreVersion?: string; includeGroupSlices?: boolean } = {},
) {
  const params = new URLSearchParams()
  if (query.scoreVersion) params.set('scoreVersion', query.scoreVersion)
  if (query.includeGroupSlices) params.set('includeGroupSlices', 'true')
  const qs = params.toString()
  return apiFetch<PriorityScoreDetail>(`${BASE}/projects/${projectId}${qs ? `?${qs}` : ''}`)
}
