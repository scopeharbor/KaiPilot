import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import PluginRuntimeHealthEvent from '#models/plugin_runtime_health_event'
import PluginRuntimeHealthSnapshot from '#models/plugin_runtime_health_snapshot'
import {
  aggregateHealthSnapshot,
  bucketDuration,
  normalizeHealthReasonCode,
  type PluginRuntimeHealthEvent as HealthEventDto,
  type PluginRuntimeHealthOutcome,
  type PluginRuntimeHealthQuotaKind,
  PLUGIN_RUNTIME_HEALTH_EVENT_RETENTION_LIMIT,
} from '@aiproj/types'

export interface RecordHealthInput {
  organizationId: number
  installationId: number
  pluginId: string
  pluginVersion?: string | null
  contributionKey?: string | null
  seamKey?: string | null
  outcome: PluginRuntimeHealthOutcome
  reasonCode?: string | null
  quotaKind?: PluginRuntimeHealthQuotaKind | null
  latencyMs?: number | null
  invocationId: string
  occurredAt?: string | null
}

/**
 * HealthEventRecorder — 幂等事件记录 + 窗口聚合 + 保留策略
 * - invocationId 去重（组织级唯一）
 * - 事务内 upsert snapshot
 * - 保留上限：组织维度的事件数超限则删除最旧
 */
