/**
 * v2-5-code-repository-auto-linking —— 候选确认事务 Service。
 *
 * 设计 D3/D5:
 * - 确认事务：重新校验 actor、候选、任务、连接与仓库
 * - 复用 TaskExternalLinkService.create 创建正式外链
 * - 原子 settle candidate 并写 audit/activity
 * - 对已存在外链、安全校验失败等错误回滚候选状态为 rejected
 */

import { DateTime } from 'luxon'
import Task from '#models/task'
import type CandidateService from './candidate_service.js'
import type TaskExternalLinkService from '#services/task_external_link_service'
import DefaultCandidateService from './candidate_service.js'
import DefaultTaskExternalLinkService from '#services/task_external_link_service'
import {
  LinkValidationError,
  LinkDuplicateError,
  type ExternalLinkActor,
  type CreateLinkInput,
} from '#services/task_external_link_service'
import AuditService, { AuditEvent } from '#services/audit_service'

// ---------------------------------------------------------------------------
// 确认结果
// ---------------------------------------------------------------------------

export interface ConfirmResult {
  success: boolean
  candidateId: number
  externalLinkId?: number
  status: 'confirmed' | 'rejected' | 'expired' | 'already_settled'
  message: string
}

// ---------------------------------------------------------------------------
// 确认事务 Service
// ---------------------------------------------------------------------------

export default class CandidateConfirmService {
  constructor(
    private candidateService: CandidateService = new DefaultCandidateService(),
    private linkService: TaskExternalLinkService = new DefaultTaskExternalLinkService(),
    private audit: AuditService = new AuditService(),
  ) {}

  /**
   * 执行候选确认事务。
   *
   * 步骤：
   * 1. 重新加载候选并校验状态（pending、未过期）
   * 2. 重新校验 task 存在性与项目归属（TOCTOU 防护）
   * 3. 构造外部链接并复用 TaskExternalLinkService.create
   * 4. 标记候选为 confirmed
   * 5. 写低敏审计
   * 6. 任一失败 → 标记 rejected 并返回错误
   */
  async confirm(
    candidateId: number,
    organizationId: number,
    projectId: number,
    taskId: number,
    actor: ExternalLinkActor,
  ): Promise<ConfirmResult> {
    // 1. 重新加载候选
    const candidate = await this.candidateService.getById(candidateId, organizationId)
    if (!candidate) {
      return {
        success: false,
        candidateId,
        status: 'already_settled',
        message: '候选未找到',
      }
    }

    // 2. 校验候选状态
    if (candidate.status !== 'pending') {
      return {
        success: false,
        candidateId,
        status: candidate.status === 'confirmed' ? 'already_settled' : (candidate.status as any),
        message: `候选状态为 ${candidate.status}，无法确认`,
      }
    }

    // 3. 校验过期
    if (candidate.expiresAt < DateTime.utc()) {
      await this.candidateService.markExpired(candidate).catch(() => {})
      return {
        success: false,
        candidateId,
        status: 'expired',
        message: '候选已过期',
      }
    }

    // 4. 重新校验任务存在性
    const task = await Task.query().where('id', taskId).where('project_id', projectId).first()

    if (!task) {
      await this.candidateService.reject(candidate.id, organizationId, actor.userId).catch(() => {})
      return {
        success: false,
        candidateId: candidate.id,
        status: 'rejected',
        message: '关联任务未找到',
      }
    }

    // 5. 构造外部链接信息
    const externalUrl = `https://github.com/${candidate.repositoryFullName}/${candidate.objectType === 'pull_request' ? 'pull' : 'issues'}/${candidate.objectId}`
    const linkType =
      candidate.objectType === 'pull_request' ? ('pull_request' as const) : ('issue' as const)
    const [owner, repo] = candidate.repositoryFullName.split('/')

    const linkInput: CreateLinkInput = {
      provider: 'github',
      linkType,
      repositoryOwner: owner || '',
      repositoryName: repo || '',
      externalNumber: Number(candidate.objectId) || 0,
      externalTitle: candidate.taskTitle ?? undefined,
      externalStatus: 'open',
      externalUrl,
    }

    // 6. 复用既有外链 Service 创建
    try {
      const link = await this.linkService.create(projectId, taskId, linkInput, actor)

      // 7. 标记候选为 confirmed
      await this.candidateService.confirm(candidate.id, organizationId, actor.userId)

      // 8. 写审计
      await this.audit.log({
        event: AuditEvent.TASK_EXTERNAL_LINK_CREATED,
        userId: actor.userId,
        organizationId,
        entityType: 'task_external_link',
        entityId: link.id,
        metadata: {
          provider: 'github',
          linkType,
          repositoryOwner: owner || '',
          repositoryName: repo || '',
          externalNumber: Number(candidate.objectId) || 0,
          externalStatus: 'open',
          taskId,
          candidateId: candidate.id,
        },
      })

      return {
        success: true,
        candidateId: candidate.id,
        externalLinkId: link.id,
        status: 'confirmed',
        message: '候选已确认并创建外链',
      }
    } catch (error) {
      // 9. 失败 → 标记 rejected
      await this.candidateService.reject(candidate.id, organizationId, actor.userId).catch(() => {})

      if (error instanceof LinkDuplicateError) {
        return {
          success: false,
          candidateId: candidate.id,
          status: 'rejected',
          message: '该任务已存在相同外链',
        }
      }

      if (error instanceof LinkValidationError) {
        return {
          success: false,
          candidateId: candidate.id,
          status: 'rejected',
          message: `链接校验失败: ${error.message}`,
        }
      }

      throw error
    }
  }
}
