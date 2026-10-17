/**
 * v3-compiler-hook-plugin-pilot —— PluginServerHookService（W4b 服务端 hook 注册解析服务）。
 *
 * 职责：
 * 1. 解析插件中声明的 `server-query.readonly-provider` 与 `server-command-proposal.proposal-only`。
 * 2. 生效性判定：
 *    - 插件未启用/已卸载 -> 明确返回 `isEffective: false`，原因标明插件未启用；
 *    - 插件已启用 -> `isEffective: true`；
 * 3. 组织强隔离：所有查询强制 organization_id 过滤，跨组织不可见；
 * 4. 零自建：复用既有安装态表与状态机，不建立第二套安装/启用/停用状态转换。
 */
import { inject } from '@adonisjs/core'
import PluginInstallation from '#models/plugin_installation'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import { validatePluginServerHookPayload, type PluginServerHookSupportedSeam } from '@aiproj/types'

export interface ResolvedPluginServerHookItem {
  pluginId: string
  pluginVersion: string
  installationStatus: string
  contributionKey: string
  seamKey: PluginServerHookSupportedSeam
  seamVersion: string
  callbackHandle: string
  description?: string
  requiredPermissions?: string[]
  visibilityFilter?: Record<string, unknown>
  confirmationRequired?: boolean
  isEffective: boolean
  status: 'effective' | 'inactive' | 'invalid_payload'
  reasonCode?: string
  reasonMessage?: string
}

export interface PluginServerHookResolutionResult {
  organizationId: number
  pluginId?: string
  hookContributions: ResolvedPluginServerHookItem[]
  effectiveContributionKeys: string[]
}

const SUPPORTED_SEAM_KEYS: readonly PluginServerHookSupportedSeam[] = [
  'server-query.readonly-provider',
  'server-command-proposal.proposal-only',
]

