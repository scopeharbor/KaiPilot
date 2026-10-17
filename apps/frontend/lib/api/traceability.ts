/**
 * v2-traceability-source-attribution —— Traceability API client and TanStack Query keys.
 *
 * 四组 HTTP 端点：
 * - 按 Compiler Run 列表 attributions
 * - 单条 attribution 详情
 * - 按实体查询来源归因摘要
 * - 项目追溯链接列表
 *
 * 所有请求使用统一 apiFetch，自动携带认证与组织上下文。
 */
import { apiFetchEnvelope } from '@/lib/api-client'

// ---------------------------------------------------------------------------
// Types —— 与后端 controller 响应结构对齐
// ---------------------------------------------------------------------------

/** 列表模式下 attribution 摘要（listByCompilerRun 响应）。 */
export interface AttributionSummary {
  id: number
  compilerRunId: number
  stageId: string
  entityId: string | null
  fieldPath: string | null
  generatedBy: string
  confidence: number
  summary: string
  humanReviewStatus: string
  sourceRefCount: number
  createdAt: string
}

/** 单条 attribution 详情（getAttribution 响应）。 */
export interface AttributionDetail {
  id: number
  compilerRunId: number
  draftSessionId: number | null
  stageId: string
  entityId: string | null
  fieldPath: string | null
  sourceRefs: Array<{
    refId: string
    artifactKind: string
    version: number
    summaryLevel: string
    label?: string
    organizationId: number
    compilerRunId?: number
    stageId?: string
  }>
  generatedBy: {
    kind: string
    provider: string | null
    model: string | null
    ruleId: string | null
  }
  confidence: number
  assumptions: string[] | null
  summary: string
  evidenceSnippets: Array<{
    refId: string
    label?: string
    snippet: string
    charOffset?: number
    charLength?: number
    contentHash?: string
  }> | null
  humanReviewStatus: string
  humanReviewedBy: number | null
  createdAt: string
}

/** 字段级 attribution（entity source attribution 响应内嵌）。 */
export interface FieldAttribution {
  fieldPath: string
  generatedBy: string
  confidence: number
  summary: string
  attributionId: number
}

/** 实体来源归因摘要（getEntitySourceAttribution 响应）。 */
export interface EntitySourceAttribution {
  entityId: string
  entityType: string
  hasFieldLevel: boolean
  fieldAttributions: FieldAttribution[]
  entityAttribution: {
    attributionId: number
    generatedBy: string
    stageId: string
    confidence: number
    summary: string
    humanReviewStatus: string
    evidenceCount: number
    sourceRefCount: number
  } | null
}

/** 追溯链接（listProjectTraceabilityLinks 响应）。 */
export interface TraceabilityLink {
  linkId: number
  relationType: string
  direction: string
  sourceEntityType: string
  sourceEntityId: string
  targetEntityType: string
  targetEntityId: string
  strength: number
  attributionId: number | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/** GET /api/v1/ai/compiler/runs/:runId/attributions */
export async function fetchCompilerRunAttributions(runId: number): Promise<AttributionSummary[]> {
  const res = await apiFetchEnvelope<{ data: AttributionSummary[] }>(
    `/ai/compiler/runs/${runId}/attributions`,
  )
  return res.data
}

/** GET /api/v1/ai/compiler/runs/:runId/attributions/:id */
export async function fetchAttributionDetail(
  runId: number,
  id: number,
): Promise<AttributionDetail> {
  const res = await apiFetchEnvelope<{ data: AttributionDetail }>(
    `/ai/compiler/runs/${runId}/attributions/${id}`,
  )
  return res.data
}

/** GET /api/v1/ai/compiler/projects/:projectId/entities/:entityType/:entityId/source-attribution */
export async function fetchEntitySourceAttribution(
  projectId: number,
  entityType: string,
  entityId: string,
): Promise<EntitySourceAttribution> {
  const res = await apiFetchEnvelope<{ data: EntitySourceAttribution }>(
    `/ai/compiler/projects/${projectId}/entities/${entityType}/${entityId}/source-attribution`,
  )
  return res.data
}

/** GET /api/v1/ai/compiler/projects/:projectId/traceability/links */
export async function fetchProjectTraceabilityLinks(
  projectId: number,
): Promise<TraceabilityLink[]> {
  const res = await apiFetchEnvelope<{ data: TraceabilityLink[] }>(
    `/ai/compiler/projects/${projectId}/traceability/links`,
  )
  return res.data
}

// ---------------------------------------------------------------------------
// TanStack Query keys
// ---------------------------------------------------------------------------

export const traceabilityKeys = {
  all: ['traceability'] as const,
  attributions: {
    all: () => [...traceabilityKeys.all, 'attributions'] as const,
    byRun: (runId: number) => [...traceabilityKeys.attributions.all(), runId] as const,
    detail: (runId: number, id: number) =>
      [...traceabilityKeys.attributions.byRun(runId), id] as const,
  },
  entity: {
    all: (projectId: number) => [...traceabilityKeys.all, 'entity', projectId] as const,
    byEntity: (projectId: number, entityType: string, entityId: string) =>
      [...traceabilityKeys.entity.all(projectId), entityType, entityId] as const,
  },
  links: {
    all: () => [...traceabilityKeys.all, 'links'] as const,
    byProject: (projectId: number) => [...traceabilityKeys.links.all(), projectId] as const,
  },
}
