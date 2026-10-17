import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  DocumentIntelligenceListQuery,
  DocumentIntelligenceListResponse,
  DocumentIntelligenceSourceDetail,
  DocumentIntelligenceSourceKind,
} from '@aiproj/types'

/**
 * 文档智能工作台 —— 前端 API 客户端（v3-document-intelligence-workbench §4.1）。
 *
 * 红线：
 * - 只读。工作台不提供任何 create/confirm/index/extract/link 端点；
 *   敏感写入继续由既有 owning API（OCR review / search-index / structured / entity-link）执行。
 * - 查询参数只序列化 allowlist 键，且只在有值时出现，保证 query key 与 URL 稳定。
 */

/** 列表查询的可选投影（未给出的键不会出现在 query string 中） */
export type DocumentIntelligenceListParams = Partial<DocumentIntelligenceListQuery>

function buildQuery(params?: DocumentIntelligenceListParams): string {
  if (!params) return ''
  const qs = new URLSearchParams()
  if (params.attention) qs.set('attention', params.attention)
  if (params.sourceKind) qs.set('sourceKind', params.sourceKind)
  if (params.capability) qs.set('capability', params.capability)
  if (params.status) qs.set('status', params.status)
  if (params.sort) qs.set('sort', params.sort)
  if (params.direction) qs.set('direction', params.direction)
  if (params.page) qs.set('page', String(params.page))
  if (params.perPage) qs.set('perPage', String(params.perPage))
  if (params.search) qs.set('search', params.search)
  const s = qs.toString()
  return s ? `?${s}` : ''
}

export const documentIntelligenceApi = {
  /** 来源清单（服务端权威 read model，返回 `{ data, meta }`） */
  listSources: (
    projectId: number,
    params?: DocumentIntelligenceListParams,
    init?: { signal?: AbortSignal },
  ) =>
    apiFetchEnvelope<DocumentIntelligenceListResponse>(
      `/projects/${projectId}/document-intelligence/sources${buildQuery(params)}`,
      init?.signal ? { signal: init.signal } : {},
    ),

  /** 来源详情（证据与治理视图；深链恢复时由服务端重新裁决可见性与入口） */
  sourceDetail: (
    projectId: number,
    sourceKind: DocumentIntelligenceSourceKind,
    sourceId: number,
    init?: { signal?: AbortSignal },
  ) =>
    apiFetchEnvelope<{ data: DocumentIntelligenceSourceDetail }>(
      `/projects/${projectId}/document-intelligence/sources/${sourceKind}/${sourceId}`,
      init?.signal ? { signal: init.signal } : {},
    ),
}

/** 分层 query keys：按项目隔离，跨项目缓存互不污染 */
export const documentIntelligenceKeys = {
  all: ['document-intelligence'] as const,
  project: (projectId: number) => [...documentIntelligenceKeys.all, projectId] as const,
  sources: (projectId: number) =>
    [...documentIntelligenceKeys.project(projectId), 'sources'] as const,
  sourceList: (projectId: number, params?: DocumentIntelligenceListParams) =>
    [...documentIntelligenceKeys.sources(projectId), 'list', params ?? {}] as const,
  sourceDetail: (projectId: number, sourceKind: DocumentIntelligenceSourceKind, sourceId: number) =>
    [...documentIntelligenceKeys.sources(projectId), 'detail', sourceKind, sourceId] as const,
}
