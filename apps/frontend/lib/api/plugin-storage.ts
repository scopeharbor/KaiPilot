/**
 * v3-plugin-scoped-storage —— 前端 PluginStorage 管理 API（任务 4.3）。
 *
 * 封装组织级 namespace 配额/用量清单、清理 preview/confirm 与版本化导出。
 */
import { apiFetchEnvelope } from '@/lib/api-client'
import type { PluginStorageScope, PluginStorageNamespaceStatus } from '@aiproj/types'

export interface PluginStorageNamespaceDto {
  namespaceId: number
  organizationId: number
  projectId: number | null
  pluginId: string
  pluginVersion: string
  scope: PluginStorageScope
  status: PluginStorageNamespaceStatus
  quotaBytes: number
  usedBytes: number
  quotaEntries: number
  usedEntries: number
  retentionUntil: string | null
  createdAt: string
}

export interface PluginStorageCleanupPreviewDto {
  format: string
  cleanupHandle: string
  namespaceId: number
  pluginId: string
  scope: PluginStorageScope
  projectId: number | null
  status: PluginStorageNamespaceStatus
  entryCount: number
  totalBytes: number
  cleanupDigest: string
  irreversible: true
  expiresAt: string
  createdAt: string
}

export interface PluginStorageCleanupResultDto {
  namespaceId: number
  pluginId: string
  deletedEntries: number
  freedBytes: number
  auditReceiptId: string | null
}

export interface PluginStorageExportResponseDto {
  manifest: {
    format: string
    organizationId: number
    requestedByActorRef: string
    filter: { pluginId: string | null; scope: string | null; includeOrphaned: boolean }
    page: number
    totalEntries: number
    totalBytes: number
    digest: string
    expiresAt: string
    createdAt: string
  }
  records: Array<Record<string, unknown>>
  filePath: string | null
}

export const pluginStorageKeys = {
  all: ['plugin-storage'] as const,
  namespaces: (orgId: string | number) =>
    [...pluginStorageKeys.all, 'namespaces', String(orgId)] as const,
}

/** 组织内 namespace 清单（配额/用量/生命周期）。 */
export async function listPluginStorageNamespaces(
  organizationId: string | number,
  params?: { pluginId?: string; status?: string },
): Promise<{ data: PluginStorageNamespaceDto[] }> {
  const query = new URLSearchParams()
  if (params?.pluginId) query.set('pluginId', params.pluginId)
  if (params?.status) query.set('status', params.status)
  const qs = query.toString()
  return apiFetchEnvelope(
    `/organizations/${organizationId}/plugin-storage/namespaces${qs ? `?${qs}` : ''}`,
  )
}

/** 清理影响面预览（一次性句柄）。 */
export async function previewPluginStorageCleanup(
  organizationId: string | number,
  namespaceId: number,
): Promise<{ data: PluginStorageCleanupPreviewDto }> {
  return apiFetchEnvelope(
    `/organizations/${organizationId}/plugin-storage/namespaces/${namespaceId}/cleanup-preview`,
    { method: 'POST' },
  )
}

/** 消费句柄执行清理（不可逆；服务端写可信审计）。 */
export async function confirmPluginStorageCleanup(
  organizationId: string | number,
  payload: { cleanupHandle: string; cleanupDigest: string },
): Promise<{ data: PluginStorageCleanupResultDto }> {
  return apiFetchEnvelope(`/organizations/${organizationId}/plugin-storage/cleanup-confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/** 版本化有界导出（单页）。 */
export async function exportPluginStorage(
  organizationId: string | number,
  payload: { pluginId?: string; scope?: string; includeOrphaned?: boolean } = {},
): Promise<{ data: PluginStorageExportResponseDto }> {
  return apiFetchEnvelope(`/organizations/${organizationId}/plugin-storage/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
