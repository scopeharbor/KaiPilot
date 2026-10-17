/**
 * v3-plugin-event-subscription-contract —— PluginEventDeliveryHostService（D5 本机批量交付宿主）。
 *
 * 职责（spec Requirements 2/4/5/6/7）：
 * 1. 批量消费 plugin_event_deliveries 中 pending 行（本机 SQLite，零外部消息设施）；
 * 2. 交付前逐行复核：installation enabled、版本一致、subscription revision（digest 仍在当前
 *    metadata 快照中）、事件版本兼容、grant permission、project scope——任一失配即
 *    stale/dropped/skipped，绝不把 payload 暴露给未授权方；
 * 3. 通过进程内确定性 handler 注册表调用插件（超时/崩溃/配额隔离），响应仅允许
 *    observation/advisory-draft/action-proposal；action-proposal 委托统一插件动作
 *    preview/confirm 边界（PluginActionBoundaryService.registerProposal，surface=event-subscription），
 *    不直接调用任何 domain service；
 * 4. 幂等 recorder：plugin_event_responses 以 delivery_identity 唯一去重；
 * 5. health best-effort + 低敏 audit；失败绝不回滚核心事务。
 */
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import PluginEventDelivery from '#models/plugin_event_delivery'
import PluginEventResponseModel from '#models/plugin_event_response'
import PluginInstallation from '#models/plugin_installation'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import Project from '#models/project'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  PLUGIN_SEAM_EVENT_SUBSCRIPTION,
  PLUGIN_ACTION_SCHEMA_VERSION,
  eventFnv1aHash,
  eventStableSerialize,
  lookupPluginEventDefinition,
  checkPluginEventVersionCompatibility,
  validatePluginEventResponse,
  type NormalizedPluginEventSubscriptionPayload,
  type PluginActionSourceRef,
  type PluginEventEnvelope,
  type PluginEventResponse,
  type PluginEventResponseKind,
} from '@aiproj/types'

/** 单次交付超时（毫秒；与 server hook 一致）。 */
const DELIVERY_TIMEOUT_MS = 5000

/** 单次 processDue 最大实际调用数（积压保留 pending，不强推）。 */
export const DEFAULT_DELIVERY_BATCH_INVOCATIONS = 50

/** 单批拉取上限。 */
export const DEFAULT_DELIVERY_BATCH_SIZE = 100

/** 插件 handler（进程内确定性函数；测试/pilot 注册）。 */
export type PluginEventHandler = (envelope: PluginEventEnvelope) => Promise<unknown>

const handlerRegistry = new Map<string, PluginEventHandler>()

/** 注册插件事件 handler（pilot 插件/测试用）。 */
export function registerPluginEventHandler(pluginId: string, handler: PluginEventHandler): void {
  handlerRegistry.set(pluginId, handler)
}

/** 注销 handler。 */
export function unregisterPluginEventHandler(pluginId: string): void {
  handlerRegistry.delete(pluginId)
}

/** 交付运行报告（低敏计数）。 */
export interface DeliveryRunReport {
  scanned: number
  delivered: number
  skipped: number
  stale: number
  failed: number
  dropped: number
  leftPending: number
}

interface ResolvedSnapshot {
  permissions: readonly string[]
  payload: NormalizedPluginEventSubscriptionPayload
}

@inject()
export default class PluginEventDeliveryHostService {
  /** 当前批的调用超时（processDue 注入；默认契约上限）。 */
  #currentTimeoutMs = DELIVERY_TIMEOUT_MS

  constructor(private auditService: AuditService) {}

