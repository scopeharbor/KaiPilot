/**
 * v3-skill-as-plugin-adapter —— PluginInstallService（W2b 安装生命周期服务）。
 *
 * 职责：
 * 1. 来源校验：私有目录 release 必须处于 approved 状态，校验 content digest，fail closed。
 * 2. 接缝负载校验：按贡献引用的 seamKey 派发 validatePluginContributionPayload，blocking finding 阻断安装。
 * 3. 预览-确认两步边界：preview 生成绑定摘要与影响面，confirm 必须显式核对 previewDigest。
 * 4. 确定性状态机：installed <-> enabled / -> uninstalled / upgrade，enable 必须显式记录权限确认摘要。
 * 5. 卸载不删宿主资源：卸载操作更新安装状态为 uninstalled 并记录 uninstalledAt，不修改/删除 Skill 表条目。
 * 6. 低敏审计：复用 AuditService 写入五类审计事件（不含 manifest 原文、包内容、secret）。
 * 7. 组织隔离：强制 organizationId 过滤。
 */
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import PluginInstallation from '#models/plugin_installation'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  validateInstallConfirmBinding,
  validatePluginContributionPayload,
  validateTemplatePackPayload,
  PLUGIN_SEAM_TEMPLATE_PACK,
  BI_DATASOURCE_KEY_VALUES,
  BI_TEMPLATE_ID_VALUES,
  type PluginInstallAction,
  type PluginInstallCommandPreview,
  type PluginInstallConfirmRequest,
  type PluginInstallContributionImpact,
  type PluginInstallErrorCode,
  type PluginInstallPermissionImpact,
  type PluginInstallationStatus,
  type PluginPermissionConfirmationSummary,
  type PluginCompatibilityDeclaration,
} from '@aiproj/types'
import { evaluateCurrentPluginCompatibility } from '#services/plugin_compatibility_service'
// 4.2 共享 planner 委托：状态转移/权限摘要/digest 纯函数由 local-plugin-developer-kit 共享内核提供（禁止第二套状态机）
import {
  computePermissionDigestForService,
  computePreviewDigestForService,
  fnvForService,
  transitionForService,
} from '@aiproj/types'

// ── 异常定义 ──

export class PluginInstallError extends Error {
  constructor(
    public readonly code: PluginInstallErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PluginInstallError'
  }
}

export class PluginInstallNotFoundError extends PluginInstallError {
  constructor(pluginId: string | number) {
    super('plugin-install-not-found', `Plugin installation not found: ${pluginId}`)
    this.name = 'PluginInstallNotFoundError'
  }
}

export class PluginInstallIllegalTransitionError extends PluginInstallError {
  constructor(message: string) {
    super('plugin-install-illegal-transition', message)
    this.name = 'PluginInstallIllegalTransitionError'
  }
}

export class PluginInstallReleaseNotApprovedError extends PluginInstallError {
  constructor(releaseId: number) {
    super(
      'plugin-install-release-not-approved',
      `Release ${releaseId} is not approved in private registry`,
    )
    this.name = 'PluginInstallReleaseNotApprovedError'
  }
}

export class PluginInstallPreviewMismatchError extends PluginInstallError {
  constructor(code: PluginInstallErrorCode, message: string) {
    super(code, message)
    this.name = 'PluginInstallPreviewMismatchError'
  }
}

export class PluginInstallSeamValidationError extends PluginInstallError {
  constructor(message: string) {
    super('plugin-install-seam-validation-failed', message)
    this.name = 'PluginInstallSeamValidationError'
  }
}

// ── 内存中暂存 Preview（TTL 控制） ──
interface StoredPreview {
  preview: PluginInstallCommandPreview
  organizationId: number
  actorId: number
  releaseId: number
  createdAt: number
  expiresAt: number
}

const PREVIEW_STORE = new Map<string, StoredPreview>()
const DEFAULT_PREVIEW_TTL_SECONDS = 300 // 5 分钟

@inject()
export class PluginInstallService {
  constructor(private readonly audit: AuditService) {}

