import { inject } from '@adonisjs/core'
import { ValidationException } from '#exceptions/api_exception'
import { DateTime } from 'luxon'
import OkrCascadePlanModel from '#models/okr_cascade_plan'
import OkrCascadePlanItemModel from '#models/okr_cascade_plan_item'
import OkrObjectiveRelationModel from '#models/okr_objective_relation'
import OkrObjective from '#models/okr_objective'
import OkrKeyResult from '#models/okr_key_result'
import OkrAlignment from '#models/okr_alignment'
import OkrPolicy from '#policies/okr_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import type User from '#models/user'
import {
  type OkrCascadePlanCreateRequest,
  type OkrCascadePlanItemConfirmRequest,
  type OkrCascadePlanItemRejectRequest,
  type OkrRelationCreateRequest,
  type OkrRelationUpdateRequest,
  type OkrHealthQuery,
  type OkrAlignmentMatrixQuery,
  type OkrAiCascadeSuggestionRequest,
  type OkrAiCascadeSuggestionResponse,
  type OkrListMeta,
  type OkrCascadePlan,
  type OkrCascadePlanItem,
  type OkrObjectiveRelation,
  type OkrAlignmentHealth,
  type OkrAlignmentMatrixRow,
  type OkrCascadeConfirmationDiff,
  type OkrWarning,
  type OkrCascadePlanStatus,
  type OkrCascadeItemStatus,
  type OkrRelationType,
  type OkrRelationStatus,
  type OkrScope,
  type OkrStatus,
  OKR_METRIC_VERSION,
  OKR_DISABLED_SCOPES,
  okrStableHash,
  validateRelation,
  computeOkrAlignmentHealth,
  makeOkrFreshness,
} from '@aiproj/types'

// ── DTO Helpers ─────────────────────────────────────────────────────────────

function toCascadePlanDto(row: OkrCascadePlanModel): OkrCascadePlan {
  return {
    id: row.id,
    organizationId: row.organizationId,
    sourceObjectiveId: row.sourceObjectiveId,
    cycleId: row.cycleId,
    title: row.title,
    description: row.description ?? null,
    status: row.status as OkrCascadePlanStatus,
    coverage: row.coverage as any,
    warnings: row.warnings ? JSON.parse(row.warnings) : [],
    assumptions: row.assumptions ? JSON.parse(row.assumptions) : [],
    sourceRefs: row.sourceRefs ? JSON.parse(row.sourceRefs) : [],
    metricVersion: row.metricVersion,
    revisionHash: row.revisionHash,
    createdAt: row.createdAt instanceof DateTime ? row.createdAt.toISO()! : String(row.createdAt),
    updatedAt: row.updatedAt instanceof DateTime ? row.updatedAt.toISO()! : String(row.updatedAt),
    deletedAt: row.deletedAt instanceof DateTime ? row.deletedAt.toISO()! : null,
  }
}

function toCascadeItemDto(row: OkrCascadePlanItemModel): OkrCascadePlanItem {
  return {
    id: row.id,
    planId: row.planId,
    organizationId: row.organizationId,
    candidateObjective:
      typeof row.candidateObjective === 'string'
        ? JSON.parse(row.candidateObjective)
        : row.candidateObjective,
    status: row.status as OkrCascadeItemStatus,
    coverageGap: row.coverageGap,
    conflictWarning: row.conflictWarning ?? null,
    rejectionReason: row.rejectionReason ?? null,
    confirmedObjectiveId: row.confirmedObjectiveId ?? null,
    createdAt: row.createdAt instanceof DateTime ? row.createdAt.toISO()! : String(row.createdAt),
    updatedAt: row.updatedAt instanceof DateTime ? row.updatedAt.toISO()! : String(row.updatedAt),
  }
}

function toRelationDto(row: OkrObjectiveRelationModel): OkrObjectiveRelation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    sourceObjectiveId: row.sourceObjectiveId,
    targetObjectiveId: row.targetObjectiveId,
    relationType: row.relationType as OkrRelationType,
    status: row.status as OkrRelationStatus,
    impactWeight: row.impactWeight,
    reasonCode: row.reasonCode ?? null,
    evidenceRefHash: row.evidenceRefHash ?? null,
    createdAt: row.createdAt instanceof DateTime ? row.createdAt.toISO()! : String(row.createdAt),
    updatedAt: row.updatedAt instanceof DateTime ? row.updatedAt.toISO()! : String(row.updatedAt),
    deletedAt: row.deletedAt instanceof DateTime ? row.deletedAt.toISO()! : null,
  }
}

