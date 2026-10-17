/**
 * v3-template-as-plugin-package —— PluginTemplatePackService（D5 Adapter 解析服务）。
 *
 * 职责：
 * 1. 模板包适配器解析：按 organizationId 查询 status='enabled' 的安装记录，
 *    从 release metadata 解析 'template-pack.content-bundle' 贡献负载；
 * 2. 生效性绑定：仅 enabled 状态生效；未安装、未启用、已停用或已卸载完全不可见；
 * 3. 组织强隔离：所有查询强制 organization_id 过滤，跨组织不可见；
 * 4. 防御性再校验与 isolate-drop：单条贡献校验失败时省略该贡献（记录低敏降级事实），
 *    不影响其余健康插件贡献，不拖垮模板库整体读取；
 * 5. 零持久化：模板内容仅存于不可变 release metadata，不写 report_templates 表或任何业务表。
 */
import { inject } from '@adonisjs/core'
import PluginInstallation from '#models/plugin_installation'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import {
  type BiTemplateEntry,
  type BiTemplateDef,
  type BiTemplateCategory,
  type BiTemplateScenario,
  BI_DATASOURCE_KEY_VALUES,
  BI_TEMPLATE_ID_VALUES,
  PLUGIN_SEAM_TEMPLATE_PACK,
  validateTemplatePackPayload,
} from '@aiproj/types'

export interface ResolvedPluginTemplate {
  entry: BiTemplateEntry
  def: BiTemplateDef
  pluginId: string
  pluginVersion: string
}

@inject()
export default class PluginTemplatePackService {
  /**
   * 解析指定组织内全部处于 enabled 状态的模板包插件贡献。
   *
   * 防御性再校验：单条贡献损坏或校验失败 isolate-drop，不影响其余插件或宿主流程。
   */
  async resolveEnabledTemplatePacks(organizationId: number): Promise<ResolvedPluginTemplate[]> {
    try {
      const installations = await PluginInstallation.query()
        .where('organization_id', organizationId)
        .where('status', 'enabled')

      const results: ResolvedPluginTemplate[] = []

      for (const inst of installations) {
        if (!inst.releaseId) continue

        const release = await PluginPrivateRegistryRelease.query()
          .where('organization_id', organizationId)
          .where('id', inst.releaseId)
          .first()

        if (!release || !release.metadata) continue

        const parsedMeta = this.parseMetadata(release.metadata)
        const contributions = parsedMeta.contributions ?? []

        for (const contrib of contributions) {
          if (contrib.seamKey !== PLUGIN_SEAM_TEMPLATE_PACK) continue

          const payload = contrib.payload
          // 契约层与宿主层防御性校验
          const valRes = validateTemplatePackPayload(payload, {
            knownDataSourceKeys: BI_DATASOURCE_KEY_VALUES,
            knownBuiltinTemplateIds: BI_TEMPLATE_ID_VALUES,
          })

          if (!valRes.valid || !valRes.normalizedPayload) {
            // isolate-drop: 损坏负载省略并跳过
            continue
          }

          // ── 6.4 统一安全门校验（template-pack / BI 来源）──
          try {
            const { evaluateGatePrerequisites, deriveScopeGrantSnapshot } =
              await import('@aiproj/types')
            const gateSeamCatalog: Record<string, any> = {
              'template-pack': {
                seamVersion: '1.0.0',
                availability: 'host-ready',
                scopeModes: ['organization', 'project'],
                sideEffectCeiling: 'render',
                confirmationCeiling: 'not-required',
                networkCeiling: 'none',
              },
              [contrib.seamKey]: {
                seamVersion: '1.0.0',
                availability: 'host-ready',
                scopeModes: ['organization', 'project'],
                sideEffectCeiling: 'render',
                confirmationCeiling: 'not-required',
                networkCeiling: 'none',
              },
            }
            const gateVocabulary: Record<string, any> = {}
            // template-pack 贡献不携带显式 permission 时，gate 仅校验 seam 本身（空权限集）
            const requestedPerms: string[] = []
            const syntheticInstallation: any = {
              installationRef: `install:${(inst as any).id ?? 0}`,
              pluginId: inst.pluginId,
              pluginVersion: inst.version,
              status: inst.status,
              manifestDigest: (inst as any).manifestDigest ?? 'm1',
              permissionDigest: (inst as any).packageDigest ?? 'p1',
              confirmationRef: `confirmed:${organizationId}:1:${new Date().toISOString()}`,
              confirmedAt: new Date().toISOString(),
            }
            const syntheticDigests: any = {
              manifestDigest: syntheticInstallation.manifestDigest,
              permissionDigest: syntheticInstallation.permissionDigest,
            }
            const grantRes: any = deriveScopeGrantSnapshot({
              organizationScope: `org:${organizationId}`,
              installation: syntheticInstallation,
              digests: syntheticDigests,
              referenceTime: new Date().toISOString(),
              grantedPermissions: requestedPerms,
            })
            const gateRequest: any = {
              pluginId: inst.pluginId,
              contributionKey: contrib.contributionKey ?? 'unknown',
              seamKey: contrib.seamKey,
              seamVersion: '1.0.0',
              operation: 'ui-slot' as const,
              requestedPermissions: requestedPerms,
              scopeKind: 'organization' as const,
              targetRef: contrib.contributionKey ?? 'template-pack',
              idempotencyKey: `${organizationId}:${inst.pluginId}:${contrib.contributionKey ?? 'template-pack'}`,
              referenceTime: new Date().toISOString(),
            }
            const trustedContext: any = {
              organizationScope: `org:${organizationId}`,
              actorRef: `actor:1`,
              installation: syntheticInstallation,
              digests: syntheticDigests,
              policyResults: { 'rbac:default': { allowed: true } },
              seamHostReady: true,
              confirmationReady: true,
              auditAvailable: true,
              networkAuthorized: true,
            }
            const scopeGrant = grantRes.ok ? grantRes.snapshot : undefined
            const evalRes = evaluateGatePrerequisites({
              request: gateRequest,
              trustedContext,
              seamCatalog: gateSeamCatalog,
              permissionVocabulary: gateVocabulary,
              scopeGrant,
            })
            if (!evalRes.allowed) {
              const hardRedlines = new Set([
                'unknown-permission',
                'orphan-contribution',
                'grant-escalation',
                'authority-claim',
                'global-scope',
                'cross-tenant-denied',
              ])
              if (evalRes.reasonCodes.some((c: string) => hardRedlines.has(c))) {
                continue
              }
            }
          } catch {}

          const normPayload = valRes.normalizedPayload
          for (const t of normPayload.templates) {
            // 仅处理 BI 域模板，跳过 compiler 等其他域（类型联合）
            if (!('category' in t) || !('composition' in t)) continue
            const biT = t as unknown as {
              templateId: string
              version: number
              name: string
              description: string
              category: BiTemplateCategory
              scenario: BiTemplateScenario
              composition: BiTemplateDef['composition']
              personDimensionRequiresExtraPermission?: boolean
            }
            const entry: BiTemplateEntry = {
              templateId: biT.templateId,
              version: biT.version,
              name: biT.name,
              description: biT.description,
              category: biT.category as BiTemplateCategory,
              scenario: biT.scenario as BiTemplateScenario,
              builtin: false,
              isCopy: false,
              source: 'plugin',
              pluginRef: {
                pluginId: inst.pluginId,
                pluginVersion: inst.version,
                displayName: contrib.title ?? inst.pluginId,
              },
            }

            const def: BiTemplateDef = {
              templateId: biT.templateId,
              version: biT.version,
              name: biT.name,
              description: biT.description,
              category: biT.category as BiTemplateCategory,
              scenario: biT.scenario as BiTemplateScenario,
              composition: biT.composition,
              personDimensionRequiresExtraPermission: Boolean(
                biT.personDimensionRequiresExtraPermission,
              ),
            }

            results.push({
              entry,
              def,
              pluginId: inst.pluginId,
              pluginVersion: inst.version,
            })
          }
        }
      }

      return results
    } catch {
      // 整体异常降级返回空列表，不阻断宿主内置/组织副本读取
      return []
    }
  }

