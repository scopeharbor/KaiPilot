/**
 * v2-5-code-repository-auto-linking —— 链接候选 Service。
 *
 * 设计 D3:
 * - 独立状态机：pending → confirmed / ignored / expired / rejected
 * - pending → confirmed 只能由显式用户动作触发
 * - pending → expired 由定时/惰性检查触发，不自动创建外链
 * - confirmed → rejected 仅当确认事务中的正式外链创建失败时
 * - 过期清理只移除已 expired 的候选，不动正式外链
 */

import { DateTime } from 'luxon'
import LinkCandidate from '#models/link_candidate'
import type {
  CandidateStatus,
  LinkCandidateDto,
  CandidateEvidenceDto,
  CandidateConfidenceClass,
} from '@aiproj/types'
import { DEFAULT_CANDIDATE_TTL_HOURS, CURRENT_RULE_VERSION } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 状态迁移表
// ---------------------------------------------------------------------------

/** 允许的状态迁移 */
const ALLOWED_TRANSITIONS: Record<CandidateStatus, CandidateStatus[]> = {
  pending: ['confirmed', 'ignored', 'expired', 'rejected'],
  confirmed: [],
  ignored: [],
  expired: ['rejected'],
  rejected: [],
}

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

export class CandidateNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CandidateNotFoundError'
  }
}

export class CandidateStatusTransitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CandidateStatusTransitionError'
  }
}

export class CandidateExpiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CandidateExpiredError'
  }
}

// ---------------------------------------------------------------------------
// 创建输入
// ---------------------------------------------------------------------------

export interface CreateCandidateInput {
  organizationId: number
  provider: string
  repositoryFullName: string
  repositoryExternalId: string
  eventType: string
  deliveryId: string
  objectType: string
  objectId: string
  taskReference: string
  taskId?: number | null
  taskTitle?: string | null
  confidenceClass: CandidateConfidenceClass
  ruleVersion?: number
  evidences?: CandidateEvidenceDto[]
  ttlHours?: number
}

// ---------------------------------------------------------------------------
// 候选 Service
// ---------------------------------------------------------------------------

export default class CandidateService {
  /**
   * 创建新候选。
   * 如果相同幂等键的候选已存在，返回现有候选而非创建新记录。
   */
  async create(input: CreateCandidateInput): Promise<LinkCandidate> {
    const expiresAt = DateTime.utc().plus({ hours: input.ttlHours ?? DEFAULT_CANDIDATE_TTL_HOURS })

    // 使用 upsert 实现幂等：如果相同唯一约束的记录已存在，不创建新记录
    const existing = await LinkCandidate.query()
      .where('organization_id', input.organizationId)
      .where('delivery_id', input.deliveryId)
      .where('object_type', input.objectType)
      .where('object_id', input.objectId)
      .where('task_reference', input.taskReference)
      .where('rule_version', input.ruleVersion ?? CURRENT_RULE_VERSION)
      .first()

    if (existing) {
      return existing
    }

    const candidate = new LinkCandidate()
    candidate.organizationId = input.organizationId
    candidate.provider = input.provider
    candidate.repositoryFullName = input.repositoryFullName
    candidate.repositoryExternalId = input.repositoryExternalId
    candidate.eventType = input.eventType
    candidate.deliveryId = input.deliveryId
    candidate.objectType = input.objectType
    candidate.objectId = input.objectId
    candidate.taskReference = input.taskReference
    candidate.taskId = input.taskId ?? null
    candidate.taskTitle = input.taskTitle ?? null
    candidate.confidenceClass = input.confidenceClass
    candidate.status = 'pending'
    candidate.ruleVersion = input.ruleVersion ?? CURRENT_RULE_VERSION
    candidate.evidencesJson = input.evidences ?? []
    candidate.expiresAt = expiresAt
    candidate.settledAt = null
    candidate.settledBy = null

    await candidate.save()
    return candidate
  }

  /**
   * 按组织+任务获取候选列表。
   */
  async listByTask(
    organizationId: number,
    taskId: number,
    status?: string,
  ): Promise<LinkCandidate[]> {
    const query = LinkCandidate.query()
      .where('organization_id', organizationId)
      .where('task_id', taskId)
      .orderBy('created_at', 'asc')

    if (status) {
      query.where('status', status)
    }

    return query
  }

  /**
   * 按组织+项目+任务获取候选列表（含未匹配的 taskReference）。
   */
  async listByTaskReference(
    organizationId: number,
    taskReference: string,
    status?: string,
  ): Promise<LinkCandidate[]> {
    const query = LinkCandidate.query()
      .where('organization_id', organizationId)
      .where('task_reference', taskReference)
      .orderBy('created_at', 'asc')

    if (status) {
      query.where('status', status)
    }

    return query
  }

  /**
   * 按 ID 获取候选（需组织隔离）。
   */
  async getById(candidateId: number, organizationId: number): Promise<LinkCandidate | null> {
    return LinkCandidate.query()
      .where('id', candidateId)
      .where('organization_id', organizationId)
      .first()
  }

