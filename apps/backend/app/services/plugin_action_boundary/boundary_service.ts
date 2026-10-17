/**
 * v3-plugin-action-preview-boundary —— PluginActionBoundaryService（编排层）。
 *
 * 全部插件写入动作的唯一受控通道：
 *   registerProposal（宿主表面调用）→ generatePreview（adapter draft → 标准 preview）
 *   → decide（reject/discard 零写入；modify 派生新提案）→ issueConfirmHandle（一次性绑定句柄）
 *   → confirm（全前置重校验 + 同事务 CAS 消费/领域写入/严格审计，任一失败整体回滚）。
 *
 * 红线：
 * - 插件代码不进入本服务执行路径；只有宿主登记的核心 adapter 在确认事务中被调用；
 * - stale / 权限缺失 / 安装禁用 / 版本失配 / dry-run blocking 一律阻断，禁止静默刷新后提交；
 * - 幂等重放返回同一 receipt，不重复写入；部分失败逐项呈现，不洗白为成功；
 * - 审计低敏：metadata 经 sanitizeActionEnvelope 脱敏后才落库。
 */
import { inject } from '@adonisjs/core'
import Database from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type {
  PluginActionConfirmHandle,
  PluginActionPreview,
  PluginActionProposal,
  PluginActionSourceRef,
  PluginActionDecisionKind,
} from '@aiproj/types'
import {
  buildPluginActionConfirmHandle,
  computeProposalDigest,
  isActionPreviewConfirmable,
  revalidateActionSourceRefs,
  sanitizeActionEnvelope,
  translateActionDecision,
  validateActionHandleBinding,
  validatePluginActionProposal,
  PLUGIN_ACTION_HANDLE_TTL_SECONDS,
} from '@aiproj/types'
import AuditLog from '#models/audit_log'
import PluginInstallation from '#models/plugin_installation'
import PluginActionProposalModel, {
  type PluginActionAppliedReceipt,
  type PluginActionRowStatus,
} from '#models/plugin_action_proposal'
import { ActionBoundaryError, pluginActionAdapterRegistry } from './adapter_registry.js'
import { assemblePluginActionPreview } from './preview_assembler.js'
import { registerPilotActionAdapter } from './pilot_adapter.js'

const PREVIEW_TTL_SECONDS = 600

/** 确认结果（幂等重放与首次成功返回同一 receipt 形状）。 */
export interface PluginActionConfirmOutcome {
  readonly status: 'applied' | 'modified' | 'idempotent_replay'
  readonly receipt: PluginActionAppliedReceipt | null
  readonly message: string
}

export interface RegisterProposalInput {
  readonly organizationId: number
  readonly projectId: number | null
  readonly proposal: PluginActionProposal
  readonly proposedBy: number | null
}

