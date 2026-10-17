/**
 * v3-organization-private-plugin-directory -- 目录管理动作统一变更流 adapter（tasks 3.1–3.6）。
 *
 * 把目录四动作（approve / disable / restore / rollback）装配为统一插件变更流
 * （plugin_change_request_service）的 canonical diff 与 apply delegate：
 * - **create**：复用 registry 状态机（`resolveDirectoryTransition`：approve/disable 走
 *   通用迁移表，restore 走 D4 恢复复验）与兼容审批门（evaluateCurrentReleaseApproval）
 *   做前置校验，任何非法输入 fail closed；
 *   rollback 额外产出结构化 diff 与 blocking findings，阻断项存在即拒绝创建（spec：
 *   「阻断 finding 存在时不得提交」）。
 * - **apply**：与可信审计 receipt 同一事务边界（design.md D5/D2）；release 状态落库
 *   通过同一 `resolveDirectoryTransition` 复验 + rowVersion 绑定校验（stale fail closed）；rollback
 *   只切换推荐指针并按显式选中的实例**委托既有 install lifecycle**（upgrade 到历史
 *   release），绝不直接改写安装行。
 *
 * 红线：本文件不提供任何绕过变更流的直接写入口；禁用只阻断未来分发，
 * 绝不停用/卸载已安装实例（spec Requirement 4）。
 */
import { inject } from '@adonisjs/core'
import PluginPrivateRegistryEntry from '#models/plugin_private_registry_entry'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import PluginChangeRequestService, {
  appendTrustedChangeAuditReceipt,
  type ChangeApplyDelegate,
} from '#services/plugin_change_request_service'
import PluginInstallService from '#services/plugin_install_service'
import { evaluateCurrentReleaseApproval } from '#services/plugin_compatibility_service'
import {
  getTransitionInstruction,
  validateTransition,
  validateRestoreRequest,
} from './status_orchestration_core.js'
import {
  computePermissionDelta,
  isPermissionElevation,
  type PluginChangeAffectedInstallationSummary,
  type PluginChangeCanonicalDiff,
  type PluginRegistryActionRef,
  type PluginRegistryReleaseStatusRef,
} from '@aiproj/types'
import type {
  PrivateRegistryRollbackBlockingCode,
  PrivateRegistryRollbackDiff,
  RegistryCommandAction,
  RegistryReleaseStatus,
} from '@aiproj/types'

/** 目录动作 -> registry 命令动作映射（design.md D2/D3/D4）。 */
export const DIRECTORY_REGISTRY_ACTION: Record<PluginRegistryActionRef, RegistryCommandAction> = {
  approve: 'approve',
  disable: 'withdraw',
  restore: 'restore-request',
  rollback: 'rollback',
}

/** 从 release metadata 提取已验证权限 key 词表（封闭解析，损坏 metadata 返回空集）。 */
export function declaredPermissionKeys(metadata: unknown): string[] {
  try {
    const meta = typeof metadata === 'string' ? JSON.parse(metadata) : metadata
    if (!Array.isArray(meta?.permissions)) return []
    return meta.permissions
      .map((p: unknown) => String((p as { permissionKey?: unknown })?.permissionKey ?? ''))
      .filter((k: string) => k.length > 0)
  } catch {
    return []
  }
}

/** 单 release 的活动/已卸载安装计数（组织隔离 GROUP BY，低敏聚合）。 */
async function countInstallations(
  organizationId: number,
  releaseId: number,
): Promise<PluginChangeAffectedInstallationSummary> {
  const rows = await PluginInstallation.query()
    .where('organization_id', organizationId)
    .where('release_id', releaseId)
    .select('status')
  let activeCount = 0
  let uninstalledCount = 0
  for (const row of rows) {
    if (row.status === 'uninstalled') uninstalledCount++
    else activeCount++
  }
  return { activeCount, uninstalledCount }
}