  /**
   * 1. 预览阶段：根据目标动作、插件及 Release 构建影响面预览与绑定摘要。
   */
  async preview(
    organizationId: number,
    actorId: number,
    params: {
      action: PluginInstallAction
      pluginId: string
      releaseId?: number
      expectedDigest?: string
    },
  ): Promise<PluginInstallCommandPreview> {
    const { action, pluginId, expectedDigest } = params

    // 1. 查询组织内现有安装记录
    const existing = await PluginInstallation.query()
      .where('organization_id', organizationId)
      .where('plugin_id', pluginId)
      .first()

    const currentStatus: PluginInstallationStatus | 'not_installed' = existing
      ? existing.status
      : 'not_installed'

    // 2. 纯函数预判状态机转移（委托共享 planner，禁止第二套状态机）
    const transitionResult = transitionForService(currentStatus, action)
    if ('error' in transitionResult) {
      throw new PluginInstallIllegalTransitionError(
        `Cannot execute action "${action}" from current status "${currentStatus}"`,
      )
    }
    const targetStatus = transitionResult.nextStatus

    // 3. 确定关联的 target release
    let targetRelease: PluginPrivateRegistryRelease | null = null
    const targetReleaseId = params.releaseId ?? (existing ? existing.releaseId : undefined)

    if (action === 'install' || action === 'upgrade' || targetReleaseId) {
      if (!targetReleaseId) {
        throw new PluginInstallError(
          'plugin-install-payload-invalid',
          'releaseId is required for installation or upgrade',
        )
      }
      targetRelease = await PluginPrivateRegistryRelease.query()
        .where('organization_id', organizationId)
        .where('id', targetReleaseId)
        .first()

      if (!targetRelease) {
        throw new PluginInstallError(
          'plugin-install-not-found',
          `Release ${targetReleaseId} not found in organization private registry`,
        )
      }

      // 来源校验：release 必须处于 approved 状态
      if (targetRelease.status !== 'approved') {
        throw new PluginInstallReleaseNotApprovedError(targetRelease.id)
      }

      // 校验摘要一致性（fail closed）
      if (expectedDigest && targetRelease.packageDigest !== expectedDigest) {
        throw new PluginInstallError(
          'plugin-install-digest-mismatch',
          `Package digest mismatch: expected ${expectedDigest}, got ${targetRelease.packageDigest}`,
        )
      }
    } else if (existing) {
      targetRelease = await PluginPrivateRegistryRelease.query()
        .where('organization_id', organizationId)
        .where('id', existing.releaseId)
        .first()
    }

    if (!targetRelease) {
      throw new PluginInstallError(
        'plugin-install-not-found',
        `No valid release associated with plugin ${pluginId}`,
      )
    }

    // 4. 解析 Release Manifest 与贡献负载（从 metadata 读取）
    const parsedMetadata = this.parseReleaseMetadata(targetRelease.metadata)
    const contributions = parsedMetadata.contributions ?? []
    const permissions = parsedMetadata.permissions ?? []
    const compatibility = this.evaluateReleaseCompatibility(parsedMetadata.compatibilityMatrix)
    if (compatibility && !compatibility.compatible) {
      throw new PluginInstallError(
        'plugin-install-source-incompatible',
        `Release is incompatible with the current host (${compatibility.reasons.map((item) => item.code).join(',')})`,
      )
    }

    // 校验每个贡献负载（按 seamKey 分派）
    for (const c of contributions) {
      if (c.payload) {
        if (c.seamKey === PLUGIN_SEAM_TEMPLATE_PACK) {
          const valRes = validateTemplatePackPayload(c.payload, {
            knownDataSourceKeys: BI_DATASOURCE_KEY_VALUES,
            knownBuiltinTemplateIds: BI_TEMPLATE_ID_VALUES,
          })
          if (!valRes.valid) {
            const blocking = valRes.findings.find((f) => f.severity === 'blocking')
            throw new PluginInstallSeamValidationError(
              blocking?.message ?? `Contribution payload validation failed for seam ${c.seamKey}`,
            )
          }
        } else {
          const valRes = validatePluginContributionPayload(c.seamKey, c.payload, c.seamVersion)
          if (!valRes.valid) {
            const blocking = valRes.findings.find((f) => f.severity === 'blocking')
            throw new PluginInstallSeamValidationError(
              blocking?.message ?? `Contribution payload validation failed for seam ${c.seamKey}`,
            )
          }
        }
      }
    }

    // 5. 组装影响面
    const affectedContributions: PluginInstallContributionImpact[] = contributions.map((c) => ({
      contributionKey: c.contributionKey ?? 'default-contribution',
      seamKey: c.seamKey ?? '',
      seamVersion: c.seamVersion ?? '1.0.0',
      title: c.title,
      skillKeyRef: typeof c.payload?.skillKey === 'string' ? c.payload.skillKey : undefined,
    }))

    const requestedPermissions: PluginInstallPermissionImpact[] = permissions.map((p) => ({
      permissionKey: p.permissionKey,
      seamKey: p.seamKey ?? '',
      sideEffect: p.sideEffect ?? 'read-only',
      network: p.network ?? 'none',
      purpose: p.purpose,
    }))

    const permissionDigest = computePermissionDigestForService(requestedPermissions)
    const nowIso = DateTime.now().toISO()!
    const expiresAtIso = DateTime.now().plus({ seconds: DEFAULT_PREVIEW_TTL_SECONDS }).toISO()!
    const sourceHash = existing
      ? fnvForService(`${existing.rowVersion}:${existing.status}`)
      : 'initial'

    const previewDataToHash = {
      organizationId: String(organizationId),
      actorRef: String(actorId),
      action,
      pluginId,
      pluginName: parsedMetadata.name ?? pluginId,
      currentVersion: existing?.version,
      targetVersion: targetRelease.version,
      releaseId: String(targetRelease.id),
      currentStatus,
      targetStatus,
      sourceHash,
      affectedContributions,
      requestedPermissions,
      permissionDigest,
      compatibilityDigest: compatibility?.digest ?? targetRelease.compatibilityDigest,
      compatibilityReasonCodes: compatibility?.reasons.map((item) => item.code) ?? [
        'compatible-legacy-approved-release' as const,
      ],
      ttlSeconds: DEFAULT_PREVIEW_TTL_SECONDS,
      createdAt: nowIso,
      expiresAt: expiresAtIso,
    }

    const previewDigest = computePreviewDigestForService(previewDataToHash)
    const previewHandle = `inst-prev-${previewDigest.slice(0, 12)}-${Date.now()}`

    const fullPreview: PluginInstallCommandPreview = {
      ...previewDataToHash,
      previewHandle,
      previewDigest,
    }

    // 存入内存暂存
    PREVIEW_STORE.set(previewHandle, {
      preview: fullPreview,
      organizationId,
      actorId,
      releaseId: targetRelease.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + DEFAULT_PREVIEW_TTL_SECONDS * 1000,
    })

    return fullPreview
  }

