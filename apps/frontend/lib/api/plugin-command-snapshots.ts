/**
 * v3-command-palette-plugin-action-pack —— 官方命令包资格快照 API。
 *
 * 只读端点封装：GET /api/v1/organizations/:organizationId/plugin-command-snapshots
 * 响应 data 为 PluginUiCommandHostSnapshot[]（服务端过滤后的当前组织合格快照）。
 */
import { apiFetchEnvelope } from '@/lib/api-client'
import type { PluginUiCommandHostSnapshot } from '@aiproj/types'

export interface PluginCommandSnapshotFindingDto {
  code: string
  severity: 'warning' | 'info'
  pluginId: string
}

export interface PluginCommandSnapshotListResponse {
  data: PluginUiCommandHostSnapshot[]
  meta: {
    total: number
    findings: PluginCommandSnapshotFindingDto[]
  }
}

/**
 * 获取当前组织已启用官方插件命令包的资格快照列表。
 */
export async function listPluginCommandSnapshots(
  organizationId: string | number,
): Promise<PluginCommandSnapshotListResponse> {
  return apiFetchEnvelope(`/organizations/${organizationId}/plugin-command-snapshots`)
}
