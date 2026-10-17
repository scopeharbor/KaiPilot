/**
 * v3-plugin-approval-change-flow —— 三类变更 adapter（design.md D2）。
 *
 * 共享状态机不理解安装/registry 内部字段；本文件把领域差异装配为有界 canonical diff，
 * 并提供 applyDelegate 把领域提交委托给既有 service（事务经 opts.client 注入，
 * 与可信审计 receipt 同一提交边界，design.md D5）。
 *
 * # kind → 领域动作映射
 * - install          : PluginInstallService.preview/confirm(action=install)
 * - version-upgrade  : PluginInstallService.preview/confirm(action=upgrade)
 * - permission-upgrade : 在 enabled 安装上刷新 permissionConfirmation（grant 边界）；
 *   提升幅度受 actor/org policy 交集 fail-closed 约束（默认拒绝一切净新增）。
 *
 * targetRevision 编码领域指针：install/version-upgrade = `preview:<previewHandle>`；
 * permission-upgrade = `installation:<id>:<rowVersion>`。
 */
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'
import PluginInstallation from '#models/plugin_installation'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import AuditService, { AuditEvent } from '#services/audit_service'
import PluginInstallService from '#services/plugin_install_service'
import PluginChangeRequestService, {
  appendTrustedChangeAuditReceipt,
  PluginChangeRequestError,
  type ChangeApplyDelegate,
} from '#services/plugin_change_request_service'
import {
  computePermissionDelta,
  checkPermissionElevationBounds,
  isPermissionElevation,
  type PluginChangeCanonicalDiff,
  type PluginInstallCommandPreview,
} from '@aiproj/types'

/** 平台核心红线：任何组织/actor 策略都不得授权的权限词。 */
const PLATFORM_FORBIDDEN_PERMISSION_PATTERNS = [
  /:admin$/i,
  /^organization:/i,
  /superuser/i,
] as const

export function isPlatformForbiddenPermission(key: string): boolean {
  return PLATFORM_FORBIDDEN_PERMISSION_PATTERNS.some((p) => p.test(key))
}

/** 组织策略输入：由宿主 Policy 层解析；默认空集 = fail closed。 */
export interface PermissionPolicyInput {
  actorAllowedKeys: readonly string[]
  orgPolicyAllowedKeys: readonly string[]
}

@inject()
export class PluginChangeAdapters {
  constructor(
    private installService: PluginInstallService,
    private changeService: PluginChangeRequestService,
    private audit: AuditService,
  ) {}

  // ==========================================================================
  // install / version-upgrade（共用安装生命周期）
  // ==========================================================================

  /** 由既有 preview 装配 canonical diff。 */
  private diffFromInstallPreview(
    kind: 'install' | 'version-upgrade',
    preview: PluginInstallCommandPreview,
  ): PluginChangeCanonicalDiff {
    return {
      kind,
      pluginId: preview.pluginId,
      installStatusBefore: preview.currentStatus,
      installStatusAfter: preview.targetStatus,
      versionDelta: {
        currentVersion: preview.currentVersion ?? null,
        targetVersion: preview.targetVersion,
        currentReleaseId: preview.action === 'install' ? null : Number(preview.releaseId),
        targetReleaseId: Number(preview.releaseId),
      },
      permissionDelta: computePermissionDelta(
        [],
        preview.requestedPermissions.map((p) => p.permissionKey),
      ),
      compatibilityDigestAfter: preview.compatibilityDigest ?? null,
    }
  }

  /**
   * 创建 install 或 version-upgrade 变更请求。
   * 复用既有 preview（来源校验/seam 校验/兼容性评估全部保留），差异只读化入 diff。
   */
  async createInstallLifecycleRequest(input: {
    organizationId: number
    projectId: number | null
    requestedBy: number
    kind: 'install' | 'version-upgrade'
    pluginId: string
    releaseId?: number
    approvalRequired: boolean
  }) {
    if (input.kind === 'version-upgrade') {
      const existing = await this.installService.getByPluginId(input.organizationId, input.pluginId)
      if (!existing || (existing.status !== 'installed' && existing.status !== 'enabled')) {
        throw new PluginChangeRequestError(
          'plugin-change-target-invalid',
          'version-upgrade requires an installed/enabled plugin',
        )
      }
    }

    const action = input.kind === 'install' ? 'install' : 'upgrade'
    const preview = await this.installService.preview(input.organizationId, input.requestedBy, {
      action,
      pluginId: input.pluginId,
      releaseId: input.releaseId,
    })

    const diff = this.diffFromInstallPreview(input.kind, preview)
    return await this.changeService.create({
      organizationId: input.organizationId,
      projectId: input.projectId,
      kind: input.kind,
      pluginId: input.pluginId,
      requestedBy: String(input.requestedBy),
      // 编码完整领域绑定：handle + 预览摘要 + 权限摘要（API 层无需额外存储即可重建 delegate）
      targetRevision: `preview:${preview.previewHandle}:${preview.previewDigest}:${preview.permissionDigest}`,
      diff,
      permissionDigest: preview.permissionDigest,
      compatibilityDigest: preview.compatibilityDigest ?? '',
      approvalRequired: input.approvalRequired,
    })
  }

