/**
 * v3-plugin-policy-bundles —— 前端组织策略包管理 API（任务 4.1）。
 *
 * 封装内置模板/组织副本/激活状态清单、复制与启停（统一变更流）与影响摘要查询。
 */
import { apiFetchEnvelope } from '@/lib/api-client'

export interface PluginPolicyTemplateDto {
  templateId: 'admin-managed' | 'pm-enabled' | 'member-readonly'
  templateVersion: number
  titleZh: string
  descriptionZh: string
}

export interface PluginPolicyBundleDto {
  bundleId: string
  version: number
  sourceTemplateId: string
  sourceTemplateVersion: number
  descriptionZh: string
  documentDigest: string
  createdAt: string
}

export interface PluginPolicyActivationDto {
  bundleId: string
  activeVersion: number
  status: 'active' | 'disabled'
  revision: number
}

export interface PluginPolicyListResponse {
  data: {
    templates: PluginPolicyTemplateDto[]
    orgCopies: PluginPolicyBundleDto[]
    activation: PluginPolicyActivationDto | null
  }
  meta: { total: number }
}

export interface PolicyImpactSummaryDto {
  action: 'copy' | 'enable' | 'disable' | 'upgrade'
  bundleId: string
  rolesAffected: string[]
  operationsAffected: string[]
  permissionKeysAffected: string[]
  addedTargets: number
  removedTargets: number
  bounded: true
}

export const pluginPolicyKeys = {
  all: ['plugin-policy-bundles'] as const,
  list: (orgId: string | number) => [...pluginPolicyKeys.all, 'list', String(orgId)] as const,
}

/** 模板 + 组织副本 + 当前激活摘要。 */
export async function listPluginPolicies(
  organizationId: string | number,
): Promise<PluginPolicyListResponse> {
  return apiFetchEnvelope(`/organizations/${organizationId}/plugin-policy-bundles`)
}

/** 从内置模板发起组织副本复制（进入统一变更流，确认前不生效）。 */
export async function copyPluginPolicy(
  organizationId: string | number,
  templateId: string,
): Promise<{
  data: { requestUid: string; bundleId: string; digest: string; summary: PolicyImpactSummaryDto }
}> {
  return apiFetchEnvelope(`/organizations/${organizationId}/plugin-policy-bundles/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId }),
  })
}

/** 启用/停用某版本（进入统一变更流）。 */
export async function changePluginPolicyActivation(
  organizationId: string | number,
  bundleId: string,
  payload: { action: 'enable' | 'disable'; version: number },
): Promise<{ data: { requestUid: string; summary: PolicyImpactSummaryDto } }> {
  return apiFetchEnvelope(
    `/organizations/${organizationId}/plugin-policy-bundles/${encodeURIComponent(bundleId)}/activation`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
}

/** 变更影响摘要（有界低敏）。 */
export async function getPluginPolicyChangeImpact(
  organizationId: string | number,
  requestUid: string,
): Promise<{
  data: {
    summary: PolicyImpactSummaryDto
    state: string
    approvalRequired: boolean
    approvedBy: string | null
    expiresAt: string
  }
}> {
  return apiFetchEnvelope(
    `/organizations/${organizationId}/plugin-policy-bundles/changes/${encodeURIComponent(requestUid)}/impact`,
  )
}