  /**
   * 2. 确认阶段：必须携带 previewHandle 与一致的 previewDigest，执行状态机持久化与低敏审计。
   * v3-plugin-approval-change-flow：支持 opts.client 事务注入——统一变更流在外层事务内
   * 委托本方法完成领域提交与同事务审计（design.md D5），不传时保持原有自开事务语义。
   */
  async confirm(
    organizationId: number,
    actorId: number,
    request: PluginInstallConfirmRequest,
    opts?: { client?: TransactionClientContract },
  ): Promise<PluginInstallation> {
    // 1. 获取预览暂存
    const stored = PREVIEW_STORE.get(request.previewHandle)
    if (!stored || stored.organizationId !== organizationId) {
      throw new PluginInstallPreviewMismatchError(
        'plugin-install-preview-expired',
        'Preview handle not found or expired',
      )
    }

    const preview = stored.preview

    // 2. 校验确认绑定一致性
    const bindRes = validateInstallConfirmBinding(preview, request)
    if (!bindRes.valid) {
      throw new PluginInstallPreviewMismatchError(bindRes.error, bindRes.reason)
    }

    if (opts?.client) {
      return await this.applyConfirmWithClient(
        organizationId,
        actorId,
        request,
        stored,
        opts.client,
      )
    }

    // 3. 在事务中执行变更
    return await db.transaction(async (trx) => {
      return await this.applyConfirmWithClient(organizationId, actorId, request, stored, trx)
    })
  }