/**
 * 目录动作 -> 目标状态 + 前置校验（restore 与其余三动作走**不同权威**）。
 *
 * `withdrawn` 在通用迁移表里是终态（`legalTransitionsFrom('withdrawn') === []`），
 * 恢复不是一次普通迁移，而是按 D4「重新进入审批周期」——权威判定是
 * `validateRestoreRequest`（复验 receipt/完整性/兼容性）加 `restore-request` 指令
 * 给出的目标状态 `draft`。若对 restore 套用 `validateTransition`，
 * 会恒得 `registry-illegal-status-transition`，恢复动作永远不可能成功。
 */
function resolveDirectoryTransition(
  action: PluginRegistryActionRef,
  release: PluginPrivateRegistryRelease,
):
  | { ok: true; targetStatus: RegistryReleaseStatus }
  | { ok: false; errorCode: string; message: string } {
  if (action === 'restore') {
    const restore = validateRestoreRequest({
      release: releaseToCoreShape(release),
      latestReview: null,
      receiptValid: Boolean(release.upstreamReceiptRef),
      integrityValid: Boolean(release.packageDigest && release.manifestDigest),
      compatibilityValid: evaluateCurrentReleaseApproval(release.metadata).allowed,
    })
    if (!restore.allowed) {
      return { ok: false, errorCode: restore.errorCode, message: restore.message }
    }
    const instruction = getTransitionInstruction('restore-request')
    if (!instruction) {
      return {
        ok: false,
        errorCode: 'registry-invalid-action',
        message: 'restore-request 指令缺失',
      }
    }
    return { ok: true, targetStatus: instruction.targetStatus }
  }

  const transition = validateTransition(
    DIRECTORY_REGISTRY_ACTION[action],
    release.status as RegistryReleaseStatus,
  )
  if (!transition.valid) {
    return { ok: false, errorCode: transition.errorCode, message: transition.message }
  }
  return { ok: true, targetStatus: transition.instruction.targetStatus }
}

export interface CreateReleaseChangeInput {
  organizationId: number
  requestedBy: number
  action: PluginRegistryActionRef
  targetReleaseId: number
  /** rollback 显式选中待降级的安装实例 id（空 = 仅指针切换）。 */
  selectedInstanceIds?: readonly number[]
}

export interface CreateReleaseChangeResult {
  requestUid: string
  state: string
  approvalRequired: boolean
  /** rollback 结构化预览 diff（其余动作为 null）。 */
  rollbackDiff: PrivateRegistryRollbackDiff | null
}

@inject()
export class PluginDirectoryChangeAdapter {
  constructor(
    private changeService: PluginChangeRequestService,
    private installService: PluginInstallService,
  ) {}

  // ==========================================================================
  // 创建：前置校验 + canonical diff + 进入统一变更流
  // ==========================================================================

