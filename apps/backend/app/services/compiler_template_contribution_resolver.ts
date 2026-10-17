/**
 * v3-template-compiler-plugin-integration —— CompilerTemplateContributionResolver（tasks 2.2）。
 *
 * 职责：为 compiler-project-start 提供可用模板候选列表与详情。
 * - 只查询当前组织 status='enabled' 的安装记录
 * - 关联 release.metadata 解析 'template-pack.content-bundle' 贡献
 * - 经 validateTemplatePackPayload 契约校验（封闭字段/枚举/低敏/规模）
 * - 计算 payloadDigest / compatDigest / seedDigest / selectionDigest
 * - 返回按 templateId 字典序稳定排序的 summary
 */

import { inject } from '@adonisjs/core'
import PluginInstallation from '#models/plugin_installation'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import {
  PLUGIN_SEAM_TEMPLATE_PACK,
  validateTemplatePackPayload,
  computeTemplatePackDigest,
  templatePackStableSerialize,
  templatePackFnv1aHash,
  normalizeCompilerSeed,
  isCompilerDomain,
  type CompilerProjectStartSeed,
  type TemplatePackPayload,
} from '@aiproj/types'

export interface CompilerTemplateSummary {
  templateId: string
  name: string
  description: string
  pluginId: string
  pluginVersion: string
  source: 'plugin'
  version: number
  payloadDigest: string
  compatDigest: string
  seedDigest: string
  selectionDigest: string
  projectType: string
  objectives: string[]
  overridableParams: string[]
  wbsConstraints?: { maxDepth?: number; maxTasks?: number; requireMilestones?: boolean }
}

export interface CompilerTemplateDetail extends CompilerTemplateSummary {
  seed: CompilerProjectStartSeed
  compat: { pluginVersion: string; compatibilityDigest: string }
  snapshot: {
    pluginId: string
    pluginVersion: string
    templateId: string
    templateVersion: number
    payloadDigest: string
    compatDigest: string
    seedDigest: string
    selectionDigest: string
    seed: CompilerProjectStartSeed
  }
}

function seedDigestOf(seed: CompilerProjectStartSeed): string {
  const normalized = normalizeCompilerSeed(seed)
  return templatePackFnv1aHash(templatePackStableSerialize(normalized))
}

function selectionDigestOf(templateId: string, seedDigest: string, payloadDigest: string): string {
  return templatePackFnv1aHash(`${templateId}:${seedDigest}:${payloadDigest}`)
}

@inject()
export default class CompilerTemplateContributionResolver {
  /**
   * 列出当前组织下所有 enabled 且 domain=compiler-project-start 的模板候选。
   * 经过校验、digest 计算后按 templateId 排序返回。
   */
  async listCandidates(organizationId: number): Promise<CompilerTemplateSummary[]> {
    try {
      const installations = await PluginInstallation.query()
        .where('organization_id', organizationId)
        .where('status', 'enabled')

      const summaries: CompilerTemplateSummary[] = []

      for (const inst of installations) {
        if (!inst.releaseId) continue

        const release = await PluginPrivateRegistryRelease.query()
          .where('organization_id', organizationId)
          .where('id', inst.releaseId)
          .first()

        if (!release || !release.metadata) continue

        const meta = this.parseMetadata(release.metadata)
        const contributions = meta.contributions ?? []

        for (const contrib of contributions) {
          if (contrib.seamKey !== PLUGIN_SEAM_TEMPLATE_PACK) continue

          const payload = contrib.payload as unknown as TemplatePackPayload | undefined
          if (!payload) continue
          if (!isCompilerDomain(payload.domain as string)) continue

          const valRes = validateTemplatePackPayload(payload, {
            knownDataSourceKeys: [],
            knownBuiltinTemplateIds: [],
          })

          if (!valRes.valid || !valRes.normalizedPayload) continue

          const normPayload = valRes.normalizedPayload
          const payloadDigest = computeTemplatePackDigest(normPayload)
          const compatDigest =
            (release as any).compatibilityDigest ?? inst.compatibilityDigest ?? ''

          for (const t of normPayload.templates) {
            const compilerEntry = t as unknown as {
              templateId: string
              version: number
              name: string
              description: string
              seed: CompilerProjectStartSeed
            }
            if (!compilerEntry.seed) continue

            const seedDigest = seedDigestOf(compilerEntry.seed)
            const selDigest = selectionDigestOf(compilerEntry.templateId, seedDigest, payloadDigest)

            summaries.push({
              templateId: compilerEntry.templateId,
              name: compilerEntry.name,
              description: compilerEntry.description,
              pluginId: inst.pluginId,
              pluginVersion: inst.version,
              source: 'plugin',
              version: compilerEntry.version,
              payloadDigest,
              compatDigest,
              seedDigest,
              selectionDigest: selDigest,
              projectType: compilerEntry.seed.projectType,
              objectives: compilerEntry.seed.objectives ?? [],
              overridableParams: compilerEntry.seed.overridableParams ?? [],
              wbsConstraints: compilerEntry.seed.wbsConstraints,
            })
          }
        }
      }

      // 确定性排序：按 templateId 字典序
      summaries.sort((a, b) => a.templateId.localeCompare(b.templateId))
      return summaries
    } catch {
      return []
    }
  }