function makeMeta(total: number, page: number, perPage: number): OkrListMeta {
  return { total, page, perPage, totalPages: Math.ceil(total / perPage) }
}

// ── Service ─────────────────────────────────────────────────────────────────

@inject()
@inject()
export default class OkrCascadeAlignmentService {
  constructor(
    private readonly policy: OkrPolicy,
    private readonly audit: AuditService,
  ) {}

  /**
   * 低敏审计写入。
   *
   * 规范 REQ「Audit relation write omits sensitive fields」要求：只记 actor、组织、
   * OKR id、动作、变更字段名、reason code、hash 引用与时间戳；**不得**含 prompt 文本、
   * 模型输出、完整备注、Authorization 头、API key、token 与跨组织数据。
   * 因此这里只传 id/字段名/hash，不传任何自由文本正文。
   *
   * 审计失败不阻断业务写入（与仓库既有审计纪律一致）。
   */
  private async writeAudit(entry: {
    event: (typeof AuditEvent)[keyof typeof AuditEvent]
    userId: number
    organizationId: number
    entityId: number
    metadata: Record<string, unknown>
  }) {
    await this.audit
      .log({
        event: entry.event,
        userId: entry.userId,
        organizationId: entry.organizationId,
        entityType: 'okr_cascade_alignment',
        entityId: entry.entityId,
        metadata: entry.metadata,
      })
      .catch(() => {})
  }

  // ══════════════════════════════════════════════════════════════════════
  // Cascade Plans
  // ══════════════════════════════════════════════════════════════════════

  async createCascadePlan(organizationId: number, input: OkrCascadePlanCreateRequest, user: User) {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeCreate(user, organizationId)

    const sourceObjective = await OkrObjective.find(input.sourceObjectiveId)
    if (
      !sourceObjective ||
      sourceObjective.deletedAt ||
      sourceObjective.organizationId !== organizationId
    ) {
      throw new ValidationException('源目标不存在')
    }
    if (!sourceObjective.cycleId) {
      throw new ValidationException('源目标未绑定 OKR 周期')
    }

    // 生成草案（mock / 基于规则拆解，不调用 AI）
    const items = this.generateCascadeDraft(sourceObjective, input.includePersonalScope ?? false)

    const revisionHash = okrStableHash(
      `cascade:${organizationId}:${sourceObjective.id}:${Date.now()}`,
    )

    const plan = await OkrCascadePlanModel.create({
      organizationId,
      sourceObjectiveId: sourceObjective.id,
      cycleId: sourceObjective.cycleId,
      title: input.title ?? `${sourceObjective.title} - 级联拆解`,
      description: null,
      status: 'draft',
      coverage: 'partial',
      warnings: JSON.stringify([]),
      assumptions: JSON.stringify(['基于组织结构和当前 OKR 数据生成', '需人工审查确认']),
      sourceRefs: JSON.stringify(['组织 OKR 周期', '项目列表']),
      metricVersion: OKR_METRIC_VERSION,
      revisionHash,
    })

    // 创建计划项
    for (const item of items) {
      await OkrCascadePlanItemModel.create({
        planId: plan.id,
        organizationId,
        candidateObjective: JSON.stringify(item.candidateObjective),
        status: 'pending',
        coverageGap: item.coverageGap,
        conflictWarning: item.conflictWarning,
      })
    }

    await this.writeAudit({
      event: AuditEvent.OKR_CASCADE_PLAN_CREATED,
      userId: Number(user.id),
      organizationId,
      entityId: plan.id,
      metadata: {
        planId: plan.id,
        sourceObjectiveId: sourceObjective.id,
        cycleId: sourceObjective.cycleId,
        itemCount: items.length,
        coverage: plan.coverage,
        revisionHash: plan.revisionHash,
        metricVersion: plan.metricVersion,
      },
    })

    return { data: toCascadePlanDto(plan) }
  }

