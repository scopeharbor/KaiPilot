import { inject } from '@adonisjs/core'
import PluginRuntimeHealthSnapshot from '#models/plugin_runtime_health_snapshot'
import { DateTime } from 'luxon'
import {
  applyProbeResult,
  canProbeCircuit,
  type PluginRuntimeHealthOutcome,
  type PluginRuntimeHealthProbeResult,
} from '@aiproj/types'

@inject()
export default class HealthCircuitProbe {
  /**
   * 触发 half_open 探针（仅宿主可调用，不会启用已禁用插件）
   * - 仅当快照为 half_open 时允许
   * - 成功则 closed + healthy，失败则重回 open
   * - 探针本身不自动启用 installation，只更新健康态
   */
  async probe(
    organizationId: number,
    installationId: number,
    contributionKey: string | null | undefined,
    outcome: PluginRuntimeHealthOutcome = 'success',
  ): Promise<PluginRuntimeHealthProbeResult> {
    const snapshotRow = await PluginRuntimeHealthSnapshot.query()
      .where('organizationId', organizationId)
      .where('installationId', installationId)
      .where('contributionKey', contributionKey ?? (null as any))
      .first()

    if (!snapshotRow) {
      return {
        probed: false,
        previousCircuit: 'closed',
        currentCircuit: 'closed',
        status: 'unknown',
        reasonCode: 'unknown',
        message: 'no snapshot found for probe target',
      }
    }

    const dto = {
      id: snapshotRow.id,
      organizationId: snapshotRow.organizationId,
      installationId: snapshotRow.installationId,
      pluginId: snapshotRow.pluginId,
      contributionKey: snapshotRow.contributionKey,
      status: snapshotRow.status,
      reasonCode: snapshotRow.reasonCode,
      circuitState: snapshotRow.circuitState,
      firstSeenAt: snapshotRow.firstSeenAt.toISO()!,
      lastSeenAt: snapshotRow.lastSeenAt.toISO()!,
      lastSuccessAt: snapshotRow.lastSuccessAt?.toISO() ?? null,
      lastFailureAt: snapshotRow.lastFailureAt?.toISO() ?? null,
      recoveredAt: snapshotRow.recoveredAt?.toISO() ?? null,
      totalSuccess: snapshotRow.totalSuccess,
      totalCrash: snapshotRow.totalCrash,
      totalTimeout: snapshotRow.totalTimeout,
      totalQuota: snapshotRow.totalQuota,
      totalPermissionDenied: snapshotRow.totalPermissionDenied,
      totalIncompatible: snapshotRow.totalIncompatible,
      totalIsolationFailed: snapshotRow.totalIsolationFailed,
      consecutiveFailures: snapshotRow.consecutiveFailures,
      isStale: snapshotRow.isStale,
      warningCodes: snapshotRow.warningCodes,
      rowVersion: snapshotRow.rowVersion,
      updatedAt: snapshotRow.updatedAt?.toISO() ?? new Date().toISOString(),
    }

    if (!canProbeCircuit(dto as any)) {
      return {
        probed: false,
        previousCircuit: dto.circuitState,
        currentCircuit: dto.circuitState,
        status: dto.status,
        reasonCode: dto.reasonCode,
        message: `probe not allowed in circuit state ${dto.circuitState}`,
      }
    }

    const next = applyProbeResult(dto as any, outcome, new Date().toISOString())

    snapshotRow.merge({
      status: next.status,
      reasonCode: next.reasonCode,
      circuitState: next.circuitState,
      lastSuccessAt: next.lastSuccessAt ? DateTime.fromISO(next.lastSuccessAt) : null,
      lastFailureAt: next.lastFailureAt ? DateTime.fromISO(next.lastFailureAt) : null,
      recoveredAt: next.recoveredAt ? DateTime.fromISO(next.recoveredAt) : null,
      lastSeenAt: DateTime.fromISO(next.lastSeenAt),
      consecutiveFailures: next.consecutiveFailures,
      isStale: next.isStale,
      warningCodes: next.warningCodes,
      rowVersion: next.rowVersion,
    } as any)
    await snapshotRow.save()

    return {
      probed: true,
      previousCircuit: dto.circuitState,
      currentCircuit: next.circuitState,
      status: next.status,
      reasonCode: next.reasonCode,
      message:
        outcome === 'success'
          ? 'probe succeeded, circuit closed'
          : 'probe failed, circuit re-opened',
    }
  }
}
