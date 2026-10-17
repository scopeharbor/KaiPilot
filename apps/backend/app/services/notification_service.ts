import Notification from '#models/notification'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import RealtimeBroadcaster from '#services/realtime/realtime_broadcaster'
import { RealtimeEvents, type RealtimeEventEnvelope } from '#types/realtime_events'
import logger from '@adonisjs/core/services/logger'
import ProjectMember from '#models/project_member'
import Project from '#models/project'
import type {
  NotificationDto,
  NotificationListResponse,
  NotificationListMetaDto,
  UnreadCountResponse,
  MarkReadResponse,
  MarkAllReadResponse,
  NotificationBatchResponse,
  NotificationBatchAction,
  NotificationType,
  NotificationSeverity,
  NotificationTypeGroup,
} from '#types/dto'
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'

export interface NotificationFilters {
  status?: 'read' | 'unread' | 'all'
  type?: NotificationType
  typeGroup?: NotificationTypeGroup
  severity?: NotificationSeverity
  projectId?: number
  dateFrom?: string
  dateTo?: string
  hidden?: 'include' | 'exclude' | 'only'
}

export interface CreateNotificationInput {
  organizationId: number
  recipientId: number
  type: NotificationType
  title: string
  body?: string | null
  severity?: NotificationSeverity
  projectId?: number | null
  targetType?: string | null
  targetId?: number | null
  actionUrl?: string | null
  idempotencyKey?: string | null
  metadata?: Record<string, unknown> | null
  /**
   * 调用方事务：传入时通知随事务写入（回滚则一起回滚），实时推送延后到提交之后。
   * 事务内若改用默认连接写，SQLite 单写连接会互相等待直至超时。
   */
  client?: TransactionClientContract
}

/** 通知类型 → 类型分组映射。 */
export const TYPE_GROUP_MAP: Record<string, NotificationTypeGroup> = {
  task_assigned: 'assignments',
  task_unassigned: 'assignments',
  task_blocked: 'assignments',
  task_completed: 'assignments',
  task_schedule_changed: 'assignments',
  task_predecessor_pending: 'assignments',
  comment_added: 'mentions',
  attachment_added: 'system',
  project_archived: 'system',
  project_restored: 'system',
  milestone_due: 'system',
  milestone_overdue: 'system',
  ai_draft_confirmed: 'approvals',
  ai_draft_imported: 'approvals',
  report_exported: 'system',
  report_export_failed: 'system',
  external_link_status_changed: 'system',
  general: 'system',
}

/** 通知类型分组的中文标签。 */
export const TYPE_GROUP_LABELS: Record<NotificationTypeGroup, string> = {
  all: '全部',
  unread: '未读',
  mentions: '@提及',
  assignments: '任务',
  approvals: '审批',
  system: '系统',
}

/** 类型组可包含的通知类型。 */
const GROUP_TYPES: Record<NotificationTypeGroup, NotificationType[]> = {
  all: [],
  unread: [],
  mentions: ['comment_added', 'general'],
  assignments: [
    'task_assigned',
    'task_unassigned',
    'task_blocked',
    'task_completed',
    'task_schedule_changed',
    'task_predecessor_pending',
  ],
  approvals: ['ai_draft_confirmed', 'ai_draft_imported'],
  system: [
    'attachment_added',
    'project_archived',
    'project_restored',
    'milestone_due',
    'milestone_overdue',
    'report_exported',
    'report_export_failed',
    'general',
  ],
}

/**
 * 获取通知类型所属分组。
 */
export function getTypeGroup(type: NotificationType): NotificationTypeGroup {
  return TYPE_GROUP_MAP[type] ?? 'system'
}

/**
 * 通知服务（v2-notification-center）：
 * - 列表查询：支持通知中心扩展筛选（项目、类型组、时间范围、隐藏状态）
 * - 稳定排序：created_at desc, id desc
 * - 批量操作：标记已读/标记未读/隐藏，幂等
 * - 隐藏通知默认不返回
 */