  /**
   * 获取单个模板详情（同组织、enabled、校验通过）。不存在返回 null。
   */
  async getDetail(
    organizationId: number,
    templateId: string,
  ): Promise<CompilerTemplateDetail | null> {
    const all = await this.listCandidates(organizationId)
    const match = all.find((s) => s.templateId === templateId)
    if (!match) return null

    // 重新解析以获取原始 seed 与 compat
    // 利用 listCandidates 已计算的 digests，补充 seed 快照
    // 为避免二次查询开销，直接从 match 重建 snapshot；调用方如需完整 seed 可再按 templateId 查询 release
    // 此处通过再次遍历 release 精确取 seed
    const installations = await PluginInstallation.query()
      .where('organization_id', organizationId)
      .where('status', 'enabled')

    for (const inst of installations) {
      if (!inst.releaseId) continue
      const release = await PluginPrivateRegistryRelease.query()
        .where('organization_id', organizationId)
        .where('id', inst.releaseId)
        .first()
      if (!release || !release.metadata) continue
      const meta = this.parseMetadata(release.metadata)
      for (const contrib of meta.contributions ?? []) {
        if (contrib.seamKey !== PLUGIN_SEAM_TEMPLATE_PACK) continue
        const payload = contrib.payload as unknown as TemplatePackPayload
        if (!payload) continue
        const valRes = validateTemplatePackPayload(payload)
        if (!valRes.valid || !valRes.normalizedPayload) continue
        for (const t of valRes.normalizedPayload.templates) {
          const ce = t as unknown as {
            templateId: string
            seed: CompilerProjectStartSeed
            name: string
            description: string
            version: number
          }
          if (ce.templateId !== templateId) continue
          const sd = seedDigestOf(ce.seed)
          const payloadDigest = computeTemplatePackDigest(valRes.normalizedPayload)
          const compatDigest =
            (release as any).compatibilityDigest ?? inst.compatibilityDigest ?? ''
          const selDigest = selectionDigestOf(templateId, sd, payloadDigest)
          return {
            ...match,
            payloadDigest,
            compatDigest,
            seedDigest: sd,
            selectionDigest: selDigest,
            seed: ce.seed,
            compat: { pluginVersion: inst.version, compatibilityDigest: compatDigest },
            snapshot: {
              pluginId: inst.pluginId,
              pluginVersion: inst.version,
              templateId,
              templateVersion: ce.version,
              payloadDigest,
              compatDigest,
              seedDigest: sd,
              selectionDigest: selDigest,
              seed: ce.seed,
            },
          }
        }
      }
    }

    // fallback：用 match 的信息构造（理论不应走到）
    return {
      ...match,
      seed: {
        projectType: match.projectType,
        objectives: match.objectives,
        wbsConstraints: match.wbsConstraints,
        overridableParams: match.overridableParams,
      },
      compat: { pluginVersion: match.pluginVersion, compatibilityDigest: match.compatDigest },
      snapshot: {
        pluginId: match.pluginId,
        pluginVersion: match.pluginVersion,
        templateId: match.templateId,
        templateVersion: match.version,
        payloadDigest: match.payloadDigest,
        compatDigest: match.compatDigest,
        seedDigest: match.seedDigest,
        selectionDigest: match.selectionDigest,
        seed: {
          projectType: match.projectType,
          objectives: match.objectives,
          wbsConstraints: match.wbsConstraints,
          overridableParams: match.overridableParams,
        },
      },
    }
  }

  private parseMetadata(metaStr: unknown): {
    contributions?: Array<{
      contributionKey?: string
      seamKey: string
      title?: string
      payload?: Record<string, unknown>
    }>
  } {
    if (!metaStr) return {}
    try {
      if (typeof metaStr === 'string') return JSON.parse(metaStr)
      if (typeof metaStr === 'object') return metaStr as any
      return {}
    } catch {
      return {}
    }
  }
}
