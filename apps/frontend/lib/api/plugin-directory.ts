/**
 * v3-organization-private-plugin-directory —— 组织私有目录 API client（tasks 4.1/4.3）。
 *
 * 只读投影端点：
 *   GET /api/v1/organizations/:organizationId/plugin-directory/releases
 *   GET /api/v1/organizations/:organizationId/plugin-directory/releases/:releaseId
 *   GET /api/v1/organizations/:organizationId/plugin-directory/releases/:releaseId/affected-installations
 */
import { apiFetchEnvelope } from '@/lib/api-client'

// =============================================================================
// Types（与后端 directory_projection DTO 对齐）
// =============================================================================

export type DirectoryReleaseStatus =
  'draft' | 'pending_review' | 'approved' | 'rejected' | 'deprecated' | 'withdrawn'

export interface DirectoryReleaseListItem {
  releaseId: string
  pluginIdentity: string
  version: string
  status: DirectoryReleaseStatus
  createdAt: string | null
  compatibilityAllowed: boolean
  activeInstallationCount: number
  uninstalledInstallationCount: number
  /** 来源标记：true = 由本机示例插件库 seed 写入（离线 fixture，非生产数据）。 */
  fixtureOnly: boolean
}

export interface DirectoryCompatibilitySummary {
  allowed: boolean
  digest: string
  reasonCodes: readonly string[]
}

export interface DirectoryReviewSummary {
  latestCycleNumber: number
  latestDecision: string | null
  latestResolvedAt: string | null
}

export interface DirectoryImpactSummary {
  activeCount: number
  uninstalledCount: number
}

export interface DirectoryReleaseDetail extends DirectoryReleaseListItem {
  manifestDigestPresent: boolean
  compatibility: DirectoryCompatibilitySummary
  review: DirectoryReviewSummary | null
  impact: DirectoryImpactSummary
}

export interface AffectedInstallationItem {
  id: string
  pluginId: string
  version: string
  status: string
  installedAt: string | null
  uninstalledAt: string | null
}

export interface DirectoryPageMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface DirectoryReleaseListResponse {
  data: DirectoryReleaseListItem[]
  meta: DirectoryPageMeta
}

export interface AffectedInstallationsResponse {
  data: AffectedInstallationItem[]
  meta: DirectoryPageMeta
}

export type DirectorySortKey = '-createdAt' | '+createdAt' | '-version' | '+version'

// =============================================================================
// Query Keys（组织隔离：organizationId 必须入 key，D5）
// =============================================================================

export const pluginDirectoryKeys = {
  all: (organizationId: number) => ['plugin-directory', organizationId] as const,
  releaseLists: (organizationId: number) =>
    [...pluginDirectoryKeys.all(organizationId), 'releases'] as const,
  releaseList: (organizationId: number, filters?: Record<string, unknown>) =>
    [...pluginDirectoryKeys.releaseLists(organizationId), filters ?? {}] as const,
  releaseDetail: (organizationId: number, releaseId: string) =>
    [...pluginDirectoryKeys.all(organizationId), 'release', releaseId] as const,
  affectedInstallations: (organizationId: number, releaseId: string) =>
    [...pluginDirectoryKeys.all(organizationId), 'affected-installations', releaseId] as const,
  rollbackPreview: (organizationId: number, targetReleaseId: string) =>
    [...pluginDirectoryKeys.all(organizationId), 'rollback-preview', targetReleaseId] as const,
}

// =============================================================================
// API Functions
// =============================================================================

/** 组织私有目录 release 列表（成员视图后端强制只返回可分发集合）。 */
export async function listDirectoryReleases(
  organizationId: number,
  params?: {
    status?: DirectoryReleaseStatus
    pluginIdentity?: string
    fixtureOnly?: boolean
    sort?: DirectorySortKey
    page?: number
    perPage?: number
  },
): Promise<DirectoryReleaseListResponse> {
  const query = new URLSearchParams()
  if (params?.status) query.set('status', params.status)
  if (params?.pluginIdentity) query.set('pluginIdentity', params.pluginIdentity)
  if (params?.fixtureOnly !== undefined) query.set('fixtureOnly', String(params.fixtureOnly))
  if (params?.sort) query.set('sort', params.sort)
  if (params?.page) query.set('page', String(params.page))
  if (params?.perPage) query.set('perPage', String(params.perPage))

  const qs = query.toString()
  return apiFetchEnvelope(
    `/organizations/${organizationId}/plugin-directory/releases${qs ? `?${qs}` : ''}`,
  )
}

