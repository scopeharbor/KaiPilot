'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  confirmPluginRegistryCommand,
  getPluginRegistryEntry,
  getPluginRegistryReviewQueue,
  listPluginRegistryEntries,
  pluginRegistryKeys,
  previewPluginRegistryCommand,
  resolvePluginVersion,
  type PrivateRegistryEntry,
  type PrivateRegistryRelease,
  type RegistryCommandPreview,
  type RegistryListResponse,
} from '@/lib/api/plugin-registry'

/**
 * v3-plugin-private-registry-lifecycle — 私有目录 hooks（task 8.1）。
 *
 * 缓存纪律：**每个 query key 都以 organizationId 开头**（`pluginRegistryKeys.*(orgId, …)`），
 * 组织切换即换 namespace，旧组织数据不可能命中——这是「跨组织切换无旧数据闪现」的机制保证，
 * 而不是靠组件层再过滤一遍。
 *
 * 授权纪律：hooks 只负责取数与失效，**不做授权判定**。前端隐藏仅是 UX，
 * 服务端始终是安全边界（spec：客户端角色不得作为授权依据）。
 */

export interface PluginRegistryListParams {
  page?: number
  perPage?: number
  status?: string
  pluginIdentity?: string
  sort?: string
}

/** 目录列表（分页 + 过滤）。 */
export function usePluginRegistryEntries(
  organizationId: string | null,
  params?: PluginRegistryListParams,
) {
  return useQuery<RegistryListResponse<PrivateRegistryEntry>>({
    queryKey: pluginRegistryKeys.list(
      organizationId ?? '',
      params as Record<string, unknown> | undefined,
    ),
    queryFn: () => listPluginRegistryEntries(organizationId as string, params),
    enabled: Boolean(organizationId),
  })
}

/** 目录条目详情。 */
export function usePluginRegistryEntry(organizationId: string | null, entryId: string | null) {
  return useQuery<PrivateRegistryEntry>({
    queryKey: pluginRegistryKeys.detail(organizationId ?? '', entryId ?? ''),
    queryFn: () => getPluginRegistryEntry(organizationId as string, entryId as string),
    enabled: Boolean(organizationId && entryId),
  })
}

/** 待审队列。 */
export function usePluginRegistryReviewQueue(
  organizationId: string | null,
  params?: { page?: number; perPage?: number },
) {
  return useQuery<RegistryListResponse<PrivateRegistryRelease>>({
    queryKey: [...pluginRegistryKeys.reviewQueue(organizationId ?? ''), params],
    queryFn: () => getPluginRegistryReviewQueue(organizationId as string, params),
    enabled: Boolean(organizationId),
  })
}

/** 版本解析。 */
export function usePluginVersionResolution(
  organizationId: string | null,
  pluginIdentity: string | null,
  params?: { range?: string; hostVersion?: string },
) {
  return useQuery<PrivateRegistryRelease>({
    queryKey: [...pluginRegistryKeys.resolve(organizationId ?? '', pluginIdentity ?? ''), params],
    queryFn: () =>
      resolvePluginVersion(organizationId as string, {
        pluginIdentity: pluginIdentity as string,
        ...params,
      }),
    enabled: Boolean(organizationId && pluginIdentity),
  })
}

/**
 * 生成命令预览。
 *
 * preview 是**只读**的：不写正式数据，因此成功后不失效任何列表缓存——
 * 失效发生在 confirm 成功之后。
 */
export function usePluginRegistryPreview(organizationId: string | null) {
  return useMutation<RegistryCommandPreview, Error, { action: string; targetReleaseId: string }>({
    mutationFn: (params) => previewPluginRegistryCommand(organizationId as string, params),
  })
}

/**
 * 确认命令。
 *
 * 成功后按**当前组织的 key 前缀**失效列表/详情/待审队列；
 * 失败不失效（避免用一次失败把好数据冲掉）。
 */
export function usePluginRegistryConfirm(organizationId: string | null) {
  const queryClient = useQueryClient()

  return useMutation<
    { success: boolean; action: string },
    Error,
    { handle: string; action: string }
  >({
    mutationFn: ({ handle, action }) =>
      confirmPluginRegistryCommand(organizationId as string, handle, { action }),
    onSuccess: () => {
      if (!organizationId) return
      queryClient.invalidateQueries({ queryKey: pluginRegistryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: pluginRegistryKeys.details() })
      queryClient.invalidateQueries({
        queryKey: pluginRegistryKeys.reviewQueue(organizationId),
      })
    },
  })
}
