/**
 * 图表馆 TRIZ 分馆前端 API 客户端（v3-triz-contradiction-copilot W7 · tasks 7.1-7.6）。
 *
 * 对接后端 W4 端点组：
 * 1. 分馆产物 CRUD（`/api/v1/projects/:projectId/triz-gallery-artifacts`）
 *    - `GET    /`                     列表（支持类型过滤、分页、历史包含）
 *    - `POST   /`                     创建产物快照（链内首版 / 下一版）
 *    - `GET    /:artifactId`          详情（支持取特定 version）
 *    - `GET    /:artifactId/versions` 版本链历史（供回退）
 *    - `PATCH  /:artifactId`          更新（版本递增，旧版本行保留）
 *    - `DELETE /:artifactId`          软删除整条版本链
 * 2. 分馆只读查询（`/api/v1/projects/:projectId/triz-gallery`）
 *    - `GET    /matrix-principles`    参数对查询推荐原则（零写、零模型调用）
 *    - `GET    /prefill`              九屏幕/功能分析预填草案（只产草案不落库）
 *
 * 权限（design D17 ③）：
 * - 读取要求 `project:view`；
 * - 产物写入要求 `diagram:manage`（沿用既有权限码，不新增权限码）；
 * - 跨组织/不存在统一 404（RL-05）。
 *
 * 契约：
 * - 严格采用 `apiFetchEnvelope` 解包；
 * - 写入集合仅限分馆产物实体，业务表（任务/风险/变更）零写入。
 */
import { apiFetchEnvelope } from '@/lib/api-client'

// ---------------------------------------------------------------------------
// 路径
// ---------------------------------------------------------------------------

export const trizGalleryArtifactsPath = (projectId: number) =>
  `/projects/${projectId}/triz-gallery-artifacts`

export const trizGalleryPath = (projectId: number) => `/projects/${projectId}/triz-gallery`

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 四类分馆产物类型（与后端 TrizGalleryArtifactType 严格对齐） */
export const TRIZ_GALLERY_ARTIFACT_TYPES = [
  'contradiction_matrix',
  'nine_windows',
  'function_analysis',
  's_curve',
] as const

export type TrizGalleryArtifactType = (typeof TRIZ_GALLERY_ARTIFACT_TYPES)[number]

export const TRIZ_GALLERY_ARTIFACT_TYPE_LABELS: Readonly<Record<TrizGalleryArtifactType, string>> =
  {
    contradiction_matrix: '矛盾矩阵快照',
    nine_windows: '九屏幕',
    function_analysis: '功能分析',
    s_curve: '进化 S 曲线快照',
  }

/** 产物 DTO */
export interface TrizGalleryArtifactDTO {
  id: number
  organizationId: number
  projectId: number
  artifactType: TrizGalleryArtifactType
  artifactTypeLabel: string
  content: Record<string, unknown>
  version: number
  isCurrent: boolean
  createdBy: number
  updatedBy: number | null
  createdAt: string | null
  updatedAt: string | null
  deletedAt: string | null
  deleted: boolean
}

/** 列表查询参数 */
export interface ListTrizGalleryArtifactsParams {
  artifactType?: TrizGalleryArtifactType
  includeDeleted?: boolean
  history?: boolean
  page?: number
  perPage?: number
}

// ---------------------------------------------------------------------------
// 矛盾矩阵参数对查询结果类型
// ---------------------------------------------------------------------------

export interface TrizGalleryMatrixParameterRef {
  number: number
  displayName: string
  nameZh: string
  nameEn: string
  category: string
  pmMeaning: string
}

export interface TrizGalleryMatrixPrincipleRef {
  number: number
  displayName: string
  nameZh: string
  nameEn: string
  nameRu: string
  definition: string
  pmInterpretation: string
}

export interface TrizGalleryMatrixMapping {
  kind: 'pm-pair' | 'classic-scenario'
  id: string
  title: string
  scenario: string
  principleNumbers: number[]
  recommendations: string[]
  source: string
}

export interface TrizGalleryMatrixPrinciplesResult {
  improving: TrizGalleryMatrixParameterRef | null
  worsening: TrizGalleryMatrixParameterRef | null
  matched: boolean
  empty: boolean
  hint: string | null
  mappings: TrizGalleryMatrixMapping[]
  principles: TrizGalleryMatrixPrincipleRef[]
  knowledgePack: {
    version: string
    parametersCount: number
    principlesCount: number
    scenariosCount: number
  }
}