  /**
   * 计算 rollback 结构化 diff 与 blocking findings（纯读，task 3.5）。
   * 供 preview 端点与 create 共用，保证「预览标记 blocking」与「创建拒绝」同源。
   */
  async buildRollbackDiff(
    organizationId: number,
    targetReleaseId: number,
    selectedInstanceIds: readonly number[] = [],
  ): Promise<
    | { ok: true; diff: PrivateRegistryRollbackDiff; currentReleaseId: number }
    | { ok: false; errorCode: string; message: string }
  > {
    const target = await PluginPrivateRegistryRelease.query()
      .where('organization_id', organizationId)
      .where('id', targetReleaseId)
      .first()
    if (!target) {
      return {
        ok: false,
        errorCode: 'registry-release-not-found',
        message: '回滚目标 release 不存在',
      }
    }

    const entry = await PluginPrivateRegistryEntry.query()
      .where('organization_id', organizationId)
      .where('plugin_identity', target.pluginIdentity)
      .first()
    if (!entry || entry.recommendedReleaseId === null) {
      return {
        ok: false,
        errorCode: 'registry-rollback-target-invalid',
        message: '该插件没有当前推荐版本，无法回滚',
      }
    }
    if (entry.recommendedReleaseId === target.id) {
      return {
        ok: false,
        errorCode: 'registry-rollback-target-invalid',
        message: '回滚目标即当前推荐版本',
      }
    }

    const current = await PluginPrivateRegistryRelease.query()
      .where('organization_id', organizationId)
      .where('id', entry.recommendedReleaseId)
      .first()
    if (!current) {
      return {
        ok: false,
        errorCode: 'registry-rollback-target-invalid',
        message: '当前推荐 release 不存在',
      }
    }

    // blocking findings 逐项判定（fail closed）
    const blocking: PrivateRegistryRollbackBlockingCode[] = []
    if (target.status !== 'approved') blocking.push('rollback-target-not-approved')
    if (!target.packageDigest || !target.manifestDigest) {
      blocking.push('rollback-target-integrity-incomplete')
    }
    const compatibility = evaluateCurrentReleaseApproval(target.metadata)
    if (!compatibility.allowed) blocking.push('rollback-target-incompatible')

    // 权限提升判定：目标声明相对当前已确认/推荐声明存在净新增 -> 阻断
    // （提权必须走 permission-upgrade 变更流，不得借回滚洗白）。
    const installation = await PluginInstallation.query()
      .where('organization_id', organizationId)
      .where('plugin_id', target.pluginIdentity)
      .first()
    const currentKeys = installation?.permissionConfirmation
      ? [...installation.permissionConfirmation.permissionKeys]
      : declaredPermissionKeys(current.metadata)
    const targetKeys = declaredPermissionKeys(target.metadata)
    const permissionDelta = computePermissionDelta(currentKeys, targetKeys)
    if (isPermissionElevation(permissionDelta)) blocking.push('rollback-permission-elevation')

    const impact = await countInstallations(organizationId, current.id)

    return {
      ok: true,
      currentReleaseId: current.id,
      diff: {
        currentReleaseId: String(current.id),
        targetReleaseId: String(target.id),
        currentVersion: current.version,
        targetVersion: target.version,
        manifestDigestBefore: current.manifestDigest ?? null,
        manifestDigestAfter: target.manifestDigest ?? null,
        packageDigestBefore: current.packageDigest ?? null,
        packageDigestAfter: target.packageDigest ?? null,
        compatibilityDigestBefore: current.compatibilityDigest ?? null,
        compatibilityDigestAfter: target.compatibilityDigest ?? null,
        permissionDelta,
        blockingFindings: blocking,
        affectedActiveCount: impact.activeCount,
        ...(selectedInstanceIds.length > 0
          ? { selectedInstanceIds: [...selectedInstanceIds] }
          : {}),
      },
    }
  }