/** 目录 release 详情（兼容性摘要 + 审批摘要 + 影响计数）。 */
export async function getDirectoryReleaseDetail(
  organizationId: number,
  releaseId: string,
): Promise<DirectoryReleaseDetail> {
  // 详情端点回 { data }（非分页 envelope），此处解包成裸 DTO 供 hooks 直接消费。
  const body = await apiFetchEnvelope<{ data: DirectoryReleaseDetail }>(
    `/organizations/${organizationId}/plugin-directory/releases/${releaseId}`,
  )
  return body.data
}

/** 有界受影响安装清单（管理员视图）。 */
export async function listAffectedInstallations(
  organizationId: number,
  releaseId: string,
  params?: { page?: number; perPage?: number },
): Promise<AffectedInstallationsResponse> {
  const query = new URLSearchParams()
  if (params?.page) query.set('page', String(params.page))
  if (params?.perPage) query.set('perPage', String(params.perPage))

  const qs = query.toString()
  return apiFetchEnvelope(
    `/organizations/${organizationId}/plugin-directory/releases/${releaseId}/affected-installations${qs ? `?${qs}` : ''}`,
  )
}

// =============================================================================
// 受控管理动作（task 4.3）
//
// 目录侧只提供两个写端点，且**全部**只推进统一插件变更流：
//   POST /plugin-directory/releases/:releaseId/changes   —— 创建变更请求（202，未生效）
//   POST /plugin-directory/changes/:requestUid/confirm   —— 最终确认（生效）
// 中间的审批（maker-checker）与句柄签发复用 `plugin-change-requests` 共享端点。
// =============================================================================

export type DirectoryChangeAction = 'approve' | 'disable' | 'restore' | 'rollback'

/** 回滚阻断码（与后端 PRIVATE_REGISTRY_ROLLBACK_BLOCKING_CODES 对齐）。 */
export type DirectoryRollbackBlockingCode =
  | 'rollback-target-not-approved'
  | 'rollback-target-integrity-incomplete'
  | 'rollback-target-incompatible'
  | 'rollback-permission-elevation'
  | 'rollback-target-missing'

export interface DirectoryRollbackDiff {
  currentReleaseId: string
  targetReleaseId: string
  currentVersion: string
  targetVersion: string
  manifestDigestBefore: string | null
  manifestDigestAfter: string | null
  packageDigestBefore: string | null
  packageDigestAfter: string | null
  compatibilityDigestBefore: string | null
  compatibilityDigestAfter: string | null
  permissionDelta: {
    added: readonly string[]
    removed: readonly string[]
    unchanged: readonly string[]
  }
  blockingFindings: readonly DirectoryRollbackBlockingCode[]
  affectedActiveCount: number
  selectedInstanceIds?: readonly number[]
}

export interface DirectoryChangeCreated {
  requestUid: string
  state: string
  approvalRequired: boolean
  rollbackDiff: DirectoryRollbackDiff | null
}

/**
 * 创建目录管理变更请求（202：已进入审批流，**尚未生效**）。
 * `selectedInstanceIds` 仅 rollback 使用：不传即只切换推荐指针，不动任何实例。
 */
export async function createDirectoryChange(
  organizationId: number,
  releaseId: string,
  payload: { action: DirectoryChangeAction; selectedInstanceIds?: readonly number[] },
): Promise<{ data: DirectoryChangeCreated }> {
  return apiFetchEnvelope(
    `/organizations/${organizationId}/plugin-directory/releases/${releaseId}/changes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
}

/** 回滚结构化预览（纯读）：`releaseId` 即回滚**目标**（历史版本）。 */
export async function getDirectoryRollbackPreview(
  organizationId: number,
  releaseId: string,
  params?: { selectedInstanceIds?: readonly number[] },
): Promise<DirectoryRollbackDiff> {
  const query = new URLSearchParams()
  for (const id of params?.selectedInstanceIds ?? []) {
    query.append('selectedInstanceIds[]', String(id))
  }
  const qs = query.toString()
  const body = await apiFetchEnvelope<{ data: DirectoryRollbackDiff }>(
    `/organizations/${organizationId}/plugin-directory/releases/${releaseId}/rollback-preview${qs ? `?${qs}` : ''}`,
  )
  return body.data
}

/** 最终确认并应用（一次性句柄，消费后即失效）。 */
export async function confirmDirectoryChange(
  organizationId: number,
  requestUid: string,
  handle: string,
): Promise<{ data: unknown }> {
  return apiFetchEnvelope(
    `/organizations/${organizationId}/plugin-directory/changes/${requestUid}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle }),
    },
  )
}