  /** 批量处理到期交付。 */
  async processDue(input?: {
    organizationId?: number
    batchSize?: number
    /** 测试注入的调用超时（毫秒；上限 DELIVERY_TIMEOUT_MS）。 */
    timeoutMs?: number
    /** 本次运行最大实际调用数（上限 DEFAULT_DELIVERY_BATCH_INVOCATIONS）。 */
    maxInvocations?: number
  }): Promise<DeliveryRunReport> {
    this.#currentTimeoutMs = Math.max(
      1,
      Math.min(DELIVERY_TIMEOUT_MS, input?.timeoutMs ?? DELIVERY_TIMEOUT_MS),
    )
    const maxInvocations = Math.max(
      0,
      Math.min(
        DEFAULT_DELIVERY_BATCH_INVOCATIONS,
        input?.maxInvocations ?? DEFAULT_DELIVERY_BATCH_INVOCATIONS,
      ),
    )
    const batchSize = Math.max(
      1,
      Math.min(DEFAULT_DELIVERY_BATCH_SIZE, input?.batchSize ?? DEFAULT_DELIVERY_BATCH_SIZE),
    )
    let query = PluginEventDelivery.query()
      .where('status', 'pending')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .limit(batchSize)
    if (typeof input?.organizationId === 'number') {
      query = query.where('organization_id', input.organizationId)
    }
    const rows = await query

    const report: DeliveryRunReport = {
      scanned: rows.length,
      delivered: 0,
      skipped: 0,
      stale: 0,
      failed: 0,
      dropped: 0,
      leftPending: 0,
    }
    let invocations = 0