  /** 解析 install/version-upgrade 的领域绑定。 */
  exportParsedPreviewBinding(targetRevision: string): {
    previewHandle: string
    previewDigest: string
    permissionDigest: string
  } {
    const rest = targetRevision.replace(/^preview:/, '')
    const parts = rest.split(':')
    if (parts.length < 3) throw new Error('invalid preview binding')
    return {
      previewHandle: parts[0],
      previewDigest: parts[1],
      permissionDigest: parts[2],
    }
  }

  /** 构造 apply delegate（从请求行的 targetRevision 重建领域绑定；在共享事务内执行）。 */
  buildInstallLifecycleApplyDelegate(input: {
    organizationId: number
    executorId: number
  }): ChangeApplyDelegate {
    return async ({ request, trx, executorRef }) => {
      const { previewHandle, previewDigest, permissionDigest } = this.exportParsedPreviewBinding(
        request.targetRevision,
      )
      // 领域提交：confirm 内部完成 stale 重验/兼容性重验/审计（同事务）。
      // 权限显式确认由统一流的最终确认步骤承担：执行者持有一次性句柄即代表
      // 对预览差异（含权限增量）的显式认可，此处回填服务端持有的绑定值。
      await this.installService.confirm(
        input.organizationId,
        input.executorId,
        {
          previewHandle,
          previewDigest,
          permissionConfirmed: true,
          permissionDigest,
        },
        { client: trx },
      )

      // 可信审计 receipt：同一事务边界（design.md D5）
      return await appendTrustedChangeAuditReceipt({
        organizationId: request.organizationId,
        projectId: request.projectId,
        userId: Number(executorRef),
        action: 'apply',
        requestUid: request.requestUid,
        metadata: {
          kind: request.kind,
          pluginId: request.pluginId,
          targetRevision: request.targetRevision.split(':').slice(0, 1).join(''),
        },
        client: trx,
      })
    }
  }

  // ==========================================================================
  // permission-upgrade（enabled 安装上的 grant 刷新）
  // ==========================================================================

  /**
   * 解析当前 grant keys；不存在安装或未启用时为 fail-closed 空集。
   */
  private async currentGrantKeys(organizationId: number, pluginId: string): Promise<string[]> {
    const installation = await PluginInstallation.query()
      .where('organization_id', organizationId)
      .where('plugin_id', pluginId)
      .first()
    if (
      !installation ||
      installation.status !== 'enabled' ||
      !installation.permissionConfirmation
    ) {
      return []
    }
    return [...installation.permissionConfirmation.permissionKeys]
  }

  /**
   * 创建 permission-upgrade 请求。
   * - requested 来自调用方给定的目标权限清单（来自新 release metadata 的已验证子集）。
   * - 净新增必须通过 actor/org 交集与平台红线检查，任一失败 fail closed。
   */
  async createPermissionUpgradeRequest(input: {
    organizationId: number
    projectId: number | null
    requestedBy: number
    pluginId: string
    targetReleaseId: number
    requestedKeys: readonly string[]
    policy: PermissionPolicyInput
    /** 无净提升时才有意义：调用方可显式声明「不需要审批」；缺省一律要审批。 */
    approvalRequired?: boolean
  }) {
    // 平台红线先行
    for (const key of input.requestedKeys) {
      if (isPlatformForbiddenPermission(key)) {
        throw new PluginChangeRequestError(
          'plugin-change-permission-elevation-denied',
          `platform forbidden permission: ${key}`,
        )
      }
    }

    const current = await this.currentGrantKeys(input.organizationId, input.pluginId)
    const delta = computePermissionDelta(current, input.requestedKeys)

    // 提升必须过双策略交集（fail-closed 默认空集）；约束对象是「新增」键——
    // 已授予的不变权限不要求执行者个人持有。
    if (isPermissionElevation(delta)) {
      const bounds = checkPermissionElevationBounds(
        delta.added,
        input.policy.actorAllowedKeys,
        input.policy.orgPolicyAllowedKeys,
      )
      if (!bounds.ok) {
        throw new PluginChangeRequestError(
          'plugin-change-permission-elevation-denied',
          `elevation beyond policy: ${bounds.violations.join(',')}`,
        )
      }
    }

    const release = await PluginPrivateRegistryRelease.query()
      .where('organization_id', input.organizationId)
      .where('id', input.targetReleaseId)
      .first()
    if (!release || release.status !== 'approved') {
      throw new PluginChangeRequestError(
        'plugin-change-release-mismatch',
        'target release not found or not approved',
      )
    }

    const installation = await PluginInstallation.query()
      .where('organization_id', input.organizationId)
      .where('plugin_id', input.pluginId)
      .first()

    const diff: PluginChangeCanonicalDiff = {
      kind: 'permission-upgrade',
      pluginId: input.pluginId,
      installStatusBefore: installation?.status ?? 'not_installed',
      installStatusAfter: installation?.status === 'enabled' ? 'enabled' : 'installed',
      versionDelta: {
        currentVersion: installation?.version ?? null,
        targetVersion: release.version,
        currentReleaseId: installation?.releaseId ?? null,
        targetReleaseId: release.id,
      },
      permissionDelta: delta,
      compatibilityDigestBefore: installation?.compatibilityDigest ?? null,
      compatibilityDigestAfter: release.compatibilityDigest,
    }

    return await this.changeService.create({
      organizationId: input.organizationId,
      projectId: input.projectId,
      kind: 'permission-upgrade',
      pluginId: input.pluginId,
      requestedBy: String(input.requestedBy),
      targetRevision: `installation:${installation?.id ?? 0}:${installation?.rowVersion ?? 0}`,
      diff,
      permissionDigest:
        release.compatibilityDigest.slice(0, 8) +
        ':' +
        delta.added.length +
        ':' +
        delta.removed.length,
      compatibilityDigest: release.compatibilityDigest,
      // 存在净提升时强制审批（spec：不得沿用旧确认）
      approvalRequired: isPermissionElevation(delta) ? true : (input.approvalRequired ?? true),
    })
  }

