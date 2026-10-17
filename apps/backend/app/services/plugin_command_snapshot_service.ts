/**
 * v3-command-palette-plugin-action-pack —— PluginCommandSnapshotService（任务 3.1）。
 *
 * 组织/actor 感知的官方命令包资格快照只读 source：
 * - 只查询当前组织 status='enabled' 的安装记录（复用安装生命周期门）
 * - 关联 release.metadata 解析 'ui-command.palette-contribution' 贡献
 * - 复用兼容性评估（metadata.compatibilityMatrix 存在时经 evaluateCurrentPluginCompatibility）
 * - 单条 contribution 无法校验 → 隔离整个 owner（fail-closed）+ 低敏诊断 finding
 * - effectiveGrantPermissions 取启用时确认的 permissionConfirmation.permissionKeys
 * - 快照形状 = @aiproj/types 的 PluginUiCommandHostSnapshot（前端 normalizeAndProject 直接消费）
 *
 * 副作用边界：纯只读投影，不写任何业务表；跨租户由组织隔离查询 + Policy 保证。
 */
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import PluginInstallation from '#models/plugin_installation'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import { evaluateCurrentPluginCompatibility } from '#services/plugin_compatibility_service'
import {
  PLUGIN_SEAM_UI_COMMAND,
  PLUGIN_UI_COMMAND_SCHEMA_VERSION,
  validateUiCommandContributionPayload,
  type PluginUiCommandContributionV1,
  type PluginUiCommandHostSnapshot,
} from '@aiproj/types'

/** 低敏诊断 finding（不泄露 payload/manifest 原文，只有 code + pluginId）。 */
export interface PluginCommandSnapshotFinding {
  code:
    | 'plugin-command-incompatible'
    | 'plugin-command-pack-isolated'
    | 'plugin-command-release-missing'
  severity: 'warning' | 'info'
  pluginId: string
}

export interface PluginCommandSnapshotListResult {
  snapshots: PluginUiCommandHostSnapshot[]
  findings: PluginCommandSnapshotFinding[]
}

interface ReleaseMetadataShape {
  name?: string
  contributions?: Array<{
    contributionKey?: string
    seamKey: string
    seamVersion?: string
    title?: string
    payload?: Record<string, unknown>
  }>
  permissions?: Array<Record<string, unknown>>
  compatibilityMatrix?: Record<string, unknown>
}

@inject()
export default class PluginCommandSnapshotService {
  /**
   * 列出当前组织的官方命令包资格快照（每插件一条；按 pluginId 字典序稳定排序）。
   * 无插件/无 ui-command 贡献的组织返回空数组——零行为变化。
   */
  async listSnapshots(
    organizationId: number,
    actorId: number,
  ): Promise<PluginCommandSnapshotListResult> {
    const installations = await PluginInstallation.query()
      .where('organization_id', organizationId)
      .where('status', 'enabled')
      .orderBy('plugin_id', 'asc')

    const snapshots: PluginUiCommandHostSnapshot[] = []
    const findings: PluginCommandSnapshotFinding[] = []
    const generatedAt = DateTime.now().toISO()!

    for (const inst of installations) {
      if (!inst.releaseId) continue

      const release = await PluginPrivateRegistryRelease.query()
        .where('organization_id', organizationId)
        .where('id', inst.releaseId)
        .first()

      if (!release || !release.metadata) {
        findings.push({
          code: 'plugin-command-release-missing',
          severity: 'info',
          pluginId: inst.pluginId,
        })
        continue
      }

      let meta: ReleaseMetadataShape = {}
      try {
        meta =
          typeof release.metadata === 'string'
            ? (JSON.parse(release.metadata) as ReleaseMetadataShape)
            : (release.metadata as ReleaseMetadataShape)
      } catch {
        // 无法解析的 metadata → 隔离该 owner（fail-closed）
        findings.push({
          code: 'plugin-command-pack-isolated',
          severity: 'warning',
          pluginId: inst.pluginId,
        })
        continue
      }

      // 兼容性门：声明了 compatibilityMatrix 才评估（与 install preview 同源评估器）。
      // 声明本身损坏/无法评估时同样排除该 owner（fail-closed），不让坏矩阵变成 500。
      if (meta.compatibilityMatrix) {
        let compatible = true
        try {
          const compat = evaluateCurrentPluginCompatibility(meta.compatibilityMatrix as never)
          compatible = compat.compatible
        } catch {
          compatible = false
        }
        if (!compatible) {
          findings.push({
            code: 'plugin-command-incompatible',
            severity: 'warning',
            pluginId: inst.pluginId,
          })
          continue
        }
      }

      // 提取 ui-command 贡献；任一无法校验 → 隔离整个 owner（spec Requirement 6）
      const commands: PluginUiCommandContributionV1[] = []
      let isolated = false
      for (const contrib of meta.contributions ?? []) {
        if (contrib.seamKey !== PLUGIN_SEAM_UI_COMMAND) continue
        if (!contrib.payload) {
          isolated = true
          break
        }
        const res = validateUiCommandContributionPayload(contrib.payload, contrib.seamVersion)
        if (!res.valid || !res.normalizedPayload) {
          isolated = true
          break
        }
        commands.push(res.normalizedPayload)
      }
      if (isolated) {
        findings.push({
          code: 'plugin-command-pack-isolated',
          severity: 'warning',
          pluginId: inst.pluginId,
        })
        continue
      }
      if (commands.length === 0) continue

      snapshots.push({
        schemaVersion: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
        pluginId: inst.pluginId,
        manifestDigest: inst.manifestDigest,
        instanceRevision: String(inst.rowVersion),
        enabled: true,
        quarantined: false,
        effectiveGrantPermissions: [...(inst.permissionConfirmation?.permissionKeys ?? [])],
        effectiveGrantExpiry: null,
        trustedScope: {
          kind: 'organization',
          organizationId: String(organizationId),
        },
        hostReadySeams: ['command-palette'],
        actorEligibilityRef: `actor:${actorId}:rev:${inst.rowVersion}`,
        generatedAt,
        contributions: commands.sort((a, b) => a.contributionKey.localeCompare(b.contributionKey)),
      })
    }

    return { snapshots, findings }
  }
}