@inject()
export default class NotificationService {
  // ---------------- 查询 ----------------

  /**
   * 查询当前用户通知列表（V2 扩展：支持通知中心筛选）。
   */
  async listForUser(
    organizationId: number,
    recipientId: number,
    filters: NotificationFilters,
    page: number = 1,
    perPage: number = 20,
  ): Promise<NotificationListResponse> {
    let query = Notification.query()
      .where('organization_id', organizationId)
      .where('recipient_id', recipientId)

    // 隐藏状态过滤（通知中心：默认排除已隐藏）
    if (!filters.hidden || filters.hidden === 'exclude') {
      query = query.whereNull('hidden_at')
    } else if (filters.hidden === 'only') {
      query = query.whereNotNull('hidden_at')
    }
    // hidden === 'include'：不过滤

    // 读取状态过滤
    if (filters.status === 'unread') {
      query = query.whereNull('read_at')
    } else if (filters.status === 'read') {
      query = query.whereNotNull('read_at')
    }

    // 类型组过滤
    if (filters.typeGroup && filters.typeGroup !== 'all') {
      const groupTypes = GROUP_TYPES[filters.typeGroup]
      if (groupTypes.length > 0) {
        query = query.whereIn('type', groupTypes)
      }
    }

    // 单个类型过滤
    if (filters.type) {
      query = query.where('type', filters.type)
    }

    // 严重级别过滤
    if (filters.severity) {
      query = query.where('severity', filters.severity)
    }

    // 项目过滤
    if (filters.projectId) {
      query = query.where('project_id', filters.projectId)
    }

    // 时间范围过滤
    if (filters.dateFrom) {
      query = query.where('created_at', '>=', filters.dateFrom)
    }
    if (filters.dateTo) {
      query = query.where('created_at', '<=', filters.dateTo)
    }

    // 总数
    const total = await query.clone().count('id as count').first()
    const totalCount = Number(total?.$extras.count ?? 0)

    // 分页 + 稳定排序（created_at desc, id desc）
    const offset = (page - 1) * perPage
    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(perPage)
      .offset(offset)

    const meta: NotificationListMetaDto = {
      total: totalCount,
      page,
      perPage,
      totalPages: Math.ceil(totalCount / perPage),
    }

    return {
      data: rows.map((n) => this.toDto(n)),
      meta,
    }
  }

  /**
   * 获取当前用户未读通知数量。
   */
  async getUnreadCount(organizationId: number, recipientId: number): Promise<UnreadCountResponse> {
    const result = await Notification.query()
      .where('organization_id', organizationId)
      .where('recipient_id', recipientId)
      .whereNull('read_at')
      .whereNull('hidden_at')
      .count('id as count')
      .first()

    return {
      unreadCount: Number(result?.$extras.count ?? 0),
    }
  }

  // ---------------- 已读操作 ----------------

  /**
   * 标记单条通知已读（幂等）。
   */
  async markRead(
    organizationId: number,
    recipientId: number,
    notificationId: number,
  ): Promise<MarkReadResponse> {
    const n = await Notification.query()
      .where('id', notificationId)
      .where('organization_id', organizationId)
      .where('recipient_id', recipientId)
      .first()

    if (!n) {
      return { success: false, readAt: '' }
    }

    const now = DateTime.now()
    n.readAt = now
    await n.save()

    return {
      success: true,
      readAt: now.toISO()!,
    }
  }

  /**
   * 全部标记已读（只处理当前用户当前组织的未读通知）。
   */
  async markAllRead(organizationId: number, recipientId: number): Promise<MarkAllReadResponse> {
    const now = DateTime.now()

    const result = await Notification.query()
      .where('organization_id', organizationId)
      .where('recipient_id', recipientId)
      .whereNull('read_at')
      .whereNull('hidden_at')
      .update({ read_at: now.toSQL() })

    return {
      success: true,
      markedCount: Number(result),
    }
  }