  /** 基于规则生成级联草案（不调用 AI） */
  private generateCascadeDraft(source: OkrObjective, includePersonal: boolean) {
    const items: Array<{
      candidateObjective: any
      coverageGap: boolean
      conflictWarning: string | null
    }> = []

    // Team scope 拆解
    items.push({
      candidateObjective: {
        title: `团队级：${source.title}`,
        description: `从 "${source.title}" 拆解的团队级执行目标`,
        scope: 'team',
        confidence: 'high',
        keyResults: [
          {
            title: '团队 KR：核心指标达成',
            description: '',
            measurementType: 'percent',
            unitLabel: '%',
            baselineValue: 0,
            targetValue: 100,
            confidence: 'medium',
          },
        ],
        alignment: { parentObjectiveTitle: source.title, rationale: '团队执行是战略落地的基础' },
      },
      coverageGap: false,
      conflictWarning: null,
    })

    // Project scope 拆解
    items.push({
      candidateObjective: {
        title: `项目级：${source.title}`,
        description: `从 "${source.title}" 拆解的项目级交付目标`,
        scope: 'project',
        confidence: 'medium',
        keyResults: [
          {
            title: '项目 KR：按时交付里程碑',
            description: '',
            measurementType: 'milestone',
            baselineValue: 0,
            targetValue: 1,
            confidence: 'medium',
          },
        ],
        alignment: { parentObjectiveTitle: source.title, rationale: '项目交付支撑组织目标' },
      },
      coverageGap: false,
      conflictWarning: null,
    })

    // Individual scope 仅提示
    if (includePersonal) {
      items.push({
        candidateObjective: {
          title: `个人级：${source.title}`,
          description: `从 "${source.title}" 拆解的个人贡献目标`,
          scope: 'individual',
          confidence: 'low',
          keyResults: [],
        },
        coverageGap: false,
        conflictWarning: 'individual scope 当前默认禁用写入',
      })
    }

    return items
  }

  async listCascadePlans(
    organizationId: number,
    query: { status?: string; page?: number; perPage?: number },
    user: User,
  ) {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const page = query.page ?? 1
    const perPage = query.perPage ?? 25

    let q = OkrCascadePlanModel.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
    if (query.status) q = q.where('status', query.status)

    const totalRows = await q.clone().count('* as total')
    const total = Number(totalRows[0].$extras.total)
    const rows = await q
      .orderBy('created_at', 'desc')
      .offset((page - 1) * perPage)
      .limit(perPage)
    return { data: rows.map(toCascadePlanDto), meta: makeMeta(total, page, perPage) }
  }

