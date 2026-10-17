// v3-resource-capacity-forecasting-closed-loop —— superseded snapshot 有界保留/清理服务（任务 3.7）。
//
// 语义：
// - 只清理「已被新版本取代」（superseded_by_id 非空）且早于保留截止期的 baseline snapshot；
// - 被引用保护：digest 被 selection 绑定（bound_baseline_digest）的版本不可删；
//   observation snapshot 被 review 引用的版本不可删；
// - 全部查询强制 organization scope，拒绝裸跨租清理；
// - 幂等：重复执行对已删除集合无副作用；
// - 默认无后台调度：仅由显式 API/运维调用触发；feature flag 关闭时整体跳过。

import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ResourceCapacityBaselineSnapshot from '#models/resource_capacity_baseline_snapshot'
import ResourceCapacityObservationSnapshot from '#models/resource_capacity_observation_snapshot'
import { isResourceCapacityLoopEnabled } from './resource_capacity_feature_flag.js'
import { RESOURCE_CAPACITY_LOOP_BUDGETS } from '@aiproj/types/resource-capacity-closed-loop'

export interface RetentionCleanupResult {
  enabled: boolean
  organizationId: number
  cutoffAt: string
  scannedBaselines: number
  deletedBaselineIds: number[]
  scannedObservations: number
  deletedObservationIds: number[]
  protectedBySelection: number
  protectedByReview: number
}

export default class ResourceCapacityRetentionService {
  /**
   * 清理单个组织的 superseded 快照。
   * @param organizationId 目标组织（必填——不做全组织扫描）
   * @param options.now 注入时钟便于确定性测试；retentionDays 覆盖默认预算
   */
  async cleanup(
    organizationId: number,
    options: { now?: DateTime; retentionDays?: number } = {},
  ): Promise<RetentionCleanupResult> {
    const now = options.now ?? DateTime.now()
    const retentionDays =
      options.retentionDays ?? RESOURCE_CAPACITY_LOOP_BUDGETS.SUPERSEDED_RETENTION_DAYS
    const cutoff = now.minus({ days: retentionDays })

    if (!isResourceCapacityLoopEnabled()) {
      return {
        enabled: false,
        organizationId,
        cutoffAt: cutoff.toISO() ?? '',
        scannedBaselines: 0,
        deletedBaselineIds: [],
        scannedObservations: 0,
        deletedObservationIds: [],
        protectedBySelection: 0,
        protectedByReview: 0,
      }
    }

    // ── baseline：superseded 且超期，且 digest 未被任何 selection 绑定 ──
    const supersededBaselines = await db
      .from('resource_capacity_baseline_snapshots')
      .where('organization_id', organizationId)
      .whereNotNull('superseded_by_id')
      .where('created_at', '<', cutoff.toSQL() ?? '')
      .select('id', 'baseline_digest')

    // 引用保护集：该组织全部 selection 绑定的 baseline digest。
    const selectionRows = await db
      .from('resource_capacity_selections')
      .where('organization_id', organizationId)
      .select('bound_baseline_digest')
    const boundDigests = new Set<string>(selectionRows.map((r) => r.bound_baseline_digest))

    const deletable: number[] = []
    let protectedBySelection = 0
    for (const row of supersededBaselines) {
      if (boundDigests.has(row.baseline_digest)) {
        protectedBySelection++
        continue
      }
      deletable.push(row.id)
    }

    let deletedBaselineIds: number[] = []
    for (const id of deletable) {
      await db
        .from('resource_capacity_baseline_snapshots')
        .where('organization_id', organizationId)
        .where('id', id)
        .delete()
      deletedBaselineIds.push(id)
    }

    // ── observation：未被 review 引用且超期即清理（observation 无 superseded 链，按期滚动）──
    const staleObservations = await db
      .from('resource_capacity_observation_snapshots')
      .where('resource_capacity_observation_snapshots.organization_id', organizationId)
      .where('resource_capacity_observation_snapshots.created_at', '<', cutoff.toSQL() ?? '')
      .leftJoin(
        'resource_capacity_reviews',
        'resource_capacity_reviews.observation_snapshot_id',
        'resource_capacity_observation_snapshots.id',
      )
      .whereNull('resource_capacity_reviews.id')
      .select('resource_capacity_observation_snapshots.id as id')

    let deletedObservationIds: number[] = []
    for (const row of staleObservations) {
      await db
        .from('resource_capacity_observation_snapshots')
        .where('organization_id', organizationId)
        .where('id', row.id)
        .delete()
      deletedObservationIds.push(row.id)
    }

    // 被 review 引用而保留的数量（诊断口径）。
    const reviewedCount = await db
      .from('resource_capacity_observation_snapshots')
      .where('resource_capacity_observation_snapshots.organization_id', organizationId)
      .where('resource_capacity_observation_snapshots.created_at', '<', cutoff.toSQL() ?? '')
      .join(
        'resource_capacity_reviews',
        'resource_capacity_reviews.observation_snapshot_id',
        'resource_capacity_observation_snapshots.id',
      )
      .countDistinct('resource_capacity_observation_snapshots.id as total')

    return {
      enabled: true,
      organizationId,
      cutoffAt: cutoff.toSQL() ?? '',
      scannedBaselines: supersededBaselines.length + protectedBySelection,
      deletedBaselineIds,
      scannedObservations: staleObservations.length + Number(reviewedCount[0]?.total ?? 0),
      deletedObservationIds,
      protectedBySelection,
      protectedByReview: Number(reviewedCount[0]?.total ?? 0),
    }
  }

  /** 模型级便捷读取：带组织过滤的最新未取代 baseline。 */
  async latestActiveBaseline(organizationId: number, loopId: number) {
    return ResourceCapacityBaselineSnapshot.query()
      .where('organization_id', organizationId)
      .where('loop_id', loopId)
      .whereNull('superseded_by_id')
      .orderBy('created_at', 'desc')
      .first()
  }

  /** 模型级便捷读取：被 review 保护的 observation（组织过滤）。 */
  async reviewedObservations(organizationId: number, loopId: number) {
    return ResourceCapacityObservationSnapshot.query()
      .where('organization_id', organizationId)
      .where('loop_id', loopId)
      .whereHas('loop', (q) => q.where('organization_id', organizationId))
      .orderBy('created_at', 'desc')
  }
}