  // ---------------- 批量操作（V2 通知中心） ----------------

  /**
   * 批量操作通知（幂等）：
   * - mark_read：设置 read_at
   * - mark_unread：清空 read_at
   * - hide：设置 hidden_at
   * 只影响当前组织当前用户的通知。
   */
  async batchOperation(
    organizationId: number,
    recipientId: number,
    notificationIds: number[],
    action: NotificationBatchAction,
  ): Promise<NotificationBatchResponse> {
    if (notificationIds.length === 0) {
      return { success: true, affectedCount: 0, action }
    }

    const now = DateTime.now()
    let affectedCount = 0

    if (action === 'mark_read') {
      const result = await Notification.query()
        .whereIn('id', notificationIds)
        .where('organization_id', organizationId)
        .where('recipient_id', recipientId)
        .whereNull('read_at')
        .update({ read_at: now.toSQL() })
      affectedCount = Number(result)
    } else if (action === 'mark_unread') {
      const result = await Notification.query()
        .whereIn('id', notificationIds)
        .where('organization_id', organizationId)
        .where('recipient_id', recipientId)
        .whereNotNull('read_at')
        .update({ read_at: null })
      affectedCount = Number(result)
    } else if (action === 'hide') {
      // 隐藏：设置 hidden_at，同时不清除 read_at（已读状态保留）
      const result = await Notification.query()
        .whereIn('id', notificationIds)
        .where('organization_id', organizationId)
        .where('recipient_id', recipientId)
        .whereNull('hidden_at')
        .update({ hidden_at: now.toSQL() })
      affectedCount = Number(result)
    }

    return {
      success: true,
      affectedCount,
      action,
    }
  }

  // ---------------- 创建（供业务服务调用） ----------------

  /**
   * 为指定用户创建通知。
   */
  async createForUser(input: CreateNotificationInput): Promise<Notification | null> {
    const created = await this.persistForUser(input)
    if (created) {
      if (input.client) input.client.after('commit', () => this.pushArrived(input))
      else this.pushArrived(input)
    }
    return created
  }

  /**
   * 实时提示收件人（铃铛未读数 / 抽屉列表即时刷新）。尽力而为：失败只记日志。
   * 通知写入不随调用方事务（默认连接直接提交），所以这里推送时数据已可读。
   */
  private pushArrived(input: CreateNotificationInput) {
    try {
      new RealtimeBroadcaster().broadcastToUser(input.recipientId, {
        type: RealtimeEvents.NOTIFICATION_ARRIVED,
        projectId: input.projectId ?? 0,
        entityId: input.targetId ?? 0,
        actorId: 0,
        occurredAt: new Date().toISOString(),
        metadata: { notificationType: input.type },
      } satisfies RealtimeEventEnvelope)
    } catch (error) {
      logger.warn(
        { recipientId: input.recipientId, error: (error as Error).message },
        '通知实时推送失败（旁路）',
      )
    }
  }

  private async persistForUser(input: CreateNotificationInput): Promise<Notification | null> {
    const { idempotencyKey } = input

    const client = input.client
    if (idempotencyKey) {
      const existing = await Notification.query({ client })
        .where('recipient_id', input.recipientId)
        .where('idempotency_key', idempotencyKey)
        .first()

      if (existing) {
        existing.title = input.title
        existing.body = input.body ?? null
        existing.severity = input.severity ?? 'info'
        existing.actionUrl = input.actionUrl ?? null
        existing.metadata = input.metadata ?? null
        if (client) existing.useTransaction(client)
        await existing.save()
        return existing
      }
    }

    return Notification.create(
      {
        organizationId: input.organizationId,
        recipientId: input.recipientId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        severity: input.severity ?? 'info',
        projectId: input.projectId ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        actionUrl: input.actionUrl ?? null,
        idempotencyKey: idempotencyKey ?? null,
        metadata: input.metadata ?? null,
      },
      { client },
    )
  }