  /** 事务内确认执行体（由 confirm 的自开事务或注入的 client 驱动）。 */
  private async applyConfirmWithClient(
    organizationId: number,
    actorId: number,
    request: PluginInstallConfirmRequest,
    stored: StoredPreview,
    trx: TransactionClientContract,
  ): Promise<PluginInstallation> {
    const preview = stored.preview
    // 查询当前安装记录
    let installation = await PluginInstallation.query({ client: trx })
      .where('organization_id', organizationId)
      .where('plugin_id', preview.pluginId)
      .first()

    // 并发冲突检测
    const currentStatus: PluginInstallationStatus | 'not_installed' = installation
      ? installation.status
      : 'not_installed'
    if (currentStatus !== preview.currentStatus) {
      throw new PluginInstallError(
        'plugin-install-preview-stale',
        'Current installation state has changed since preview',
      )
    }

    // An enabled plugin may gain a broader permission set on upgrade.  Treat
    // every permission-digest change as a new grant boundary: the old enable
    // confirmation cannot silently authorize the new release.
    const upgradeNeedsPermissionConfirmation =
      preview.action === 'upgrade' &&
      currentStatus === 'enabled' &&
      installation?.permissionConfirmation?.permissionDigest !== preview.permissionDigest
    if (upgradeNeedsPermissionConfirmation) {
      if (!request.permissionConfirmed) {
        throw new PluginInstallPreviewMismatchError(
          'plugin-install-permission-unconfirmed',
          'Explicit permission confirmation is required when an upgrade changes permissions',
        )
      }
      if (request.permissionDigest !== preview.permissionDigest) {
        throw new PluginInstallPreviewMismatchError(
          'plugin-install-permission-digest-mismatch',
          'Permission digest in upgrade confirmation does not match preview',
        )
      }
    }

    // 获取 Release 信息
    const release = await PluginPrivateRegistryRelease.query({ client: trx })
      .where('organization_id', organizationId)
      .where('id', stored.releaseId)
      .first()

    if (!release) {
      throw new PluginInstallError('plugin-install-not-found', 'Associated release not found')
    }

    // Compatibility is part of the preview binding and is re-evaluated on
    // confirm so host/seam changes cannot reuse a stale preview.
    const currentMetadata = this.parseReleaseMetadata(release.metadata)
    const currentCompatibility = this.evaluateReleaseCompatibility(
      currentMetadata.compatibilityMatrix,
    )
    const currentCompatibilityDigest = currentCompatibility?.digest ?? release.compatibilityDigest
    if (currentMetadata.compatibilityMatrix && !currentCompatibility?.compatible) {
      throw new PluginInstallError(
        'plugin-install-source-incompatible',
        'Release compatibility changed after preview',
      )
    }
    if (preview.compatibilityDigest !== currentCompatibilityDigest) {
      throw new PluginInstallError(
        'plugin-install-preview-stale',
        'Compatibility digest changed after preview',
      )
    }

    let auditEvent: (typeof AuditEvent)[keyof typeof AuditEvent] = AuditEvent.PLUGIN_INSTALLED
    let permissionSummary: PluginPermissionConfirmationSummary | null = null

    switch (preview.action) {
      case 'install': {
        installation = await PluginInstallation.create(
          {
            organizationId,
            pluginId: preview.pluginId,
            version: release.version,
            releaseId: release.id,
            status: 'installed',
            permissionConfirmation: null,
            packageDigest: release.packageDigest,
            manifestDigest: release.manifestDigest,
            compatibilityDigest: release.compatibilityDigest,
            rowVersion: 1,
            uninstalledAt: null,
          },
          { client: trx },
        )
        auditEvent = AuditEvent.PLUGIN_INSTALLED
        break
      }

      case 'enable': {
        if (!installation) {
          throw new PluginInstallNotFoundError(preview.pluginId)
        }
        permissionSummary = {
          confirmedBy: String(actorId),
          permissionDigest: preview.permissionDigest,
          permissionKeys: preview.requestedPermissions.map((p) => p.permissionKey),
          confirmedAt: DateTime.now().toISO()!,
        }
        installation.status = 'enabled'
        installation.permissionConfirmation = permissionSummary
        installation.rowVersion += 1
        await installation.useTransaction(trx).save()
        auditEvent = AuditEvent.PLUGIN_ENABLED
        break
      }

      case 'disable': {
        if (!installation) {
          throw new PluginInstallNotFoundError(preview.pluginId)
        }
        installation.status = 'installed'
        installation.permissionConfirmation = null
        installation.rowVersion += 1
        await installation.useTransaction(trx).save()
        auditEvent = AuditEvent.PLUGIN_DISABLED
        break
      }

      case 'uninstall': {
        if (!installation) {
          throw new PluginInstallNotFoundError(preview.pluginId)
        }
        // 卸载不删除宿主资源（不删 Skill 条目），仅更新安装状态与时间戳
        installation.status = 'uninstalled'
        installation.uninstalledAt = DateTime.now()
        installation.permissionConfirmation = null
        installation.rowVersion += 1
        await installation.useTransaction(trx).save()
        auditEvent = AuditEvent.PLUGIN_UNINSTALLED
        break
      }

      case 'upgrade': {
        if (!installation) {
          throw new PluginInstallNotFoundError(preview.pluginId)
        }
        installation.version = release.version
        installation.releaseId = release.id
        installation.packageDigest = release.packageDigest
        installation.manifestDigest = release.manifestDigest
        installation.compatibilityDigest = release.compatibilityDigest
        if (upgradeNeedsPermissionConfirmation) {
          permissionSummary = {
            confirmedBy: String(actorId),
            permissionDigest: preview.permissionDigest,
            permissionKeys: preview.requestedPermissions.map((p) => p.permissionKey),
            confirmedAt: DateTime.now().toISO()!,
          }
          installation.permissionConfirmation = permissionSummary
        }
        installation.rowVersion += 1
        await installation.useTransaction(trx).save()
        auditEvent = AuditEvent.PLUGIN_UPGRADED
        break
      }
    }

    // 4. 记录低敏审计
    await this.audit.log({
      event: auditEvent,
      userId: actorId,
      organizationId,
      entityType: 'plugin_installation',
      entityId: installation.id,
      metadata: {
        pluginId: preview.pluginId,
        version: release.version,
        action: preview.action,
        targetStatus: preview.targetStatus,
        permissionDigest: preview.permissionDigest,
        compatibilityDigest: preview.compatibilityDigest,
        compatibilityReasonCodes: preview.compatibilityReasonCodes,
      },
      client: trx,
    })

    // 消费后移除 preview 句柄
    PREVIEW_STORE.delete(request.previewHandle)

    return installation
  }

