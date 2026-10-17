/**
 * v3-plugin-approval-change-flow —— 前端统一变更请求 API（tasks 4.1/4.3）。
 *
 * 封装九端点：列表/创建/详情/预览推进/审批/拒绝/撤回/句柄签发/最终确认。
 * 错误遵循后端统一 envelope { error: { code, message } }，由 apiFetchEnvelope 解析。
 */
import { apiFetchEnvelope } from '@/lib/api-client'
import type { PluginChangeKind, PluginChangeRequestState } from '@aiproj/types'

/** 变更请求 DTO（对应后端 toRecordDTO 投影）。 */
export interface PluginChangeRequestDto {
  id: string
  organizationId: string
  projectId: string | null
  kind: PluginChangeKind
  state: PluginChangeRequestState
  pluginId: string
  requestedBy: string
  targetRevision: string
  diff: {
    kind: PluginChangeKind
    pluginId: string
    installStatusBefore?: string
    installStatusAfter?: string
    versionDelta?: {
      currentVersion: string | null
      targetVersion: string
      currentReleaseId: number | null
      targetReleaseId: number
    }
    permissionDelta?: {
      added: string[]
      removed: string[]
      unchanged: string[]
    }
    compatibilityDigestBefore?: string | null
    compatibilityDigestAfter?: string | null
  }
  diffDigest: string
  permissionDigest: string
  compatibilityDigest: string
  approvalRequired: boolean
  approvedBy: string | null
  rowVersion: number
  expiresAt: string
  createdAt: string
  updatedAt: string
}

/** 决策事件 DTO。 */
export interface PluginChangeDecisionDto {
  id: string
  event: string
  actorRef: string
  fromState: string
  toState: string
  reasonCode: string | null
  auditLogId: number | null
  createdAt: string
}

export interface PluginChangeRequestListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

// ── Query Keys ──

export const pluginChangeRequestKeys = {
  all: ['plugin-change-requests'] as const,
  lists: () => [...pluginChangeRequestKeys.all, 'list'] as const,
  list: (orgId: string | number, filters?: Record<string, unknown>) =>
    [...pluginChangeRequestKeys.lists(), String(orgId), filters ?? {}] as const,
  details: () => [...pluginChangeRequestKeys.all, 'detail'] as const,
  detail: (orgId: string | number, requestUid: string) =>
    [...pluginChangeRequestKeys.details(), String(orgId), requestUid] as const,
}

const BASE = (orgId: string | number) => `/organizations/${orgId}/plugin-change-requests`

/** 组织隔离分页列表。 */
export async function listPluginChangeRequests(
  organizationId: string | number,
  params?: { state?: string; kind?: string; pluginId?: string; page?: number; perPage?: number },
): Promise<{ data: PluginChangeRequestDto[]; meta: PluginChangeRequestListMeta }> {
  const query = new URLSearchParams()
  if (params?.state) query.set('state', params.state)
  if (params?.kind) query.set('kind', params.kind)
  if (params?.pluginId) query.set('pluginId', params.pluginId)
  if (params?.page) query.set('page', String(params.page))
  if (params?.perPage) query.set('perPage', String(params.perPage))
  const qs = query.toString()
  return apiFetchEnvelope(`${BASE(organizationId)}${qs ? `?${qs}` : ''}`)
}

/** 创建变更请求（install / permission-upgrade / version-upgrade）。 */
export async function createPluginChangeRequest(
  organizationId: string | number,
  payload: {
    kind: PluginChangeKind
    pluginId: string
    releaseId?: number
    approvalRequired?: boolean
  },
): Promise<{ data: PluginChangeRequestDto }> {
  return apiFetchEnvelope(BASE(organizationId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/** 详情 + 决策流水。 */
export async function getPluginChangeRequest(
  organizationId: string | number,
  requestUid: string,
): Promise<{ data: { request: PluginChangeRequestDto; decisions: PluginChangeDecisionDto[] } }> {
  return apiFetchEnvelope(`${BASE(organizationId)}/${requestUid}`)
}

/** 推进预览阶段。 */
export async function previewPluginChangeRequest(
  organizationId: string | number,
  requestUid: string,
): Promise<{ data: PluginChangeRequestDto }> {
  return apiFetchEnvelope(`${BASE(organizationId)}/${requestUid}/preview`, { method: 'POST' })
}

/** maker-checker 审批。 */
export async function approvePluginChangeRequest(
  organizationId: string | number,
  requestUid: string,
  idempotencyKey: string,
): Promise<{ data: PluginChangeRequestDto }> {
  return apiFetchEnvelope(`${BASE(organizationId)}/${requestUid}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotencyKey }),
  })
}

/** 拒绝（终态幂等）。 */
export async function rejectPluginChangeRequest(
  organizationId: string | number,
  requestUid: string,
  payload: { idempotencyKey: string; reasonCode?: string },
): Promise<{ data: PluginChangeRequestDto }> {
  return apiFetchEnvelope(`${BASE(organizationId)}/${requestUid}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/** 发起人撤回（管理员可代为）。 */
export async function withdrawPluginChangeRequest(
  organizationId: string | number,
  requestUid: string,
): Promise<{ data: PluginChangeRequestDto }> {
  return apiFetchEnvelope(`${BASE(organizationId)}/${requestUid}/withdraw`, { method: 'POST' })
}

/** 签发一次性确认句柄。 */
export async function issueConfirmHandle(
  organizationId: string | number,
  requestUid: string,
): Promise<{ data: { handle: string; expiresAt: string } }> {
  return apiFetchEnvelope(`${BASE(organizationId)}/${requestUid}/confirm-handle`, {
    method: 'POST',
  })
}

/** 最终显式确认并应用（提交门）。 */
export async function confirmPluginChangeRequest(
  organizationId: string | number,
  requestUid: string,
  handle: string,
): Promise<{ data: PluginChangeRequestDto }> {
  return apiFetchEnvelope(`${BASE(organizationId)}/${requestUid}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle }),
  })
}