function randomUid(): string {
  return `pact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

@inject()
export class PluginActionBoundaryService {
  constructor() {
    // pilot adapter 随服务装配幂等注册（host-owned；插件不可达）
    registerPilotActionAdapter()
  }

  /**
   * 宿主表面登记提案（server hook / 未来 command palette / copilot tool / event）。
   * 形状非法即拒绝；插件永远无法绕过本入口产生可确认对象。
   */
  async registerProposal(input: RegisterProposalInput): Promise<{ proposalUid: string }> {
    const check = validatePluginActionProposal(input.proposal)
    if (!check.valid) {
      throw new ActionBoundaryError(
        'action-proposal-invalid',
        `proposal rejected: ${check.findings.map((f) => `${f.code}${f.path ? `@${f.path}` : ''}`).join('; ')}`,
      )
    }
    // scope 一致性：envelope scope 必须等于宿主解析的请求 scope（防跨 scope 夹带）。
    if (
      input.proposal.scope.organizationId !== input.organizationId ||
      (input.proposal.scope.projectId ?? null) !== (input.projectId ?? null)
    ) {
      throw new ActionBoundaryError('cross-scope-denied', 'proposal scope mismatch')
    }

    const proposalUid = randomUid()
    await PluginActionProposalModel.create({
      organizationId: input.organizationId,
      projectId: input.projectId,
      proposalUid,
      schemaVersion: input.proposal.schemaVersion,
      actionKind: input.proposal.actionKind,
      status: 'proposed' satisfies PluginActionRowStatus,
      inputPayload: input.proposal.inputPayload,
      sourceRefs: input.proposal.sourceRefs,
      proposedBy: input.proposedBy,
      rowVersion: 1,
    })

    const auditMeta = sanitizeActionEnvelope({
      proposalUid,
      actionKind: input.proposal.actionKind,
      pluginId: input.proposal.sourceRefs[0]?.pluginId ?? null,
      surface: input.proposal.sourceRefs[0]?.surface ?? null,
      sourceDigestPrefix: (input.proposal.sourceRefs[0]?.contentDigest ?? '').slice(0, 8),
    })
    await AuditLog.create({
      action: 'create',
      severity: 'info',
      userId: input.proposedBy ?? null,
      organizationId: input.organizationId,
      projectId: input.projectId,
      entityType: 'plugin_action_proposal',
      entityId: null,
      metadata: { event: 'PLUGIN_ACTION_PROPOSAL_REGISTERED', ...auditMeta },
    })
    return { proposalUid }
  }

  /** 加载组织内提案；跨组织查询恒空 → 统一 not-found（非泄露）。 */
  private async loadRow(
    organizationId: number,
    proposalUid: string,
  ): Promise<PluginActionProposalModel> {
    const row = await PluginActionProposalModel.forOrganization(organizationId)
      .where('proposal_uid', proposalUid)
      .first()
    if (!row) {
      throw new ActionBoundaryError('action-proposal-invalid', 'proposal not found')
    }
    return row
  }

  /**
   * 生成/刷新标准 preview：adapter draft → 有界组装 → digest 固化。
   * dry-run blocking finding 时 preview 标记不可确认（confirm 前置会再拦一次）。
   */
  async generatePreview(params: {
    organizationId: number
    proposalUid: string
    actorUserId: number
    actorPermissions: readonly string[]
    nowIso?: string
  }): Promise<PluginActionPreview> {
    const row = await this.loadRow(params.organizationId, params.proposalUid)
    if (row.status === 'rejected' || row.status === 'discarded' || row.status === 'applied') {
      throw new ActionBoundaryError('action-proposal-invalid', `proposal is ${row.status}`)
    }
    if (row.status === 'stale') {
      throw new ActionBoundaryError('preview-stale', 'proposal superseded by modification')
    }

    const adapter = pluginActionAdapterRegistry.require(
      row.actionKind as PluginActionProposal['actionKind'],
    )
    const envelope = row.toEnvelope()
    const proposalDigest = computeProposalDigest(envelope)
    const draft = await adapter.preview({
      organizationId: params.organizationId,
      projectId: row.projectId,
      actorUserId: params.actorUserId,
      inputPayload: row.inputPayload,
    })

    const nowIso = params.nowIso ?? DateTime.now().toISO()!
    const assembled = assemblePluginActionPreview(pluginActionAdapterRegistry, {
      proposal: envelope,
      proposalDigest,
      draft,
      actorPermissions: params.actorPermissions,
      nowIso,
      ttlSeconds: PREVIEW_TTL_SECONDS,
    })
    const preview: PluginActionPreview = {
      ...assembled.preview,
      previewDigest: assembled.previewDigest,
    }

    row.status = 'previewed'
    row.previewJson = preview
    row.previewDigest = preview.previewDigest
    row.previewExpiresAt = DateTime.fromISO(preview.expiresAt)
    row.targetRevision = draft.targetRevision
    row.idempotencyKey = assembled.idempotencyKey
    await row.save()

    await AuditLog.create({
      action: 'update',
      severity: 'info',
      userId: params.actorUserId,
      organizationId: params.organizationId,
      projectId: row.projectId,
      entityType: 'plugin_action_proposal',
      entityId: row.id,
      metadata: sanitizeActionEnvelope({
        event: 'PLUGIN_ACTION_PREVIEWED',
        proposalUid: row.proposalUid,
        previewDigestPrefix: preview.previewDigest.slice(0, 12),
        canApply: preview.dryRun.canApply,
        findingCount: preview.dryRun.findings.length,
        diffEntryCount: preview.diffEntries.length,
      }),
    })
    return preview
  }

  /** 提案详情（含最新 preview）。 */
  async detail(
    organizationId: number,
    proposalUid: string,
  ): Promise<{
    proposalUid: string
    status: PluginActionRowStatus
    preview: PluginActionPreview | null
  }> {
    const row = await this.loadRow(organizationId, proposalUid)
    return { proposalUid: row.proposalUid, status: row.status, preview: row.previewJson ?? null }
  }

  /**
   * 决策：reject/discard 直接落状态（零正式写入）；modify 校验修改值后派生新提案，
   * 原提案标记 stale（其旧句柄因行级 stale 而不可用），返回新 proposalUid。
   */
  async decide(params: {
    organizationId: number
    projectId: number | null
    proposalUid: string
    actorUserId: number
    decision: PluginActionDecisionKind
    userModifiedValue?: unknown
  }): Promise<{ proposalUid: string; status: PluginActionRowStatus }> {
    const translation = translateActionDecision({
      decision: params.decision,
      userModifiedValue: params.userModifiedValue,
    })
    if (!translation.ok) {
      throw new ActionBoundaryError(translation.reasonCode, translation.reason)
    }

    const row = await this.loadRow(params.organizationId, params.proposalUid)

    if (!translation.writeIntent) {
      row.status = params.decision === 'reject' ? 'rejected' : 'discarded'
      row.resultStatus = params.decision === 'reject' ? 'rejected' : 'discarded'
      await row.save()
      await AuditLog.create({
        action: 'reject',
        severity: 'info',
        userId: params.actorUserId,
        organizationId: params.organizationId,
        projectId: row.projectId,
        entityType: 'plugin_action_proposal',
        entityId: row.id,
        metadata: sanitizeActionEnvelope({
          event: 'PLUGIN_ACTION_DECIDED',
          proposalUid: row.proposalUid,
          decision: params.decision,
        }),
      })
      return { proposalUid: row.proposalUid, status: row.status }
    }

    // modify：新值必须通过同 kind 的输入校验；派生为新提案并重新走 preview→confirm。
    if (params.decision === 'modify') {
      const modifiedPayload = params.userModifiedValue as Record<string, unknown>
      const baseEnvelope = row.toEnvelope()
      const modified: PluginActionProposal = {
        ...baseEnvelope,
        inputPayload: modifiedPayload,
      }
      const check = validatePluginActionProposal(modified)
      if (!check.valid) {
        throw new ActionBoundaryError(
          'action-proposal-invalid',
          `modified value rejected: ${check.findings.map((f) => f.code).join('; ')}`,
        )
      }
      row.status = 'stale'
      await row.save()
      const created = await this.registerProposal({
        organizationId: params.organizationId,
        projectId: row.projectId,
        proposal: modified,
        proposedBy: params.actorUserId,
      })
      return { proposalUid: created.proposalUid, status: 'proposed' }
    }

    // accept 不在 decide 里执行 —— accept 必须走 confirm（显式用户确认 + 句柄）。
    throw new ActionBoundaryError(
      'action-proposal-invalid',
      'accept requires the confirm endpoint with a one-time handle',
    )
  }

  /**
   * 签发一次性确认句柄。
   * 前置：preview 存在且未过期、dry-run 可应用、权限已授予、安装启用且版本匹配。
   */
  async issueConfirmHandle(params: {
    organizationId: number
    proposalUid: string
    actorUserId: number
    actorPermissions: readonly string[]
    nowIso?: string
  }): Promise<PluginActionConfirmHandle> {
    const row = await this.loadRow(params.organizationId, params.proposalUid)
    if (row.status !== 'previewed' || !row.previewJson || !row.previewDigest) {
      throw new ActionBoundaryError('action-proposal-invalid', 'proposal has no active preview')
    }
    if (row.previewExpiresAt && row.previewExpiresAt.toJSDate().getTime() <= Date.now()) {
      throw new ActionBoundaryError('handle-expired', 'preview expired; re-preview required')
    }
    if (row.handleConsumedAt) {
      throw new ActionBoundaryError('handle-consumed', 'previous handle already consumed')
    }
    if (!isActionPreviewConfirmable(row.previewJson)) {
      throw new ActionBoundaryError('dry-run-blocking', 'preview contains blocking findings')
    }
    if (!row.previewJson.permissionSummary.granted) {
      throw new ActionBoundaryError('permission-denied', 'required permissions not granted')
    }
    await this.assertInstallEnabled(params.organizationId, row.sourceRefs)

    const nowIso = params.nowIso ?? DateTime.now().toISO()!
    const handle = buildPluginActionConfirmHandle({
      proposalId: row.proposalUid,
      previewDigest: row.previewDigest,
      actorUserId: params.actorUserId,
      organizationId: params.organizationId,
      projectId: row.projectId,
      pluginId: row.previewJson.pluginRef.pluginId,
      pluginVersion: row.previewJson.pluginRef.pluginVersion,
      targetRevision: row.targetRevision ?? '',
      idempotencyKey: row.idempotencyKey ?? '',
      nowIso,
      ttlSeconds: PLUGIN_ACTION_HANDLE_TTL_SECONDS,
    })

    // CAS：仅当行版本未变时写入句柄（并发签发互相失效）。
    const claimed = (await Database.from('plugin_action_proposals')
      .where({ id: row.id, row_version: row.rowVersion })
      .update({
        handle_value: handle.handle,
        handle_actor_user_id: params.actorUserId,
        handle_expires_at: DateTime.fromISO(handle.expiresAt).toSQL(),
        handle_consumed_at: null,
        row_version: row.rowVersion + 1,
      })) as unknown as number
    if (claimed === 0) {
      throw new ActionBoundaryError(
        'preview-stale',
        'proposal changed concurrently; re-preview required',
      )
    }
    return handle
  }

  /** 安装态 + 版本一致性：未启用或版本漂移一律阻断。 */
  private async assertInstallEnabled(
    organizationId: number,
    sourceRefs: readonly PluginActionSourceRef[],
  ): Promise<void> {
    const ref = sourceRefs[0]
    if (!ref) {
      throw new ActionBoundaryError('install-not-enabled', 'no source reference')
    }
    const installation = await PluginInstallation.query()
      .where('organizationId', organizationId)
      .where('pluginId', ref.pluginId)
      .first()
    if (!installation || installation.status !== 'enabled') {
      throw new ActionBoundaryError(
        'install-not-enabled',
        'plugin is not enabled in this organization',
      )
    }
    if (installation.version !== ref.pluginVersion) {
      throw new ActionBoundaryError(
        'plugin-version-mismatch',
        'plugin version changed since proposal',
      )
    }
  }

  /**
   * 确认执行（spec Requirement 3/4/5 的完整实现）：
   * 1) 结构绑定校验（scope/actor/过期/digest/revision/version/幂等键）；
   * 2) 安装启用 + 版本一致；
   * 3) 来源新鲜度重校验（echo vs recorded，失配即 stale）；
   * 4) 目标 revision 重校验（adapter 裁决）；
   * 5) 同一事务内：CAS 消费句柄 → adapter.apply → 严格审计 receipt；
   *    任一步失败整体回滚（fail-closed），不产生部分可见状态。
   * 已成功消费的相同幂等键重放返回既有 receipt，不重复写入。
   */
  async confirm(params: {
    organizationId: number
    proposalUid: string
    handleValue: string
    actorUserId: number
    actorPermissions: readonly string[]
    /** 客户端回显的来源引用（可选）；提供时与服务端记录比对。 */
    echoedSourceRefs?: readonly PluginActionSourceRef[]
    nowIso?: string
  }): Promise<PluginActionConfirmOutcome> {
    const nowIso = params.nowIso ?? DateTime.now().toISO()!

    // 事务外先做结构校验以便快速失败；事务内对关键前置再做一次新鲜读取复核。
    const row = await this.loadRow(params.organizationId, params.proposalUid)
    if (!row.previewJson || !row.previewDigest || !row.targetRevision) {
      throw new ActionBoundaryError('action-proposal-invalid', 'proposal has no active preview')
    }
    if (!row.idempotencyKey) {
      throw new ActionBoundaryError(
        'action-proposal-invalid',
        'proposal missing derived idempotency key',
      )
    }
    if (row.handleValue !== params.handleValue || row.handleActorUserId !== params.actorUserId) {
      throw new ActionBoundaryError('handle-invalid', 'unknown handle for this proposal/actor')
    }

    // 规范化过期时间为签发时的 toISOString() 形态，保证 digest 重算逐字节一致。
    const boundExpiresAt = row.handleExpiresAt ? row.handleExpiresAt.toJSDate().toISOString() : ''

    const binding = validateActionHandleBinding(
      {
        handle: params.handleValue,
        proposalId: row.proposalUid,
        previewDigest: row.previewDigest,
        actorUserId: params.actorUserId,
        organizationId: params.organizationId,
        projectId: row.projectId,
        pluginId: row.previewJson.pluginRef.pluginId,
        pluginVersion: row.previewJson.pluginRef.pluginVersion,
        targetRevision: row.targetRevision,
        idempotencyKey: row.idempotencyKey,
        expiresAt: boundExpiresAt,
      },
      {
        proposalId: row.proposalUid,
        previewDigest: row.previewDigest,
        actorUserId: params.actorUserId,
        organizationId: params.organizationId,
        projectId: row.projectId,
        pluginId: row.previewJson.pluginRef.pluginId,
        pluginVersion: row.previewJson.pluginRef.pluginVersion,
        targetRevision: row.targetRevision,
        idempotencyKey: row.idempotencyKey,
        nowIso,
      },
    )
    if (!binding.valid) {
      throw new ActionBoundaryError(binding.error, binding.reason)
    }

    await this.assertInstallEnabled(params.organizationId, row.sourceRefs)

    if (params.echoedSourceRefs) {
      const freshness = revalidateActionSourceRefs(params.echoedSourceRefs, row.sourceRefs)
      if (!freshness.fresh) {
        await this.auditDenied(
          params.organizationId,
          row.projectId,
          params.actorUserId,
          row.proposalUid,
          'PLUGIN_ACTION_STALE_BLOCKED',
          freshness.mismatchedIndexes.length,
        )
        throw new ActionBoundaryError(
          'source-signature-stale',
          'source references changed since capture',
        )
      }
    }

    if (!isActionPreviewConfirmable(row.previewJson)) {
      throw new ActionBoundaryError('dry-run-blocking', 'preview contains blocking findings')
    }
    if (
      !row.previewJson.permissionSummary.granted ||
      !row.previewJson.permissionSummary.requiredPermissions.every((p) =>
        params.actorPermissions.includes(p),
      )
    ) {
      await this.auditDenied(
        params.organizationId,
        row.projectId,
        params.actorUserId,
        row.proposalUid,
        'PLUGIN_ACTION_DENIED',
        0,
      )
      throw new ActionBoundaryError('permission-denied', 'required permissions not granted')
    }

    const adapter = pluginActionAdapterRegistry.require(
      row.actionKind as PluginActionProposal['actionKind'],
    )

    // 收窄快照：事务闭包内使用的不可变绑定值（避免属性可变性破坏类型收窄）。
    const boundPreview = row.previewJson
    const boundRevision: string = row.targetRevision
    const boundIdempotencyKey: string = row.idempotencyKey

    // ── 单一事务：CAS 消费 + 领域写入 + 严格审计 ──
    const outcome = await Database.transaction(async (trx) => {
      const current = await trx
        .from('plugin_action_proposals')
        .where({ organization_id: params.organizationId, proposal_uid: params.proposalUid })
        .first()
      if (!current) {
        throw new ActionBoundaryError('action-proposal-invalid', 'proposal not found')
      }
      // 幂等重放：同幂等键的已成功消费 → 返回既有 receipt，不重复写入。
      if (current.handle_consumed_at) {
        const existing =
          row.appliedReceiptJson ??
          (current.applied_receipt_json ? JSON.parse(current.applied_receipt_json) : null)
        if (existing && existing.idempotencyKey === row.idempotencyKey) {
          return {
            status: 'idempotent_replay' as const,
            receipt: existing as PluginActionAppliedReceipt,
            message: '该确认已处理过，返回既有结果（幂等）',
          }
        }
        throw new ActionBoundaryError('handle-consumed', 'handle already consumed')
      }
      if (current.row_version !== row.rowVersion) {
        throw new ActionBoundaryError(
          'preview-stale',
          'proposal changed concurrently; re-preview required',
        )
      }

      // 目标 revision 重校验（adapter 裁决当前事实；复用宿主事务连接）。
      const rv = await adapter.revalidate({
        organizationId: params.organizationId,
        projectId: row.projectId,
        actorUserId: params.actorUserId,
        inputPayload: row.inputPayload,
        expectedRevision: boundRevision,
        trx,
      })
      if (!rv.fresh) {
        throw new ActionBoundaryError(
          'preview-stale',
          `target revision moved (${boundRevision} → ${rv.currentRevision})`,
        )
      }

      // CAS 消费句柄（声明写入权；并发确认只有一个赢家）。
      const claimed = (await trx
        .from('plugin_action_proposals')
        .where({ id: current.id, row_version: current.row_version, handle_consumed_at: null })
        .update({
          handle_consumed_at: DateTime.fromISO(nowIso).toSQL(),
          row_version: current.row_version + 1,
        })) as unknown as number
      if (claimed === 0) {
        throw new ActionBoundaryError('handle-consumed', 'handle concurrently consumed')
      }

      // 正式领域写入（核心 adapter，宿主事务注入）。
      const applied = await adapter.apply({
        trx,
        organizationId: params.organizationId,
        projectId: row.projectId,
        actorUserId: params.actorUserId,
        inputPayload: row.inputPayload,
        proposalUid: row.proposalUid,
        targetRevision: boundRevision,
      })

      // 严格审计（同事务；失败抛错 → 整体回滚，含已领取的消费标记与领域写入）。
      const auditLog = await AuditLog.create(
        {
          action: 'apply',
          severity: 'info',
          userId: params.actorUserId,
          organizationId: params.organizationId,
          projectId: row.projectId,
          entityType: 'plugin_action_proposal',
          entityId: row.id,
          metadata: sanitizeActionEnvelope({
            event: 'PLUGIN_ACTION_APPLIED',
            proposalUid: row.proposalUid,
            actionKind: row.actionKind,
            pluginId: boundPreview.pluginRef.pluginId,
            writtenRefCount: applied.writtenRefs.length,
            idempotencyKey: boundIdempotencyKey,
          }),
        },
        { client: trx },
      )

      const receipt: PluginActionAppliedReceipt = {
        proposalId: row.proposalUid,
        status: 'applied',
        idempotencyKey: boundIdempotencyKey,
        writtenRefs: applied.writtenRefs,
        auditLogId: auditLog.id,
        auditCreatedAt: auditLog.createdAt.toISO()!,
        appliedAt: nowIso,
      }

      await trx
        .from('plugin_action_proposals')
        .where({ id: current.id })
        .update({
          status: 'applied',
          result_status: 'applied',
          applied_receipt_json: JSON.stringify(receipt),
          applied_at: DateTime.fromISO(nowIso).toSQL(),
          row_version: current.row_version + 2,
        })

      return {
        status: 'applied' as const,
        receipt,
        message: '已在确认的事务中完成写入',
      }
    })

    return outcome
  }

  /** 低敏拒绝审计（越权/stale 尝试；不泄露目标内容）。 */
  private async auditDenied(
    organizationId: number,
    projectId: number | null,
    actorUserId: number,
    proposalUid: string,
    event: 'PLUGIN_ACTION_DENIED' | 'PLUGIN_ACTION_STALE_BLOCKED',
    mismatchCount: number,
  ): Promise<void> {
    await AuditLog.create({
      action: 'reject',
      severity: 'warning',
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'plugin_action_proposal',
      entityId: null,
      metadata: sanitizeActionEnvelope({
        event,
        proposalUid,
        mismatchCount,
      }),
    })
  }
}
