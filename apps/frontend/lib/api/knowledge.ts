/**
 * v3-four-layer-knowledge-system —— 知识库 API 客户端。
 *
 * 提供知识记录列表/详情/创建/更新/确认/生命周期转移/结构化/检索的前端 API 接口。
 */
import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import type {
  CreateKnowledgeRequest,
  KnowledgeItem,
  KnowledgeItemLowSensitiveProjection,
} from '@aiproj/types'

export interface KnowledgeListResponse {
  data: KnowledgeItemLowSensitiveProjection[]
  meta: { total: number; page: number; perPage: number; totalPages?: number }
}

export interface KnowledgeDetailResponse {
  data: KnowledgeItem
}

export interface KnowledgeCreateResponse {
  data: KnowledgeItem
}

export interface KnowledgeStructureResponse {
  data: {
    candidates: KnowledgeItem[]
    summary: string
  }
}

export interface KnowledgeStructureBody {
  rawText: string
  domain?: string
}

export const knowledgeApi = {
  /**
   * 列表 / 检索。
   *
   * 契约响应是 `{ data, meta }` 信封（api-contract 冻结点）——
   * 用 `apiFetchEnvelope` 保留信封，避免 `apiFetch`（lib/api-client.ts:198）
   * 把 `body.data` 展开成数组后与 `KnowledgeListResponse` 类型失配。
   */
  list: (params?: Record<string, unknown>) =>
    apiFetchEnvelope<KnowledgeListResponse>(
      `/knowledge${params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''}`,
    ),

  /** 详情（契约：`{ data: KnowledgeItem }` 完整记录，审查抽屉依赖 content/reviewHistory）。 */
  getById: (id: number) => apiFetchEnvelope<KnowledgeDetailResponse>(`/knowledge/${id}`),

  /** 创建 */
  create: (body: CreateKnowledgeRequest) =>
    apiFetch<KnowledgeCreateResponse>('/knowledge', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** 更新 */
  update: (id: number, body: Partial<CreateKnowledgeRequest>) =>
    apiFetch<KnowledgeDetailResponse>(`/knowledge/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /** 人工确认转正 */
  confirm: (id: number) =>
    apiFetch<KnowledgeDetailResponse>(`/knowledge/${id}/confirm`, {
      method: 'POST',
    }),

  /** 生命周期转移 */
  transitionLifecycle: (id: number, body: { status: string }) =>
    apiFetch<KnowledgeDetailResponse>(`/knowledge/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** AI 结构化 */
  structure: (body: KnowledgeStructureBody) =>
    apiFetch<KnowledgeStructureResponse>('/knowledge/structure', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}
