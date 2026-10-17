/**
 * @aiproj/backend —— TraceabilityService（tasks 5.1–5.3）。
 *
 * V2 Project Compiler 的 Traceability Link 服务。
 * 在 Draft Layer Apply 成功后为正式实体创建最小追溯链路。
 *
 * 红线：
 * - 只创建显式关系，禁止基于名称相似度隐式推断
 * - Link 创建应纳入 Apply 事务或幂等补偿路径
 *
 * @aiproj/backend
 */

import TraceabilityLink from '#models/traceability_link'
import type { TraceabilityRelationType } from '@aiproj/compiler-spec'

// ── Errors ──

export class TraceabilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TraceabilityError'
  }
}

export class ImplicitRelationError extends TraceabilityError {
  constructor(message: string) {
    super(message)
    this.name = 'ImplicitRelationError'
  }
}

// ── Types ──

export interface ApplyEntityRelation {
  sourceEntityType: string
  sourceEntityId: string
  targetEntityType: string
  targetEntityId: string
  relationType: TraceabilityRelationType
  direction?: 'forward' | 'bidirectional'
  strength?: number
  sourceAttributionId?: number
}

export interface ApplyResultRelations {
  projectId?: number
  hierarchyLinks: ApplyEntityRelation[]
  dependencyLinks: ApplyEntityRelation[]
  validationLinks: ApplyEntityRelation[]
  milestoneLinks: ApplyEntityRelation[]
  riskLinks: ApplyEntityRelation[]
}

// ── Service ──

export class TraceabilityService {
  /**
   * 5.1: 从 accepted apply plan 显式关系创建 Traceability Links。
   * 按类型分组：层级、依赖、验证、里程碑/风险等 MVP link。
   */
  async createLinksForApplyResult(
    organizationId: number,
    createdBy: number,
    relations: ApplyResultRelations,
  ): Promise<{ created: number; warnings: string[] }> {
    const warnings: string[] = []
    let created = 0

    const allLinks: ApplyEntityRelation[] = [
      ...relations.hierarchyLinks,
      ...relations.dependencyLinks,
      ...relations.validationLinks,
      ...relations.milestoneLinks,
      ...relations.riskLinks,
    ]

    for (const link of allLinks) {
      // 5.3: 禁止隐式关系 — 只接受显式传入的 relation
      if (!link.relationType) {
        warnings.push(`Implicit relation skipped: ${link.sourceEntityId} -> ${link.targetEntityId}`)
        continue
      }

      // 5.2: 幂等检查 — 相同实体+关系+attribution 不重复创建
      const existing = await TraceabilityLink.query()
        .where('organization_id', organizationId)
        .where('source_entity_type', link.sourceEntityType)
        .where('source_entity_id', link.sourceEntityId)
        .where('target_entity_type', link.targetEntityType)
        .where('target_entity_id', link.targetEntityId)
        .where('relation_type', link.relationType)
        .whereNull('deleted_at')
        .first()

      if (existing) {
        warnings.push(
          `Duplicate link skipped: ${link.sourceEntityId}(${link.relationType})${link.targetEntityId}`,
        )
        continue
      }

      await TraceabilityLink.create({
        organizationId,
        projectId: relations.projectId ?? null,
        sourceEntityType: link.sourceEntityType,
        sourceEntityId: link.sourceEntityId,
        targetEntityType: link.targetEntityType,
        targetEntityId: link.targetEntityId,
        relationType: link.relationType,
        direction: link.direction ?? 'forward',
        strength: link.strength ?? 1,
        sourceAttributionId: link.sourceAttributionId ?? null,
        createdBy,
      })

      created++
    }

    return { created, warnings }
  }

  /**
   * 查询项目的所有活跃 traceability links。
   */
  async listByProject(organizationId: number, projectId: number): Promise<TraceabilityLink[]> {
    return TraceabilityLink.forProject(organizationId, projectId)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
  }

  /**
   * 查询实体的所有关联 links。
   */
  async listByEntity(
    organizationId: number,
    entityType: string,
    entityId: string,
  ): Promise<TraceabilityLink[]> {
    return TraceabilityLink.forOrganization(organizationId)
      .where((query) => {
        query
          .where((q) =>
            q.where('source_entity_type', entityType).where('source_entity_id', entityId),
          )
          .orWhere((q) =>
            q.where('target_entity_type', entityType).where('target_entity_id', entityId),
          )
      })
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
  }

  /**
   * 5.3: 禁止基于名称相似度创建隐式关系。
   * 只允许 PDM/Draft/user decision 中的显式关系。
   * 此方法作为防御性校验：传入疑似隐式推断的关系将返回 warning 而非创建。
   */
  validateExplicitRelation(link: ApplyEntityRelation): { valid: boolean; warning?: string } {
    // 如果 relationType 为空或未知，则可能是隐式推断
    const knownTypes = [
      'hierarchy_parent',
      'hierarchy_child',
      'depends_on',
      'depended_by',
      'validates',
      'validated_by',
      'milestone_tracks',
      'risk_impacts',
      'risk_mitigated_by',
      'derived_from',
      'generated',
      'confirms',
    ]
    if (!link.relationType || !knownTypes.includes(link.relationType)) {
      return {
        valid: false,
        warning: `Implicit relation rejected: relationType '${link.relationType}' is not a known explicit type`,
      }
    }

    return { valid: true }
  }
}