  async getCascadePlan(planId: number, user: User) {
    const plan = await OkrCascadePlanModel.find(planId)
    if (!plan || plan.deletedAt) throw new ValidationException('级联计划不存在')
    await this.policy.assertOrganizationVisible(user, plan.organizationId)
    await this.policy.authorizeView(user, plan.organizationId)

    const items = await OkrCascadePlanItemModel.query()
      .where('plan_id', planId)
      .orderBy('id', 'asc')
    return {
      data: {
        ...toCascadePlanDto(plan),
        items: items.map(toCascadeItemDto),
      },
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Cascade Plan Confirmation / Rejection
  // ══════════════════════════════════════════════════════════════════════

  async confirmCascadeItems(planId: number, input: OkrCascadePlanItemConfirmRequest, user: User) {
    const plan = await OkrCascadePlanModel.find(planId)
    if (!plan || plan.deletedAt) throw new ValidationException('级联计划不存在')
    await this.policy.assertOrganizationVisible(user, plan.organizationId)
    await this.policy.authorizeUpdate(user, plan.organizationId)

    // 检查计划状态
    if (plan.status !== 'draft') throw new ValidationException('只能确认草案状态的级联计划')

    const diffs: OkrCascadeConfirmationDiff[] = []
    let acceptedCount = 0
    let rejectedCount = 0
    const warnings: OkrWarning[] = []

    for (const itemId of input.acceptedItemIds) {
      const item = await OkrCascadePlanItemModel.find(itemId)
      if (!item || item.planId !== planId) continue

      const candidate =
        typeof item.candidateObjective === 'string'
          ? JSON.parse(item.candidateObjective)
          : item.candidateObjective

      // 检查 individual scope
      if (OKR_DISABLED_SCOPES.includes(candidate.scope as any)) {
        item.status = 'rejected'
        item.rejectionReason = `scope '${candidate.scope}' 当前默认禁用写入`
        await item.save()
        rejectedCount++
        warnings.push({
          code: 'DISABLED_SCOPE',
          message: `scope '${candidate.scope}' 当前默认禁用写入`,
        })
        continue
      }

      // 创建实际 objective
      try {
        const objective = await OkrObjective.create({
          organizationId: plan.organizationId,
          cycleId: plan.cycleId,
          scope: candidate.scope,
          title: candidate.title,
          description: candidate.description,
          status: 'draft',
          weight: 1,
          metricVersion: OKR_METRIC_VERSION,
        })

        // 创建父级 alignment
        await OkrAlignment.create({
          organizationId: plan.organizationId,
          childObjectiveId: objective.id,
          parentObjectiveId: plan.sourceObjectiveId,
        })

        // 创建候选 KR
        for (const kr of candidate.keyResults || []) {
          await OkrKeyResult.create({
            organizationId: plan.organizationId,
            objectiveId: objective.id,
            title: kr.title,
            description: kr.description || '',
            measurementType: kr.measurementType,
            unitLabel: kr.unitLabel ?? null,
            baselineValue: kr.baselineValue,
            targetValue: kr.targetValue,
            currentValue: kr.baselineValue,
            confidence: kr.confidence || 'medium',
            status: 'draft',
            weight: 1,
          })
        }

        item.status = 'confirmed'
        item.confirmedObjectiveId = objective.id
        acceptedCount++

        diffs.push({
          itemId: item.id,
          kind: 'objective',
          before: null,
          after: { title: candidate.title, scope: candidate.scope, id: objective.id },
          warnings: [],
        })
      } catch (err) {
        item.status = 'rejected'
        item.rejectionReason = err instanceof Error ? err.message : '创建失败'
        rejectedCount++
        warnings.push({ code: 'AI_DRAFT_UNAVAILABLE', message: item.rejectionReason })
      }

      await item.save()
    }

    // 处理拒绝项
    if (input.rejectedItemIds) {
      for (const itemId of input.rejectedItemIds) {
        const item = await OkrCascadePlanItemModel.find(itemId)
        if (!item || item.planId !== planId) continue
        item.status = 'rejected'
        item.rejectionReason = input.rejectionReasons?.[itemId] ?? '用户拒绝'
        await item.save()
        rejectedCount++
      }
    }

    // 更新计划状态
    plan.status = acceptedCount > 0 ? 'confirmed' : 'rejected'
    await plan.save()

    await this.writeAudit({
      event: AuditEvent.OKR_CASCADE_PLAN_CONFIRMED,
      userId: Number(user.id),
      organizationId: plan.organizationId,
      entityId: plan.id,
      metadata: {
        planId: plan.id,
        planStatus: plan.status,
        acceptedCount,
        rejectedCount,
        // 只记 warning code，不记 message 正文
        warningCodes: warnings.map((w) => w.code),
        revisionHash: plan.revisionHash,
      },
    })

    return {
      data: diffs,
      meta: { totalItems: acceptedCount + rejectedCount, acceptedCount, rejectedCount, warnings },
    }
  }

  async rejectCascadeItems(planId: number, input: OkrCascadePlanItemRejectRequest, user: User) {
    const plan = await OkrCascadePlanModel.find(planId)
    if (!plan || plan.deletedAt) throw new ValidationException('级联计划不存在')
    await this.policy.assertOrganizationVisible(user, plan.organizationId)
    await this.policy.authorizeUpdate(user, plan.organizationId)

    for (const itemId of input.rejectedItemIds) {
      const item = await OkrCascadePlanItemModel.find(itemId)
      if (!item || item.planId !== planId) continue
      item.status = 'rejected'
      item.rejectionReason = input.reason
      await item.save()
    }

    // 检查是否所有项都已处理
    const pendingItems = await OkrCascadePlanItemModel.query()
      .where('plan_id', planId)
      .where('status', 'pending')
      .count('* as total')
    const pendingCount = Number(pendingItems[0].$extras.total)
    if (pendingCount === 0) {
      plan.status = 'rejected'
      await plan.save()
    }

    await this.writeAudit({
      event: AuditEvent.OKR_CASCADE_PLAN_REJECTED,
      userId: Number(user.id),
      organizationId: plan.organizationId,
      entityId: plan.id,
      metadata: {
        planId: plan.id,
        rejectedItemIds: input.rejectedItemIds,
        rejectedCount: input.rejectedItemIds.length,
        // 契约里的 reason 是自由文本备注，规范明令审计不得含完整备注
        // （omits full notes）。这里只记「有没有给理由」与其 hash 引用。
        hasReason: Boolean(input.reason && input.reason.length > 0),
        reasonHash: input.reason ? okrStableHash(input.reason) : null,
      },
    })

    return { data: { rejectedCount: input.rejectedItemIds.length } }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Cross-Objective Relations
  // ══════════════════════════════════════════════════════════════════════

  async createRelation(organizationId: number, input: OkrRelationCreateRequest, user: User) {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeUpdate(user, organizationId)

    const source = await OkrObjective.find(input.sourceObjectiveId)
    const target = await OkrObjective.find(input.targetObjectiveId)
    if (!source || source.deletedAt || source.organizationId !== organizationId)
      throw new ValidationException('源目标不存在')
    if (!target || target.deletedAt || target.organizationId !== organizationId)
      throw new ValidationException('目标目标不存在')

    // 验证关系
    const existingRelations = await OkrObjectiveRelationModel.query()
      .where('source_objective_id', input.sourceObjectiveId)
      .whereNull('deleted_at')

    const sourceObj = {
      id: source.id,
      organizationId: source.organizationId,
      cycleId: source.cycleId,
    } as any
    const targetObj = {
      id: target.id,
      organizationId: target.organizationId,
      cycleId: target.cycleId,
    } as any

    const validation = validateRelation(
      sourceObj,
      targetObj,
      input.relationType,
      existingRelations.map(toRelationDto) as any,
    )
    if (!validation.valid)
      throw new ValidationException(validation.warning?.message ?? '关系校验失败')

    const relation = await OkrObjectiveRelationModel.create({
      organizationId,
      sourceObjectiveId: input.sourceObjectiveId,
      targetObjectiveId: input.targetObjectiveId,
      relationType: input.relationType,
      status: 'active',
      impactWeight: input.impactWeight ?? 1,
      reasonCode: input.reasonCode ?? null,
    })

    await this.writeAudit({
      event: AuditEvent.OKR_RELATION_CREATED,
      userId: Number(user.id),
      organizationId,
      entityId: relation.id,
      metadata: {
        relationId: relation.id,
        sourceObjectiveId: relation.sourceObjectiveId,
        targetObjectiveId: relation.targetObjectiveId,
        relationType: relation.relationType,
        // reasonCode 是 vine.string().maxLength(100) 的**自由文本**（app/validators/okr.ts:352），
        // 不是受限枚举。原先把它原样写进审计 metadata，等于开了一条让用户把任意内容
        // （token / 个人信息）落进审计表的通道——既与兄弟方法 updateRelation
        // 「只记 changedFields 名、不记值」自相矛盾，也违反规范
        // 「Audit relation write omits sensitive fields」。改为只记「有没有给」+ 稳定 hash。
        hasReasonCode: Boolean(relation.reasonCode && relation.reasonCode.length > 0),
        reasonCodeHash: relation.reasonCode ? okrStableHash(relation.reasonCode) : null,
      },
    })

    return { data: toRelationDto(relation) }
  }

  async updateRelation(relationId: number, input: OkrRelationUpdateRequest, user: User) {
    const relation = await OkrObjectiveRelationModel.find(relationId)
    if (!relation || relation.deletedAt) throw new ValidationException('关系不存在')
    await this.policy.assertOrganizationVisible(user, relation.organizationId)
    await this.policy.authorizeUpdate(user, relation.organizationId)

    const changedFields: string[] = []
    if (input.relationType !== undefined) {
      relation.relationType = input.relationType
      changedFields.push('relationType')
    }
    if (input.impactWeight !== undefined) {
      relation.impactWeight = input.impactWeight
      changedFields.push('impactWeight')
    }
    if (input.reasonCode !== undefined) {
      relation.reasonCode = input.reasonCode
      changedFields.push('reasonCode')
    }
    if (input.status !== undefined) {
      relation.status = input.status
      changedFields.push('status')
    }
    await relation.save()

    await this.writeAudit({
      event: AuditEvent.OKR_RELATION_UPDATED,
      userId: Number(user.id),
      organizationId: relation.organizationId,
      entityId: relation.id,
      metadata: {
        relationId: relation.id,
        sourceObjectiveId: relation.sourceObjectiveId,
        targetObjectiveId: relation.targetObjectiveId,
        // 只记字段名，不记新旧值——值可能含自由文本
        changedFields,
      },
    })

    return { data: toRelationDto(relation) }
  }

  async archiveRelation(relationId: number, user: User) {
    const relation = await OkrObjectiveRelationModel.find(relationId)
    if (!relation || relation.deletedAt) throw new ValidationException('关系不存在')
    await this.policy.assertOrganizationVisible(user, relation.organizationId)
    await this.policy.authorizeUpdate(user, relation.organizationId)

    relation.deletedAt = DateTime.now()
    await relation.save()

    await this.writeAudit({
      event: AuditEvent.OKR_RELATION_ARCHIVED,
      userId: Number(user.id),
      organizationId: relation.organizationId,
      entityId: relation.id,
      metadata: {
        relationId: relation.id,
        sourceObjectiveId: relation.sourceObjectiveId,
        targetObjectiveId: relation.targetObjectiveId,
        relationType: relation.relationType,
      },
    })

    return { data: toRelationDto(relation) }
  }

  async getRelation(relationId: number, user: User) {
    const relation = await OkrObjectiveRelationModel.find(relationId)
    if (!relation || relation.deletedAt) throw new ValidationException('关系不存在')
    await this.policy.assertOrganizationVisible(user, relation.organizationId)
    await this.policy.authorizeView(user, relation.organizationId)

    return { data: toRelationDto(relation) }
  }

  async listRelations(
    organizationId: number,
    query: {
      sourceObjectiveId?: number
      targetObjectiveId?: number
      relationType?: string
      status?: string
      page?: number
      perPage?: number
    },
    user: User,
  ) {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const page = query.page ?? 1
    const perPage = query.perPage ?? 25

    let q = OkrObjectiveRelationModel.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
    if (query.sourceObjectiveId) q = q.where('source_objective_id', query.sourceObjectiveId)
    if (query.targetObjectiveId) q = q.where('target_objective_id', query.targetObjectiveId)
    if (query.relationType) q = q.where('relation_type', query.relationType)
    if (query.status) q = q.where('status', query.status)

    const totalRows = await q.clone().count('* as total')
    const total = Number(totalRows[0].$extras.total)
    const rows = await q
      .orderBy('created_at', 'desc')
      .offset((page - 1) * perPage)
      .limit(perPage)
    return { data: rows.map(toRelationDto), meta: makeMeta(total, page, perPage) }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Alignment Health
  // ══════════════════════════════════════════════════════════════════════

  async getHealth(objectiveId: number, user: User) {
    const objective = await OkrObjective.find(objectiveId)
    if (!objective || objective.deletedAt) throw new ValidationException('目标不存在')
    await this.policy.assertOrganizationVisible(user, objective.organizationId)
    await this.policy.authorizeView(user, objective.organizationId)

    const health = await this.computeHealthForObjective(objective)
    return { data: health }
  }

  async listHealth(organizationId: number, query: OkrHealthQuery, user: User) {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    let q = OkrObjective.query().where('organization_id', organizationId).whereNull('deleted_at')
    if (query.cycleId) q = q.where('cycle_id', query.cycleId)
    if (query.scope) q = q.where('scope', query.scope as string)
    if (query.ownerId) q = q.where('owner_id', query.ownerId)
    if (query.status) q = q.where('status', query.status as string)

    const rows = await q.limit(100)
    const healthResults: OkrAlignmentHealth[] = []

    for (const obj of rows) {
      healthResults.push(await this.computeHealthForObjective(obj))
    }

    return { data: healthResults, meta: makeMeta(healthResults.length, 1, 100) }
  }

  private async computeHealthForObjective(objective: OkrObjective): Promise<OkrAlignmentHealth> {
    const parentAlignment = await OkrAlignment.query()
      .where('child_objective_id', objective.id)
      .whereNull('deleted_at')
      .first()

    const childAlignments = await OkrAlignment.query()
      .where('parent_objective_id', objective.id)
      .whereNull('deleted_at')

    const crossRelations = await OkrObjectiveRelationModel.query()
      .where((builder) => {
        builder
          .where('source_objective_id', objective.id)
          .orWhere('target_objective_id', objective.id)
      })
      .whereNull('deleted_at')

    const keyResults = await OkrKeyResult.query()
      .where('objective_id', objective.id)
      .whereNull('deleted_at')

    const freshness = makeOkrFreshness(
      objective.updatedAt instanceof DateTime
        ? objective.updatedAt.toISO()!
        : String(objective.updatedAt),
    )

    const objDto = {
      id: objective.id,
      organizationId: objective.organizationId,
      cycleId: objective.cycleId,
      projectId: objective.projectId,
      teamId: null,
      ownerId: objective.ownerId,
      scope: objective.scope,
      title: objective.title,
      description: objective.description,
      status: objective.status,
      weight: objective.weight,
      progress: objective.progress,
      confidence: objective.confidence,
      startDate: objective.startDate,
      endDate: objective.endDate,
      metricVersion: objective.metricVersion,
      calculatedAt:
        objective.calculatedAt instanceof DateTime
          ? objective.calculatedAt.toISO()!
          : objective.calculatedAt
            ? String(objective.calculatedAt)
            : null,
      createdAt:
        objective.createdAt instanceof DateTime
          ? objective.createdAt.toISO()!
          : String(objective.createdAt),
      updatedAt:
        objective.updatedAt instanceof DateTime
          ? objective.updatedAt.toISO()!
          : String(objective.updatedAt),
      deletedAt: objective.deletedAt instanceof DateTime ? objective.deletedAt.toISO()! : null,
    }

    const parentAlignmentDto = parentAlignment
      ? {
          id: parentAlignment.id,
          organizationId: parentAlignment.organizationId,
          childObjectiveId: parentAlignment.childObjectiveId,
          parentObjectiveId: parentAlignment.parentObjectiveId,
          createdAt:
            parentAlignment.createdAt instanceof DateTime
              ? parentAlignment.createdAt.toISO()!
              : String(parentAlignment.createdAt),
          updatedAt:
            parentAlignment.updatedAt instanceof DateTime
              ? parentAlignment.updatedAt.toISO()!
              : String(parentAlignment.updatedAt),
          deletedAt:
            parentAlignment.deletedAt instanceof DateTime
              ? parentAlignment.deletedAt.toISO()!
              : null,
        }
      : null

    return computeOkrAlignmentHealth({
      objective: objDto as any,
      parentAlignment: parentAlignmentDto as any,
      childAlignments: childAlignments.map((a) => ({
        id: a.id,
        organizationId: a.organizationId,
        childObjectiveId: a.childObjectiveId,
        parentObjectiveId: a.parentObjectiveId,
        createdAt: a.createdAt instanceof DateTime ? a.createdAt.toISO()! : String(a.createdAt),
        updatedAt: a.updatedAt instanceof DateTime ? a.updatedAt.toISO()! : String(a.updatedAt),
        deletedAt: a.deletedAt instanceof DateTime ? a.deletedAt.toISO()! : null,
      })),
      crossRelations: crossRelations.map(toRelationDto) as any,
      keyResults: keyResults.map(
        (kr) =>
          ({
            id: kr.id,
            organizationId: kr.organizationId,
            objectiveId: kr.objectiveId,
            title: kr.title,
            description: kr.description,
            measurementType: kr.measurementType,
            unitLabel: kr.unitLabel,
            baselineValue: kr.baselineValue,
            targetValue: kr.targetValue,
            currentValue: kr.currentValue,
            confidence: kr.confidence,
            status: kr.status,
            weight: kr.weight,
            lastUpdatedAt:
              kr.lastUpdatedAt instanceof DateTime
                ? kr.lastUpdatedAt.toISO()!
                : kr.lastUpdatedAt
                  ? String(kr.lastUpdatedAt)
                  : null,
            createdAt:
              kr.createdAt instanceof DateTime ? kr.createdAt.toISO()! : String(kr.createdAt),
            updatedAt:
              kr.updatedAt instanceof DateTime ? kr.updatedAt.toISO()! : String(kr.updatedAt),
            deletedAt: kr.deletedAt instanceof DateTime ? kr.deletedAt.toISO()! : null,
          }) as any,
      ),
      evidenceFreshness: freshness,
      restrictedVisibilityCount: 0,
    })
  }

  // ══════════════════════════════════════════════════════════════════════
  // Alignment Matrix
  // ══════════════════════════════════════════════════════════════════════

  async getMatrix(organizationId: number, query: OkrAlignmentMatrixQuery, user: User) {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const page = query.page ?? 1
    const perPage = query.perPage ?? 25

    let q = OkrObjective.query().where('organization_id', organizationId).whereNull('deleted_at')
    if (query.cycleId) q = q.where('cycle_id', query.cycleId)
    if (query.scope) q = q.where('scope', query.scope as string)
    if (query.ownerId) q = q.where('owner_id', query.ownerId)
    if (query.status) q = q.where('status', query.status as string)

    const totalRows = await q.clone().count('* as total')
    const total = Number(totalRows[0].$extras.total)
    const rows = await q
      .orderBy('created_at', 'asc')
      .offset((page - 1) * perPage)
      .limit(perPage)

    const matrixRows: OkrAlignmentMatrixRow[] = []
    let totalRelations = 0
    let redactedCount = 0
    const warnings: OkrWarning[] = []

    for (const obj of rows) {
      const relations = await OkrObjectiveRelationModel.query()
        .where((builder) => {
          builder.where('source_objective_id', obj.id).orWhere('target_objective_id', obj.id)
        })
        .whereNull('deleted_at')

      const childCountRows = await OkrAlignment.query()
        .where('parent_objective_id', obj.id)
        .whereNull('deleted_at')
        .count('* as total')
      const childCount = Number(childCountRows[0].$extras.total)

      const parentAlignment = await OkrAlignment.query()
        .where('child_objective_id', obj.id)
        .whereNull('deleted_at')
        .first()

      const health = await this.computeHealthForObjective(obj)

      totalRelations += relations.length

      matrixRows.push({
        objectiveId: obj.id,
        objectiveTitle: obj.title,
        scope: obj.scope as OkrScope,
        ownerId: obj.ownerId ?? null,
        status: obj.status as OkrStatus,
        health,
        relations: relations.map(toRelationDto) as any,
        parentAlignmentId: parentAlignment?.id ?? null,
        childCount,
        restricted: false,
      })
    }

    return {
      data: matrixRows,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
        totalRelations,
        redactedCount,
        warnings,
      },
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // AI Suggestion Preview
  // ══════════════════════════════════════════════════════════════════════

  async generateAiCascadeSuggestions(
    organizationId: number,
    _input: OkrAiCascadeSuggestionRequest,
    user: User,
  ): Promise<OkrAiCascadeSuggestionResponse> {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeAiDraft(user, organizationId)

    // Mock AI 建议生成（不调用真实 AI）
    const objectives = await OkrObjective.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .limit(10)

    const objectiveTitles = objectives.map((o) => o.title)

    return {
      cascadeCandidates: [
        {
          title: 'AI 建议：提升跨团队协作',
          description: '基于当前目标间缺少支持关系，建议增加跨团队协作目标',
          scope: 'team',
          confidence: 'high',
          keyResults: [
            {
              title: '跨团队项目按时交付率 ≥ 90%',
              description: '',
              measurementType: 'percent',
              unitLabel: '%',
              baselineValue: 70,
              targetValue: 90,
              confidence: 'medium',
            },
          ],
          alignment: {
            parentObjectiveTitle: objectiveTitles[0] ?? '组织战略目标',
            rationale: '跨团队协作是战略落地的基础',
          },
        },
      ],
      relationSuggestions:
        objectiveTitles.length >= 2
          ? [
              {
                sourceObjectiveTitle: objectiveTitles[0],
                targetObjectiveTitle: objectiveTitles[1],
                relationType: 'supports',
                rationale: '两者共享上游资源依赖',
                confidence: 'medium',
                impactWeight: 1,
              },
            ]
          : [],
      conflictExplanations: [],
      missingAlignmentPrompts:
        objectives.length === 0
          ? ['该组织尚未创建任何 OKR 目标']
          : ['部分项目级目标尚未对齐组织战略'],
      confidence: 'medium',
      assumptions: ['基于当前组织 OKR 数据', '假设团队资源配置不变'],
      sourceRefs: ['组织 OKR 周期', '项目列表'],
      warnings: [],
    }
  }
}