// ---------------------------------------------------------------------------
// 预填草案类型（九屏幕 / 功能分析）
// ---------------------------------------------------------------------------

export type TrizGalleryPrefillArtifactType = 'nine_windows' | 'function_analysis'
export type TrizGalleryPrefillSource = 'model' | 'template' | 'generic-template'
export type TrizGalleryPrefillPath = 'ai' | 'rule'
export type TrizFunctionEdgeType = 'useful' | 'harmful' | 'insufficient' | 'excessive'

export interface TrizNineWindowsCellDraft {
  key: string
  timeAxis: 'past' | 'present' | 'future'
  levelAxis: 'supersystem' | 'system' | 'subsystem'
  timeLabel: string
  levelLabel: string
  prompt: string
  text: string
  source: TrizGalleryPrefillSource
  contextRefs: string[]
  locked: boolean
}

export interface TrizNineWindowsPrefillDraft {
  persisted: false
  requiresHumanConfirmation: true
  path: TrizGalleryPrefillPath
  fallbackReasons: string[]
  qualityFlags: string[]
  contextRefs: string[]
  artifactType: 'nine_windows'
  cells: TrizNineWindowsCellDraft[]
  centerKey: string
  filledCells: number
}

export interface TrizFunctionNodeDraft {
  id: string
  kind: 'system' | 'task' | 'risk' | 'resource' | 'milestone'
  label: string
  source: TrizGalleryPrefillSource
  contextRef: string | null
}

export interface TrizFunctionEdgeDraft {
  id: string
  from: string
  to: string
  edgeType: 'useful' | 'harmful' | 'insufficient' | 'excessive'
  label: string
  source: TrizGalleryPrefillSource
}

export interface TrizFunctionAnalysisPrefillDraft {
  persisted: false
  requiresHumanConfirmation: true
  path: TrizGalleryPrefillPath
  fallbackReasons: string[]
  qualityFlags: string[]
  contextRefs: string[]
  artifactType: 'function_analysis'
  nodes: TrizFunctionNodeDraft[]
  edges: TrizFunctionEdgeDraft[]
  problemCandidates: Array<{ id: string; kind: string; message: string; contextRefs: string[] }>
}

export type TrizGalleryPrefillDraft = TrizNineWindowsPrefillDraft | TrizFunctionAnalysisPrefillDraft

// ---------------------------------------------------------------------------
// 基础信封包类型
// ---------------------------------------------------------------------------

interface ApiDataEnvelope<T> {
  data: T
}

interface ApiListEnvelope<T> {
  data: T[]
  meta?: { total: number; page: number; perPage: number; totalPages: number }
}

// ---------------------------------------------------------------------------
// API 客户端
// ---------------------------------------------------------------------------

function toQueryString(params?: Record<string, unknown>): string {
  if (!params) return ''
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) search.set(k, String(v))
  }
  return search.size ? `?${search.toString()}` : ''
}