    for (const row of rows) {
      if (invocations >= maxInvocations) {
        report.leftPending++
        continue
      }
      const outcome = await this.#deliverOne(row)
      switch (outcome.status) {
        case 'delivered':
          report.delivered++
          break
        case 'skipped':
          report.skipped++
          break
        case 'stale':
          report.stale++
          break
        case 'failed':
          report.failed++
          break
        case 'dropped':
          report.dropped++
          break
        default:
          report.leftPending++
      }
      if (outcome.invoked) invocations++
    }
    return report
  }

  /**
   * 交付单行：返回终态与是否实际调用了 handler。
   * 任何内部异常都被隔离为 failed（不向上抛）。
   */
  async #deliverOne(row: PluginEventDelivery): Promise<{ status: string; invoked: boolean }> {
    const startedAt = Date.now()
    try {
      // ── 安装态复核 ──
      const installation = await PluginInstallation.find(row.installationId)
      if (!installation || installation.organizationId !== row.organizationId) {
        await this.#markTerminal(row, 'stale', 'installation_missing')
        return { status: 'stale', invoked: false }
      }
      if (installation.status !== 'enabled') {
        // 停用/卸载 → 撤销订阅；排队事件不交付、不泄露 payload
        await this.#markTerminal(row, 'dropped', 'subscription_revoked')
        return { status: 'dropped', invoked: false }
      }
      if ((installation.version ?? '') !== row.pluginVersion) {
        await this.#markTerminal(row, 'stale', 'plugin_version_changed')
        return { status: 'stale', invoked: false }
      }

      // ── subscription snapshot 复核（digest 必须仍在当前 metadata）──
      const snapshot = await this.#resolveInstallSnapshot(row.organizationId, installation)
      if (!snapshot) {
        await this.#markTerminal(row, 'stale', 'metadata_unavailable')
        return { status: 'stale', invoked: false }
      }
      const subscription = snapshot.payload.subscriptions.find(
        (s) => s.subscriptionDigest === row.subscriptionDigest && s.eventType === row.eventType,
      )
      if (!subscription) {
        await this.#markTerminal(row, 'stale', 'subscription_revision_changed')
        return { status: 'stale', invoked: false }
      }

      // ── 目录与兼容性复核 ──
      const def = lookupPluginEventDefinition(row.eventType, row.eventVersion)
      if (!def || def.eventVersion !== row.eventVersion) {
        await this.#markTerminal(row, 'stale', 'event_version_incompatible')
        return { status: 'stale', invoked: false }
      }
      const compat = checkPluginEventVersionCompatibility(row.eventVersion, def.eventVersion)
      if (!compat.compatible) {
        await this.#markTerminal(row, 'stale', 'event_version_incompatible')
        return { status: 'stale', invoked: false }
      }

      // ── grant 复核：安装声明的权限必须覆盖事件 requiredPermission ──
      if (!snapshot.permissions.includes(def.requiredPermission)) {
        await this.#markTerminal(row, 'skipped', 'permission_denied')
        await this.#recordHealth(
          row,
          'permission_denied',
          'permission_denied',
          Date.now() - startedAt,
        )
        return { status: 'skipped', invoked: false }
      }

      // ── scope 复核：项目事件的项目必须仍属于同一组织 ──
      const envelope = row.envelope
      if (envelope.projectId !== null && envelope.projectId !== undefined) {
        const project = await Project.query()
          .where('id', envelope.projectId)
          .where('organization_id', row.organizationId)
          .first()
        if (!project) {
          await this.#markTerminal(row, 'skipped', 'scope_mismatch')
          return { status: 'skipped', invoked: false }
        }
      }

      // ── handler 调用（隔离）──
      const handler = handlerRegistry.get(row.pluginId)
      if (!handler) {
        await this.#markTerminal(row, 'failed', 'handler_unavailable')
        await this.#recordHealth(row, 'crash', 'crash', Date.now() - startedAt)
        return { status: 'failed', invoked: false }
      }
      row.attemptCount = (row.attemptCount ?? 0) + 1
      await row.save()

      let raw: unknown
      try {
        raw = await Promise.race([
          handler(envelope),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('delivery timeout')), this.#currentTimeoutMs),
          ),
        ])
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message === 'delivery timeout') {
          await this.#markTerminal(row, 'failed', 'timeout')
          await this.#recordHealth(row, 'timeout', 'timeout', Date.now() - startedAt)
          return { status: 'failed', invoked: true }
        }
        await this.#markTerminal(row, 'failed', 'handler_crash')
        await this.#recordHealth(row, 'crash', 'crash', Date.now() - startedAt)
        return { status: 'failed', invoked: true }
      }

      // ── 响应边界校验（三类封闭；直接写入/递归/外发拒绝）──
      const validation = validatePluginEventResponse(raw, {
        allowedKinds: subscription.responseKinds as Readonly<PluginEventResponseKind[]>,
        expectedDeliveryIdentity: row.deliveryIdentity,
        eventType: row.eventType,
        eventVersion: row.eventVersion,
      })
      if (!validation.valid || !validation.normalized) {
        await this.#markTerminal(row, 'failed', 'response_invalid')
        await this.#recordHealth(row, 'crash', 'crash', Date.now() - startedAt)
        return { status: 'failed', invoked: true }
      }
      const response = validation.normalized

      // ── action-proposal：委托统一 preview/confirm 边界（不直接执行）──
      let proposalRegistered = false
      if (response.kind === 'action-proposal' && response.actionProposal) {
        proposalRegistered = await this.#delegateActionProposal(
          row,
          installation,
          response.actionProposal,
        )
        if (!proposalRegistered) {
          await this.#markTerminal(row, 'failed', 'proposal_registration_rejected')
          return { status: 'failed', invoked: true }
        }
      }

      // ── 幂等 recorder（delivery_identity 唯一）──
      await this.#recordResponse(row, installation, response.kind, response, proposalRegistered)

      row.status = 'delivered'
      row.responseKind = response.kind
      row.lastReasonCode = null
      row.deliveredAt = DateTime.now()
      await row.save()
      await this.#recordHealth(row, 'success', null, Date.now() - startedAt)
      await this.#writeAudit(row, 'delivered', response.kind)
      return { status: 'delivered', invoked: true }
    } catch (error) {
      logger.warn(
        {
          deliveryIdentity: row.deliveryIdentity,
          error: error instanceof Error ? error.message : 'unknown',
        },
        '插件事件交付异常（已隔离，不影响其他行）',
      )
      try {
        await this.#markTerminal(row, 'failed', 'host_error')
      } catch {
        // 尽力而为
      }
      return { status: 'failed', invoked: false }
    }
  }

  /** 解析单个安装的订阅快照（损坏 isolate → null）。 */
  async #resolveInstallSnapshot(
    organizationId: number,
    installation: PluginInstallation,
  ): Promise<ResolvedSnapshot | null> {
    if (!installation.releaseId) return null
    const release = await PluginPrivateRegistryRelease.query()
      .where('organization_id', organizationId)
      .where('id', installation.releaseId)
      .first()
    if (!release || !release.metadata) return null
    try {
      const meta =
        typeof release.metadata === 'string'
          ? (JSON.parse(release.metadata) as Record<string, unknown>)
          : (release.metadata as Record<string, unknown>)
      const contributions = (meta.contributions ?? []) as Array<{
        seamKey?: string
        payload?: unknown
      }>
      const contrib = contributions.find((c) => c.seamKey === PLUGIN_SEAM_EVENT_SUBSCRIPTION)
      if (!contrib) return null
      const { validatePluginEventSubscriptionPayload } = await import('@aiproj/types')
      const valRes = validatePluginEventSubscriptionPayload(contrib.payload)
      if (!valRes.valid || !valRes.normalizedPayload) return null
      const declaredPermissions = Array.isArray(meta.permissions)
        ? (meta.permissions as string[])
        : []
      return { permissions: declaredPermissions, payload: valRes.normalizedPayload }
    } catch {
      return null
    }
  }

  /**
   * action-proposal 委托统一插件动作 preview/confirm 边界（surface=event-subscription）。
   * 登记 = 进入边界（宿主持久化 proposed 行 + 低敏审计）；确认/执行永远由边界编排，
   * 本服务不触发任何领域写。失败（形状非法/跨 scope 等）返回 false → 交付行 failed 隔离。
   */
  async #delegateActionProposal(
    row: PluginEventDelivery,
    installation: PluginInstallation,
    proposal: { proposalKey: string; title: string; summary: string },
  ): Promise<boolean> {
    const capturedAt = new Date().toISOString()
    const contentDigest = eventFnv1aHash(eventStableSerialize(proposal))
    const sourceRef: PluginActionSourceRef = {
      surface: 'event-subscription',
      pluginId: row.pluginId,
      pluginVersion: installation.version ?? row.pluginVersion,
      installationId: row.installationId,
      contributionKey: `event:${proposal.proposalKey}`,
      contentDigest,
      capturedAt,
    }
    // 统一边界当前唯一已登记 action kind 为 pilot fixture kind；事件来源的写入意图
    // 以 pilot kind 承载（title=提案标题，content=建议正文），后续新 kind 另立 change。
    try {
      const { default: app } = await import('@adonisjs/core/services/app')
      const { PluginActionBoundaryService } =
        await import('#services/plugin_action_boundary/boundary_service')
      const boundary = (await app.container.make(PluginActionBoundaryService)) as InstanceType<
        typeof PluginActionBoundaryService
      >
      await boundary.registerProposal({
        organizationId: row.organizationId,
        projectId: row.envelope.projectId ?? null,
        proposedBy: null,
        proposal: {
          schemaVersion: PLUGIN_ACTION_SCHEMA_VERSION,
          actionKind: 'plugin.pilot.item.create',
          scope: { organizationId: row.organizationId, projectId: row.envelope.projectId ?? null },
          inputPayload: {
            title: proposal.title,
            content: `[${proposal.proposalKey}] ${proposal.summary}`.slice(0, 2000),
          },
          sourceRefs: [sourceRef],
          createdAt: capturedAt,
        },
      })
      return true
    } catch (error) {
      logger.warn(
        {
          deliveryIdentity: row.deliveryIdentity,
          error: error instanceof Error ? error.message : String(error),
        },
        'action-proposal 边界登记被拒绝',
      )
      return false
    }
  }

  /** 幂等写入响应记录；重复 identity 静默复用既有记录。 */
  async #recordResponse(
    row: PluginEventDelivery,
    installation: PluginInstallation,
    kind: PluginEventResponseKind,
    response: PluginEventResponse,
    proposalRegistered: boolean,
  ): Promise<void> {
    const existing = await PluginEventResponseModel.query()
      .where('delivery_identity', row.deliveryIdentity)
      .first()
    if (existing) return // 幂等：最多一个有效建议记录
    await PluginEventResponseModel.create({
      organizationId: row.organizationId,
      installationId: row.installationId,
      pluginId: row.pluginId,
      deliveryIdentity: row.deliveryIdentity,
      eventId: row.eventId,
      kind,
      title: response.advisoryDraft?.title ?? response.actionProposal?.title ?? null,
      body:
        response.observation?.note ??
        response.advisoryDraft?.body ??
        response.actionProposal?.summary ??
        null,
      proposalKey: response.actionProposal?.proposalKey ?? null,
      proposalSummary: response.actionProposal
        ? eventFnv1aHash(eventStableSerialize(response.actionProposal)).slice(0, 32)
        : null,
      proposalRegistered,
    })
    void installation
  }

  /** 终态标记（stale/dropped/skipped/failed）。 */
  async #markTerminal(
    row: PluginEventDelivery,
    status: 'stale' | 'dropped' | 'skipped' | 'failed',
    reasonCode: string,
  ): Promise<void> {
    row.status = status
    row.lastReasonCode = reasonCode
    await row.save()
    if (status !== 'skipped' || reasonCode === 'permission_denied') {
      await this.#writeAudit(row, status, null, reasonCode)
    }
  }

  /** health best-effort（动态 import 防环；失败静默）。 */
  async #recordHealth(
    row: PluginEventDelivery,
    outcome:
      'success' | 'crash' | 'timeout' | 'quota_exceeded' | 'permission_denied' | 'incompatible',
    reasonCode: string | null,
    latencyMs: number,
  ): Promise<void> {
    try {
      const mod = await import('#services/plugin_runtime_health/health_event_recorder').catch(
        () => null,
      )
      const Recorder = mod?.default
      if (!Recorder) return
      let recorder: InstanceType<typeof Recorder>
      try {
        const { default: app } = await import('@adonisjs/core/services/app')
        recorder = app?.container?.make ? await app.container.make(Recorder) : new Recorder()
      } catch {
        recorder = new Recorder()
      }
      await recorder.record({
        organizationId: row.organizationId,
        installationId: row.installationId,
        pluginId: row.pluginId,
        contributionKey: null,
        seamKey: PLUGIN_SEAM_EVENT_SUBSCRIPTION,
        outcome,
        reasonCode,
        quotaKind: 'none',
        latencyMs,
        invocationId: `${row.deliveryIdentity}:${row.attemptCount}`,
      })
    } catch {
      // 健康写失败静默
    }
  }

  /** 低敏审计（仅状态/原因/identity hash；不含 payload）。 */
  async #writeAudit(
    row: PluginEventDelivery,
    status: string,
    responseKind: string | null,
    reasonCode?: string,
  ): Promise<void> {
    try {
      await this.auditService.log({
        event: AuditEvent.PLUGIN_EVENT_DELIVERY,
        severity: 'info',
        userId: null,
        organizationId: row.organizationId,
        projectId: row.envelope.projectId ?? null,
        entityType: 'plugin_event_delivery',
        entityId: row.id,
        metadata: {
          status,
          responseKind,
          reasonCode: reasonCode ?? null,
          deliveryIdentity: row.deliveryIdentity,
        },
      })
    } catch {
      // 审计失败静默（非 strict）
    }
  }
}
