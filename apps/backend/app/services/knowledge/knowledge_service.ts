/**
 * v3-four-layer-knowledge-system —— KnowledgeService（D2/D4/D5）。
 *
 * 四层知识底座的核心业务逻辑——CRUD、检索（L3 隔离 + 组织隔离）、
 * AI 结构化（仅产待审草案）、人工确认转正、合成治理、生命周期。
 *
 * 所有查询强制附加 organization_id 过滤（组织隔离红线）。
 * 所有检索在数据访问层强制排除 L3（evalContext=true 除外）。
 *
 * @aiproj/backend
 */
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import KnowledgeItem from '#models/knowledge_item'
import AuditService, { AuditEvent } from '#services/audit_service'
import SqliteKnowledgeIndex from './sqlite_knowledge_index.js'
import type { KnowledgeIndex } from './knowledge_index.js'
import {
  LAYER_METADATA,
  validateKnowledgeItemConstraints,
  validateKnowledgeLifecycleTransition,
  type KnowledgeLifecycleStatus,
  type KnowledgeQuery,
  type KnowledgeQueryResult,
  type CreateKnowledgeRequest,
  type KnowledgeItemLowSensitiveProjection,
  type ReviewRecord,
} from '@aiproj/types'

export class KnowledgeItemNotFoundError extends Error {
  constructor(id: number) {
    super(`Knowledge item not found: ${id}`)
    this.name = 'KnowledgeItemNotFoundError'
  }
}

export class KnowledgeValidationError extends Error {
  constructor(errors: string[]) {
    super(`Knowledge validation failed: ${errors.join('; ')}`)
    this.name = 'KnowledgeValidationError'
  }
}

export class KnowledgeTransitionRejectedError extends Error {
  constructor(id: number, from: string, to: string, reason: string) {
    super(`Transition rejected for knowledge ${id}: ${from}→${to} — ${reason}`)
    this.name = 'KnowledgeTransitionRejectedError'
  }
}

export class L3AccessDeniedError extends Error {
  constructor() {
    super('L3 合成知识仅可在 Eval 上下文中检索')
    this.name = 'L3AccessDeniedError'
  }
}

@inject()
export default class KnowledgeService {
  private index: KnowledgeIndex

  constructor(private readonly audit: AuditService) {
    // 降级实现：SQLite 结构化过滤（外部向量库未配置时核心流程不中断）
    this.index = new SqliteKnowledgeIndex()
  }

  // ── 检索（组织隔离 + L3 排除 + RBAC 回调） ───────────────────────

  /**
   * 统一检索接口——结构化过滤 + 组织隔离 + L3 排除。
   *
   * @param organizationId 调用者组织 ID（强制过滤）。
   * @param query 检索参数。evalContext 默认 false，仅 Eval 服务可设为 true。
   * @param onPolicyCheck 可选 RBAC 回调——在返回数据前调用，不通过则拒绝。
   */
  async query(
    organizationId: number,
    query: KnowledgeQuery,
    onPolicyCheck?: (item: KnowledgeItemLowSensitiveProjection) => Promise<boolean>,
  ): Promise<KnowledgeQueryResult> {
    // L3 强制门禁——非 evalContext 下 L3 已由 index 层排除，此处为双重保障
    if (query.layer === 'L3' && !query.evalContext) {
      throw new L3AccessDeniedError()
    }

    const result = await this.index.search(organizationId, query)

    // 可选 RBAC 校验
    if (onPolicyCheck) {
      const filtered: KnowledgeItemLowSensitiveProjection[] = []
      for (const item of result.data) {
        if (await onPolicyCheck(item)) {
          filtered.push(item)
        }
      }
      return {
        data: filtered,
        meta: { ...result.meta, total: filtered.length },
      }
    }

    return result
  }

  // ── CRUD ───────────────────────────────────────────────────────────

