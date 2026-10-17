/**
 * v3-skill-as-plugin-adapter —— PluginSkillAdapterService（W4a Adapter 解析服务）。
 *
 * 职责：
 * 1. 适配器解析：解析插件中声明的 `skill-adapter.skill-bundle` 与 `compiler-contribution.context-contribution`。
 * 2. 生效性判定：
 *    - 插件未启用/已卸载 -> 明确返回 `isEffective: false`，原因标明插件未启用，绝非「Skill 不存在」；
 *    - 插件已启用 -> 查询宿主 Skill 表（复用既有 Skill 状态机），若处于 active 则 `isEffective: true`；
 * 3. 组织强隔离：所有查询强制 organization_id 过滤，跨组织不可见；
 * 4. 零自建：复用既有 Skill 表与状态机，不建立第二套 Skill 存储或状态转换。
 */
import { inject } from '@adonisjs/core'
import PluginInstallation from '#models/plugin_installation'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import CompilerSkill from '#models/compiler_skill'
import {
  validatePluginContributionPayload,
  type PluginSkillBundleContributionPayload,
  type PluginCompilerContributionPayload,
} from '@aiproj/types'

export interface ResolvedPluginSkillBundleItem {
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
}

export interface ResolvedPluginContextItem {
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
}

export interface PluginSkillAdapterResolutionResult {
  organizationId: number
  pluginId?: string
  skillBundles: ResolvedPluginSkillBundleItem[]
  contextContributions: ResolvedPluginContextItem[]
  effectiveSkillKeys: string[]
}

