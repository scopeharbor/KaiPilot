// 多项目依赖检测 API client（v3-multi-project-dependency-detection §6.1）。
// TanStack Query keys + API fetch helpers。
import { apiFetch } from '@/lib/api-client'
import type {
  DetectionScope,
  DetectionPlan,
  DetectionRun,
  DetectionRunListResponse,
  DetectionResult,
  DetectionResultListResponse,
} from '@aiproj/types'

function buildQuery(filters: Record<string, unknown>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        query.set(key, value.join(','))
      } else {
        query.set(key, String(value))
      }
    }
  }
  return query.size ? `?${query.toString()}` : ''
}

const basePath = (organizationId: number | string) =>
  `/organizations/${organizationId}/multi-project-dependencies/detections`

export const mpdDetectionKeys = {
  all: (organizationId: number | string) =>
    ['multi-project-dependencies', 'detections', organizationId] as const,

  plan: (organizationId: number | string, scopeHash: string) =>
    [...mpdDetectionKeys.all(organizationId), 'plan', scopeHash] as const,

  runs: (organizationId: number | string, filters?: Record<string, unknown>) =>
    [...mpdDetectionKeys.all(organizationId), 'runs', filters ?? {}] as const,

  results: (organizationId: number | string, filters?: Record<string, unknown>) =>
    [...mpdDetectionKeys.all(organizationId), 'results', filters ?? {}] as const,

  resultDetail: (organizationId: number | string, resultId: number) =>
    [...mpdDetectionKeys.all(organizationId), 'result', resultId] as const,
}

export const mpdDetectionApi = {
  // ── 检测计划 ──
  plan: (organizationId: number | string, scope: DetectionScope) =>
    apiFetch<{ data: DetectionPlan }>(`${basePath(organizationId)}/plan`, {
      method: 'POST',
      body: JSON.stringify({ organizationId, scope }),
    }),

  // ── 执行检测 ──
  run: (organizationId: number | string, planToken: string) =>
    apiFetch<{ data: DetectionRun; results: DetectionResult[] }>(
      `${basePath(organizationId)}/run`,
      { method: 'POST', body: JSON.stringify({ organizationId, planToken }) },
    ),

  // ── 检测批次列表 ──
  listRuns: (organizationId: number | string, filters?: Record<string, unknown>) =>
    apiFetch<DetectionRunListResponse>(
      `${basePath(organizationId)}/runs${buildQuery(filters ?? {})}`,
    ),

  // ── 检测结果列表 ──
  listResults: (organizationId: number | string, filters?: Record<string, unknown>) =>
    apiFetch<DetectionResultListResponse>(
      `${basePath(organizationId)}/results${buildQuery(filters ?? {})}`,
    ),

  // ── 检测结果详情 ──
  resultDetail: (organizationId: number | string, resultId: number) =>
    apiFetch<{ data: DetectionResult }>(`${basePath(organizationId)}/results/${resultId}`),

  // ── 忽略结果 ──
  ignoreResult: (organizationId: number | string, resultId: number, reasonHash?: string) =>
    apiFetch<{ data: DetectionResult }>(`${basePath(organizationId)}/results/${resultId}/ignore`, {
      method: 'POST',
      body: JSON.stringify({ reasonHash }),
    }),

  // ── 重新打开结果 ──
  reopenResult: (organizationId: number | string, resultId: number, reasonHash?: string) =>
    apiFetch<{ data: DetectionResult }>(`${basePath(organizationId)}/results/${resultId}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ reasonHash }),
    }),
}
