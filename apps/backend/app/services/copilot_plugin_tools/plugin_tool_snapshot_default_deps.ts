/**
 * v3-copilot-productized-operating-entry —— 资格快照的**生产装配**（任务 3.5）。
 *
 * 背景：`CopilotPluginToolSnapshotService` 一直只在测试里手工装配依赖，
 * 没有生产构造路径。入口 readiness 需要消费真实资格快照，故在此提供唯一的
 * 生产 deps 工厂——**只做装配，不做判定**：
 * - 安装态来自 `PluginInstallation`（组织隔离由查询条件保证）；
 * - release metadata 来自组织私有目录 release 行；
 * - actor 权限来自既有 `RbacService.resolveOrganizationPermissions`；
 * - 宿主封闭权限词表来自 `#rbac` 的 `ALL_PERMISSIONS`。
 *
 * 兼容性判定保持缺省（`CopilotPluginToolSnapshotService` 默认视为兼容），
 * 由既有兼容性服务在其自身路径上负责——此处不复制第二套判定。
 */

import type User from '#models/user'
import PluginInstallation from '#models/plugin_installation'
import type RbacService from '#services/rbac_service'
import { ALL_PERMISSIONS } from '#rbac'
import { seamFnv1aHash } from '@aiproj/types'
import type {
  CopilotPluginToolSnapshotDeps,
  EnabledInstallationProjection,
  ParsedReleaseMetadata,
} from './plugin_tool_snapshot_service.js'

/** 资格快照里 actor 的稳定标识（与既有 `actorId: string` 形状一致）。 */
export function copilotToolActorKey(userId: number): string {
  return `user:${userId}`
}

/**
 * 构造生产 deps。
 *
 * @param user 当前 actor（权限解析复用既有 RBAC 服务）
 * @param rbac 既有 RBAC 服务实例
 */
export function buildCopilotPluginToolSnapshotDeps(
  user: User,
  rbac: RbacService,
): CopilotPluginToolSnapshotDeps {
  return {
    listEnabledInstallations: async (
      organizationId: number,
    ): Promise<readonly EnabledInstallationProjection[]> => {
      const rows = await PluginInstallation.query()
        .where('organization_id', organizationId)
        .where('status', 'enabled')
      return rows.map((row) => ({
        id: row.id,
        pluginId: row.pluginId,
        version: row.version,
        releaseId: row.releaseId,
        manifestDigest: row.manifestDigest,
        packageDigest: row.packageDigest,
        compatibilityDigest: row.compatibilityDigest,
        rowVersion: row.rowVersion,
      }))
    },

    getReleaseMetadata: async (
      organizationId: number,
      releaseId: number,
    ): Promise<ParsedReleaseMetadata | null> => {
      const { default: Release } = await import('#models/plugin_private_registry_release')
      const release = await Release.query()
        .where('organization_id', organizationId)
        .where('id', releaseId)
        .first()
      if (!release?.metadata) return null
      try {
        const parsed =
          typeof release.metadata === 'string' ? JSON.parse(release.metadata) : release.metadata
        return parsed as ParsedReleaseMetadata
      } catch {
        // 元数据损坏 ⇒ 该 release 不贡献任何工具（fail closed，不抛出）。
        return null
      }
    },

    getActorPermissions: async (
      actorId: string,
      organizationId: number,
    ): Promise<readonly string[]> => {
      // 只解析当前请求 actor 的权限；其它 actorId 一律返回空集（零跨身份泄露）。
      if (actorId !== copilotToolActorKey(user.id)) return []
      const permissions = await rbac.resolveOrganizationPermissions(user, organizationId)
      return [...permissions].sort()
    },

    getPolicyRevision: async (organizationId: number): Promise<string> => {
      const permissions = await rbac.resolveOrganizationPermissions(user, organizationId)
      return seamFnv1aHash(`org:${organizationId}|${[...permissions].sort().join(',')}`)
    },

    knownPermissionKeys: [...ALL_PERMISSIONS],

    now: () => new Date().toISOString(),
  }
}