@inject()
export default class PluginSkillAdapterService {
  /**
   * 解析指定插件或组织内全部安装插件的 Skill Adapter 贡献与生效性。
   */
  async resolvePluginSkillContributions(
    organizationId: number,
    pluginId?: string,
  ): Promise<PluginSkillAdapterResolutionResult> {
    let query = PluginInstallation.query().where('organization_id', organizationId)
    if (pluginId) {
      query = query.where('plugin_id', pluginId)
    }
    const installations = await query

    const skillBundles: ResolvedPluginSkillBundleItem[] = []
    const contextContributions: ResolvedPluginContextItem[] = []
    const effectiveSkillKeys = new Set<string>()

    for (const inst of installations) {
      const release = await PluginPrivateRegistryRelease.query()
        .where('organization_id', organizationId)
        .where('id', inst.releaseId)
        .first()

      if (!release || !release.metadata) {
        continue
      }

      const parsedMeta = this.parseMetadata(release.metadata)
      const contributions = parsedMeta.contributions ?? []
      const isPluginEnabled = inst.status === 'enabled'

      for (const contrib of contributions) {
        const seamKey = contrib.seamKey
        const seamVersion = contrib.seamVersion ?? '1.0.0'
        const payload = contrib.payload ?? {}

        // 1. Skill Bundle 接缝
        if (seamKey === 'skill-adapter.skill-bundle') {
          const valRes = validatePluginContributionPayload(seamKey, payload, seamVersion)
          if (!valRes.valid) {
            skillBundles.push({
              pluginId: inst.pluginId,
              pluginVersion: inst.version,
              installationStatus: inst.status,
              contributionKey: contrib.contributionKey ?? 'unknown',
              seamKey,
              seamVersion,
              skillKey: String(payload.skillKey ?? ''),
              skillVersion: String(payload.skillVersion ?? ''),
              lifecycleRef: String(payload.lifecycleRef ?? ''),
              description:
                typeof payload.description === 'string' ? payload.description : undefined,
              isEffective: false,
              status: 'invalid_payload',
              reasonCode: 'payload_validation_failed',
              reasonMessage: valRes.findings[0]?.message ?? 'Payload validation failed',
            })
            continue
          }

          const typedPayload = payload as unknown as PluginSkillBundleContributionPayload

          if (!isPluginEnabled) {
            skillBundles.push({
              pluginId: inst.pluginId,
              pluginVersion: inst.version,
              installationStatus: inst.status,
              contributionKey: contrib.contributionKey ?? 'unknown',
              seamKey,
              seamVersion,
              skillKey: typedPayload.skillKey,
              skillVersion: typedPayload.skillVersion,
              lifecycleRef: typedPayload.lifecycleRef ?? 'active',
              description: typedPayload.description,
              isEffective: false,
              status: 'inactive',
              reasonCode: inst.status === 'installed' ? 'plugin_disabled' : 'plugin_uninstalled',
              reasonMessage: '插件未启用或已卸载，贡献暂不生效',
            })
            continue
          }

          // 插件已启用，查询宿主 Skill 状态
          const hostSkill = await CompilerSkill.query()
            .where('organization_id', organizationId)
            .where('skill_key', typedPayload.skillKey)
            .first()

          if (!hostSkill) {
            skillBundles.push({
              pluginId: inst.pluginId,
              pluginVersion: inst.version,
              installationStatus: inst.status,
              contributionKey: contrib.contributionKey ?? 'unknown',
              seamKey,
              seamVersion,
              skillKey: typedPayload.skillKey,
              skillVersion: typedPayload.skillVersion,
              lifecycleRef: typedPayload.lifecycleRef ?? 'active',
              description: typedPayload.description,
              isEffective: false,
              status: 'skill_inactive',
              reasonCode: 'skill_not_found',
              reasonMessage: `宿主未找到 skillKey 为 ${typedPayload.skillKey} 的条目`,
            })
          } else if (hostSkill.status !== 'active') {
            skillBundles.push({
              pluginId: inst.pluginId,
              pluginVersion: inst.version,
              installationStatus: inst.status,
              contributionKey: contrib.contributionKey ?? 'unknown',
              seamKey,
              seamVersion,
              skillKey: typedPayload.skillKey,
              skillVersion: typedPayload.skillVersion,
              lifecycleRef: typedPayload.lifecycleRef ?? 'active',
              description: typedPayload.description,
              isEffective: false,
              status: 'skill_inactive',
              reasonCode: 'skill_status_not_active',
              reasonMessage: `宿主对应 Skill 当前状态为 ${hostSkill.status}，非 active`,
              hostSkillId: hostSkill.id,
              hostSkillName: hostSkill.name,
              hostSkillStatus: hostSkill.status,
            })
          } else {
            // 宿主 Skill 处于 active，贡献生效
            effectiveSkillKeys.add(typedPayload.skillKey)
            skillBundles.push({
              pluginId: inst.pluginId,
              pluginVersion: inst.version,
              installationStatus: inst.status,
              contributionKey: contrib.contributionKey ?? 'unknown',
              seamKey,
              seamVersion,
              skillKey: typedPayload.skillKey,
              skillVersion: typedPayload.skillVersion,
              lifecycleRef: typedPayload.lifecycleRef ?? 'active',
              description: typedPayload.description,
              isEffective: true,
              status: 'effective',
              hostSkillId: hostSkill.id,
              hostSkillName: hostSkill.name,
              hostSkillStatus: hostSkill.status,
            })
          }
        }

        // 2. Compiler Context 接缝
        if (seamKey === 'compiler-contribution.context-contribution') {
          const valRes = validatePluginContributionPayload(seamKey, payload, seamVersion)
          if (!valRes.valid) {
            contextContributions.push({
              pluginId: inst.pluginId,
              pluginVersion: inst.version,
              installationStatus: inst.status,
              contributionKey: contrib.contributionKey ?? 'unknown',
              seamKey,
              seamVersion,
              descriptor: String(payload.descriptor ?? ''),
              scope: String(payload.scope ?? ''),
              targetStages: Array.isArray(payload.targetStages) ? payload.targetStages : [],
              advisory: Boolean(payload.advisory),
              contextScope:
                typeof payload.contextScope === 'string' ? payload.contextScope : undefined,
              description:
                typeof payload.description === 'string' ? payload.description : undefined,
              isEffective: false,
              status: 'invalid_payload',
              reasonCode: 'payload_validation_failed',
              reasonMessage: valRes.findings[0]?.message ?? 'Payload validation failed',
            })
            continue
          }

          const typedPayload = payload as unknown as PluginCompilerContributionPayload

          if (!isPluginEnabled) {
            contextContributions.push({
              pluginId: inst.pluginId,
              pluginVersion: inst.version,
              installationStatus: inst.status,
              contributionKey: contrib.contributionKey ?? 'unknown',
              seamKey,
              seamVersion,
              descriptor: typedPayload.descriptor,
              scope: typedPayload.scope,
              targetStages: typedPayload.targetStages ? [...typedPayload.targetStages] : [],
              advisory: typedPayload.advisory,
              contextScope: typedPayload.contextScope,
              description: typedPayload.description,
              isEffective: false,
              status: 'inactive',
              reasonCode: inst.status === 'installed' ? 'plugin_disabled' : 'plugin_uninstalled',
              reasonMessage: '插件未启用或已卸载，上下文贡献暂不生效',
            })
            continue
          }

          // 插件已启用，上下文贡献生效
          contextContributions.push({
            pluginId: inst.pluginId,
            pluginVersion: inst.version,
            installationStatus: inst.status,
            contributionKey: contrib.contributionKey ?? 'unknown',
            seamKey,
            seamVersion,
            descriptor: typedPayload.descriptor,
            scope: typedPayload.scope,
            targetStages: typedPayload.targetStages ? [...typedPayload.targetStages] : [],
            advisory: typedPayload.advisory,
            contextScope: typedPayload.contextScope,
            description: typedPayload.description,
            isEffective: true,
            status: 'effective',
          })
        }
      }
    }

    return {
      organizationId,
      pluginId,
      skillBundles,
      contextContributions,
      effectiveSkillKeys: Array.from(effectiveSkillKeys),
    }
  }

  /**
   * 仅获取当前组织内已生效的插件 Skill 贡献集合（供 Compiler 与 Copilot 注入接线消费）。
   */
  async getEffectivePluginContributions(organizationId: number): Promise<{
    effectiveSkillKeys: string[]
    effectiveContextContributions: ResolvedPluginContextItem[]
  }> {
    const res = await this.resolvePluginSkillContributions(organizationId)
    return {
      effectiveSkillKeys: res.effectiveSkillKeys,
      effectiveContextContributions: res.contextContributions.filter((c) => c.isEffective),
    }
  }

  private parseMetadata(metaStr: string | null): {
    contributions?: Array<{
      contributionKey?: string
      seamKey: string
      seamVersion?: string
      title?: string
      payload?: Record<string, unknown>
    }>
  } {
    if (!metaStr) return {}
    try {
      return typeof metaStr === 'string' ? JSON.parse(metaStr) : metaStr
    } catch {
      return {}
    }
  }
}
