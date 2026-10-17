/**
 * v3-copilot-suggestion-inbox — 状态管理服务（任务 6.1–6.10）
 *
 * 五态生命周期管理：
 * - unread → read：查看即已读（显式 mark_read）
 * - read → adopted：显式采纳（走 preview 通道，无直写）
 * - read → dismissed：显式忽略
 * - unread/read → expired：source hash 失配自动过期
 * - 终态：adopted / dismissed / expired 不可迁移
 *
 * 禁止隐式状态推断（不看不点不产生忽略）。
 * 采纳必经已归档动作边界的 preview → diff → dry-run → 确认 → apply。
 * 采纳/忽略/过期产出反馈事件，标记为 inbox 来源。
 */

import type { InboxEntry, InboxEntryState, InboxAction } from '@aiproj/types'
import { canInboxTransition, INBOX_FEEDBACK_ORIGIN } from '@aiproj/types'
import { CopilotActionBoundaryAdoptionRouter } from './inbox_adoption_router.js'

/**
 * 状态变更结果。
 */
export interface InboxStateChangeResult {
  success: boolean
  previousState: InboxEntryState
  newState: InboxEntryState
  /** 采纳时产生的 preview session ID（供前端跳转） */
  previewSessionId?: string
  /** 反馈事件（供 feedback ledger 消费） */
  feedbackEvent?: InboxFeedbackEvent
  error?: string
}

/**
 * 反馈事件（inbox 来源标记）。
 */
export interface InboxFeedbackEvent {
  origin: 'inbox_suggestion'
  action: InboxAction
  entryId: string
  problemKind: string
  severity: string
  timestamp: string
}

/**
 * 采纳动作路由器接口。
 * 复用已归档动作边界的 preview 通道。
 */
export interface InboxAdoptionRouter {
  /**
   * 启动采纳 preview 流程。
   * 必须走 preview → diff → dry-run → 确认 → apply。
   * 不直接修改领域数据。
   */
  startAdoptionPreview(params: {
    entryId: string
    sourceRefs: readonly { sourceKind: string; sourceId: string }[]
    organizationId: number
    projectId: number
    actorId: number
  }): Promise<{ sessionId: string }>
}

/**
 * 状态管理服务。
 */
export class InboxStateService {
  constructor(
    private adoptionRouter: InboxAdoptionRouter = new CopilotActionBoundaryAdoptionRouter(),
  ) {}

  /**
   * 标记已读（查看即已读）。
   */
  markRead(entry: InboxEntry): InboxStateChangeResult {
    if (!canInboxTransition(entry.state, 'read')) {
      return {
        success: false,
        previousState: entry.state,
        newState: entry.state,
        error: `Cannot transition from "${entry.state}" to "read"`,
      }
    }
    return {
      success: true,
      previousState: entry.state,
      newState: 'read',
    }
  }

  /**
   * 显式忽略（须显式用户动作）。
   */
  dismiss(entry: InboxEntry): InboxStateChangeResult {
    if (!canInboxTransition(entry.state, 'dismissed')) {
      return {
        success: false,
        previousState: entry.state,
        newState: entry.state,
        error: `Cannot transition from "${entry.state}" to "dismissed"`,
      }
    }
    return {
      success: true,
      previousState: entry.state,
      newState: 'dismissed',
      feedbackEvent: this.buildFeedbackEvent('dismiss', entry),
    }
  }

  /**
   * 显式采纳（必经 preview 通道，无直写）。
   */
  async adopt(
    entry: InboxEntry,
    params: {
      organizationId: number
      projectId: number
      actorId: number
    },
  ): Promise<InboxStateChangeResult> {
    if (!canInboxTransition(entry.state, 'adopted')) {
      return {
        success: false,
        previousState: entry.state,
        newState: entry.state,
        error: `Cannot transition from "${entry.state}" to "adopted"`,
      }
    }

    // 必须走 preview 通道
    const preview = await this.adoptionRouter.startAdoptionPreview({
      entryId: entry.id,
      sourceRefs: entry.sourceRefs,
      organizationId: params.organizationId,
      projectId: params.projectId,
      actorId: params.actorId,
    })

    return {
      success: true,
      previousState: entry.state,
      newState: 'adopted',
      previewSessionId: preview.sessionId,
      feedbackEvent: this.buildFeedbackEvent('adopt', entry),
    }
  }

  /**
   * 过期（source hash 失配自动触发）。
   */
  expire(entry: InboxEntry): InboxStateChangeResult {
    if (!canInboxTransition(entry.state, 'expired')) {
      return {
        success: false,
        previousState: entry.state,
        newState: entry.state,
        error: `Cannot transition from "${entry.state}" to "expired"`,
      }
    }
    return {
      success: true,
      previousState: entry.state,
      newState: 'expired',
      feedbackEvent: this.buildFeedbackEvent('dismiss', entry),
    }
  }

  /**
   * 构建反馈事件（inbox 来源标记，供区分主动建议与会话内建议采纳率）。
   */
  private buildFeedbackEvent(action: InboxAction, entry: InboxEntry): InboxFeedbackEvent {
    return {
      origin: INBOX_FEEDBACK_ORIGIN,
      action,
      entryId: entry.id,
      problemKind: entry.problemKind,
      severity: entry.severity,
      timestamp: new Date().toISOString(),
    }
  }
}
