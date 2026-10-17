// apps/backend — V3 Copilot 插件工具资格快照服务（v3-copilot-plugin-tool-contract）
//
// 从 enabled 安装 ∩ grant ∩ policy ∩ compatibility 投影出组织 × actor × project 感知的
// 可信工具快照（D2）。快照只含可路由 metadata；隐藏工具零泄露（不出现名称/数量/版本）。
//
// 核心裁决：
// - 组织强隔离：所有读取按 organization_id 过滤
// - isolate-drop：单条贡献损坏/校验失败只影响该工具，不拖垮其他插件或宿主流程
// - 快照 digest 绑定 install/grant/policy/compatibility 四类 revision（TOCTOU 锚点）

import type {
  CopilotPluginToolSnapshot,
  CopilotPluginToolSnapshotEntry,
  CopilotPluginToolSnapshotRevisions,
  CopilotToolExclusionReason,
} from '@aiproj/types'
import {
  PLUGIN_SEAM_COPILOT_TOOL,
  computeCopilotToolDigest,
  normalizeCopilotPluginToolSnapshot,
  seamFnv1aHash,
  validateCopilotToolContributionPayload,
} from '@aiproj/types'

/** 安装投影（低敏，服务层从 Model 行提取）。 */
export interface EnabledInstallationProjection {
  readonly id: number
  readonly pluginId: string
  readonly version: string
  readonly releaseId: number
  readonly manifestDigest: string
  readonly packageDigest: string
  readonly compatibilityDigest: string
  readonly rowVersion: number
}

/** release metadata 中与 copilot-tool 相关的贡献形状。 */
export interface ReleaseMetadataContribution {
  readonly contributionKey?: string
  readonly seamKey: string
  readonly seamVersion?: string
  readonly title?: string
  readonly payload?: unknown
}

export interface ParsedReleaseMetadata {
  readonly contributions?: readonly ReleaseMetadataContribution[]
}

/** 快照服务依赖（全部可注入，便于离线单测）。 */
export interface CopilotPluginToolSnapshotDeps {
  /** 读取组织内全部 enabled 安装（组织隔离由实现保证）。 */
  readonly listEnabledInstallations: (
    organizationId: number,
  ) => Promise<readonly EnabledInstallationProjection[]>
  /** 读取 release metadata（已解析对象或 null）。 */
  readonly getReleaseMetadata: (
    organizationId: number,
    releaseId: number,
  ) => Promise<ParsedReleaseMetadata | null>
  /** 读取 actor 权限列表。 */
  readonly getActorPermissions: (
    actorId: string,
    organizationId: number,
  ) => Promise<readonly string[]>
  /** 读取当前 policy revision（RBAC/policy 结果摘要）。 */
  readonly getPolicyRevision: (organizationId: number) => Promise<string>
  /** 兼容性判定（可选；缺省视为兼容）。 */
  readonly getCompatibilityVerdict?: (
    pluginId: string,
    version: string,
    organizationId: number,
  ) => Promise<'compatible' | 'incompatible'>
  /** 宿主封闭权限词表（contribution 校验白名单）。 */
  readonly knownPermissionKeys: readonly string[]
  /** 已登记 Skill refs（可选白名单）。 */
  readonly knownSkillRefs?: readonly string[]
  /** 当前时间（ISO 8601）。 */
  readonly now: () => string
}

/** 内部排除明细（仅诊断/测试可见，绝不进入对外暴露面）。 */
export interface SnapshotExclusion {
  readonly reason: CopilotToolExclusionReason
  readonly pluginId?: string
  readonly toolId?: string
}

export interface ResolveSnapshotResult {
  readonly snapshot: CopilotPluginToolSnapshot
  /** 内部排除记录（低敏原因码；仅供诊断，不外发）。 */
  readonly exclusions: readonly SnapshotExclusion[]
}

/**
 * Copilot 插件工具资格快照服务。
 * 每次调用重新解析（无长期缓存）；快照整体可替换即生命周期原子撤销的实现基础。
 */
export class CopilotPluginToolSnapshotService {
  constructor(private readonly deps: CopilotPluginToolSnapshotDeps) {}