@inject()
export default class HealthEventRecorder {
  async record(
    input: RecordHealthInput,
  ): Promise<{ event: PluginRuntimeHealthEvent; snapshot: PluginRuntimeHealthSnapshot }> {
    const occurredAtIso = input.occurredAt ?? new Date().toISOString()
    const occurredAtDt = DateTime.fromISO(occurredAtIso)
    const reasonCode = normalizeHealthReasonCode(
      input.reasonCode ?? (input.outcome === 'success' ? 'unknown' : input.outcome),
    )
    const bucket = bucketDuration(input.latencyMs ?? null)

    return db.transaction(async (trx) => {
      // 幂等：已存在 invocation_id 直接返回
      const existing = await PluginRuntimeHealthEvent.query({ client: trx })
        .where('organizationId', input.organizationId)
        .where('invocationId', input.invocationId)
        .first()

      if (existing) {
        const snap = await PluginRuntimeHealthSnapshot.query({ client: trx })
          .where('organizationId', input.organizationId)
          .where('installationId', input.installationId)
          .where('contributionKey', input.contributionKey ?? (null as any))
          .first()
        // fallback: if snapshot missing, build from existing event (should not happen)
        if (!snap) throw new Error('snapshot missing for existing invocation')
        return { event: existing, snapshot: snap }
      }

      const event = await PluginRuntimeHealthEvent.create(
        {
          organizationId: input.organizationId,
          installationId: input.installationId,
          pluginId: input.pluginId,
          pluginVersion: input.pluginVersion ?? null,
          contributionKey: input.contributionKey ?? null,
          seamKey: input.seamKey ?? null,
          outcome: input.outcome,
          reasonCode,
          quotaKind: (input.quotaKind ?? 'none') as PluginRuntimeHealthQuotaKind,
          durationBucket: bucket,
          latencyMs: input.latencyMs ?? null,
          circuitState: 'closed',
          invocationId: input.invocationId,
          occurredAt: occurredAtDt,
          rowVersion: 1,
        } as any,
        { client: trx },
      )

      // 加载或初始化快照
      let snapshot = await PluginRuntimeHealthSnapshot.query({ client: trx })
        .where('organizationId', input.organizationId)
        .where('installationId', input.installationId)
        .where('contributionKey', input.contributionKey ?? (null as any))
        .first()

      const dto: HealthEventDto = {
        id: event.id,
        organizationId: event.organizationId,
        installationId: event.installationId,
        pluginId: event.pluginId,
        pluginVersion: event.pluginVersion ?? null,
        contributionKey: event.contributionKey ?? null,
        seamKey: event.seamKey ?? null,
        outcome: event.outcome,
        reasonCode: event.reasonCode,
        quotaKind: event.quotaKind,
        durationBucket: event.durationBucket,
        latencyMs: event.latencyMs ?? null,
        circuitState: event.circuitState,
        invocationId: event.invocationId,
        occurredAt: event.occurredAt.toISO()!,
        rowVersion: event.rowVersion,
      }

      if (!snapshot) {
        // 通过聚合函数从空快照构建
        const aggregated = aggregateHealthSnapshot(null, dto, occurredAtIso)
        snapshot = await PluginRuntimeHealthSnapshot.create(
          {
            organizationId: aggregated.organizationId,
            installationId: aggregated.installationId,
            pluginId: aggregated.pluginId,
            contributionKey: aggregated.contributionKey,
            status: aggregated.status,
            reasonCode: aggregated.reasonCode,
            circuitState: aggregated.circuitState,
            firstSeenAt: DateTime.fromISO(aggregated.firstSeenAt),
            lastSeenAt: DateTime.fromISO(aggregated.lastSeenAt),
            lastSuccessAt: aggregated.lastSuccessAt
              ? DateTime.fromISO(aggregated.lastSuccessAt)
              : null,
            lastFailureAt: aggregated.lastFailureAt
              ? DateTime.fromISO(aggregated.lastFailureAt)
              : null,
            recoveredAt: aggregated.recoveredAt ? DateTime.fromISO(aggregated.recoveredAt) : null,
            totalSuccess: aggregated.totalSuccess,
            totalCrash: aggregated.totalCrash,
            totalTimeout: aggregated.totalTimeout,
            totalQuota: aggregated.totalQuota,
            totalPermissionDenied: aggregated.totalPermissionDenied,
            totalIncompatible: aggregated.totalIncompatible,
            totalIsolationFailed: aggregated.totalIsolationFailed,
            consecutiveFailures: aggregated.consecutiveFailures,
            isStale: aggregated.isStale,
            warningCodes: aggregated.warningCodes,
            rowVersion: aggregated.rowVersion,
          } as any,
          { client: trx },
        )
      } else {
        // 将已有 snapshot 投影为 DTO 再聚合
        const prevDto = {
          id: snapshot.id,
          organizationId: snapshot.organizationId,
          installationId: snapshot.installationId,
          pluginId: snapshot.pluginId,
          contributionKey: snapshot.contributionKey,
          status: snapshot.status,
          reasonCode: snapshot.reasonCode,
          circuitState: snapshot.circuitState,
          firstSeenAt: snapshot.firstSeenAt.toISO()!,
          lastSeenAt: snapshot.lastSeenAt.toISO()!,
          lastSuccessAt: snapshot.lastSuccessAt?.toISO() ?? null,
          lastFailureAt: snapshot.lastFailureAt?.toISO() ?? null,
          recoveredAt: snapshot.recoveredAt?.toISO() ?? null,
          totalSuccess: snapshot.totalSuccess,
          totalCrash: snapshot.totalCrash,
          totalTimeout: snapshot.totalTimeout,
          totalQuota: snapshot.totalQuota,
          totalPermissionDenied: snapshot.totalPermissionDenied,
          totalIncompatible: snapshot.totalIncompatible,
          totalIsolationFailed: snapshot.totalIsolationFailed,
          consecutiveFailures: snapshot.consecutiveFailures,
          isStale: snapshot.isStale,
          warningCodes: snapshot.warningCodes,
          rowVersion: snapshot.rowVersion,
          updatedAt: snapshot.updatedAt?.toISO() ?? new Date().toISOString(),
        }
        const aggregated = aggregateHealthSnapshot(prevDto as any, dto, occurredAtIso)
        snapshot.merge({
          status: aggregated.status,
          reasonCode: aggregated.reasonCode,
          circuitState: aggregated.circuitState,
          lastSeenAt: DateTime.fromISO(aggregated.lastSeenAt),
          lastSuccessAt: aggregated.lastSuccessAt
            ? DateTime.fromISO(aggregated.lastSuccessAt)
            : null,
          lastFailureAt: aggregated.lastFailureAt
            ? DateTime.fromISO(aggregated.lastFailureAt)
            : null,
          recoveredAt: aggregated.recoveredAt ? DateTime.fromISO(aggregated.recoveredAt) : null,
          totalSuccess: aggregated.totalSuccess,
          totalCrash: aggregated.totalCrash,
          totalTimeout: aggregated.totalTimeout,
          totalQuota: aggregated.totalQuota,
          totalPermissionDenied: aggregated.totalPermissionDenied,
          totalIncompatible: aggregated.totalIncompatible,
          totalIsolationFailed: aggregated.totalIsolationFailed,
          consecutiveFailures: aggregated.consecutiveFailures,
          isStale: aggregated.isStale,
          warningCodes: aggregated.warningCodes,
          rowVersion: aggregated.rowVersion,
        } as any)
        await snapshot.useTransaction(trx).save()
      }

      // 保留策略：超限则删除最旧事件（组织维度）
      const count = await PluginRuntimeHealthEvent.query({ client: trx })
        .where('organizationId', input.organizationId)
        .count('* as total')
        .first()
      const total = Number((count as any)?.$extras?.total ?? (count as any)?.total ?? 0)
      if (total > PLUGIN_RUNTIME_HEALTH_EVENT_RETENTION_LIMIT) {
        const toDelete = total - PLUGIN_RUNTIME_HEALTH_EVENT_RETENTION_LIMIT
        const oldest = await PluginRuntimeHealthEvent.query({ client: trx })
          .where('organizationId', input.organizationId)
          .orderBy('occurredAt', 'asc')
          .limit(toDelete)
        for (const row of oldest) {
          await row.useTransaction(trx).delete()
        }
      }

      // 同步 event 的 circuitState 为 snapshot 当前 circuit
      event.circuitState = snapshot.circuitState
      await event.useTransaction(trx).save()

      return { event, snapshot }
    })
  }
}
