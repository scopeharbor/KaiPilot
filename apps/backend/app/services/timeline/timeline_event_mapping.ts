/**
 * AuditEventType → Timeline 显式 allowlist 映射表。
 *
 * 规则：
 * - 仅映射表中声明的事件可进入 Timeline
 * - 未知 / 未声明事件默认 hidden
 * - 摘要由 summaryBuilder 生成中文短语，禁止回退为原始 event code
 */

import { AuditEvent, type AuditEventType } from '#services/audit_service'
import type {
  TimelineCategory,
  TimelineImportance,
  TimelineVisibility,
} from '#types/timeline_event'

/** TASK_UPDATED 纳入 Timeline 的用户可感知字段白名单（task 1.7）。 */
export const TASK_UPDATED_IMPORTANT_FIELDS = new Set([
  'startDate',
  'endDate',
  'priority',
  'assigneeId',
  'progressPercent',
  'status',
  'estimatedHours',
  'dueDate',
])

export interface TimelineMappingContext {
  objectLabel: string | null
  changedFields?: string[]
  actorDisplayName?: string
}

export interface TimelineEventMapping {
  eventType: string
  verb: string
  category: TimelineCategory
  importance: TimelineImportance
  visibility: TimelineVisibility
  objectType: string
  isKeyEvent: boolean
  /** 生成中文摘要；不得返回原始 event code。 */
  summaryBuilder: (ctx: TimelineMappingContext) => string
  secondaryBuilder?: (ctx: TimelineMappingContext) => string | null
  /**
   * 可选：额外门控（例如 TASK_UPDATED 仅重要字段）。
   * 返回 false 时视为 hidden（不进入 Timeline）。
   */
  includeWhen?: (meta: Record<string, unknown> | null | undefined) => boolean
}

function labelOrFallback(label: string | null, fallback: string): string {
  const t = label?.trim()
  return t && t.length > 0 ? t : fallback
}

function taskSummary(action: string, ctx: TimelineMappingContext): string {
  return `${action}${labelOrFallback(ctx.objectLabel, '任务')}`
}

/**
 * P0 可见 + 管理员可见 + 显式 hidden 的完整映射。
 * 未出现在本表的 AuditEvent 一律按未知事件处理（hidden）。
 */