  /**
   * 按 task_id 列出候选（组织隔离，支持分页和状态过滤）。
   */
  async listByTaskPaginated(
    organizationId: number,
    taskId: number,
    options?: {
      status?: string
      page?: number
      perPage?: number
    },
  ): Promise<{ data: LinkCandidate[]; total: number; page: number; perPage: number }> {
    const page = options?.page ?? 1
    const perPage = options?.perPage ?? 20

    const query = LinkCandidate.query()
      .where('organization_id', organizationId)
      .where('task_id', taskId)

    if (options?.status) {
      query.where('status', options.status)
    }

    const result = await query.orderBy('created_at', 'asc').paginate(page, perPage)
    return {
      data: result.all(),
      total: result.total,
      page: result.currentPage,
      perPage: result.perPage,
    }
  }

  /**
   * 状态迁移（通用转换）。
   * 验证迁移合法后执行，返回更新后的候选。
   */
  async transitionTo(
    candidateId: number,
    organizationId: number,
    newStatus: CandidateStatus,
    actorUserId?: number,
  ): Promise<LinkCandidate> {
    const candidate = await this.getById(candidateId, organizationId)
    if (!candidate) {
      throw new CandidateNotFoundError('候选未找到')
    }

    return this.transition(candidate, newStatus, actorUserId)
  }

  /**
   * 对已加载的候选对象执行状态迁移。
   * 用于事务内操作，避免重复加载。
   */
  async transition(
    candidate: LinkCandidate,
    newStatus: CandidateStatus,
    actorUserId?: number,
  ): Promise<LinkCandidate> {
    const currentStatus = candidate.status as CandidateStatus
    const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? []

    if (!allowed.includes(newStatus)) {
      throw new CandidateStatusTransitionError(`不允许从 ${currentStatus} 迁移到 ${newStatus}`)
    }

    // 已过期但状态仍是 pending：自动更新为过期
    if (
      currentStatus === 'pending' &&
      newStatus !== 'expired' &&
      candidate.expiresAt < DateTime.utc()
    ) {
      candidate.status = 'expired'
      candidate.settledAt = DateTime.utc()
      await candidate.save()
      throw new CandidateExpiredError('候选已过期，无法执行状态变更')
    }

    candidate.status = newStatus
    if (['confirmed', 'ignored', 'rejected'].includes(newStatus)) {
      candidate.settledAt = DateTime.utc()
      candidate.settledBy = actorUserId ?? null
    }

    await candidate.save()
    return candidate
  }

  /**
   * 显式确认候选（pending → confirmed）。
   */
  async confirm(
    candidateId: number,
    organizationId: number,
    actorUserId: number,
  ): Promise<LinkCandidate> {
    return this.transitionTo(candidateId, organizationId, 'confirmed', actorUserId)
  }

  /**
   * 忽略候选（pending → ignored）。
   */
  async ignore(
    candidateId: number,
    organizationId: number,
    actorUserId: number,
  ): Promise<LinkCandidate> {
    return this.transitionTo(candidateId, organizationId, 'ignored', actorUserId)
  }

  /**
   * 标记为拒绝（pending/expired → rejected）。
   * 当确认事务失败时调用。
   */
  async reject(
    candidateId: number,
    organizationId: number,
    actorUserId: number,
  ): Promise<LinkCandidate> {
    const candidate = await this.getById(candidateId, organizationId)
    if (!candidate) {
      throw new CandidateNotFoundError('候选未找到')
    }
    return this.transition(candidate, 'rejected', actorUserId)
  }

  /**
   * 将候选标记为过期（惰性清理的辅助方法）。
   */
  async markExpired(candidate: LinkCandidate): Promise<LinkCandidate> {
    if (candidate.status !== 'pending') {
      return candidate
    }
    return this.transition(candidate, 'expired')
  }

  /**
   * 清理已过期候选（批量）。
   * 只清理 expired/rejected 的候选，不动正式外链。
   */
  async cleanupExpired(organizationId?: number, olderThanHours?: number): Promise<number> {
    const threshold = DateTime.utc().minus({ hours: olderThanHours ?? 24 * 30 })

    const query = LinkCandidate.query()
      .whereIn('status', ['expired', 'rejected'])
      .where('created_at', '<', threshold.toSQL()!)

    if (organizationId) {
      query.where('organization_id', organizationId)
    }

    const count = await query.count('* as total')
    const total = Number(count[0]?.$extras?.total ?? 0)

    if (total > 0) {
      await query.delete()
    }

    return total
  }

  /**
   * 将候选转换为 DTO。
   */
  toDto(candidate: LinkCandidate): LinkCandidateDto {
    return {
      id: candidate.id,
      organizationId: candidate.organizationId,
      provider: candidate.provider as 'github',
      repositoryFullName: candidate.repositoryFullName,
      repositoryExternalId: candidate.repositoryExternalId,
      eventType: candidate.eventType as LinkCandidateDto['eventType'],
      deliveryId: candidate.deliveryId,
      objectType: candidate.objectType as LinkCandidateDto['objectType'],
      objectId: candidate.objectId,
      taskReference: candidate.taskReference,
      taskId: candidate.taskId,
      taskTitle: candidate.taskTitle,
      evidences: candidate.evidencesJson ?? [],
      confidenceClass: candidate.confidenceClass as CandidateConfidenceClass,
      status: candidate.status as CandidateStatus,
      createdAt: candidate.createdAt.toISO()!,
      expiresAt: candidate.expiresAt.toISO()!,
      settledAt: candidate.settledAt?.toISO() ?? null,
      settledBy: candidate.settledBy,
    }
  }
}
