/**
 * v3-plugin-event-subscription-contract —— PluginEventProjectorService（D2 事务后投影 pilot）。
 *
 * 职责：
 * 1. 挂在 AuditService 事务后 fire-and-forget 旁路（与 timeline hint 同语义）：核心事务成功后
 *    把 TASK_* 审计事件投影为 `project.task.updated@1.0.0` 的最小 permission-aware envelope；
 * 2. 只为 enabled 安装且 manifest 声明了匹配订阅的插件写 outbox 行（plugin_event_deliveries）；
 * 3. 失败隔离：任何异常只记 warn + 降级计数，绝不向上抛、绝不回滚领域事务；
 * 4. 有界保留：每组织超过 MAX_EVENT_DELIVERY_ROWS_PER_ORG 时删除最旧行。
 *
 * 边界：不建订阅表（订阅从 enabled 安装 metadata 派生）；不做真实网络；插件不参与原事务。
 */
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import PluginInstallation from '#models/plugin_installation'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginEventDelivery from '#models/plugin_event_delivery'
import type { AuditEntry } from '#services/audit_service'
import {
  PLUGIN_SEAM_EVENT_SUBSCRIPTION,
  MAX_EVENT_DELIVERY_ROWS_PER_ORG,
  buildPluginEventEnvelope,
  computePluginEventDeliveryIdentity,
  matchPluginEventFilter,
  validatePluginEventSubscriptionPayload,
  type NormalizedPluginEventSubscriptionPayload,
} from '@aiproj/types'

/** pilot 目录事件：TASK_* 审计事件 → entityAction。 */
const PILOT_TASK_EVENT_ACTIONS: Record<string, string> = {
  TASK_CREATED: 'created',
  TASK_UPDATED: 'updated',
  TASK_ASSIGNED: 'assigned',
  TASK_STATUS_CHANGED: 'status_changed',
}

/** 投影降级计数（进程内、低敏、仅计数）。 */
let projectionDegradedCount = 0

export function getProjectionDegradedCount(): number {
  return projectionDegradedCount
}

export function resetProjectionDegradedCount(): void {
  projectionDegradedCount = 0
}

interface ResolvedSubscriptionInstall {
  installationId: number
  pluginId: string
  pluginVersion: string
  permissions: readonly string[]
  payload: NormalizedPluginEventSubscriptionPayload
}

@inject()
export default class PluginEventProjectorService {
  /**
   * 从审计旁路入口投影（fire-and-forget 安全包装；绝不 throw）。
   */
  async projectFromAuditEntry(entry: AuditEntry, auditLogId: number): Promise<void> {
    try {
      await this.#projectUnsafe(entry, auditLogId)
    } catch (error) {
      projectionDegradedCount++
      logger.warn(
        { event: entry.event, error: error instanceof Error ? error.message : 'unknown' },
        '插件事件投影失败（不影响审计与领域写入）',
      )
    }
  }

  /** 实际投影逻辑（内部）。 */
  async #projectUnsafe(entry: AuditEntry, auditLogId: number): Promise<void> {
    const organizationId = entry.organizationId
    const projectId = entry.projectId
    if (typeof organizationId !== 'number') return

    const eventType = 'project.task.updated'
    const eventVersion = '1.0.0'
    const entityAction = PILOT_TASK_EVENT_ACTIONS[entry.event]
    if (!entityAction) return // 非目录事件：静默跳过

    // 变更字段名列表（仅字段名，不含前后值；来自已 sanitize 的审计 changes）
    const changedKeys = new Set<string>()
    for (const side of [entry.changes?.before, entry.changes?.after]) {
      if (side && typeof side === 'object') {
        for (const key of Object.keys(side)) changedKeys.add(key)
      }
    }
    const changedFields = [...changedKeys].sort().join(',').slice(0, 200)

    const envelope = buildPluginEventEnvelope({
      eventType,
      eventVersion,
      organizationId,
      projectId: typeof projectId === 'number' ? projectId : null,
      occurredAtIso: new Date().toISOString(),
      auditLogId,
      producerRef: 'audit-bypass',
      candidateProjection: { entityAction, changedFields },
    })
    if (!envelope) return

