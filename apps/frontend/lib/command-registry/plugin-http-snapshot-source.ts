/**
 * plugin-http-snapshot-source.ts —— 生产 PluginUiCommandSnapshotSource（任务 3.3）。
 *
 * - 绑定 GET /organizations/:orgId/plugin-command-snapshots 只读端点
 * - 响应由服务端按 actor/organization 过滤；其他租户完全缺席
 * - 失败只映射为封闭低敏错误码（不透出原始响应/堆栈）
 * - 多插件组织：一次请求返回全部 owner 快照，由 provider 逐 owner 原子 replace/remove；
 *   本 source 把列表包装为逐 owner 的快照流（ownerKey = pluginId）
 */

import type { PluginUiCommandHostSnapshot } from '@aiproj/types'
import { listPluginCommandSnapshots } from '@/lib/api/plugin-command-snapshots'
import type {
  PluginUiCommandSnapshotError,
  PluginUiCommandSnapshotResult,
  PluginUiCommandSnapshotSource,
} from './plugin-snapshot-source'
import type { ApiError } from '@/lib/api-client'

/** 单 owner 快照 + 归属键。 */
export interface OwnerSnapshotEntry {
  ownerKey: string
  snapshot: PluginUiCommandHostSnapshot
}

/**
 * 生产 HTTP 快照源。
 * fetchSnapshot 返回 ok:false 时携带封闭错误码；成功时携带当前组织全部合格 owner 快照。
 */
export class HttpPluginSnapshotSource implements PluginUiCommandSnapshotSource {
  async fetchSnapshot(context: {
    organizationId: string
    projectId?: string
    actorId: string
    sessionId: string
  }): Promise<PluginUiCommandSnapshotResult & { owners?: OwnerSnapshotEntry[] }> {
    try {
      const res = await listPluginCommandSnapshots(context.organizationId)
      return {
        ok: true,
        snapshot: emptyAggregateSnapshot(res.data, context),
        owners: res.data.map((snapshot) => ({
          ownerKey: snapshot.pluginId,
          snapshot,
        })),
      }
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'unknown',
        code: mapToSnapshotError(error),
      }
    }
  }
}

/** 把任意失败映射到封闭低敏错误码。 */
export function mapToSnapshotError(error: unknown): PluginUiCommandSnapshotError {
  // ApiError 是鸭子类型接口（携带 status），这里按形状判定
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as ApiError).status
    if (status === 401) return 'unauthenticated'
    if (status === 403 || status === 404) return 'tenant-resolution-failed'
    if (typeof status === 'number' && status >= 500) return 'source-offline'
    return 'snapshot-unavailable'
  }
  if (error instanceof TypeError) return 'network-error'
  return 'source-offline'
}

/**
 * 聚合占位快照：pilot 的 usePluginCommandHost 以单快照为单位投影。
 * 多 owner 模式下宿主改走 owners 列表逐 owner 投影；此聚合快照仅承载
 * 「组织内是否有任何合格命令」的空态语义，避免误注册跨 owner 命令。
 */
function emptyAggregateSnapshot(
  _snapshots: PluginUiCommandHostSnapshot[],
  context: { organizationId: string },
): PluginUiCommandHostSnapshot {
  return {
    schemaVersion: '1',
    pluginId: `__org__:${context.organizationId}`,
    manifestDigest: '',
    instanceRevision: '0',
    enabled: false,
    quarantined: false,
    effectiveGrantPermissions: [],
    effectiveGrantExpiry: null,
    trustedScope: { kind: 'organization', organizationId: context.organizationId },
    hostReadySeams: ['command-palette'],
    actorEligibilityRef: 'aggregate',
    generatedAt: new Date(0).toISOString(),
    contributions: [],
  }
}
