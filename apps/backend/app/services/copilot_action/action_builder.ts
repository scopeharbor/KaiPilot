/**
 * v3-copilot-action-and-preview-boundary —— CopilotActionBuilder（任务 3.1/3.2）。
 *
 * 把 Copilot 建议物化为草案层 session 与 change set（sourceType='v3_copilot_action'）。
 *
 * 红线（任务 3.2 / spec Requirement 1）：
 * - 本文件**只导入草案层模型**（DraftLayerSession / DraftLayerChange）——通道本身；
 * - **禁止导入任何领域仓储或模型写入 API**（Project/Task/WbsNode/Milestone/Risk/Resource 等）；
 *   该约束由源码级 import 守卫测试钉死（tests/unit/copilot_action_builder.spec.ts）；
 * - 未经确认提交动作 → 零领域写入（本 service 只写草案态行）。
 */
import { inject } from '@adonisjs/core'
import DraftLayerSession from '#models/draft_layer_session'
import DraftLayerChange from '#models/draft_layer_change'
import {
  buildCopilotActionChangeRows,
  buildCopilotActionSessionPayload,
  deriveCopilotActionSessionHash,
  type CopilotActionMaterializeInput,
} from './action_builder_core.js'

export class CopilotActionBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CopilotActionBuildError'
  }
}

export interface CopilotActionMaterializeResult {
  readonly session: DraftLayerSession
  readonly changes: DraftLayerChange[]
}

@inject()
export class CopilotActionBuilder {
  /**
   * 物化 Copilot 动作：创建草案层会话 + change set。
   * 只写 ai_draft_layer_sessions / ai_draft_layer_changes；不写任何正式业务表。
   * 未映射目标引用 → 整体拒绝（不静默丢弃，无绕过路径）。
   */
  async materializeAction(
    input: CopilotActionMaterializeInput,
  ): Promise<CopilotActionMaterializeResult> {
    const { rows, unmappedRefs } = buildCopilotActionChangeRows(input.changeInputs)
    if (unmappedRefs.length > 0) {
      throw new CopilotActionBuildError(
        `动作包含无法映射的目标引用（${unmappedRefs.length} 项），已拒绝物化`,
      )
    }

    const pdmHash = deriveCopilotActionSessionHash(
      input.normalizedActionInput,
      input.idempotencyKey,
      input.changeInputs.map((c) => c.targetRef),
    )
    const sessionPayload = buildCopilotActionSessionPayload(input, rows.length, pdmHash)

    const session = await DraftLayerSession.create(sessionPayload)

    const changes: DraftLayerChange[] = []
    for (const row of rows) {
      const change = await DraftLayerChange.create({
        sessionId: session.id,
        targetEntityType: row.targetEntityType,
        targetEntityId: row.targetEntityId,
        targetFieldPath: row.targetFieldPath,
        operation: row.operation,
        value: row.value,
        oldValue: row.oldValue,
        reviewStatus: row.reviewStatus,
        userModifiedValue: row.userModifiedValue,
        userNote: row.userNote,
        sequence: row.sequence,
        dependsOn: [...row.dependsOn],
        confidence: row.confidence,
        validationSummary: row.validationSummary,
      })
      changes.push(change)
    }

    return { session, changes }
  }
}
