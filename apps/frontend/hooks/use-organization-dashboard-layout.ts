import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchLayoutList,
  fetchCurrentLayout,
  previewLayout,
  savePersonalLayout,
  saveSharedLayout,
  copyLayout,
  setDefaultLayout,
  resetLayout,
  deleteLayout,
  organizationDashboardLayoutKeys,
} from '@/lib/api/organization-dashboard-layout'
import { useAuthStore } from '@/stores/auth-store'
import type {
  OrganizationDashboardLayoutPayload,
  OrganizationDashboardLayoutScope,
} from '@aiproj/types'

/** 当前会话的组织 ID（来自 JWT claims）。 */
export function useCurrentOrganizationId(): number | null {
  return useAuthStore((state) => state.currentOrganizationId)
}

/**
 * 组织 Dashboard 布局编排 React Query hooks（v3-organization-dashboard-layout-builder §5.1）。
 */

/** 获取所有布局列表。 */
export function useLayoutList() {
  const orgId = useCurrentOrganizationId()
  return useQuery({
    queryKey: organizationDashboardLayoutKeys.list(orgId),
    queryFn: () => fetchLayoutList(orgId as number),
    enabled: orgId !== null,
    staleTime: 30_000,
  })
}

/** 获取当前激活的布局。 */
export function useCurrentLayout() {
  const orgId = useCurrentOrganizationId()
  return useQuery({
    queryKey: organizationDashboardLayoutKeys.current(orgId),
    queryFn: () => fetchCurrentLayout(orgId as number),
    enabled: orgId !== null,
    staleTime: 30_000,
  })
}

/** 预览布局（QUERY 模式——输入 payload 触发查询，但不落库）。 */
export function useLayoutPreview(payload: OrganizationDashboardLayoutPayload | null) {
  const orgId = useCurrentOrganizationId()
  return useQuery({
    queryKey: [...organizationDashboardLayoutKeys.all, orgId, 'preview', payload],
    queryFn: () => previewLayout(orgId as number, payload!),
    enabled: orgId !== null && payload !== null,
    staleTime: 0,
  })
}

/** 保存个人布局。 */
export function useSavePersonalLayout() {
  const orgId = useCurrentOrganizationId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: OrganizationDashboardLayoutPayload) =>
      savePersonalLayout(orgId as number, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: organizationDashboardLayoutKeys.all })
    },
  })
}

/** 保存组织共享布局。 */
export function useSaveSharedLayout() {
  const orgId = useCurrentOrganizationId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: OrganizationDashboardLayoutPayload) =>
      saveSharedLayout(orgId as number, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: organizationDashboardLayoutKeys.all })
    },
  })
}

/** 复制布局。 */
export function useCopyLayout() {
  const orgId = useCurrentOrganizationId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: {
      layoutId: number
      name?: string
      scope?: OrganizationDashboardLayoutScope
    }) => copyLayout(orgId as number, params.layoutId, params.name, params.scope),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: organizationDashboardLayoutKeys.all })
    },
  })
}

/** 设为默认。 */
export function useSetDefaultLayout() {
  const orgId = useCurrentOrganizationId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: { layoutId: number; expectedVersion?: number }) =>
      setDefaultLayout(orgId as number, params.layoutId, params.expectedVersion),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: organizationDashboardLayoutKeys.all })
    },
  })
}

/** 重置为系统默认。 */
export function useResetLayout() {
  const orgId = useCurrentOrganizationId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => resetLayout(orgId as number),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: organizationDashboardLayoutKeys.all })
    },
  })
}

/** 删除布局。 */
export function useDeleteLayout() {
  const orgId = useCurrentOrganizationId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (layoutId: number) => deleteLayout(orgId as number, layoutId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: organizationDashboardLayoutKeys.all })
    },
  })
}