export const TIMELINE_EVENT_MAPPINGS: Partial<Record<AuditEventType, TimelineEventMapping>> = {
  // —— 项目（项目成员可见）——
  [AuditEvent.PROJECT_CREATED]: {
    eventType: AuditEvent.PROJECT_CREATED,
    verb: 'created',
    category: 'project',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'project',
    isKeyEvent: true,
    summaryBuilder: () => '创建了项目',
  },
  [AuditEvent.PROJECT_UPDATED]: {
    eventType: AuditEvent.PROJECT_UPDATED,
    verb: 'updated',
    category: 'project',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'project',
    isKeyEvent: false,
    summaryBuilder: () => '更新了项目信息',
  },
  [AuditEvent.PROJECT_ARCHIVED]: {
    eventType: AuditEvent.PROJECT_ARCHIVED,
    verb: 'archived',
    category: 'project',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'project',
    isKeyEvent: true,
    summaryBuilder: () => '归档了项目',
  },
  [AuditEvent.PROJECT_RESTORED]: {
    eventType: AuditEvent.PROJECT_RESTORED,
    verb: 'restored',
    category: 'project',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'project',
    isKeyEvent: true,
    summaryBuilder: () => '恢复了项目',
  },
  [AuditEvent.PROJECT_WORKING_CALENDAR_UPDATED]: {
    eventType: AuditEvent.PROJECT_WORKING_CALENDAR_UPDATED,
    verb: 'updated',
    category: 'project',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'project',
    isKeyEvent: false,
    summaryBuilder: () => '更新了工作日历',
  },

  // —— 项目成员（默认管理员可见）——
  [AuditEvent.PROJECT_MEMBER_ADDED]: {
    eventType: AuditEvent.PROJECT_MEMBER_ADDED,
    verb: 'added',
    category: 'member',
    importance: 'normal',
    visibility: 'admin',
    objectType: 'project_member',
    isKeyEvent: false,
    summaryBuilder: () => '添加了项目成员',
  },
  [AuditEvent.PROJECT_MEMBER_ROLE_CHANGED]: {
    eventType: AuditEvent.PROJECT_MEMBER_ROLE_CHANGED,
    verb: 'role_changed',
    category: 'member',
    importance: 'normal',
    visibility: 'admin',
    objectType: 'project_member',
    isKeyEvent: false,
    summaryBuilder: () => '变更了成员角色',
  },
  [AuditEvent.PROJECT_MEMBER_REMOVED]: {
    eventType: AuditEvent.PROJECT_MEMBER_REMOVED,
    verb: 'removed',
    category: 'member',
    importance: 'normal',
    visibility: 'admin',
    objectType: 'project_member',
    isKeyEvent: false,
    summaryBuilder: () => '移除了项目成员',
  },
  [AuditEvent.PROJECT_OWNER_TRANSFERRED]: {
    eventType: AuditEvent.PROJECT_OWNER_TRANSFERRED,
    verb: 'transferred',
    category: 'member',
    importance: 'high',
    visibility: 'admin',
    objectType: 'project',
    isKeyEvent: true,
    summaryBuilder: () => '转移了项目所有权',
  },

  // —— 任务 / WBS / 依赖 / 甘特 ——
  [AuditEvent.TASK_CREATED]: {
    eventType: AuditEvent.TASK_CREATED,
    verb: 'created',
    category: 'task',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'task',
    isKeyEvent: false,
    summaryBuilder: (ctx) => taskSummary('创建了任务「', ctx) + '」',
  },
  [AuditEvent.TASK_ASSIGNED]: {
    eventType: AuditEvent.TASK_ASSIGNED,
    verb: 'assigned',
    category: 'task',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'task',
    isKeyEvent: false,
    summaryBuilder: (ctx) => taskSummary('指派了任务「', ctx) + '」',
  },
  [AuditEvent.TASK_STATUS_CHANGED]: {
    eventType: AuditEvent.TASK_STATUS_CHANGED,
    verb: 'status_changed',
    category: 'task',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'task',
    isKeyEvent: true,
    summaryBuilder: (ctx) => taskSummary('变更了任务状态「', ctx) + '」',
  },
  [AuditEvent.TASK_UPDATED]: {
    eventType: AuditEvent.TASK_UPDATED,
    verb: 'updated',
    category: 'task',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'task',
    isKeyEvent: false,
    includeWhen: (meta) => {
      const changed = meta?.changed
      if (!Array.isArray(changed) || changed.length === 0) return false
      return changed.some((f) => typeof f === 'string' && TASK_UPDATED_IMPORTANT_FIELDS.has(f))
    },
    summaryBuilder: (ctx) => {
      const fields = ctx.changedFields ?? []
      const important = fields.filter((f) => TASK_UPDATED_IMPORTANT_FIELDS.has(f))
      const fieldHint =
        important.length > 0
          ? `（${important
              .slice(0, 3)
              .map((f) => TASK_FIELD_LABELS[f] ?? '信息')
              .join('、')}）`
          : ''
      return `更新了任务「${labelOrFallback(ctx.objectLabel, '任务')}」${fieldHint}`
    },
  },
  [AuditEvent.TASK_RESTORED]: {
    eventType: AuditEvent.TASK_RESTORED,
    verb: 'restored',
    category: 'task',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'task',
    isKeyEvent: false,
    summaryBuilder: (ctx) => taskSummary('恢复了任务「', ctx) + '」',
  },
  [AuditEvent.WBS_NODE_CREATED]: {
    eventType: AuditEvent.WBS_NODE_CREATED,
    verb: 'created',
    category: 'wbs',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'wbs_node',
    isKeyEvent: false,
    summaryBuilder: (ctx) => `创建了 WBS 节点「${labelOrFallback(ctx.objectLabel, '节点')}」`,
  },
  [AuditEvent.WBS_NODE_MOVED]: {
    eventType: AuditEvent.WBS_NODE_MOVED,
    verb: 'moved',
    category: 'wbs',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'wbs_node',
    isKeyEvent: false,
    summaryBuilder: (ctx) => `移动了 WBS 节点「${labelOrFallback(ctx.objectLabel, '节点')}」`,
  },
  [AuditEvent.DEPENDENCY_CREATED]: {
    eventType: AuditEvent.DEPENDENCY_CREATED,
    verb: 'created',
    category: 'dependency',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'dependency',
    isKeyEvent: false,
    summaryBuilder: () => '创建了任务依赖',
  },
  [AuditEvent.DEPENDENCY_DELETED]: {
    eventType: AuditEvent.DEPENDENCY_DELETED,
    verb: 'deleted',
    category: 'dependency',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'dependency',
    isKeyEvent: false,
    summaryBuilder: () => '删除了任务依赖',
  },
  [AuditEvent.GANTT_SCHEDULE_COMMITTED]: {
    eventType: AuditEvent.GANTT_SCHEDULE_COMMITTED,
    verb: 'committed',
    category: 'gantt',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'gantt',
    isKeyEvent: true,
    summaryBuilder: () => '提交了甘特排程调整',
  },
  [AuditEvent.GANTT_BASELINE_SAVED]: {
    eventType: AuditEvent.GANTT_BASELINE_SAVED,
    verb: 'saved',
    category: 'gantt',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'gantt',
    isKeyEvent: true,
    summaryBuilder: () => '保存了甘特基线',
  },

  // —— 里程碑 ——
  [AuditEvent.MILESTONE_CREATED]: {
    eventType: AuditEvent.MILESTONE_CREATED,
    verb: 'created',
    category: 'milestone',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'milestone',
    isKeyEvent: false,
    summaryBuilder: (ctx) => `创建了里程碑「${labelOrFallback(ctx.objectLabel, '里程碑')}」`,
  },
  [AuditEvent.MILESTONE_UPDATED]: {
    eventType: AuditEvent.MILESTONE_UPDATED,
    verb: 'updated',
    category: 'milestone',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'milestone',
    isKeyEvent: false,
    summaryBuilder: (ctx) => `更新了里程碑「${labelOrFallback(ctx.objectLabel, '里程碑')}」`,
  },
  [AuditEvent.MILESTONE_ACHIEVED]: {
    eventType: AuditEvent.MILESTONE_ACHIEVED,
    verb: 'achieved',
    category: 'milestone',
    importance: 'critical',
    visibility: 'project_member',
    objectType: 'milestone',
    isKeyEvent: true,
    summaryBuilder: (ctx) => `达成了里程碑「${labelOrFallback(ctx.objectLabel, '里程碑')}」`,
  },

  // —— 风险 ——
  [AuditEvent.RISK_CREATED]: {
    eventType: AuditEvent.RISK_CREATED,
    verb: 'created',
    category: 'risk',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'risk',
    isKeyEvent: true,
    summaryBuilder: (ctx) => `登记了风险「${labelOrFallback(ctx.objectLabel, '风险')}」`,
  },
  [AuditEvent.RISK_STATUS_CHANGED]: {
    eventType: AuditEvent.RISK_STATUS_CHANGED,
    verb: 'status_changed',
    category: 'risk',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'risk',
    isKeyEvent: true,
    summaryBuilder: (ctx) => `变更了风险状态「${labelOrFallback(ctx.objectLabel, '风险')}」`,
  },
  [AuditEvent.RISK_AI_ACCEPTED]: {
    eventType: AuditEvent.RISK_AI_ACCEPTED,
    verb: 'accepted',
    category: 'risk',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'risk',
    isKeyEvent: true,
    summaryBuilder: () => '采纳了 AI 风险建议',
  },
  [AuditEvent.RISK_AI_REJECTED]: {
    eventType: AuditEvent.RISK_AI_REJECTED,
    verb: 'rejected',
    category: 'risk',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'risk',
    isKeyEvent: false,
    summaryBuilder: () => '忽略了 AI 风险建议',
  },

  // —— 变更请求 ——
  [AuditEvent.CHANGE_REQUEST_SUBMITTED]: {
    eventType: AuditEvent.CHANGE_REQUEST_SUBMITTED,
    verb: 'submitted',
    category: 'change_request',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'change_request',
    isKeyEvent: true,
    summaryBuilder: (ctx) => `提交了变更请求「${labelOrFallback(ctx.objectLabel, '变更')}」`,
  },
  [AuditEvent.CHANGE_REQUEST_APPROVED]: {
    eventType: AuditEvent.CHANGE_REQUEST_APPROVED,
    verb: 'approved',
    category: 'change_request',
    importance: 'critical',
    visibility: 'project_member',
    objectType: 'change_request',
    isKeyEvent: true,
    summaryBuilder: (ctx) => `批准了变更请求「${labelOrFallback(ctx.objectLabel, '变更')}」`,
  },
  [AuditEvent.CHANGE_REQUEST_REJECTED]: {
    eventType: AuditEvent.CHANGE_REQUEST_REJECTED,
    verb: 'rejected',
    category: 'change_request',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'change_request',
    isKeyEvent: true,
    summaryBuilder: (ctx) => `驳回了变更请求「${labelOrFallback(ctx.objectLabel, '变更')}」`,
  },
  [AuditEvent.CHANGE_REQUEST_RETURNED]: {
    eventType: AuditEvent.CHANGE_REQUEST_RETURNED,
    verb: 'returned',
    category: 'change_request',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'change_request',
    isKeyEvent: false,
    summaryBuilder: (ctx) => `退回了变更请求「${labelOrFallback(ctx.objectLabel, '变更')}」`,
  },
  [AuditEvent.CHANGE_REQUEST_IMPLEMENTED]: {
    eventType: AuditEvent.CHANGE_REQUEST_IMPLEMENTED,
    verb: 'implemented',
    category: 'change_request',
    importance: 'critical',
    visibility: 'project_member',
    objectType: 'change_request',
    isKeyEvent: true,
    summaryBuilder: (ctx) => `实施了变更请求「${labelOrFallback(ctx.objectLabel, '变更')}」`,
  },
  [AuditEvent.CHANGE_REQUEST_CLOSED]: {
    eventType: AuditEvent.CHANGE_REQUEST_CLOSED,
    verb: 'closed',
    category: 'change_request',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'change_request',
    isKeyEvent: false,
    summaryBuilder: (ctx) => `关闭了变更请求「${labelOrFallback(ctx.objectLabel, '变更')}」`,
  },
  [AuditEvent.CHANGE_REQUEST_CANCELLED]: {
    eventType: AuditEvent.CHANGE_REQUEST_CANCELLED,
    verb: 'cancelled',
    category: 'change_request',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'change_request',
    isKeyEvent: false,
    summaryBuilder: (ctx) => `取消了变更请求「${labelOrFallback(ctx.objectLabel, '变更')}」`,
  },

  // —— 变更影响分析（v2-change-management-impact-analysis §9.1）——
  // 低敏事件：仅摘要 + 证据引用进入 Timeline，不透传影响项/规则证据正文。
  [AuditEvent.CHANGE_IMPACT_ANALYSIS_CREATED]: {
    eventType: AuditEvent.CHANGE_IMPACT_ANALYSIS_CREATED,
    verb: 'created',
    category: 'change_request',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'change_impact_analysis',
    isKeyEvent: false,
    summaryBuilder: () => '生成了变更影响分析',
  },
  [AuditEvent.CHANGE_IMPACT_ANALYSIS_REFRESHED]: {
    eventType: AuditEvent.CHANGE_IMPACT_ANALYSIS_REFRESHED,
    verb: 'refreshed',
    category: 'change_request',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'change_impact_analysis',
    isKeyEvent: false,
    summaryBuilder: () => '刷新了变更影响分析',
  },
  [AuditEvent.CHANGE_IMPACT_ANALYSIS_CONFIRMED]: {
    eventType: AuditEvent.CHANGE_IMPACT_ANALYSIS_CONFIRMED,
    verb: 'confirmed',
    category: 'change_request',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'change_impact_analysis',
    isKeyEvent: false,
    summaryBuilder: () => '确认了变更影响分析',
  },
  [AuditEvent.CHANGE_IMPACT_ANALYSIS_CONFIRMED_STALE]: {
    eventType: AuditEvent.CHANGE_IMPACT_ANALYSIS_CONFIRMED_STALE,
    verb: 'confirmed',
    category: 'change_request',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'change_impact_analysis',
    isKeyEvent: false,
    summaryBuilder: () => '确认继续使用已过期的变更影响分析',
  },
  [AuditEvent.CHANGE_IMPACT_ANALYSIS_STALE_DETECTED]: {
    eventType: AuditEvent.CHANGE_IMPACT_ANALYSIS_STALE_DETECTED,
    verb: 'flagged',
    category: 'change_request',
    importance: 'low',
    visibility: 'project_member',
    objectType: 'change_impact_analysis',
    isKeyEvent: false,
    summaryBuilder: () => '标记变更影响分析为已过期',
  },
  [AuditEvent.CHANGE_IMPACT_AI_EXPLANATION_GENERATED]: {
    eventType: AuditEvent.CHANGE_IMPACT_AI_EXPLANATION_GENERATED,
    verb: 'generated',
    category: 'change_request',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'change_impact_analysis',
    isKeyEvent: false,
    summaryBuilder: () => '生成了变更影响的 AI 解释建议（待确认）',
  },
  [AuditEvent.CHANGE_IMPACT_APPROVE_REFERENCED]: {
    eventType: AuditEvent.CHANGE_IMPACT_APPROVE_REFERENCED,
    verb: 'referenced',
    category: 'change_request',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'change_impact_analysis',
    isKeyEvent: true,
    summaryBuilder: () => '审批时引用了变更影响分析作为决策证据',
  },

  // —— 文件 / 附件 / 图表 / 报表 ——
  [AuditEvent.DOCUMENT_CREATED]: {
    eventType: AuditEvent.DOCUMENT_CREATED,
    verb: 'created',
    category: 'document',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'document',
    isKeyEvent: false,
    summaryBuilder: (ctx) => `创建了文档「${labelOrFallback(ctx.objectLabel, '文档')}」`,
  },
  [AuditEvent.DOCUMENT_UPDATED]: {
    eventType: AuditEvent.DOCUMENT_UPDATED,
    verb: 'updated',
    category: 'document',
    importance: 'low',
    visibility: 'project_member',
    objectType: 'document',
    isKeyEvent: false,
    summaryBuilder: (ctx) => `更新了文档「${labelOrFallback(ctx.objectLabel, '文档')}」`,
  },
  [AuditEvent.ATTACHMENT_UPLOADED]: {
    eventType: AuditEvent.ATTACHMENT_UPLOADED,
    verb: 'uploaded',
    category: 'attachment',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'attachment',
    isKeyEvent: false,
    summaryBuilder: (ctx) => `上传了附件「${labelOrFallback(ctx.objectLabel, '附件')}」`,
  },
  [AuditEvent.DIAGRAM_CREATED]: {
    eventType: AuditEvent.DIAGRAM_CREATED,
    verb: 'created',
    category: 'diagram',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'diagram',
    isKeyEvent: false,
    summaryBuilder: (ctx) => `创建了图表「${labelOrFallback(ctx.objectLabel, '图表')}」`,
  },
  [AuditEvent.DIAGRAM_EXPORTED]: {
    eventType: AuditEvent.DIAGRAM_EXPORTED,
    verb: 'exported',
    category: 'diagram',
    importance: 'low',
    visibility: 'project_member',
    objectType: 'diagram',
    isKeyEvent: false,
    summaryBuilder: () => '导出了图表',
  },
  [AuditEvent.REPORT_GENERATED]: {
    eventType: AuditEvent.REPORT_GENERATED,
    verb: 'generated',
    category: 'report',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'report',
    isKeyEvent: false,
    summaryBuilder: () => '生成了项目报表',
  },
  [AuditEvent.REPORT_EXPORTED]: {
    eventType: AuditEvent.REPORT_EXPORTED,
    verb: 'exported',
    category: 'report',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'report',
    isKeyEvent: false,
    summaryBuilder: () => '导出了项目报表',
  },

  // —— 评论 ——
  [AuditEvent.COMMENT_CREATED]: {
    eventType: AuditEvent.COMMENT_CREATED,
    verb: 'commented',
    category: 'comment',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'comment',
    isKeyEvent: false,
    summaryBuilder: () => '发表了评论',
    secondaryBuilder: () => '评论内容请在详情中查看',
  },
  [AuditEvent.COMMENT_REPLIED]: {
    eventType: AuditEvent.COMMENT_REPLIED,
    verb: 'replied',
    category: 'comment',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'comment',
    isKeyEvent: false,
    summaryBuilder: () => '回复了评论',
  },
  [AuditEvent.COMMENT_RESOLVED]: {
    eventType: AuditEvent.COMMENT_RESOLVED,
    verb: 'resolved',
    category: 'comment',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'comment',
    isKeyEvent: true,
    summaryBuilder: () => '解决了评论线程',
  },
  [AuditEvent.COMMENT_REOPENED]: {
    eventType: AuditEvent.COMMENT_REOPENED,
    verb: 'reopened',
    category: 'comment',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'comment',
    isKeyEvent: false,
    summaryBuilder: () => '重新打开了评论线程',
  },
  [AuditEvent.COMMENT_MENTIONED]: {
    eventType: AuditEvent.COMMENT_MENTIONED,
    verb: 'mentioned',
    category: 'comment',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'comment',
    isKeyEvent: true,
    summaryBuilder: () => '在评论中提到了',
  },

  // —— AI 草案 / Draft Layer 用户可感知 ——
  [AuditEvent.AI_DRAFT_GENERATED]: {
    eventType: AuditEvent.AI_DRAFT_GENERATED,
    verb: 'generated',
    category: 'ai_draft',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'ai_draft',
    isKeyEvent: true,
    summaryBuilder: () => '生成了 AI 项目草案',
  },
  [AuditEvent.AI_DRAFT_FAILED]: {
    eventType: AuditEvent.AI_DRAFT_FAILED,
    verb: 'failed',
    category: 'ai_draft',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'ai_draft',
    isKeyEvent: true,
    summaryBuilder: () => 'AI 草案生成失败',
  },
  [AuditEvent.AI_DRAFT_SAVED]: {
    eventType: AuditEvent.AI_DRAFT_SAVED,
    verb: 'saved',
    category: 'ai_draft',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'ai_draft',
    isKeyEvent: false,
    summaryBuilder: () => '保存了 AI 草案',
  },
  [AuditEvent.AI_DRAFT_REJECTED]: {
    eventType: AuditEvent.AI_DRAFT_REJECTED,
    verb: 'rejected',
    category: 'ai_draft',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'ai_draft',
    isKeyEvent: true,
    summaryBuilder: () => '驳回了 AI 草案',
  },
  [AuditEvent.AI_DRAFT_CONFIRMED]: {
    eventType: AuditEvent.AI_DRAFT_CONFIRMED,
    verb: 'confirmed',
    category: 'ai_draft',
    importance: 'critical',
    visibility: 'project_member',
    objectType: 'ai_draft',
    isKeyEvent: true,
    summaryBuilder: () => '确认导入了 AI 草案',
  },
  [AuditEvent.AI_DRAFT_VALIDATED]: {
    eventType: AuditEvent.AI_DRAFT_VALIDATED,
    verb: 'validated',
    category: 'ai_draft',
    importance: 'normal',
    visibility: 'project_member',
    objectType: 'ai_draft',
    isKeyEvent: false,
    summaryBuilder: () => '校验了 AI 草案',
  },
  [AuditEvent.DRAFT_LAYER_APPLIED]: {
    eventType: AuditEvent.DRAFT_LAYER_APPLIED,
    verb: 'applied',
    category: 'draft_layer',
    importance: 'critical',
    visibility: 'project_member',
    objectType: 'draft_layer',
    isKeyEvent: true,
    summaryBuilder: () => '应用了 AI 草案层变更',
  },
  [AuditEvent.DRAFT_LAYER_APPLY_FAILED]: {
    eventType: AuditEvent.DRAFT_LAYER_APPLY_FAILED,
    verb: 'apply_failed',
    category: 'draft_layer',
    importance: 'critical',
    visibility: 'project_member',
    objectType: 'draft_layer',
    isKeyEvent: true,
    summaryBuilder: () => 'AI 草案层应用失败',
  },
  [AuditEvent.DRAFT_LAYER_DISCARDED]: {
    eventType: AuditEvent.DRAFT_LAYER_DISCARDED,
    verb: 'discarded',
    category: 'draft_layer',
    importance: 'high',
    visibility: 'project_member',
    objectType: 'draft_layer',
    isKeyEvent: true,
    summaryBuilder: () => '丢弃了 AI 草案层',
  },

  // —— 删除类：默认隐藏（仅映射为 hidden，不返回）——
  [AuditEvent.PROJECT_DELETED]: hiddenMapping(AuditEvent.PROJECT_DELETED, 'project', 'project'),
  [AuditEvent.TASK_DELETED]: hiddenMapping(AuditEvent.TASK_DELETED, 'task', 'task'),
  [AuditEvent.WBS_NODE_DELETED]: hiddenMapping(AuditEvent.WBS_NODE_DELETED, 'wbs', 'wbs_node'),
  [AuditEvent.MILESTONE_DELETED]: hiddenMapping(
    AuditEvent.MILESTONE_DELETED,
    'milestone',
    'milestone',
  ),
  [AuditEvent.RISK_DELETED]: hiddenMapping(AuditEvent.RISK_DELETED, 'risk', 'risk'),
  [AuditEvent.DOCUMENT_DELETED]: hiddenMapping(AuditEvent.DOCUMENT_DELETED, 'document', 'document'),
  [AuditEvent.ATTACHMENT_DELETED]: hiddenMapping(
    AuditEvent.ATTACHMENT_DELETED,
    'attachment',
    'attachment',
  ),
  [AuditEvent.DIAGRAM_DELETED]: hiddenMapping(AuditEvent.DIAGRAM_DELETED, 'diagram', 'diagram'),
  [AuditEvent.COMMENT_DELETED]: hiddenMapping(AuditEvent.COMMENT_DELETED, 'comment', 'comment'),

  // —— 认证 / 安全 / 用户 / 组织：显式 hidden ——
  [AuditEvent.LOGIN_SUCCESS]: hiddenMapping(AuditEvent.LOGIN_SUCCESS, 'other', 'auth'),
  [AuditEvent.LOGIN_FAILED]: hiddenMapping(AuditEvent.LOGIN_FAILED, 'other', 'auth'),
  [AuditEvent.LOGOUT]: hiddenMapping(AuditEvent.LOGOUT, 'other', 'auth'),
  [AuditEvent.TOKEN_REFRESHED]: hiddenMapping(AuditEvent.TOKEN_REFRESHED, 'other', 'auth'),
  [AuditEvent.PASSWORD_CHANGED]: hiddenMapping(AuditEvent.PASSWORD_CHANGED, 'other', 'auth'),
  [AuditEvent.TWO_FACTOR_ENROLLMENT_STARTED]: hiddenMapping(
    AuditEvent.TWO_FACTOR_ENROLLMENT_STARTED,
    'other',
    'auth',
  ),
  [AuditEvent.TWO_FACTOR_ENROLLMENT_SKIPPED]: hiddenMapping(
    AuditEvent.TWO_FACTOR_ENROLLMENT_SKIPPED,
    'other',
    'auth',
  ),
  [AuditEvent.TWO_FACTOR_ENABLED]: hiddenMapping(AuditEvent.TWO_FACTOR_ENABLED, 'other', 'auth'),
  [AuditEvent.TWO_FACTOR_DISABLED]: hiddenMapping(AuditEvent.TWO_FACTOR_DISABLED, 'other', 'auth'),
  [AuditEvent.TWO_FACTOR_CHALLENGE_ISSUED]: hiddenMapping(
    AuditEvent.TWO_FACTOR_CHALLENGE_ISSUED,
    'other',
    'auth',
  ),
  [AuditEvent.TWO_FACTOR_CHALLENGE_SUCCEEDED]: hiddenMapping(
    AuditEvent.TWO_FACTOR_CHALLENGE_SUCCEEDED,
    'other',
    'auth',
  ),
  [AuditEvent.TWO_FACTOR_CHALLENGE_FAILED]: hiddenMapping(
    AuditEvent.TWO_FACTOR_CHALLENGE_FAILED,
    'other',
    'auth',
  ),
  [AuditEvent.TWO_FACTOR_RECOVERY_CODE_USED]: hiddenMapping(
    AuditEvent.TWO_FACTOR_RECOVERY_CODE_USED,
    'other',
    'auth',
  ),
  [AuditEvent.TWO_FACTOR_RECOVERY_CODES_REGENERATED]: hiddenMapping(
    AuditEvent.TWO_FACTOR_RECOVERY_CODES_REGENERATED,
    'other',
    'auth',
  ),
  [AuditEvent.PERMISSION_DENIED]: hiddenMapping(AuditEvent.PERMISSION_DENIED, 'other', 'auth'),
  [AuditEvent.ROLE_CHANGED]: hiddenMapping(AuditEvent.ROLE_CHANGED, 'other', 'auth'),
  [AuditEvent.USER_CREATED]: hiddenMapping(AuditEvent.USER_CREATED, 'other', 'user'),
  [AuditEvent.USER_UPDATED]: hiddenMapping(AuditEvent.USER_UPDATED, 'other', 'user'),
  [AuditEvent.USER_DISABLED]: hiddenMapping(AuditEvent.USER_DISABLED, 'other', 'user'),
  [AuditEvent.USER_ENABLED]: hiddenMapping(AuditEvent.USER_ENABLED, 'other', 'user'),
  [AuditEvent.USER_DELETED]: hiddenMapping(AuditEvent.USER_DELETED, 'other', 'user'),
  [AuditEvent.ORG_CREATED]: hiddenMapping(AuditEvent.ORG_CREATED, 'other', 'organization'),
  [AuditEvent.ORG_UPDATED]: hiddenMapping(AuditEvent.ORG_UPDATED, 'other', 'organization'),
  [AuditEvent.ORG_DELETED]: hiddenMapping(AuditEvent.ORG_DELETED, 'other', 'organization'),
  [AuditEvent.ORG_OWNER_TRANSFERRED]: hiddenMapping(
    AuditEvent.ORG_OWNER_TRANSFERRED,
    'other',
    'organization',
  ),
  [AuditEvent.MEMBER_INVITED]: hiddenMapping(AuditEvent.MEMBER_INVITED, 'other', 'organization'),
  [AuditEvent.MEMBER_REMOVED]: hiddenMapping(AuditEvent.MEMBER_REMOVED, 'other', 'organization'),

  // —— AI 连接 / 配置 / 下载拒绝 / Source Attribution / PDM ——
  [AuditEvent.AI_CONNECTION_CREATED]: hiddenMapping(
    AuditEvent.AI_CONNECTION_CREATED,
    'other',
    'ai_connection',
  ),
  [AuditEvent.AI_CONNECTION_UPDATED]: hiddenMapping(
    AuditEvent.AI_CONNECTION_UPDATED,
    'other',
    'ai_connection',
  ),
  [AuditEvent.AI_CONNECTION_DELETED]: hiddenMapping(
    AuditEvent.AI_CONNECTION_DELETED,
    'other',
    'ai_connection',
  ),
  [AuditEvent.AI_CONNECTION_TESTED]: hiddenMapping(
    AuditEvent.AI_CONNECTION_TESTED,
    'other',
    'ai_connection',
  ),
  [AuditEvent.CONFIG_CHANGED]: hiddenMapping(AuditEvent.CONFIG_CHANGED, 'other', 'config'),
  [AuditEvent.REPORT_DOWNLOAD_DENIED]: hiddenMapping(
    AuditEvent.REPORT_DOWNLOAD_DENIED,
    'report',
    'report',
  ),
  [AuditEvent.REPORT_ACCESS_DENIED]: hiddenMapping(
    AuditEvent.REPORT_ACCESS_DENIED,
    'report',
    'report',
  ),
  [AuditEvent.SOURCE_ATTRIBUTION_READ]: hiddenMapping(
    AuditEvent.SOURCE_ATTRIBUTION_READ,
    'other',
    'source_attribution',
  ),
  [AuditEvent.SOURCE_ATTRIBUTION_BIND_FAILED]: hiddenMapping(
    AuditEvent.SOURCE_ATTRIBUTION_BIND_FAILED,
    'other',
    'source_attribution',
  ),
  [AuditEvent.TRACEABILITY_PERMISSION_DENIED]: hiddenMapping(
    AuditEvent.TRACEABILITY_PERMISSION_DENIED,
    'other',
    'traceability',
  ),
  [AuditEvent.PDM_MIGRATION_PLANNED]: hiddenMapping(
    AuditEvent.PDM_MIGRATION_PLANNED,
    'other',
    'pdm_migration',
  ),
  [AuditEvent.PDM_MIGRATION_DRY_RUN]: hiddenMapping(
    AuditEvent.PDM_MIGRATION_DRY_RUN,
    'other',
    'pdm_migration',
  ),
  [AuditEvent.PDM_MIGRATION_EXECUTE_STARTED]: hiddenMapping(
    AuditEvent.PDM_MIGRATION_EXECUTE_STARTED,
    'other',
    'pdm_migration',
  ),
  [AuditEvent.PDM_MIGRATION_EXECUTE_COMPLETED]: hiddenMapping(
    AuditEvent.PDM_MIGRATION_EXECUTE_COMPLETED,
    'other',
    'pdm_migration',
  ),
  [AuditEvent.PDM_MIGRATION_VERIFY_FAILED]: hiddenMapping(
    AuditEvent.PDM_MIGRATION_VERIFY_FAILED,
    'other',
    'pdm_migration',
  ),
  [AuditEvent.PDM_MIGRATION_ROLLBACK]: hiddenMapping(
    AuditEvent.PDM_MIGRATION_ROLLBACK,
    'other',
    'pdm_migration',
  ),
  [AuditEvent.PDM_MIGRATION_READ_SWITCHED]: hiddenMapping(
    AuditEvent.PDM_MIGRATION_READ_SWITCHED,
    'other',
    'pdm_migration',
  ),
  // v2-github-gitlab-light-links —— 任务外部链接
  [AuditEvent.TASK_EXTERNAL_LINK_CREATED]: {
    eventType: AuditEvent.TASK_EXTERNAL_LINK_CREATED,
    verb: 'created',
    category: 'task',
    importance: 'low',
    visibility: 'project_member',
    objectType: 'task_external_link',
    isKeyEvent: false,
    summaryBuilder: (ctx) => `关联了外部 ${ctx.objectLabel ?? '链接'}`,
    secondaryBuilder: (ctx) => (ctx.objectLabel ? `外部链接：${ctx.objectLabel}` : null),
  },
  [AuditEvent.TASK_EXTERNAL_LINK_UPDATED]: {
    eventType: AuditEvent.TASK_EXTERNAL_LINK_UPDATED,
    verb: 'updated',
    category: 'task',
    importance: 'low',
    visibility: 'project_member',
    objectType: 'task_external_link',
    isKeyEvent: false,
    summaryBuilder: (ctx) => `更新了外部 ${ctx.objectLabel ?? '链接'} 的状态`,
  },
  [AuditEvent.TASK_EXTERNAL_LINK_DELETED]: {
    eventType: AuditEvent.TASK_EXTERNAL_LINK_DELETED,
    verb: 'deleted',
    category: 'task',
    importance: 'low',
    visibility: 'project_member',
    objectType: 'task_external_link',
    isKeyEvent: false,
    summaryBuilder: (ctx) => `移除了外部 ${ctx.objectLabel ?? '链接'}`,
  },
  [AuditEvent.TASK_EXTERNAL_LINK_REFRESHED]: {
    eventType: AuditEvent.TASK_EXTERNAL_LINK_REFRESHED,
    verb: 'updated',
    category: 'task',
    importance: 'low',
    visibility: 'project_member',
    objectType: 'task_external_link',
    isKeyEvent: false,
    summaryBuilder: (ctx) => `刷新了外部 ${ctx.objectLabel ?? '链接'} 的状态`,
  },
  [AuditEvent.TASK_EXTERNAL_LINK_REFRESH_DEGRADED]: {
    eventType: AuditEvent.TASK_EXTERNAL_LINK_REFRESH_DEGRADED,
    verb: 'updated',
    category: 'task',
    importance: 'low',
    visibility: 'project_member',
    objectType: 'task_external_link',
    isKeyEvent: false,
    summaryBuilder: () => '尝试刷新外部链接状态（provider 未配置）',
  },
}