    const installs = await this.#resolveSubscribedInstalls(organizationId)
    for (const install of installs) {
      for (const sub of install.payload.subscriptions) {
        if (sub.eventType !== eventType || sub.eventVersion !== eventVersion) continue
        if (!matchPluginEventFilter(sub.filterNodes, envelope)) continue
        // 订阅声明的响应类别必须仍被目录允许（防御性复核）
        if (
          !sub.responseKinds.every((k) =>
            ['observation', 'advisory-draft', 'action-proposal'].includes(k),
          )
        ) {
          continue
        }
        const deliveryIdentity = computePluginEventDeliveryIdentity({
          organizationId,
          pluginId: install.pluginId,
          pluginVersion: install.pluginVersion,
          subscriptionDigest: sub.subscriptionDigest,
          eventId: envelope.eventId,
        })
        try {
          await PluginEventDelivery.create({
            organizationId,
            installationId: install.installationId,
            pluginId: install.pluginId,
            pluginVersion: install.pluginVersion,
            subscriptionDigest: sub.subscriptionDigest,
            eventType,
            eventVersion,
            eventId: envelope.eventId,
            deliveryIdentity,
            envelope,
            status: 'pending',
            attemptCount: 0,
          })
        } catch (error) {
          // 幂等：唯一约束冲突（重复投影）静默；其他错误上抛由外层统一降级
          const code = (error as { code?: string }).code
          if (
            code !== 'SQLITE_CONSTRAINT_UNIQUE' &&
            code !== '23505' &&
            !String(error).includes('UNIQUE')
          ) {
            throw error
          }
        }
      }
    }

    // 组织级有界保留（超限删最旧）
    await this.#enforceRetention(organizationId)
  }

  /** 解析 org 内 enabled 安装的 event-subscription 贡献（损坏负载 isolate-drop）。 */
  async #resolveSubscribedInstalls(organizationId: number): Promise<ResolvedSubscriptionInstall[]> {
    const installations = await PluginInstallation.query()
      .where('organization_id', organizationId)
      .where('status', 'enabled')

    const results: ResolvedSubscriptionInstall[] = []
    for (const inst of installations) {
      if (!inst.releaseId) continue
      const release = await PluginPrivateRegistryRelease.query()
        .where('organization_id', organizationId)
        .where('id', inst.releaseId)
        .first()
      if (!release || !release.metadata) continue

      let contributions: Array<{ seamKey?: string; payload?: unknown; permissions?: unknown }> = []
      try {
        const meta =
          typeof release.metadata === 'string'
            ? (JSON.parse(release.metadata) as Record<string, unknown>)
            : (release.metadata as Record<string, unknown>)
        contributions = (meta.contributions ?? []) as typeof contributions
      } catch {
        continue
      }

      for (const contrib of contributions) {
        if (contrib.seamKey !== PLUGIN_SEAM_EVENT_SUBSCRIPTION) continue
        const valRes = validatePluginEventSubscriptionPayload(contrib.payload)
        if (!valRes.valid || !valRes.normalizedPayload) continue // isolate-drop
        results.push({
          installationId: inst.id,
          pluginId: inst.pluginId,
          pluginVersion: inst.version ?? '0.0.0',
          permissions: Array.isArray(contrib.permissions) ? (contrib.permissions as string[]) : [],
          payload: valRes.normalizedPayload,
        })
      }
    }
    return results
  }

  /** 有界保留：删除超出上限的最旧行。 */
  async #enforceRetention(organizationId: number): Promise<void> {
    const countRow = await PluginEventDelivery.query()
      .where('organization_id', organizationId)
      .count('* as total')
      .first()
    const count = Number(countRow?.$extras?.total ?? 0)
    if (count <= MAX_EVENT_DELIVERY_ROWS_PER_ORG) return
    const excess = count - MAX_EVENT_DELIVERY_ROWS_PER_ORG
    const oldest = await PluginEventDelivery.query()
      .where('organization_id', organizationId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .limit(excess)
    for (const row of oldest) {
      await row.delete()
    }
  }
}