  /**
   * 创建目录变更请求（四动作统一入口，task 3.1）。
   * 任何前置校验失败抛 PluginDirectoryChangeError（fail closed，不落任何行）。
   */
  async createReleaseChangeRequest(
    input: CreateReleaseChangeInput,
  ): Promise<CreateReleaseChangeResult> {
    const release = await PluginPrivateRegistryRelease.query()
      .where('organization_id', input.organizationId)
      .where('id', input.targetReleaseId)
      .first()
    if (!release) {
      throw new PluginDirectoryChangeError('registry-release-not-found', '目标 release 不存在')
    }

    // 动作前置校验（复用 registry 状态机，fail closed）
    if (input.action === 'rollback') {
      const plan = await this.buildRollbackDiff(
        input.organizationId,
        input.targetReleaseId,
        input.selectedInstanceIds ?? [],
      )
      if (!plan.ok) {
        throw new PluginDirectoryChangeError(plan.errorCode, plan.message)
      }
      // 阻断 finding 存在时不得提交（spec Requirement 5）
      if (plan.diff.blockingFindings.length > 0) {
        throw new PluginDirectoryChangeError(
          'registry-rollback-blocking',
          `回滚存在阻断项：${plan.diff.blockingFindings.join(',')}`,
        )
      }
    } else {
      // approve/disable 走通用迁移表，restore 走 D4 恢复复验（见 resolveDirectoryTransition）
      const resolved = resolveDirectoryTransition(input.action, release)
      if (!resolved.ok) {
        throw new PluginDirectoryChangeError(resolved.errorCode, resolved.message)
      }
      if (input.action === 'approve') {
        // 审批兼容门：与 registry preview 端点同一权威判定
        const compatibility = evaluateCurrentReleaseApproval(release.metadata)
        if (!compatibility.allowed) {
          throw new PluginDirectoryChangeError(
            'registry-release-incompatible',
            'release compatibility review failed',
          )
        }
      }
    }

    // canonical diff（before/after 一经创建不可变）
    const diff = await this.buildCanonicalDiff(input, release)

    const created = await this.changeService.create({
      organizationId: input.organizationId,
      projectId: null,
      kind: 'registry-release-change',
      pluginId: release.pluginIdentity,
      requestedBy: String(input.requestedBy),
      targetRevision: `registry-release:${release.id}:${release.rowVersion}`,
      diff,
      permissionDigest: '',
      compatibilityDigest: release.compatibilityDigest ?? '',
      // 四动作映射的 registry 命令全部 requiresMakerChecker -> 审批强制
      approvalRequired: true,
    })

    const previewed = await this.changeService.attachPreview(
      input.organizationId,
      created.requestUid,
    )
    if (!previewed.ok) {
      throw new PluginDirectoryChangeError(
        previewed.code,
        previewed.message ?? '变更请求进入审批流失败',
      )
    }

    let rollbackDiff: PrivateRegistryRollbackDiff | null = null
    if (input.action === 'rollback') {
      const plan = await this.buildRollbackDiff(
        input.organizationId,
        input.targetReleaseId,
        input.selectedInstanceIds ?? [],
      )
      if (plan.ok) rollbackDiff = plan.diff
    }

    return {
      requestUid: created.requestUid,
      state: previewed.data.state,
      approvalRequired: true,
      rollbackDiff,
    }
  }

  /** 构建 canonical diff（含低敏影响摘要与状态差异）。 */
  private async buildCanonicalDiff(
    input: CreateReleaseChangeInput,
    release: PluginPrivateRegistryRelease,
  ): Promise<PluginChangeCanonicalDiff> {
    const status = release.status as RegistryReleaseStatus

    const diff: PluginChangeCanonicalDiff = {
      kind: 'registry-release-change',
      pluginId: release.pluginIdentity,
      registryAction: input.action,
    }

    if (input.action !== 'rollback') {
      // 状态差异：approve/disable/restore 的目标状态由状态机指令决定
      const resolved = resolveDirectoryTransition(input.action, release)
      if (resolved.ok) {
        diff.releaseStatusDelta = {
          from: status as PluginRegistryReleaseStatusRef,
          to: resolved.targetStatus as PluginRegistryReleaseStatusRef,
        }
      }
      diff.compatibilityDigestAfter = release.compatibilityDigest ?? null
    } else {
      // rollback：版本/权限/兼容性对照 + 影响摘要
      const entry = await PluginPrivateRegistryEntry.query()
        .where('organization_id', input.organizationId)
        .where('plugin_identity', release.pluginIdentity)
        .first()
      const currentId = entry?.recommendedReleaseId ?? null
      const current = currentId
        ? await PluginPrivateRegistryRelease.query()
            .where('organization_id', input.organizationId)
            .where('id', currentId)
            .first()
        : null
      diff.versionDelta = {
        currentVersion: current?.version ?? null,
        targetVersion: release.version,
        currentReleaseId: currentId,
        targetReleaseId: release.id,
      }
      const currentKeys = current ? declaredPermissionKeys(current.metadata) : []
      diff.permissionDelta = computePermissionDelta(
        currentKeys,
        declaredPermissionKeys(release.metadata),
      )
      diff.compatibilityDigestBefore = current?.compatibilityDigest ?? null
      diff.compatibilityDigestAfter = release.compatibilityDigest ?? null
      if (current) {
        const impact = await countInstallations(input.organizationId, current.id)
        diff.affectedInstallationSummary = {
          ...impact,
          ...(input.selectedInstanceIds && input.selectedInstanceIds.length > 0
            ? { selectedInstanceIds: [...input.selectedInstanceIds] }
            : {}),
        }
      }
    }

    // disable 影响摘要（spec Requirement 4：影响清单与禁用并存）
    if (input.action === 'disable') {
      const impact = await countInstallations(input.organizationId, release.id)
      diff.affectedInstallationSummary = impact
    }

    return diff
  }

