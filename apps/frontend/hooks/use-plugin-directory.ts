/**
 * v3-organization-private-plugin-directory —— 组织私有目录 TanStack Query hooks（tasks 4.1/4.3）。
 *
 * 分层 query keys 且 organizationId 必入 key（D5）；组织切换时旧组织缓存天然隔离。
 * 浏览侧全只读；管理动作（approve/disable/restore/rollback）一律经统一插件变更流，
 * 创建即 202「尚未生效」，唯有显式确认才落库。
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { pluginChangeRequestKeys } from '@/lib/api/plugin-change-requests'
import {
  confirmDirectoryChange,
  createDirectoryChange,
  getDirectoryReleaseDetail,
  getDirectoryRollbackPreview,
  listAffectedInstallations,
  listDirectoryReleases,
  pluginDirectoryKeys,
  type DirectoryChangeAction,
  type DirectoryReleaseStatus,
  type DirectorySortKey,
} from '@/lib/api/plugin-directory'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'

export interface DirectoryReleaseFilters {
  status?: DirectoryReleaseStatus
  /** 来源过滤（本机示例插件库）：true 只看示例数据，false 只看非示例数据。 */
  fixtureOnly?: boolean
  sort?: DirectorySortKey
  page?: number
  perPage?: number
}

/** 目录 release 列表（成员视图由后端强制收敛到可分发集合）。 */
export function useDirectoryReleases(filters: DirectoryReleaseFilters = {}) {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  return useQuery({
    queryKey: pluginDirectoryKeys.releaseList(organizationId ?? 0, { ...filters }),
    queryFn: () => listDirectoryReleases(organizationId!, filters),
    enabled: organizationId !== null,
  })
}

/** 目录 release 详情。 */
export function useDirectoryReleaseDetail(releaseId: string | null) {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  return useQuery({
    queryKey: pluginDirectoryKeys.releaseDetail(organizationId ?? 0, releaseId ?? ''),
    queryFn: () => getDirectoryReleaseDetail(organizationId!, releaseId!),
    enabled: organizationId !== null && !!releaseId,
  })
}

/**
 * 有界受影响安装清单（管理员视图）。
 * `enabled` 由调用方按权限决定——无权限时不发请求也不渲染入口。
 */
export function useAffectedInstallations(releaseId: string | null, enabled = true) {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  return useQuery({
    queryKey: pluginDirectoryKeys.affectedInstallations(organizationId ?? 0, releaseId ?? ''),
    queryFn: () => listAffectedInstallations(organizationId!, releaseId!),
    enabled: organizationId !== null && !!releaseId && enabled,
  })
}

// =============================================================================
// 受控管理动作（task 4.3）
//
// 目录写入**只**推进统一插件变更流：创建（未生效）→ 审批（他人）→ 句柄 → 确认（生效）。
// 每个 hook 都不隐式串联下一步：每一步都要 UI 上的显式人工动作。
// =============================================================================

/**
 * 回滚结构化预览（纯读）。`targetReleaseId` 是回滚**目标**（历史版本）。
 * `enabled` 由调用方按权限与对话框开合决定——关闭时不发请求。
 */
export function useDirectoryRollbackPreview(targetReleaseId: string | null, enabled = true) {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  return useQuery({
    queryKey: pluginDirectoryKeys.rollbackPreview(organizationId ?? 0, targetReleaseId ?? ''),
    queryFn: () => getDirectoryRollbackPreview(organizationId!, targetReleaseId!),
    enabled: organizationId !== null && !!targetReleaseId && enabled,
    retry: false,
  })
}

/** 创建目录管理变更请求（202：进入审批流，尚未生效）。 */
export function useCreateDirectoryChange() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      releaseId: string
      action: DirectoryChangeAction
      selectedInstanceIds?: readonly number[]
    }) =>
      createDirectoryChange(organizationId!, input.releaseId, {
        action: input.action,
        ...(input.selectedInstanceIds ? { selectedInstanceIds: input.selectedInstanceIds } : {}),
      }),
    onSuccess: () => {
      // 变更请求列表变了；目录本身**尚未**变化，故不失效目录缓存。
      queryClient.invalidateQueries({ queryKey: pluginChangeRequestKeys.all })
    },
  })
}

/**
 * 最终确认并应用（提交门）。成功后目录状态与安装影响面才真正改变，
 * 因此在此一并失效目录与安装缓存。
 */
export function useConfirmDirectoryChange() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { requestUid: string; handle: string }) =>
      confirmDirectoryChange(organizationId!, input.requestUid, input.handle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pluginDirectoryKeys.all(organizationId ?? 0) })
      queryClient.invalidateQueries({ queryKey: pluginChangeRequestKeys.all })
      queryClient.invalidateQueries({ queryKey: ['plugin-installations'] })
    },
  })
}