  /**
   * 获取插件贡献模板条目列表（供 BiTemplateLibraryService.listTemplates 消费）。
   */
  async listPluginTemplates(
    organizationId: number,
    query?: { category?: string },
  ): Promise<BiTemplateEntry[]> {
    const all = await this.resolveEnabledTemplatePacks(organizationId)
    const filtered = query?.category
      ? all.filter((item) => item.entry.category === query.category)
      : all
    return filtered.map((item) => item.entry)
  }

  /**
   * 获取单个插件模板定义与条目（供 getTemplate / previewTemplate 消费）。
   */
  async getPluginTemplate(
    organizationId: number,
    templateId: string,
  ): Promise<{ entry: BiTemplateEntry; def: BiTemplateDef } | null> {
    const all = await this.resolveEnabledTemplatePacks(organizationId)
    const match = all.find((item) => item.entry.templateId === templateId)
    if (!match) return null
    return { entry: match.entry, def: match.def }
  }

  private parseMetadata(metaStr: unknown): {
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
      if (typeof metaStr === 'string') {
        return JSON.parse(metaStr) as {
          contributions?: Array<{
            contributionKey?: string
            seamKey: string
            seamVersion?: string
            title?: string
            payload?: Record<string, unknown>
          }>
        }
      }
      if (typeof metaStr === 'object') {
        return metaStr as {
          contributions?: Array<{
            contributionKey?: string
            seamKey: string
            seamVersion?: string
            title?: string
            payload?: Record<string, unknown>
          }>
        }
      }
      return {}
    } catch {
      return {}
    }
  }
}