  // ==========================================================================
  // 查询与确认：目录侧承接扩展 kind 的 confirm（与 policy-bundle 同范式）
  // ==========================================================================

  /**
   * 按 uid 取本组织的变更请求行（跨组织/不存在一律 null，非泄露）。
   * Controller 据此判定 404 与 kind fail-closed，避免把 registry-release-change
   * 之外的请求错误地套上目录 apply delegate。
   */
  async findDirectoryChangeRequest(organizationId: number, requestUid: string) {
    return this.changeService.tryGetByUid(organizationId, requestUid)
  }

  /**
   * 目录变更最终确认（提交门，task 3.1/3.6）。
   *
   * 一次性句柄消费 → 本 adapter 的 apply delegate → 可信审计 receipt，
   * 三者同一事务边界（由 `confirmAndApply` 保证）：任一失败整体回滚，
   * release 状态与推荐指针不留半成品。
   */
  async confirmReleaseChange(input: {
    organizationId: number
    requestUid: string
    executorId: number
    handle: string
  }) {
    const result = await this.changeService.confirmAndApply({
      organizationId: input.organizationId,
      requestUid: input.requestUid,
      executorRef: String(input.executorId),
      handle: input.handle,
      applyDelegate: this.buildApplyDelegate({
        organizationId: input.organizationId,
        executorId: input.executorId,
      }),
    })
    if (!result.ok) return result
    return {
      ok: true as const,
      data: this.changeService.toRecordDTO(result.data.request),
    }
  }

  // ==========================================================================
  // 应用：apply delegate（领域提交 + 可信审计同事务）
  // ==========================================================================

