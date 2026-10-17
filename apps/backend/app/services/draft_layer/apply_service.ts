/**
 * v2-ai-draft-layer-preview-diff-apply —— DraftLayerApplyService（task 8.1-8.5）。
 *
 * 事务性 Apply：复核 hash 一致性，在单个事务内写入正式业务表。
 * 幂等：同一幂等键重复提交返回既有结果。
 * 失败整体回滚。
 */
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import DraftLayerSession from '#models/draft_layer_session'
import DraftLayerChange from '#models/draft_layer_change'
import DraftLayerPreview from '#models/draft_layer_preview'
import DraftLayerApplyResult from '#models/draft_layer_apply_result'
import Project from '#models/project'
import Task from '#models/task'
import WbsNode from '#models/wbs_node'
import Milestone from '#models/milestone'
import type {
  DraftLayerApplyEntityCounts,
  DraftLayerApplyEntityReceipt,
  DraftLayerApplyOperation,
} from '@aiproj/types'
import { buildApplyIdempotencyKey } from '@aiproj/types'
import { computeSelectionHash } from '@aiproj/types'
import { writeTrizDeliveryLinksForConfirmedApply } from '#services/triz_delivery_loop/apply_link_writer'
import { DateTime } from 'luxon'

export class ApplyValidationError extends Error {
  constructor(
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApplyValidationError'
  }
}

interface ApplyParams {
  sessionId: number
  organizationId: number
  userId: number
  idempotencyKey?: string
}