  /**
   * 按项目成员过滤后批量创建通知。
   */
  async createForProjectMembers(
    baseInput: Omit<CreateNotificationInput, 'recipientId'>,
    projectId: number,
    excludeUserIds: number[] = [],
  ): Promise<Notification[]> {
    const members = await ProjectMember.query()
      .where('project_id', projectId)
      .where('is_active', true)

    const notifications: Notification[] = []
    const excludeSet = new Set(excludeUserIds.map(Number))

    for (const member of members) {
      const userId = Number(member.userId)
      if (excludeSet.has(userId)) continue

      const n = await this.createForUser({
        ...baseInput,
        recipientId: userId,
      })
      if (n) notifications.push(n)
    }

    return notifications
  }

  // ---------------- 低敏目标摘要 ----------------

  /** 目标类型 → 中文显示名。 */
  private static TARGET_TYPE_NAMES: Record<string, string> = {
    task: '任务',
    project: '项目',
    file: '文件',
    report: '报表',
    change_request: '变更请求',
    risk: '风险',
    resource: '资源',
    milestone: '里程碑',
    comment: '评论',
    ai_draft: 'AI 草案',
    compiler_run: 'Compiler',
  }

  /**
   * 生成低敏目标摘要（禁止返回完整标题、正文、路径、下载 URL 或原始 metadata）。
   */
  generateTargetSummary(
    targetType: string | null,
    metadata: Record<string, unknown> | null,
  ): {
    type: string
    status?: string
    genericTitle?: string
  } | null {
    if (!targetType) return null

    const typeName = NotificationService.TARGET_TYPE_NAMES[targetType] ?? targetType

    // 从 metadata 提取安全的泛化标题（禁止获取完整目标名称）
    const metaEvent = metadata?.event as string | undefined
    const metaStatus = metadata?.status as string | undefined

    return {
      type: typeName,
      status: metaStatus ?? undefined,
      genericTitle: metaEvent ? undefined : undefined, // 不暴露具体事件名
    }
  }

  /**
   * 对通知执行目标资源的二次可见性判定。
   * 外部协作者已撤权目标返回 inaccessible。
   */
  async resolveAccessStatus(
    notification: NotificationDto,
    userId: number,
  ): Promise<'accessible' | 'inaccessible' | 'unknown'> {
    if (!notification.projectId) return 'unknown'

    try {
      const membership = await ProjectMember.query()
        .where('project_id', notification.projectId)
        .where('user_id', userId)
        .where('is_active', true)
        .first()

      if (!membership) return 'inaccessible'

      const project = await Project.query()
        .where('id', notification.projectId)
        .whereNull('deleted_at')
        .first()

      if (!project) return 'inaccessible'

      return 'accessible'
    } catch {
      return 'unknown'
    }
  }

  // ---------------- DTO ----------------

  private toDto(n: Notification): NotificationDto {
    const metadata = (n.metadata ?? {}) as Record<string, unknown>
    return {
      id: n.id,
      organizationId: Number(n.organizationId),
      recipientId: Number(n.recipientId),
      type: n.type as NotificationType,
      title: n.title,
      body: n.body,
      severity: n.severity as NotificationSeverity,
      projectId: n.projectId === null ? null : Number(n.projectId),
      target:
        n.targetType !== null && n.targetId !== null
          ? { type: n.targetType, id: Number(n.targetId) }
          : null,
      actionUrl: n.actionUrl,
      readAt: n.readAt ? n.readAt.toISO()! : null,
      hiddenAt: n.hiddenAt ? n.hiddenAt.toISO()! : null,
      targetSummary: this.generateTargetSummary(n.targetType, metadata),
      metadata: metadata ?? null,
      createdAt: n.createdAt.toISO()!,
    }
  }
}