  /**
   * 创建知识记录（L1/L2 录入）。
   * 新知识以 draft/pending 落库，provenance.sources 非空校验。
   */
  async create(
    organizationId: number,
    actorId: number,
    input: CreateKnowledgeRequest,
  ): Promise<KnowledgeItem> {
    // 校验约束
    const constraintErrors = validateKnowledgeItemConstraints({
      layer: input.layer,
      isSynthetic: input.layer === 'L3',
      syntheticMethod: input.layer === 'L3' ? '由用户手动创建' : undefined,
      provenance: input.provenance,
    })
    if (constraintErrors.length > 0) {
      throw new KnowledgeValidationError(constraintErrors)
    }

    // L3 不可手动创建——合成治理 Service 专用
    if (input.layer === 'L3') {
      throw new KnowledgeValidationError(['L3 合成知识不可手动创建，请通过合成治理 Service'])
    }

    const item = new KnowledgeItem()
    item.organizationId = organizationId
    item.layer = input.layer
    item.layerMeta = LAYER_METADATA[input.layer]
    item.title = input.title
    item.content = input.content
    item.status = 'draft'
    item.domain = input.domain
    item.purpose = input.purpose
    item.complexity = input.complexity ?? null
    item.provenance = { ...input.provenance, reviewHistory: [] }
    item.reviewHistory = []
    item.isSynthetic = false
    item.syntheticMethod = null
    item.createdBy = actorId
    item.updatedBy = null
    item.lastReferencedAt = null
    item.retentionDays = input.layer === 'L4' ? 90 : null

    await item.save()

    await this.audit.log({
      event: AuditEvent.KNOWLEDGE_ITEM_CREATED,
      organizationId,
      userId: actorId,
      metadata: {
        description: `创建 ${input.layer} 知识记录: ${input.title}`,
        knowledgeItemId: item.id,
        layer: input.layer,
        domain: input.domain,
      },
    })

    return item
  }

  /**
   * 获取单条知识记录（组织隔离）。
   */
  async getById(organizationId: number, id: number): Promise<KnowledgeItem> {
    const item = await KnowledgeItem.forOrganization(organizationId).where('id', id).first()

    if (!item) {
      throw new KnowledgeItemNotFoundError(id)
    }

    return item
  }

  /**
   * 获取低敏投影（组织隔离 + L3 上下文校验）。
   */
  async getLowSensitiveById(
    organizationId: number,
    id: number,
    evalContext: boolean = false,
  ): Promise<KnowledgeItemLowSensitiveProjection> {
    const item = await this.getById(organizationId, id)

    if (item.layer === 'L3' && !evalContext) {
      throw new L3AccessDeniedError()
    }

    return this.toLowSensitive(item)
  }

  /**
   * 治理视角的低敏列表——**跨全部生命周期状态**（v3-knowledge-memory-operating-layer）。
   *
   * 与 `query()` 的区别：`query()` 服务于「检索可用知识」，因此只返回 `active`；
   * 运营/治理视角恰恰要看 `draft` / `pending` / `outdated` / `deprecated`——
   * 待审与过期条目正是待办本身。走 `query()` 会让治理队列恒为空。
   *
   * 只读、只返回低敏投影；L3 排除与 `query()` 同一红线（仅 evalContext 放行），
   * 生命周期状态机与转正入口仍只在本 Service 的 confirm/transition 中。
   *
   * @param organizationId 调用者组织 ID（强制过滤）。
   * @param options.limit 有界上限，调用方负责传入合理窗口。
   * @param options.evalContext 仅 Eval 上下文可为 true；生产路径恒 false。
   */
  async listLowSensitiveForGovernance(
    organizationId: number,
    options: { limit: number; evalContext?: boolean },
  ): Promise<KnowledgeItemLowSensitiveProjection[]> {
    let q = KnowledgeItem.forOrganization(organizationId)
    if (!options.evalContext) {
      q = q.whereNot('layer', 'L3')
    }
    const rows = await q
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc')
      .limit(Math.max(0, options.limit))
    return rows.map((item) => this.toLowSensitive(item))
  }

  // ── 生命周期治理 ──────────────────────────────────────────────────

