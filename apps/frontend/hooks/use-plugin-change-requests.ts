/**
 * v3-plugin-approval-change-flow —— 前端统一变更请求 Hooks（task 4.3）。
 *
 * TanStack Query hooks：列表/详情查询 + 六个写向 mutation（创建/预览推进/审批/
 * 拒绝/撤回/句柄签发+确认）。成功后失效本域缓存；安装域缓存亦失效（应用会改变安装态）。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listPluginChangeRequests,
  getPluginChangeRequest,
  createPluginChangeRequest,
  previewPluginChangeRequest,
  approvePluginChangeRequest,
  rejectPluginChangeRequest,
  withdrawPluginChangeRequest,
  issueConfirmHandle,
  confirmPluginChangeRequest,
  pluginChangeRequestKeys,
} from '@/lib/api/plugin-change-requests'
import type { PluginChangeKind } from '@aiproj/types'

export function usePluginChangeRequests(
  organizationId: string | number,
  params?: { state?: string; kind?: string; pluginId?: string; page?: number; perPage?: number },
) {
  return useQuery({
    queryKey: pluginChangeRequestKeys.list(organizationId, params as Record<string, unknown>),
    queryFn: () => listPluginChangeRequests(organizationId, params),
    enabled: Boolean(organizationId),
  })
}

export function usePluginChangeRequest(organizationId: string | number, requestUid: string) {
  return useQuery({
    queryKey: pluginChangeRequestKeys.detail(organizationId, requestUid),
    queryFn: () => getPluginChangeRequest(organizationId, requestUid),
    enabled: Boolean(organizationId && requestUid),
  })
}

export function useCreatePluginChangeRequest(organizationId: string | number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      kind: PluginChangeKind
      pluginId: string
      releaseId?: number
      approvalRequired?: boolean
    }) => createPluginChangeRequest(organizationId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pluginChangeRequestKeys.all })
    },
  })
}

export function usePreviewPluginChangeRequest(organizationId: string | number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (requestUid: string) => previewPluginChangeRequest(organizationId, requestUid),
    onSuccess: (_data, requestUid) => {
      queryClient.invalidateQueries({
        queryKey: pluginChangeRequestKeys.detail(organizationId, requestUid),
      })
    },
  })
}

export function useApprovePluginChangeRequest(organizationId: string | number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { requestUid: string; idempotencyKey: string }) =>
      approvePluginChangeRequest(organizationId, input.requestUid, input.idempotencyKey),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({
        queryKey: pluginChangeRequestKeys.detail(organizationId, input.requestUid),
      })
    },
  })
}

export function useRejectPluginChangeRequest(organizationId: string | number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { requestUid: string; idempotencyKey: string; reasonCode?: string }) =>
      rejectPluginChangeRequest(organizationId, input.requestUid, {
        idempotencyKey: input.idempotencyKey,
        reasonCode: input.reasonCode,
      }),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({
        queryKey: pluginChangeRequestKeys.detail(organizationId, input.requestUid),
      })
    },
  })
}

export function useWithdrawPluginChangeRequest(organizationId: string | number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (requestUid: string) => withdrawPluginChangeRequest(organizationId, requestUid),
    onSuccess: (_data, requestUid) => {
      queryClient.invalidateQueries({
        queryKey: pluginChangeRequestKeys.detail(organizationId, requestUid),
      })
    },
  })
}

/** 句柄签发 + 最终确认组合步骤：审批与最终确认分离，但 UI 上以「执行变更」一键承接。 */
export function useConfirmPluginChangeRequest(organizationId: string | number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (requestUid: string) => {
      const handleRes = await issueConfirmHandle(organizationId, requestUid)
      return await confirmPluginChangeRequest(organizationId, requestUid, handleRes.data.handle)
    },
    onSuccess: () => {
      // 应用会改变安装态 / grant / 版本，联动失效
      queryClient.invalidateQueries({ queryKey: pluginChangeRequestKeys.all })
      queryClient.invalidateQueries({ queryKey: ['plugin-installations'] })
    },
  })
}