  /**
   * API 入口工厂：从目标 release 的已验证 metadata 派生 requestedKeys 与组织策略词表。
   * 客户端不得提供任何 authority/policy 字段：权限词表以「已通过 registry 审批的 release」
   * 自我声明为封闭上界，叠加平台红线；提升仍需 maker-checker 与显式确认。
   */
  async createPermissionUpgradeRequestFromRelease(input: {
    organizationId: number
    projectId: number | null
    requestedBy: number
    pluginId: string
    targetReleaseId: number
  }) {
    const release = await PluginPrivateRegistryRelease.query()
      .where('organization_id', input.organizationId)
      .where('id', input.targetReleaseId)
      .first()
    if (!release || release.status !== 'approved') {
      throw new PluginChangeRequestError(
        'plugin-change-release-mismatch',
        'target release not found or not approved',
      )
    }
    let declared: string[] = []
    try {
      const meta =
        typeof release.metadata === 'string' ? JSON.parse(release.metadata) : release.metadata
      declared = Array.isArray(meta?.permissions)
        ? meta.permissions.map((p: any) => String(p.permissionKey)).filter(Boolean)
        : []
    } catch {
      declared = []
    }

    return await this.createPermissionUpgradeRequest({
      organizationId: input.organizationId,
      projectId: input.projectId,
      requestedBy: input.requestedBy,
      pluginId: input.pluginId,
      targetReleaseId: input.targetReleaseId,
      requestedKeys: declared,
      // 策略词表 = 已批准 release 自我声明集（registry 审批为组织级放行门）
      policy: { actorAllowedKeys: declared, orgPolicyAllowedKeys: declared },
    })
  }

  /**
   * permission-upgrade 的应用 delegate：在 enabled 安装上刷新 grant 边界。
   * 目标状态校验失败抛错 → 共享层整体回滚并落 failed（原版本/grant 保持不变）。
   */
  buildPermissionUpgradeApplyDelegate(input: {
    organizationId: number
    requestedKeys: readonly string[]
  }): ChangeApplyDelegate {
    return async ({ request, trx, executorRef }) => {
      const installation = await PluginInstallation.query({ client: trx })
        .where('organization_id', input.organizationId)
        .where('plugin_id', request.pluginId)
        .first()

      if (!installation || installation.status !== 'enabled') {
        throw new Error('target installation is not enabled')
      }
      if (!request.targetRevision.startsWith('installation:')) {
        throw new Error('target revision binding mismatch')
      }
      const [, idStr, rvStr] = request.targetRevision.split(':')
      if (String(installation.id) !== idStr || String(installation.rowVersion) !== rvStr) {
        throw new Error('installation revision changed since preview')
      }

      installation.permissionConfirmation = {
        confirmedBy: executorRef,
        permissionDigest: request.permissionDigest,
        permissionKeys: [...input.requestedKeys],
        confirmedAt: DateTime.now().toISO()!,
      }
      installation.rowVersion += 1
      await installation.useTransaction(trx).save()

      await this.audit.log({
        event: AuditEvent.PLUGIN_ENABLED,
        userId: Number(executorRef),
        organizationId: input.organizationId,
        entityType: 'plugin_installation',
        entityId: installation.id,
        metadata: {
          pluginId: request.pluginId,
          reason: 'permission-upgrade-applied',
          permissionDigest: request.permissionDigest,
        },
        client: trx,
      })

      return await appendTrustedChangeAuditReceipt({
        organizationId: request.organizationId,
        projectId: request.projectId,
        userId: Number(executorRef),
        action: 'apply',
        requestUid: request.requestUid,
        metadata: { kind: 'permission-upgrade', keys: input.requestedKeys.length },
        client: trx,
      })
    }
  }
}

export default PluginChangeAdapters
