/**
 * v3-skill-as-plugin-adapter —— 前端 PluginInstall API（W2b / W4a）。
 *
 * 封装已安装插件列表、单项详情、安装/启停/升级/卸载两步预览确认、Skill Adapter 查询。
 */
import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  PluginInstallAction,
  PluginInstallationStatus,
  PluginInstallCommandPreview,
  PluginInstallConfirmRequest,
} from '@aiproj/types'

export interface PluginInstallationDto {
  id: number
  organizationId: number
  pluginId: string
  version: string
  releaseId: number
  status: PluginInstallationStatus
  permissionConfirmation: {
    confirmedBy: string
    permissionDigest: string
    permissionKeys: string[]
    confirmedAt: string
  } | null
  packageDigest: string
  manifestDigest: string
  compatibilityDigest: string
  rowVersion: number
  uninstalledAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PluginSkillAdapterResolutionDto {
  organizationId: number
  pluginId?: string
  skillBundles: Array<{
    pluginId: string
    pluginVersion: string
    installationStatus: string
    contributionKey: string
    seamKey: string
    seamVersion: string
    skillKey: string
    skillVersion: string
    lifecycleRef: string
    description?: string
    isEffective: boolean
    status: 'effective' | 'inactive' | 'skill_inactive' | 'invalid_payload'
    reasonCode?: string
    reasonMessage?: string
    hostSkillId?: number
    hostSkillName?: string
    hostSkillStatus?: string
  }>
  contextContributions: Array<{
    pluginId: string
    pluginVersion: string
    installationStatus: string
    contributionKey: string
    seamKey: string
    seamVersion: string
    descriptor: string
    scope: string
    targetStages: string[]
    advisory: boolean
    contextScope?: string
    description?: string
    isEffective: boolean
    status: 'effective' | 'inactive' | 'invalid_payload'
    reasonCode?: string
    reasonMessage?: string
  }>
  effectiveSkillKeys: string[]
}

// ── Query Keys ──

export const pluginInstallKeys = {
  all: ['plugin-installations'] as const,
  lists: () => [...pluginInstallKeys.all, 'list'] as const,
  list: (orgId: string | number, status?: string) =>
    [...pluginInstallKeys.lists(), String(orgId), status] as const,
  details: () => [...pluginInstallKeys.all, 'detail'] as const,
  detail: (orgId: string | number, pluginId: string) =>
    [...pluginInstallKeys.details(), String(orgId), pluginId] as const,
  adapters: () => ['plugin-skill-adapters'] as const,
  adapterList: (orgId: string | number) =>
    [...pluginInstallKeys.adapters(), String(orgId)] as const,
  adapterDetail: (orgId: string | number, pluginId: string) =>
    [...pluginInstallKeys.adapters(), String(orgId), pluginId] as const,
}

// ── API Functions ──

/**
 * 获取组织内已安装插件列表。
 */
export async function listPluginInstallations(
  organizationId: string | number,
  params?: { status?: string },
): Promise<{ data: PluginInstallationDto[] }> {
  const query = new URLSearchParams()
  if (params?.status) query.set('status', params.status)
  const qs = query.toString()
  return apiFetchEnvelope(
    `/organizations/${organizationId}/plugin-installations${qs ? `?${qs}` : ''}`,
  )
}

/**
 * 获取单个已安装插件详情。
 */
export async function getPluginInstallation(
  organizationId: string | number,
  pluginId: string,
): Promise<{ data: PluginInstallationDto }> {
  return apiFetchEnvelope(`/organizations/${organizationId}/plugin-installations/${pluginId}`)
}

/**
 * 预览安装动作（install / enable / disable / upgrade / uninstall）。
 */
export async function previewPluginInstall(
  organizationId: string | number,
  payload: {
    action: PluginInstallAction
    pluginId: string
    releaseId?: number
    expectedDigest?: string
  },
): Promise<{ data: PluginInstallCommandPreview }> {
  return apiFetchEnvelope(
    `/organizations/${organizationId}/plugin-installations/commands/preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
}

/**
 * 确认执行状态转移。
 */
export async function confirmPluginInstall(
  organizationId: string | number,
  payload: PluginInstallConfirmRequest,
): Promise<{ data: PluginInstallationDto }> {
  return apiFetchEnvelope(
    `/organizations/${organizationId}/plugin-installations/commands/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
}

/**
 * 查询组织 Skill Adapter 解析结果。
 */
export async function getPluginSkillAdapters(
  organizationId: string | number,
  pluginId?: string,
): Promise<{ data: PluginSkillAdapterResolutionDto }> {
  const url = pluginId
    ? `/organizations/${organizationId}/plugin-skill-adapters/${pluginId}`
    : `/organizations/${organizationId}/plugin-skill-adapters`
  return apiFetchEnvelope(url)
}