  /**
   * 构造 apply delegate：从请求行的 targetRevision/diff 重建领域绑定。
   * 在共享事务内执行；任何校验失败抛错 -> 整体回滚并落 failed（可重试）。
   */
  buildApplyDelegate(input: { organizationId: number; executorId: number }): ChangeApplyDelegate {
    return async ({ request, trx, executorRef }) => {
      const action = request.diffJson.registryAction
      if (!action) throw new Error('registry-release-change missing registryAction in diff')

      // 领域绑定解析：registry-release:<releaseId>:<rowVersion>
      const binding = parseRegistryReleaseBinding(request.targetRevision)
      const release = await PluginPrivateRegistryRelease.query({ client: trx })
        .where('organization_id', request.organizationId)
        .where('id', binding.releaseId)
        .first()
      if (!release) throw new Error('target release not found')

      if (action === 'rollback') {
        // ── rollback：指针切换 + 显式选中实例委托 install lifecycle ──
        const entry = await PluginPrivateRegistryEntry.query({ client: trx })
          .where('organization_id', request.organizationId)
          .where('plugin_identity', release.pluginIdentity)
          .first()
        if (!entry) throw new Error('registry entry not found for rollback')

        // 委托既有 install lifecycle 降级实例（绝不直接改写安装行，task 3.6）
        const selected = request.diffJson.affectedInstallationSummary?.selectedInstanceIds ?? []
        let downgraded = 0
        for (const installationId of selected) {
          const installation = await PluginInstallation.query({ client: trx })
            .where('organization_id', request.organizationId)
            .where('id', installationId)
            .first()
          if (!installation || installation.status === 'uninstalled') continue
          // preview 用默认连接读取（PREVIEW_STORE 为内存暂存，不写库）；
          // confirm 的事务注入保证安装行与指针切换同事务提交。
          const preview = await this.installService.preview(
            request.organizationId,
            input.executorId,
            {
              action: 'upgrade',
              pluginId: release.pluginIdentity,
              releaseId: release.id,
            },
          )
          await this.installService.confirm(
            request.organizationId,
            input.executorId,
            {
              previewHandle: preview.previewHandle,
              previewDigest: preview.previewDigest,
            },
            { client: trx },
          )
          downgraded++
        }

        entry.recommendedReleaseId = release.id
        entry.recommendedVersion = release.version
        await entry.useTransaction(trx).save()

        return await appendTrustedChangeAuditReceipt({
          organizationId: request.organizationId,
          projectId: request.projectId,
          userId: Number(executorRef),
          action: 'apply',
          requestUid: request.requestUid,
          metadata: {
            kind: 'registry-release-change',
            registryAction: 'rollback',
            targetReleaseId: release.id,
            pointerUpdated: true,
            instancesDowngraded: downgraded,
          },
          client: trx,
        })
      }

      // ── approve / disable / restore：release 状态落库（状态机复验 + rowVersion 绑定）──
      if (String(release.rowVersion) !== binding.rowVersion) {
        throw new Error('release state has changed since preview; re-preview required')
      }
      // apply 时点二次校验（防 preview 后漂移）：restore 在此重新复验
      // receipt/完整性/兼容性，approve/disable 复验通用迁移表。
      const resolved = resolveDirectoryTransition(action, release)
      if (!resolved.ok) {
        throw new Error(`illegal transition: ${resolved.message}`)
      }

      release.status = resolved.targetStatus
      release.rowVersion += 1
      await release.useTransaction(trx).save()

      return await appendTrustedChangeAuditReceipt({
        organizationId: request.organizationId,
        projectId: request.projectId,
        userId: Number(executorRef),
        action: 'apply',
        requestUid: request.requestUid,
        metadata: {
          kind: 'registry-release-change',
          registryAction: action,
          releaseId: release.id,
          releaseStatusDelta: request.diffJson.releaseStatusDelta ?? null,
        },
        client: trx,
      })
    }
  }
}

/** 解析 targetRevision 绑定（registry-release:<releaseId>:<rowVersion>）。 */
export function parseRegistryReleaseBinding(targetRevision: string): {
  releaseId: number
  rowVersion: string
} {
  const parts = targetRevision.split(':')
  if (parts.length !== 3 || parts[0] !== 'registry-release') {
    throw new Error('invalid registry release binding')
  }
  return { releaseId: Number(parts[1]), rowVersion: parts[2] }
}

/** 目录变更错误（稳定 code，fail closed）。 */
export class PluginDirectoryChangeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PluginDirectoryChangeError'
  }
}

/** Lucid 模型 -> registry 纯核心期望的 release 形态（只取校验所需字段）。 */
function releaseToCoreShape(release: PluginPrivateRegistryRelease) {
  return {
    id: String(release.id),
    organizationId: String(release.organizationId),
    pluginIdentity: release.pluginIdentity,
    version: release.version,
    packageDigest: release.packageDigest,
    manifestDigest: release.manifestDigest,
    compatibilityDigest: release.compatibilityDigest,
    upstreamReceiptRef: release.upstreamReceiptRef,
    // 列上有 CHECK 约束保证取值落在词表内；此处只做类型收窄，不放宽校验。
    status: release.status as RegistryReleaseStatus,
    metadata: release.metadata,
    rowVersion: release.rowVersion,
    createdAt: release.createdAt?.toISO() ?? '',
    updatedAt: release.updatedAt?.toISO() ?? '',
  }
}

export default PluginDirectoryChangeAdapter
