/**
 * v3-skill-as-plugin-adapter —— 前端 PluginInstall Hooks。
 *
 * TanStack Query hooks for plugin install operations.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listPluginInstallations,
  getPluginInstallation,
  previewPluginInstall,
  confirmPluginInstall,
  getPluginSkillAdapters,
  pluginInstallKeys,
} from '@/lib/api/plugin-install'
import type { PluginInstallAction, PluginInstallConfirmRequest } from '@aiproj/types'

export function usePluginInstallations(organizationId: string | number, status?: string) {
  return useQuery({
    queryKey: pluginInstallKeys.list(organizationId, status),
    queryFn: () => listPluginInstallations(organizationId, { status }),
    enabled: Boolean(organizationId),
  })
}

export function usePluginInstallation(organizationId: string | number, pluginId: string) {
  return useQuery({
    queryKey: pluginInstallKeys.detail(organizationId, pluginId),
    queryFn: () => getPluginInstallation(organizationId, pluginId),
    enabled: Boolean(organizationId && pluginId),
  })
}

export function usePluginSkillAdapters(organizationId: string | number, pluginId?: string) {
  return useQuery({
    queryKey: pluginId
      ? pluginInstallKeys.adapterDetail(organizationId, pluginId)
      : pluginInstallKeys.adapterList(organizationId),
    queryFn: () => getPluginSkillAdapters(organizationId, pluginId),
    enabled: Boolean(organizationId),
  })
}

export function usePluginInstallPreview(organizationId: string | number) {
  return useMutation({
    mutationFn: (payload: {
      action: PluginInstallAction
      pluginId: string
      releaseId?: number
      expectedDigest?: string
    }) => previewPluginInstall(organizationId, payload),
  })
}

export function usePluginInstallConfirm(organizationId: string | number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: PluginInstallConfirmRequest) =>
      confirmPluginInstall(organizationId, payload),
    onSuccess: () => {
      // 成功后失效安装列表与适配器列表缓存
      queryClient.invalidateQueries({ queryKey: pluginInstallKeys.all })
    },
  })
}