@inject()
export class DraftLayerApplyService {
  /**
   * 执行事务性 apply。
   * 校验：draftVersion、selectionHash、previewHash、applyPlanHash、actor。
   */
  async apply(params: ApplyParams): Promise<DraftLayerApplyResult> {
    const { sessionId, organizationId, userId } = params
    const key = params.idempotencyKey

    const session = await DraftLayerSession.forOrganization(organizationId)
      .where('id', sessionId)
      .first()
    if (!session) throw new ApplyValidationError('Session 不存在')
    if (session.status === 'applied') throw new ApplyValidationError('该草案已应用')

    const allChanges = await DraftLayerChange.query()
      .where('session_id', sessionId)
      .orderBy('sequence', 'asc')

    const latestPreview = await DraftLayerPreview.query()
      .where('session_id', sessionId)
      .orderBy('version', 'desc')
      .first()

    if (!latestPreview) throw new ApplyValidationError('尚无 Preview')

    // 计算 hash
    const decisions = allChanges.map((c) => ({
      changeId: c.id,
      reviewStatus: c.reviewStatus,
      userModifiedValue: c.userModifiedValue,
    }))
    const selectionHash = computeSelectionHash(decisions)

    const acceptedChanges = allChanges.filter(
      (c) => c.reviewStatus === 'accepted' || c.reviewStatus === 'modified',
    )

    const operations: DraftLayerApplyOperation[] = acceptedChanges.map((change, index) => ({
      entityType: change.targetEntityType as DraftLayerApplyOperation['entityType'],
      operation: change.operation as DraftLayerApplyOperation['operation'],
      fields: change.userModifiedValue
        ? (change.userModifiedValue as Record<string, unknown>)
        : (change.value as Record<string, unknown>),
      tempId: change.targetEntityId,
      order: index + 1,
    }))

    const operationsDigest = operations
      .map((o) => `${o.entityType}:${o.operation}:${o.tempId}`)
      .sort()
      .join(',')
    const { computeApplyPlanHash } = await import('@aiproj/types')
    const applyPlanHash = computeApplyPlanHash(
      selectionHash,
      latestPreview.previewHash,
      operationsDigest,
    )

    // 幂等键
    const idempotencyKey =
      key ??
      buildApplyIdempotencyKey({
        sessionId: session.id,
        version: session.version,
        selectionHash,
        previewHash: latestPreview.previewHash,
        applyPlanHash,
        actorUserId: userId,
      })

    // 幂等检查
    // v3-multitenant-database-isolation §5.4：必须按 session 归属 scope（该表无
    // organization_id，catalog 声明的父级链是 session_id → ai_draft_layer_sessions）。
    // 原实现只按 idempotency_key 全局查，而 key 可由客户端提供（params.idempotencyKey），
    // 因此他租的 apply 结果（projectId / entityCounts / status）可被直接读出。
    // 唯一索引同步为 (session_id, idempotency_key)，见迁移 1839300000002。
    const existing = await DraftLayerApplyResult.query()
      .where('session_id', session.id)
      .where('idempotency_key', idempotencyKey)
      .first()
    if (existing) {
      return existing
    }

    // 状态检查
    if (session.status !== 'reviewing' && session.status !== 'previewing') {
      throw new ApplyValidationError(
        `Session 状态 ${session.status} 不允许 Apply，需先通过 dry-run`,
      )
    }

    // 必须有 accepted 变更
    if (acceptedChanges.length === 0) {
      throw new ApplyValidationError('没有已接受的变更项')
    }

    // 事务性 apply
    try {
      const result = await db.transaction(async (trx) => {
        let projectId: number | null = null
        // v3-triz-to-delivery-closed-loop（task 4.1/4.2）：逐实体 typed receipt。
        const receipts: DraftLayerApplyEntityReceipt[] = []
        const changeIdByTempId = new Map(
          acceptedChanges.map((c) => [c.targetEntityId, c.id] as const),
        )
        const pushReceipt = (
          entityType: DraftLayerApplyEntityReceipt['entityType'],
          entityId: number | string,
          tempId: string,
        ) => {
          const sourceChangeId = changeIdByTempId.get(tempId)
          if (sourceChangeId === undefined) return
          receipts.push({
            entityType,
            entityId: String(entityId),
            sourceChangeId,
            tempId,
          })
        }

        // 1. 创建项目
        const projectOp = operations.find((o) => o.entityType === 'project')
        if (projectOp) {
          const project = await Project.create(
            {
              organizationId,
              name: (projectOp.fields.name as string) ?? 'AI 生成项目',
              description: (projectOp.fields.description as string) ?? null,
              status: 'planning',
              priority: 'medium',
              createdBy: userId,
              settings: { source: 'ai_draft_layer' },
            },
            { client: trx },
          )
          projectId = project.id
          pushReceipt('project', project.id, projectOp.tempId)
        }

        // 2. 创建 WBS nodes
        const wbsOps = operations.filter((o) => o.entityType === 'wbs_node')
        for (const op of wbsOps) {
          if (!projectId) continue
          const wbs = await WbsNode.create(
            {
              projectId,
              parentId: null,
              path: null,
              code: null,
              name: (op.fields.name as string) ?? 'WBS 节点',
              depth: 0,
              isLeaf: true,
              collapsed: false,
              displayOrder: op.order,
              taskId: null,
            },
            { client: trx },
          )
          pushReceipt('wbs_node', wbs.id, op.tempId)
        }

        // 3. 创建 Tasks
        const taskOps = operations.filter((o) => o.entityType === 'task')
        for (const op of taskOps) {
          if (!projectId) continue
          const task = await Task.create(
            {
              projectId,
              name: (op.fields.name as string) ?? '任务',
              description: null,
              status: 'not_started',
              priority: 'medium',
              taskType: 'task',
              startDate: null,
              endDate: null,
              durationDays: (op.fields.durationDays as number) ?? 1,
            },
            { client: trx },
          )
          pushReceipt('task', task.id, op.tempId)
        }

        // 4. 创建 Milestones
        const msOps = operations.filter((o) => o.entityType === 'milestone')
        for (const op of msOps) {
          if (!projectId) continue
          const milestone = await Milestone.create(
            {
              projectId,
              name: (op.fields.name as string) ?? '里程碑',
              status: 'not_started',
              plannedDate: null,
              autoCalculated: true,
              displayOrder: op.order,
            },
            { client: trx },
          )
          pushReceipt('milestone', milestone.id, op.tempId)
        }

        // entity 计数
        const entityCounts: DraftLayerApplyEntityCounts = {
          projects: projectOp ? 1 : 0,
          wbsNodes: wbsOps.length,
          tasks: taskOps.length,
          dependencies: operations.filter((o) => o.entityType === 'dependency').length,
          milestones: msOps.length,
          acceptanceCriteria: operations.filter((o) => o.entityType === 'acceptance_criterion')
            .length,
          risks: operations.filter((o) => o.entityType === 'risk').length,
          resources: operations.filter((o) => o.entityType === 'resource').length,
        }

        // 回填 session
        session.status = 'applied'
        session.version = session.version + 1
        session.useTransaction(trx)
        await session.save()

        // 创建 apply result（同事务带 typed receipt，task 4.2）
        const applyResult = await DraftLayerApplyResult.create(
          {
            sessionId,
            applyPlanHash,
            selectionHash,
            status: 'applied' as const,
            projectId,
            entityCounts,
            errorSummary: null,
            idempotencyKey,
            appliedAt: DateTime.now(),
            entityRefs: receipts.length > 0 ? receipts : [],
          },
          { client: trx },
        )

        // v3-triz-to-delivery-closed-loop（task 4.3/4.4）：TRIZ 来源会话在同一事务内
        // 解析 decision attribution 并幂等写闭环 link；任何失败整体回滚（无 orphan link）。
        await writeTrizDeliveryLinksForConfirmedApply({
          trx,
          organizationId,
          actorUserId: userId,
          sessionSource: session.sourceType,
          sessionMetadata: session.metadata,
          appliedProjectId: projectId,
          applyResultId: applyResult.id,
          receiptList: receipts,
        })

        return applyResult
      })

      return result
    } catch (error) {
      // 失败时创建 failed apply result
      const errorMessage = error instanceof Error ? error.message : String(error)
      await DraftLayerApplyResult.create({
        sessionId,
        applyPlanHash,
        selectionHash,
        status: 'failed' as const,
        projectId: null,
        entityCounts: null,
        errorSummary: errorMessage,
        idempotencyKey,
        appliedAt: null,
      })

      session.status = 'previewing'
      await session.save()

      throw new ApplyValidationError(`Apply 失败：${errorMessage}`)
    }
  }
}