export const trizGalleryApi = {
  /** 查询矛盾矩阵参数对命中原则（知识包只读投影，零写） */
  async getMatrixPrinciples(
    projectId: number,
    improving: number,
    worsening: number,
  ): Promise<TrizGalleryMatrixPrinciplesResult> {
    const qs = toQueryString({ improving, worsening })
    const res = await apiFetchEnvelope<ApiDataEnvelope<TrizGalleryMatrixPrinciplesResult>>(
      `${trizGalleryPath(projectId)}/matrix-principles${qs}`,
    )
    return res.data
  },

  /** 查询预填草案（九屏幕九格 / 功能分析初始拓扑，只产草案不落库） */
  async getPrefillDraft<T extends TrizGalleryPrefillDraft = TrizGalleryPrefillDraft>(
    projectId: number,
    artifactType: TrizGalleryPrefillArtifactType,
    asOfDate?: string,
  ): Promise<T> {
    const qs = toQueryString({ artifactType, asOfDate })
    const res = await apiFetchEnvelope<ApiDataEnvelope<T>>(
      `${trizGalleryPath(projectId)}/prefill${qs}`,
    )
    return res.data
  },

  /** 分馆产物列表（支持类型过滤、分页与历史） */
  async listArtifacts(
    projectId: number,
    params?: ListTrizGalleryArtifactsParams,
  ): Promise<{
    data: TrizGalleryArtifactDTO[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const qs = toQueryString(params as Record<string, unknown>)
    const res = await apiFetchEnvelope<ApiListEnvelope<TrizGalleryArtifactDTO>>(
      `${trizGalleryArtifactsPath(projectId)}${qs}`,
    )
    return {
      data: res.data,
      meta: (res.meta ?? {
        total: res.data.length,
        page: 1,
        perPage: res.data.length,
        totalPages: 1,
      }) as { total: number; page: number; perPage: number; totalPages: number },
    }
  },

  /** 查询指定产物详情（可指定 version 查旧版本） */
  async getArtifact(
    projectId: number,
    artifactId: number,
    options?: { version?: number; includeDeleted?: boolean },
  ): Promise<TrizGalleryArtifactDTO> {
    const qs = toQueryString(options as Record<string, unknown>)
    const res = await apiFetchEnvelope<ApiDataEnvelope<TrizGalleryArtifactDTO>>(
      `${trizGalleryArtifactsPath(projectId)}/${artifactId}${qs}`,
    )
    return res.data
  },

  /** 查询产物版本链历史 */
  async getArtifactVersions(
    projectId: number,
    artifactId: number,
    options?: { includeDeleted?: boolean },
  ): Promise<TrizGalleryArtifactDTO[]> {
    const qs = toQueryString(options as Record<string, unknown>)
    const res = await apiFetchEnvelope<ApiDataEnvelope<TrizGalleryArtifactDTO[]>>(
      `${trizGalleryArtifactsPath(projectId)}/${artifactId}/versions${qs}`,
    )
    return res.data
  },

  /** 创建分馆产物（链内首版，需 diagram:manage） */
  async createArtifact(
    projectId: number,
    payload: {
      artifactType: TrizGalleryArtifactType
      content: Record<string, unknown>
    },
  ): Promise<TrizGalleryArtifactDTO> {
    const res = await apiFetchEnvelope<ApiDataEnvelope<TrizGalleryArtifactDTO>>(
      trizGalleryArtifactsPath(projectId),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
    return res.data
  },

  /** 更新分馆产物（版本递增，需 diagram:manage） */
  async updateArtifact(
    projectId: number,
    artifactId: number,
    payload: {
      content: Record<string, unknown>
    },
  ): Promise<TrizGalleryArtifactDTO & { previousVersion: number }> {
    const res = await apiFetchEnvelope<
      ApiDataEnvelope<TrizGalleryArtifactDTO & { previousVersion: number }>
    >(`${trizGalleryArtifactsPath(projectId)}/${artifactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return res.data
  },

  /** 软删除分馆产物整条版本链（需 diagram:manage） */
  async deleteArtifact(
    projectId: number,
    artifactId: number,
  ): Promise<{
    artifactType: TrizGalleryArtifactType
    deletedRows: number
    version: number
    deleted: boolean
  }> {
    const res = await apiFetchEnvelope<
      ApiDataEnvelope<{
        artifactType: TrizGalleryArtifactType
        deletedRows: number
        version: number
        deleted: boolean
      }>
    >(`${trizGalleryArtifactsPath(projectId)}/${artifactId}`, {
      method: 'DELETE',
    })
    return res.data
  },
}

// ---------------------------------------------------------------------------
// React Query Keys
// ---------------------------------------------------------------------------

export const trizGalleryKeys = {
  all: ['triz-gallery'] as const,
  matrixPrinciples: (projectId: number, improving: number, worsening: number) =>
    [...trizGalleryKeys.all, 'matrix-principles', projectId, improving, worsening] as const,
  prefill: (projectId: number, artifactType: TrizGalleryPrefillArtifactType) =>
    [...trizGalleryKeys.all, 'prefill', projectId, artifactType] as const,
  artifacts: (projectId: number) => [...trizGalleryKeys.all, 'artifacts', projectId] as const,
  artifactsList: (projectId: number, params?: ListTrizGalleryArtifactsParams) =>
    [...trizGalleryKeys.artifacts(projectId), 'list', params] as const,
  artifactDetail: (projectId: number, artifactId: number, version?: number) =>
    [...trizGalleryKeys.artifacts(projectId), 'detail', artifactId, version] as const,
  artifactVersions: (projectId: number, artifactId: number) =>
    [...trizGalleryKeys.artifacts(projectId), 'versions', artifactId] as const,
}