  // ── 查询接口 ──

  async listByOrg(
    organizationId: number,
    query?: { status?: PluginInstallationStatus },
  ): Promise<PluginInstallation[]> {
    let dbQuery = PluginInstallation.query().where('organization_id', organizationId)
    if (query?.status) {
      dbQuery = dbQuery.where('status', query.status)
    }
    return await dbQuery.orderBy('updated_at', 'desc')
  }

  async getById(organizationId: number, id: number): Promise<PluginInstallation> {
    const record = await PluginInstallation.query()
      .where('organization_id', organizationId)
      .where('id', id)
      .first()

    if (!record) {
      throw new PluginInstallNotFoundError(id)
    }
    return record
  }

  async getByPluginId(
    organizationId: number,
    pluginId: string,
  ): Promise<PluginInstallation | null> {
    return await PluginInstallation.query()
      .where('organization_id', organizationId)
      .where('plugin_id', pluginId)
      .first()
  }

  // ── 内部辅助函数 ──

  private parseReleaseMetadata(metadataStr: string | null): {
    name?: string
    contributions?: Array<{
      contributionKey?: string
      seamKey: string
      seamVersion?: string
      title?: string
      payload?: Record<string, unknown>
    }>
    permissions?: Array<{
      permissionKey: string
      seamKey?: string
      sideEffect?: string
      network?: string
      purpose?: string
    }>
    compatibilityMatrix?: PluginCompatibilityDeclaration
  } {
    if (!metadataStr) return {}
    try {
      return typeof metadataStr === 'string' ? JSON.parse(metadataStr) : metadataStr
    } catch {
      return {}
    }
  }

  private evaluateReleaseCompatibility(declaration?: PluginCompatibilityDeclaration) {
    if (!declaration) return null
    return evaluateCurrentPluginCompatibility(declaration)
  }
}

export default PluginInstallService
