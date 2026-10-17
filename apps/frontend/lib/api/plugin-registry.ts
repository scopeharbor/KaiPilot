/**
 * v3-plugin-private-registry-lifecycle — 前端 API hooks（task 8.1 partial）。
 *
 * TanStack Query hooks for plugin registry operations.
 * 组织切换时隔离并失效旧组织缓存。
 */
import { apiFetchEnvelope } from '@/lib/api-client'

// =============================================================================
// Types
// =============================================================================

export type RegistryReleaseStatus =
  'draft' | 'pending_review' | 'approved' | 'rejected' | 'deprecated' | 'withdrawn'

export interface PrivateRegistryEntry {
  entryId: string
  pluginIdentity: string
  pluginName: string
  recommendedVersion: string | null
  releaseCount: number
  latestApprovedVersion: string | null
  latestStatus: RegistryReleaseStatus
  createdAt: string
  updatedAt: string
}

export interface PrivateRegistryRelease {
  id: string
  pluginIdentity: string
  version: string
  status: RegistryReleaseStatus
  packageDigest: string
  manifestDigest: string
  compatibilityDigest: string
  upstreamReceiptRef: string
  reviewCycleCount: number
  latestReviewDecision: 'approved' | 'rejected' | 'pending'
  isRecommended: boolean
  metadata: string | null
  rowVersion: number
  createdAt: string
  updatedAt: string
}

export interface RegistryListResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface RegistryCommandPreview {
  handle: string
  organizationId: string
  actorRef: string
  action: string
  targetReleaseId: string
  stateVersion: number
  sourceHash: string
  diff: string
  impactSummary: string[]
  ttlSeconds: number
  createdAt: string
  expiresAt: string
}

// =============================================================================
// Query Keys
// =============================================================================

export const pluginRegistryKeys = {
  all: ['plugin-registry'] as const,
  lists: () => [...pluginRegistryKeys.all, 'list'] as const,
  list: (orgId: string, filters?: Record<string, unknown>) =>
    [...pluginRegistryKeys.lists(), orgId, filters] as const,
  details: () => [...pluginRegistryKeys.all, 'detail'] as const,
  detail: (orgId: string, entryId: string) =>
    [...pluginRegistryKeys.details(), orgId, entryId] as const,
  reviewQueue: (orgId: string) => [...pluginRegistryKeys.all, 'review-queue', orgId] as const,
  resolve: (orgId: string, pluginIdentity: string) =>
    [...pluginRegistryKeys.all, 'resolve', orgId, pluginIdentity] as const,
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * List plugin registry entries for an organization.
 */
export async function listPluginRegistryEntries(
  organizationId: string,
  params?: {
    page?: number
    perPage?: number
    status?: string
    pluginIdentity?: string
    sort?: string
  },
): Promise<RegistryListResponse<PrivateRegistryEntry>> {
  const query = new URLSearchParams()
  if (params?.page) query.set('page', String(params.page))
  if (params?.perPage) query.set('perPage', String(params.perPage))
  if (params?.status) query.set('status', params.status)
  if (params?.pluginIdentity) query.set('pluginIdentity', params.pluginIdentity)
  if (params?.sort) query.set('sort', params.sort)

  const qs = query.toString()
  return apiFetchEnvelope(`/organizations/${organizationId}/plugin-registry${qs ? `?${qs}` : ''}`)
}

/**
 * Get a single plugin registry entry detail.
 */
export async function getPluginRegistryEntry(
  organizationId: string,
  entryId: string,
): Promise<PrivateRegistryEntry> {
  return apiFetchEnvelope(`/organizations/${organizationId}/plugin-registry/${entryId}`)
}

/**
 * Get the review queue for an organization.
 */
export async function getPluginRegistryReviewQueue(
  organizationId: string,
  params?: { page?: number; perPage?: number },
): Promise<RegistryListResponse<PrivateRegistryRelease>> {
  const query = new URLSearchParams()
  if (params?.page) query.set('page', String(params.page))
  if (params?.perPage) query.set('perPage', String(params.perPage))

  const qs = query.toString()
  return apiFetchEnvelope(
    `/organizations/${organizationId}/plugin-registry/review-queue${qs ? `?${qs}` : ''}`,
  )
}

/**
 * Resolve the best version for a plugin identity.
 */
export async function resolvePluginVersion(
  organizationId: string,
  params: { pluginIdentity: string; range?: string; hostVersion?: string },
): Promise<PrivateRegistryRelease> {
  const query = new URLSearchParams()
  query.set('pluginIdentity', params.pluginIdentity)
  if (params.range) query.set('range', params.range)
  if (params.hostVersion) query.set('hostVersion', params.hostVersion)

  return apiFetchEnvelope(
    `/organizations/${organizationId}/plugin-registry/resolve?${query.toString()}`,
  )
}

/**
 * Generate a command preview.
 */
export async function previewPluginRegistryCommand(
  organizationId: string,
  params: { action: string; targetReleaseId: string },
): Promise<RegistryCommandPreview> {
  return apiFetchEnvelope(`/organizations/${organizationId}/plugin-registry/commands/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}

/**
 * Confirm a command with handle.
 */
export async function confirmPluginRegistryCommand(
  organizationId: string,
  handle: string,
  params: { action: string },
): Promise<{ success: boolean; action: string }> {
  return apiFetchEnvelope(
    `/organizations/${organizationId}/plugin-registry/commands/${handle}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    },
  )
}

// =============================================================================
// Query Key Invalidation Helpers
// =============================================================================

/**
 * Invalidate all plugin registry queries for an organization.
 * Used when organization switches.
 */
export function pluginRegistryInvalidate(orgId: string): readonly unknown[][] {
  // 每一项是一个 query key 前缀（TanStack Query 按前缀匹配失效），不是扁平字符串列表
  return [
    [...pluginRegistryKeys.lists()],
    [...pluginRegistryKeys.details()],
    [...pluginRegistryKeys.reviewQueue(orgId)],
  ]
}