  /**
   * 人工确认——将待审知识转为 active（D4 唯一转正门）。
   * 仅 pending 状态可确认；置信度再高不豁免。
   */
  async confirm(organizationId: number, actorId: number, id: number): Promise<KnowledgeItem> {
    const item = await this.getById(organizationId, id)

    if (item.status !== 'pending') {
      throw new KnowledgeTransitionRejectedError(
        id,
        item.status,
        'active',
        '仅 pending 状态可确认转正',
      )
    }

    const result = validateKnowledgeLifecycleTransition('pending', 'active')
    if (!result.valid) {
      throw new KnowledgeTransitionRejectedError(id, 'pending', 'active', result.reasonCode)
    }

    const oldStatus = item.status
    item.status = 'active'
    item.updatedBy = actorId

    // 追加审核记录
    const reviewRecord: ReviewRecord = {
      reviewer: actorId,
      action: 'confirmed',
      timestamp: DateTime.now().toISO()!,
      note: `人工确认: ${oldStatus} → active`,
    }
    item.reviewHistory = [...item.reviewHistory, reviewRecord]

    await item.save()

    await this.audit.log({
      event: AuditEvent.KNOWLEDGE_ITEM_CONFIRMED,
      organizationId,
      userId: actorId,
      metadata: {
        description: `确认知识记录: ${item.title}`,
        knowledgeItemId: item.id,
        oldStatus,
        newStatus: 'active',
        layer: item.layer,
      },
    })

    return item
  }

  /**
   * 受治理生命周期转移（显式转移表校验）。
   */
  async transitionLifecycle(
    organizationId: number,
    actorId: number,
    id: number,
    to: KnowledgeLifecycleStatus,
  ): Promise<KnowledgeItem> {
    const item = await this.getById(organizationId, id)

    const result = validateKnowledgeLifecycleTransition(item.status, to)
    if (!result.valid) {
      throw new KnowledgeTransitionRejectedError(id, item.status, to, result.reasonCode)
    }

    const oldStatus = item.status
    item.status = to
    item.updatedBy = actorId

    // 追加审核记录
    const reviewRecord: ReviewRecord = {
      reviewer: actorId,
      action: `transition_${oldStatus}_to_${to}`,
      timestamp: DateTime.now().toISO()!,
      note: `生命周期转移: ${oldStatus} → ${to}`,
    }
    item.reviewHistory = [...item.reviewHistory, reviewRecord]

    await item.save()

    await this.audit.log({
      event: AuditEvent.KNOWLEDGE_ITEM_TRANSITIONED,
      organizationId,
      userId: actorId,
      metadata: {
        description: `知识生命周期转移: ${oldStatus} → ${to}`,
        knowledgeItemId: item.id,
        oldStatus,
        newStatus: to,
        layer: item.layer,
      },
    })

    return item
  }

  // ── Eval 专用：L3 检索（仅 Eval 服务可调用） ──────────────────────

  /**
   * Eval 上下文检索——放行 L3。
   * 仅 Eval 服务持有此方法的能力（非注入点，显式调用方可进入）。
   */
  async queryForEval(organizationId: number, query: KnowledgeQuery): Promise<KnowledgeQueryResult> {
    return this.query(organizationId, { ...query, evalContext: true })
  }

  /**
   * 正向对照：验证生产检索路径返回 0 条 L3 记录。
   * 如发现 L3 则说明隔离门禁被绕过——抛出错误。
   */
  async assertNoL3InProduction(organizationId: number): Promise<number> {
    const result = await this.index.search(organizationId, { evalContext: false })
    const l3Count = result.data.filter((item) => item.layer === 'L3').length

    if (l3Count > 0) {
      throw new Error(`L3 隔离红线被违反！生产检索路径发现 ${l3Count} 条 L3 记录。`)
    }

    return l3Count // 返回 0
  }

  /**
   * 正向对照：验证 Eval 检索路径返回精确 L3 条数。
   * 防扫描器坏掉恰好返回 0。
   */
  async countL3InEval(organizationId: number): Promise<number> {
    const result = await this.index.search(organizationId, { evalContext: true })
    return result.data.filter((item) => item.layer === 'L3').length
  }

  // ── 辅助 ───────────────────────────────────────────────────────────

  private toLowSensitive(item: KnowledgeItem): KnowledgeItemLowSensitiveProjection {
    return {
      id: item.id,
      layer: item.layer,
      title: item.title,
      status: item.status,
      domain: item.domain,
      purpose: item.purpose,
      complexity: item.complexity ?? undefined,
      provenance: item.provenance,
      isSynthetic: item.isSynthetic,
      createdAt: item.createdAt.toISO()!,
      updatedAt: item.updatedAt.toISO()!,
    }
  }
}
