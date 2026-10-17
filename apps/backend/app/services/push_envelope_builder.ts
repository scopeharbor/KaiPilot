import type Notification from '#models/notification'
import type {
  PushNotificationEnvelope,
  PushNotificationType,
  PushNotificationSeverity,
} from '@aiproj/types'
import { DateTime } from 'luxon'

/**
 * 通知类型到推送类型映射。
 * 只映射可推送的通知类型。
 */
const NOTIFICATION_TYPE_TO_PUSH_TYPE: Record<string, PushNotificationType> = {
  task_assigned: 'assignment',
  task_unassigned: 'assignment',
  task_blocked: 'assignment',
  task_completed: 'assignment',
  task_schedule_changed: 'assignment',
  task_predecessor_pending: 'assignment',
  comment_added: 'mention',
  ai_draft_confirmed: 'approval',
  ai_draft_imported: 'approval',
  report_exported: 'report',
  report_export_failed: 'report',
  milestone_due: 'system',
  milestone_overdue: 'system',
  project_archived: 'system',
  project_restored: 'system',
  attachment_added: 'system',
  general: 'system',
}

/** 可推送的通知类型集合。 */
const PUSHABLE_TYPES = new Set(Object.keys(NOTIFICATION_TYPE_TO_PUSH_TYPE))

/** 安全的同源路由 allowlist（notificationclick 只允许这些路由）。 */
const SAFE_ROUTES = new Set([
  '/notifications',
  '/notifications/',
  '/projects',
  '/dashboard',
  '/settings',
])

/**
 * 低敏推送 Envelope 构建器（design D5）。
 *
 * 从站内通知作为 canonical source 构建推送 envelope。
 * 只包含 allowlisted 低敏字段：notificationId、type、severity、createdAt、route、title、body。
 * 禁止包含：项目名称、任务标题、正文全文、评论、AI 输出、文件路径、token、secret、外部 payload、raw metadata。
 */
export default class PushEnvelopeBuilder {
  /**
   * 从站内通知构建推送 envelope。
   * 返回 null 表示通知不可推送。
   */
  async build(notification: Notification): Promise<PushNotificationEnvelope | null> {
    if (!PUSHABLE_TYPES.has(notification.type)) {
      return null
    }

    const pushType = NOTIFICATION_TYPE_TO_PUSH_TYPE[notification.type]
    if (!pushType) {
      return null
    }

    // 构建安全路由
    const route = this.resolveSafeRoute(notification.actionUrl)

    // 构建低敏标题和正文
    const { title, body } = this.buildSafeContent(notification.type)

    return {
      notificationId: notification.id,
      type: pushType,
      severity: (notification.severity ?? 'info') as PushNotificationSeverity,
      createdAt: (notification.createdAt ?? DateTime.now()).toISO()!,
      route,
      title,
      body,
    }
  }

  /**
   * 从通知数据直接构建 envelope（供桥接调用）。
   */
  buildFromData(data: {
    id: number
    type: string
    severity?: string
    createdAt: DateTime
    actionUrl?: string | null
  }): PushNotificationEnvelope | null {
    if (!PUSHABLE_TYPES.has(data.type)) {
      return null
    }

    const pushType = NOTIFICATION_TYPE_TO_PUSH_TYPE[data.type]
    if (!pushType) {
      return null
    }

    const route = this.resolveSafeRoute(data.actionUrl)
    const { title, body } = this.buildSafeContent(data.type)

    return {
      notificationId: data.id,
      type: pushType,
      severity: (data.severity ?? 'info') as PushNotificationSeverity,
      createdAt: data.createdAt.toISO()!,
      route,
      title,
      body,
    }
  }

  /**
   * 解析安全路由。
   * 只允许 SAFE_ROUTES 中的路径或 /projects/* 模式。
   * 不支持/不安全的路径回退到 /notifications。
   */
  private resolveSafeRoute(actionUrl: string | null | undefined): string {
    if (!actionUrl) return '/notifications'

    try {
      const url = new URL(actionUrl, 'https://localhost')
      const pathname = url.pathname

      // 精确匹配安全路由
      if (SAFE_ROUTES.has(pathname)) return pathname
      if (SAFE_ROUTES.has(pathname.replace(/\/$/, ''))) return pathname

      // /projects/* 模式
      if (/^\/projects(\/|$)/.test(pathname)) return pathname

      // /notifications/* 模式
      if (/^\/notifications(\/|$)/.test(pathname)) return pathname

      // 不支持的路由回退
      return '/notifications'
    } catch {
      return '/notifications'
    }
  }

  /**
   * 构建低敏推送标题和正文。
   * 只使用泛化的通用文本，不包含具体项目名、任务名等敏感信息。
   */
  private buildSafeContent(notificationType: string): { title: string; body: string | null } {
    const content = PUSH_CONTENT_MAP[notificationType] ?? PUSH_CONTENT_MAP.general
    return { title: content.title, body: content.body }
  }
}

/** 推送内容模板（低敏通用文本，不包含具体业务数据）。 */
const PUSH_CONTENT_MAP: Record<string, { title: string; body: string | null }> = {
  task_assigned: { title: '新任务指派', body: '你被指派了一个新任务' },
  task_unassigned: { title: '任务取消指派', body: '你被取消了任务指派' },
  task_blocked: { title: '任务受阻', body: '有任务被标记为受阻' },
  task_completed: { title: '任务已完成', body: '有任务已完成' },
  task_schedule_changed: { title: '任务排期调整', body: '有任务的排期发生了调整' },
  task_predecessor_pending: { title: '前置未完成即开工', body: '有任务在前置任务未完成时开工' },
  comment_added: { title: '新回复', body: '你有一条新回复' },
  ai_draft_confirmed: { title: 'AI 草案已确认', body: 'AI 生成的草案已确认' },
  ai_draft_imported: { title: 'AI 草案已导入', body: 'AI 生成的草案已导入' },
  report_exported: { title: '报表已导出', body: '报表导出完成' },
  report_export_failed: { title: '报表导出失败', body: '报表导出失败，请重试' },
  milestone_due: { title: '里程碑到期', body: '里程碑即将到期' },
  milestone_overdue: { title: '里程碑已超期', body: '里程碑已超过截止日期' },
  project_archived: { title: '项目已归档', body: '项目已归档' },
  project_restored: { title: '项目已恢复', body: '项目已恢复' },
  attachment_added: { title: '新附件', body: '有新的附件上传' },
  general: { title: '新通知', body: null },
}