const TASK_FIELD_LABELS: Record<string, string> = {
  startDate: '开始日期',
  endDate: '结束日期',
  priority: '优先级',
  assigneeId: '负责人',
  progressPercent: '进度',
  status: '状态',
  estimatedHours: '估算工时',
  dueDate: '截止日期',
}

function hiddenMapping(
  eventType: string,
  category: TimelineCategory,
  objectType: string,
): TimelineEventMapping {
  return {
    eventType,
    verb: 'hidden',
    category,
    importance: 'low',
    visibility: 'hidden',
    objectType,
    isKeyEvent: false,
    // 即使误用也不得泄露 event code
    summaryBuilder: () => '项目活动',
  }
}

/** 解析映射；未知事件返回 null（调用方按 hidden 处理）。 */
export function resolveTimelineMapping(
  eventCode: string | null | undefined,
): TimelineEventMapping | null {
  if (!eventCode) return null
  return TIMELINE_EVENT_MAPPINGS[eventCode as AuditEventType] ?? null
}

/** 是否为 Timeline 可派生候选（非 hidden）。 */
export function isTimelineCandidate(
  eventCode: string | null | undefined,
  metadata?: Record<string, unknown> | null,
): boolean {
  const mapping = resolveTimelineMapping(eventCode)
  if (!mapping) return false
  if (mapping.visibility === 'hidden') return false
  if (mapping.includeWhen && !mapping.includeWhen(metadata)) return false
  return true
}

/** 聚合摘要文案。 */
export function buildAggregatedSummary(verb: string, objectType: string, count: number): string {
  const objectLabel = OBJECT_TYPE_LABELS[objectType] ?? '条目'
  const verbLabel = VERB_LABELS[verb] ?? '更新了'
  return `${verbLabel} ${count} 个${objectLabel}`
}

const OBJECT_TYPE_LABELS: Record<string, string> = {
  task: '任务',
  wbs_node: 'WBS 节点',
  milestone: '里程碑',
  risk: '风险',
  change_request: '变更请求',
  document: '文档',
  attachment: '附件',
  diagram: '图表',
  comment: '评论',
  project: '项目',
}

const VERB_LABELS: Record<string, string> = {
  created: '创建了',
  updated: '更新了',
  assigned: '指派了',
  commented: '发表了',
  uploaded: '上传了',
  moved: '移动了',
  replied: '回复了',
  resolved: '解决了',
  reopened: '重新打开了',
  mentioned: '提到了',
}