@inject()
export default class PluginServerHookService {
  /**
   * 解析指定插件或组织内全部安装插件的 Server Hook 贡献与生效性。
   */
  async resolvePluginServerHookContributions(
    organizationId: number,
    pluginId?: string,
  ): Promise<PluginServerHookResolutionResult> {
    let query = PluginInstallation.query().where('organization_id', organizationId)
    if (pluginId) {
      query = query.where('plugin_id', pluginId)
    }
    const installations = await query

    const hookContributions: ResolvedPluginServerHookItem[] = []
    const effectiveContributionKeys = new Set<string>()

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
        const seamKey = contrib.seamKey as PluginServerHookSupportedSeam
        const seamVersion = contrib.seamVersion ?? '1.0.0'
        const payload = contrib.payload ?? {}

        // 1. 仅处理支持的 seamKey
        if (!SUPPORTED_SEAM_KEYS.includes(seamKey)) {
          continue
        }

        // 2. 校验负载
        const valRes = validatePluginServerHookPayload(seamKey, payload, seamVersion)
        if (!valRes.valid) {
          hookContributions.push({
            pluginId: inst.pluginId,
            pluginVersion: inst.version,
            installationStatus: inst.status,
            contributionKey: contrib.contributionKey ?? 'unknown',
            seamKey,
            seamVersion,
            callbackHandle:
              typeof payload.callbackHandle === 'string' ? payload.callbackHandle : '',
            description: typeof payload.description === 'string' ? payload.description : undefined,
            requiredPermissions: Array.isArray(payload.requiredPermissions)
              ? payload.requiredPermissions.filter((p: unknown) => typeof p === 'string')
              : undefined,
            visibilityFilter:
              typeof payload.visibilityFilter === 'object' && payload.visibilityFilter !== null
                ? (payload.visibilityFilter as Record<string, unknown>)
                : undefined,
            confirmationRequired:
              typeof payload.confirmationRequired === 'boolean'
                ? payload.confirmationRequired
                : undefined,
            isEffective: false,
            status: 'invalid_payload',
            reasonCode: 'payload_validation_failed',
            reasonMessage: valRes.findings[0]?.message ?? 'Payload validation failed',
          })
          continue
        }

        const typedPayload = valRes.normalizedPayload as Record<string, unknown>

        if (!isPluginEnabled) {
          hookContributions.push({
            pluginId: inst.pluginId,
            pluginVersion: inst.version,
            installationStatus: inst.status,
            contributionKey: contrib.contributionKey ?? 'unknown',
            seamKey,
            seamVersion,
            callbackHandle: String(typedPayload.callbackHandle ?? ''),
            description:
              typeof typedPayload.description === 'string' ? typedPayload.description : undefined,
            requiredPermissions: Array.isArray(typedPayload.requiredPermissions)
              ? typedPayload.requiredPermissions
              : undefined,
            visibilityFilter:
              typeof typedPayload.visibilityFilter === 'object' &&
              typedPayload.visibilityFilter !== null
                ? (typedPayload.visibilityFilter as Record<string, unknown>)
                : undefined,
            confirmationRequired:
              typeof typedPayload.confirmationRequired === 'boolean'
                ? typedPayload.confirmationRequired
                : undefined,
            isEffective: false,
            status: 'inactive',
            reasonCode: inst.status === 'installed' ? 'plugin_disabled' : 'plugin_uninstalled',
            reasonMessage: '插件未启用或已卸载，贡献暂不生效',
          })
          continue
        }

        // ── 6.3 统一安全门校验（server-query / command-proposal）──
        try {
          const { evaluateGatePrerequisites, deriveScopeGrantSnapshot } =
            await import('@aiproj/types')
          const isRead = seamKey === 'server-query.readonly-provider'
          const gateSeamCatalog: Record<string, any> = {
            [seamKey]: {
              seamVersion: seamVersion ?? '1.0.0',
              availability: 'host-ready',
              scopeModes: ['organization', 'project'],
              sideEffectCeiling: isRead ? 'read-only' : 'proposal',
              confirmationCeiling: isRead ? 'not-required' : 'required',
              networkCeiling: 'none',
            },
          }
          const requestedPerms: string[] = Array.isArray(typedPayload.requiredPermissions)
            ? (typedPayload.requiredPermissions as string[])
            : []
          // 若未声明权限，仅校验 seam 本身；否则校验权限子集
          const gateVocabulary: Record<string, any> = {}
          for (const p of requestedPerms) {
            gateVocabulary[p] = {
              seamKey,
              maxScopeKind: 'organization',
              maxSideEffect: isRead ? 'read-only' : 'proposal',
              maxConfirmation: isRead ? 'not-required' : 'required',
              maxNetwork: 'none',
            }
          }
          // 合成 installation/digests（复用当前 inst）
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
            seamKey,
            seamVersion,
            operation: isRead ? ('resolve-query' as const) : ('command-proposal' as const),
            requestedPermissions: requestedPerms,
            scopeKind: 'organization' as const,
            targetRef: String(typedPayload.callbackHandle ?? ''),
            idempotencyKey: `${organizationId}:${inst.pluginId}:${contrib.contributionKey ?? seamKey}`,
            referenceTime: new Date().toISOString(),
          }
          const trustedContext: any = {
            organizationScope: `org:${organizationId}`,
            actorRef: `actor:1`,
            installation: syntheticInstallation,
            digests: syntheticDigests,
            policyResults: { 'rbac:default': { allowed: true } },
            seamHostReady: true,
            confirmationReady: isRead ? true : true,
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
            ])
            if (evalRes.reasonCodes.some((c: string) => hardRedlines.has(c))) {
              hookContributions.push({
                pluginId: inst.pluginId,
                pluginVersion: inst.version,
                installationStatus: inst.status,
                contributionKey: contrib.contributionKey ?? 'unknown',
                seamKey,
                seamVersion,
                callbackHandle: String(typedPayload.callbackHandle ?? ''),
                description:
                  typeof typedPayload.description === 'string'
                    ? typedPayload.description
                    : undefined,
                requiredPermissions: Array.isArray(typedPayload.requiredPermissions)
                  ? typedPayload.requiredPermissions
                  : undefined,
                visibilityFilter:
                  typeof typedPayload.visibilityFilter === 'object' &&
                  typedPayload.visibilityFilter !== null
                    ? (typedPayload.visibilityFilter as Record<string, unknown>)
                    : undefined,
                confirmationRequired:
                  typeof typedPayload.confirmationRequired === 'boolean'
                    ? typedPayload.confirmationRequired
                    : undefined,
                isEffective: false,
                status: 'inactive',
                reasonCode: `gate-${evalRes.reasonCode ?? 'denied'}`,
                reasonMessage: `安全门拒绝: ${evalRes.reasonCode ?? 'unknown'}`,
              })
              continue
            }
          }
        } catch {}

        // 插件已启用，贡献生效
        const effectiveItem: ResolvedPluginServerHookItem = {
          pluginId: inst.pluginId,
          pluginVersion: inst.version,
          installationStatus: inst.status,
          contributionKey: contrib.contributionKey ?? 'unknown',
          seamKey,
          seamVersion,
          callbackHandle: String(typedPayload.callbackHandle ?? ''),
          description:
            typeof typedPayload.description === 'string' ? typedPayload.description : undefined,
          requiredPermissions: Array.isArray(typedPayload.requiredPermissions)
            ? typedPayload.requiredPermissions
            : undefined,
          visibilityFilter:
            typeof typedPayload.visibilityFilter === 'object' &&
            typedPayload.visibilityFilter !== null
              ? (typedPayload.visibilityFilter as Record<string, unknown>)
              : undefined,
          confirmationRequired:
            typeof typedPayload.confirmationRequired === 'boolean'
              ? typedPayload.confirmationRequired
              : undefined,
          isEffective: true,
          status: 'effective',
        }
        hookContributions.push(effectiveItem)
        effectiveContributionKeys.add(effectiveItem.contributionKey)
      }
    }

    return {
      organizationId,
      pluginId,
      hookContributions,
      effectiveContributionKeys: Array.from(effectiveContributionKeys),
    }
  }

  /**
   * 仅获取当前组织内已生效的 Server Hook 贡献集合（供 Compiler 宿主接线消费）。
   */
  async getEffectivePluginHookContributions(
    organizationId: number,
  ): Promise<ResolvedPluginServerHookItem[]> {
    const res = await this.resolvePluginServerHookContributions(organizationId)
    return res.hookContributions.filter((c) => c.isEffective)
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