  /**
   * 解析当前组织 × actor（× project）的合格工具快照。
   * 未安装/disabled/uninstalled/incompatible/无权限/负载损坏的工具一律不可见。
   */
  async resolveSnapshot(params: {
    organizationId: number
    actorId: string
    projectId?: number
  }): Promise<ResolveSnapshotResult> {
    const { organizationId, actorId } = params
    const exclusions: SnapshotExclusion[] = []

    const installations = await this.deps.listEnabledInstallations(organizationId)
    const actorPermissions = await this.deps.getActorPermissions(actorId, organizationId)
    const actorPermSet = new Set(actorPermissions)
    const policyRevision = await this.deps.getPolicyRevision(organizationId)

    // ── revision 绑定（D2）──
    const installRevision = seamFnv1aHash(
      installations
        .map((i) => `${i.pluginId}@${i.version}:${i.rowVersion}`)
        .sort()
        .join('|'),
    )
    const grantRevision = seamFnv1aHash([...actorPermissions].sort().join('|'))

    const entries: CopilotPluginToolSnapshotEntry[] = []
    const compatVerdicts: string[] = []

    for (const inst of installations) {
      // 兼容性判定（缺省兼容）
      const verdict = this.deps.getCompatibilityVerdict
        ? await this.deps.getCompatibilityVerdict(inst.pluginId, inst.version, organizationId)
        : 'compatible'
      compatVerdicts.push(`${inst.pluginId}@${inst.version}:${verdict}`)
      if (verdict !== 'compatible') {
        exclusions.push({ reason: 'incompatible', pluginId: inst.pluginId })
        continue
      }

      const metadata = await this.deps.getReleaseMetadata(organizationId, inst.releaseId)
      if (!metadata?.contributions) continue

      for (const contrib of metadata.contributions) {
        if (contrib.seamKey !== PLUGIN_SEAM_COPILOT_TOOL) continue

        // 防御性再校验：损坏负载 isolate-drop
        const validation = validateCopilotToolContributionPayload(contrib.payload, {
          knownPermissionKeys: this.deps.knownPermissionKeys,
          ...(this.deps.knownSkillRefs ? { knownSkillRefs: this.deps.knownSkillRefs } : {}),
        })
        if (!validation.valid || !validation.normalizedPayload) {
          exclusions.push({
            reason: 'invalid_payload',
            pluginId: inst.pluginId,
            ...(contrib.contributionKey ? { toolId: contrib.contributionKey } : {}),
          })
          continue
        }

        for (const tool of validation.normalizedPayload.tools) {
          // actor 权限过滤：任一所需权限缺失 → 工具整体不可见（零泄露）
          const permitted = tool.requiredPermissions.every((p) => actorPermSet.has(p.permissionKey))
          if (!permitted) {
            exclusions.push({
              reason: 'no_permission',
              pluginId: inst.pluginId,
              toolId: tool.toolId,
            })
            continue
          }

          entries.push({
            toolId: tool.toolId,
            version: tool.version,
            name: tool.name,
            description: tool.description,
            sideEffectClass: tool.sideEffectClass,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            requiredPermissions: tool.requiredPermissions,
            intentTags: tool.intentTags,
            ...(tool.skillRefs ? { skillRefs: tool.skillRefs } : {}),
            budget: tool.budget,
            toolDigest: computeCopilotToolDigest(tool),
            pluginId: inst.pluginId,
            pluginVersion: inst.version,
            installationRef: `install:${inst.id}`,
          })
        }
      }
    }

    const compatibilityRevision = seamFnv1aHash(compatVerdicts.sort().join('|'))
    const revisions: CopilotPluginToolSnapshotRevisions = {
      installRevision,
      grantRevision,
      policyRevision,
      compatibilityRevision,
    }

    const snapshot = normalizeCopilotPluginToolSnapshot({
      organizationId,
      actorId,
      ...(params.projectId !== undefined ? { projectId: params.projectId } : {}),
      revisions,
      entries,
      generatedAt: this.deps.now(),
    })

    return { snapshot, exclusions }
  }

  /** 仅读取当前四类 revision（供调用前 TOCTOU 复核，不构建完整快照）。 */
  async currentRevisions(params: {
    organizationId: number
    actorId: string
  }): Promise<CopilotPluginToolSnapshotRevisions> {
    const { organizationId, actorId } = params
    const installations = await this.deps.listEnabledInstallations(organizationId)
    const actorPermissions = await this.deps.getActorPermissions(actorId, organizationId)
    const policyRevision = await this.deps.getPolicyRevision(organizationId)

    const compatVerdicts: string[] = []
    for (const inst of installations) {
      const verdict = this.deps.getCompatibilityVerdict
        ? await this.deps.getCompatibilityVerdict(inst.pluginId, inst.version, organizationId)
        : 'compatible'
      compatVerdicts.push(`${inst.pluginId}@${inst.version}:${verdict}`)
    }

    return {
      installRevision: seamFnv1aHash(
        installations
          .map((i) => `${i.pluginId}@${i.version}:${i.rowVersion}`)
          .sort()
          .join('|'),
      ),
      grantRevision: seamFnv1aHash([...actorPermissions].sort().join('|')),
      policyRevision,
      compatibilityRevision: seamFnv1aHash(compatVerdicts.sort().join('|')),
    }
  }
}
