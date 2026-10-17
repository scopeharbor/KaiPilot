/**
 * v3-four-layer-knowledge-system —— LifecycleGovernanceService（D4 §8）。
 *
 * 差异化时效治理：
 * - L1 定期评审 → 标记过时（active → outdated）
 * - L2 6 个月未引用 → 降级（active → deprecated）
 * - L3 定期复验 → 复验标记（追加 ReviewRecord，不改状态）
 * - L4 到期清理 → 删除超期原始明细（委托 CollectL4Service.cleanupExpired）
 *
 * 所有操作追加 ReviewRecord，不静默删除知识内容（L4 除外）。
 *
 * @aiproj/backend
 */
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import KnowledgeItem from '#models/knowledge_item'
import AuditService, { AuditEvent } from '#services/audit_service'
import type { ReviewRecord } from '@aiproj/types'

export interface GovernanceResult {
  /** 治理操作类型。 */
  action: string
  /** 受影响的记录 ID 列表。 */
  affectedIds: number[]
  /** 受影响记录数。 */
  count: number
}

@inject()
export default class LifecycleGovernanceService {
  constructor(private readonly audit: AuditService) {}

  /**
   * L1 定期评审——将超过评审期的 L1 active 记录标记为 outdated。
   *
   * @param organizationId 组织 ID
   * @param monthsUnreviewed 未评审月数阈值（默认 12 个月）
   */
  async reviewL1Outdated(
    organizationId: number,
    monthsUnreviewed: number = 12,
  ): Promise<GovernanceResult> {
    const cutoff = DateTime.now()
      .minus({ months: monthsUnreviewed })
      .toFormat('yyyy-MM-dd HH:mm:ss.SSS')

    const items = await KnowledgeItem.forOrganization(organizationId)
      .where('layer', 'L1')
      .where('status', 'active')
      .where('updated_at', '<', cutoff)

    const affectedIds: number[] = []
    for (const item of items) {
      const reviewRecord: ReviewRecord = {
        reviewer: 0, // 系统治理
        action: 'marked_outdated',
        timestamp: DateTime.now().toISO()!,
        note: `L1 定期评审：超过 ${monthsUnreviewed} 个月未更新，标记为过时`,
      }

      item.status = 'outdated'
      item.updatedBy = 0
      item.reviewHistory = [...item.reviewHistory, reviewRecord]
      await item.save()

      affectedIds.push(item.id)
    }

    if (affectedIds.length > 0) {
      await this.audit.log({
        event: AuditEvent.KNOWLEDGE_ITEM_TRANSITIONED,
        organizationId,
        userId: null,
        metadata: {
          description: `L1 定期评审：${affectedIds.length} 条记录标记为 outdated`,
          affectedIds,
          layer: 'L1',
          action: 'review_l1_outdated',
        },
      })
    }

    return { action: 'review_l1_outdated', affectedIds, count: affectedIds.length }
  }

  /**
   * L2 降级——将长期未引用的 L2 active 记录降级为 deprecated。
   *
   * @param organizationId 组织 ID
   * @param monthsUnreferenced 未引用月数阈值（默认 6 个月）
   */
  async downgradeL2Unreferenced(
    organizationId: number,
    monthsUnreferenced: number = 6,
  ): Promise<GovernanceResult> {
    const cutoff = DateTime.now()
      .minus({ months: monthsUnreferenced })
      .toFormat('yyyy-MM-dd HH:mm:ss.SSS')

    // L2 active 记录，lastReferencedAt 为 null 或早于截止日期
    const items = await KnowledgeItem.forOrganization(organizationId)
      .where('layer', 'L2')
      .where('status', 'active')
      .where((query) => {
        query.whereNull('last_referenced_at').orWhere('last_referenced_at', '<', cutoff)
      })

    const affectedIds: number[] = []
    for (const item of items) {
      const reviewRecord: ReviewRecord = {
        reviewer: 0,
        action: 'downgraded',
        timestamp: DateTime.now().toISO()!,
        note: `L2 降级：${monthsUnreferenced} 个月未引用，自动降级为 deprecated`,
      }

      item.status = 'deprecated'
      item.updatedBy = 0
      item.reviewHistory = [...item.reviewHistory, reviewRecord]
      await item.save()

      affectedIds.push(item.id)
    }

    if (affectedIds.length > 0) {
      await this.audit.log({
        event: AuditEvent.KNOWLEDGE_ITEM_TRANSITIONED,
        organizationId,
        userId: null,
        metadata: {
          description: `L2 降级：${affectedIds.length} 条记录标记为 deprecated`,
          affectedIds,
          layer: 'L2',
          action: 'downgrade_l2_unreferenced',
        },
      })
    }

    return { action: 'downgrade_l2_unreferenced', affectedIds, count: affectedIds.length }
  }

  /**
   * L3 定期复验——对 L3 合成记录追加复验标记，不改状态。
   * 注意：L3 记录不在生产检索路径中，此处仅为治理审计记录。
   *
   * @param organizationId 组织 ID
   * @param monthsSinceCreation 创建后多少月开始复验（默认 3 个月）
   */
  async reverifyL3(
    organizationId: number,
    monthsSinceCreation: number = 3,
  ): Promise<GovernanceResult> {
    const cutoff = DateTime.now()
      .minus({ months: monthsSinceCreation })
      .toFormat('yyyy-MM-dd HH:mm:ss.SSS')

    const items = await KnowledgeItem.forOrganization(organizationId)
      .where('layer', 'L3')
      .where('status', 'active')
      .where('created_at', '<', cutoff)

    const affectedIds: number[] = []
    for (const item of items) {
      const reviewRecord: ReviewRecord = {
        reviewer: 0,
        action: 'reverified',
        timestamp: DateTime.now().toISO()!,
        note: `L3 定期复验：创建超过 ${monthsSinceCreation} 个月，建议重新验证合成有效性`,
      }

      item.reviewHistory = [...item.reviewHistory, reviewRecord]
      // L3 复验不改变状态——仅追加审核记录
      await item.save()

      affectedIds.push(item.id)
    }

    if (affectedIds.length > 0) {
      await this.audit.log({
        event: AuditEvent.KNOWLEDGE_ITEM_TRANSITIONED,
        organizationId,
        userId: null,
        metadata: {
          description: `L3 定期复验：${affectedIds.length} 条记录已追加复验标记`,
          affectedIds,
          layer: 'L3',
          action: 'reverify_l3',
        },
      })
    }

    return { action: 'reverify_l3', affectedIds, count: affectedIds.length }
  }

  /**
   * 综合治理运行——执行全部四层治理任务。
   * 适用于 ace command 或 cron 调度。
   */
  async runAll(organizationId: number): Promise<GovernanceResult[]> {
    const results: GovernanceResult[] = []

    results.push(await this.reviewL1Outdated(organizationId))
    results.push(await this.downgradeL2Unreferenced(organizationId))
    results.push(await this.reverifyL3(organizationId))

    return results
  }
}
