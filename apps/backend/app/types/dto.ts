import type AuditLog from '#models/audit_log'
import type Notification from '#models/notification'
import type Organization from '#models/organization'
import type OrganizationMember from '#models/organization_member'
import type Task from '#models/task'
import type User from '#models/user'
import type { TaskPriority, TaskStatus, TaskType } from '#services/task_status_machine'
import type { MilestoneStatus, MilestoneView } from '#services/milestone_service'
import type Resource from '#models/resource'
import type ResourceAllocation from '#models/resource_allocation'

export interface OrganizationSummaryDto {
  id: number
  name: string
  slug: string
  role: string
  planTier: string
}

/**
 * 用户对外 DTO。密码、providerId 等认证敏感字段永不暴露。
 */
export function userDto(user: User) {
  const organizationMembers = user.organizationMembers ?? []

  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    initials: user.initials,
    isActive: user.isActive,
    isSuperAdmin: user.isSuperAdmin,
    authProvider: user.authProvider,
    allowSelfAiConfig: Boolean(user.allowSelfAiConfig),
    twoFactorExempt: Boolean(user.twoFactorExempt),
    organizations: organizationMembers
      .filter((membership) => Boolean(membership.organization))
      .map((membership): OrganizationSummaryDto => ({
        id: Number(membership.organization.id),
        name: membership.organization.name,
        slug: membership.organization.slug,
        role: membership.role,
        planTier: membership.organization.planTier,
      })),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

export function organizationDto(organization: Organization, role?: string | null) {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    description: organization.description,
    planTier: organization.planTier,
    maxProjects: organization.maxProjects,
    maxMembers: organization.maxMembers,
    settings: organization.settings,
    ownerId: Number(organization.ownerId),
    ...(role ? { role } : {}),
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  }
}

export function memberDto(member: OrganizationMember) {
  return {
    id: member.id,
    organizationId: Number(member.organizationId),
    userId: Number(member.userId),
    role: member.role,
    permissions: member.permissions ?? [],
    invitedBy: member.invitedBy === null ? null : Number(member.invitedBy),
    user: member.user
      ? {
          id: member.user.id,
          fullName: member.user.fullName,
          email: member.user.email,
          initials: member.user.initials,
          isActive: member.user.isActive,
        }
      : undefined,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  }
}

// ---------- 任务 DTO ----------

export interface TaskListMetaDto {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface TaskDto {
  id: number
  projectId: number
  name: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  taskType: TaskType
  startDate: string | null
  endDate: string | null
  actualStartDate: string | null
  actualEndDate: string | null
  durationDays: number | null
  estimatedHours: number | null
  actualHours: number | null
  progressPercent: number
  kanbanRank: number | null
  assigneeId: number | null
  reviewerId: number | null
  parentTaskId: number | null
  wbsNodeId: number | null
  milestoneId: number | null
  costEstimateCents: number | null
  costActualCents: number | null
  customFields: Record<string, unknown> | null
  // V3 图表馆 RACI/LOB（v3-chart-gallery-data-foundation）
  consultedUserIds: number[]
  informedUserIds: number[]
  locationUnit: string | null
  cycleStage: string | null
  subtaskCount?: number
  dependencyCount?: number
  commentCount?: number
  assignee?: { id: number; fullName: string | null; email: string; initials: string }
  reviewer?: { id: number; fullName: string | null; email: string; initials: string }
  parent?: { id: number; name: string; status: TaskStatus }
  subtasks?: TaskDto[]
  createdAt: string
  updatedAt: string | null
  /** AI 建议岗位（来自 AI 草案），供按岗位筛选与批量指派。 */
  roleHint?: string | null
}

const toDate = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  // luxon DateTime
  const iso = (value as { toISODate?: () => string }).toISODate?.()
  return iso ?? null
}

const userRef = (user?: User | null) => {
  if (!user) return undefined
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    initials: user.initials,
  }
}

/**
 * 任务对外 DTO。extras 传入列表聚合（subtask_count/dependency_count/comment_count）。
 */
/** AI 草案给任务标注的建议岗位（ai_metadata.assigneeHint，如「后端开发」「安全、运维」）。 */
export function taskRoleHint(task: Task): string | null {
  let meta: unknown = (task as unknown as { aiMetadata?: unknown }).aiMetadata ?? null
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta)
    } catch {
      return null
    }
  }
  const hint = (meta as { assigneeHint?: unknown } | null)?.assigneeHint
  return typeof hint === 'string' && hint.trim() ? hint.trim() : null
}

export function taskDto(
  task: Task,
  extras?: { subtaskCount?: number; dependencyCount?: number; commentCount?: number },
): TaskDto {
  const parent = task.parent
  return {
    id: task.id,
    projectId: Number(task.projectId),
    name: task.name,
    description: task.description,
    status: task.status as TaskStatus,
    priority: task.priority as TaskPriority,
    taskType: task.taskType as TaskType,
    startDate: toDate(task.startDate),
    endDate: toDate(task.endDate),
    actualStartDate: toDate(task.actualStartDate),
    actualEndDate: toDate(task.actualEndDate),
    durationDays: task.durationDays,
    estimatedHours: task.estimatedHours,
    actualHours: task.actualHours,
    progressPercent: task.progressPercent ?? 0,
    kanbanRank: task.kanbanRank === null ? null : Number(task.kanbanRank),
    assigneeId: task.assigneeId === null ? null : Number(task.assigneeId),
    reviewerId: task.reviewerId === null ? null : Number(task.reviewerId),
    parentTaskId: task.parentTaskId === null ? null : Number(task.parentTaskId),
    wbsNodeId: task.wbsNodeId === null ? null : Number(task.wbsNodeId),
    milestoneId: task.milestoneId === null ? null : Number(task.milestoneId),
    costEstimateCents: task.costEstimateCents === null ? null : Number(task.costEstimateCents),
    costActualCents: task.costActualCents === null ? null : Number(task.costActualCents),
    customFields: (task.customFields as Record<string, unknown> | null) ?? null,
    roleHint: taskRoleHint(task),
    consultedUserIds: Array.isArray(task.consultedUserIds) ? task.consultedUserIds.map(Number) : [],
    informedUserIds: Array.isArray(task.informedUserIds) ? task.informedUserIds.map(Number) : [],
    locationUnit: task.locationUnit ?? null,
    cycleStage: task.cycleStage ?? null,
    ...(extras?.subtaskCount !== undefined ? { subtaskCount: extras.subtaskCount } : {}),
    ...(extras?.dependencyCount !== undefined ? { dependencyCount: extras.dependencyCount } : {}),
    ...(extras?.commentCount !== undefined ? { commentCount: extras.commentCount } : {}),
    ...(task.assignee ? { assignee: userRef(task.assignee) } : {}),
    ...(task.reviewer ? { reviewer: userRef(task.reviewer) } : {}),
    ...(parent
      ? { parent: { id: parent.id, name: parent.name, status: parent.status as TaskStatus } }
      : {}),
    ...((task as unknown as { $relationsPreloaded?: Record<string, Task[]> }).$relationsPreloaded
      ?.subtasks
      ? {
          subtasks: (
            (task as unknown as { $relationsPreloaded: Record<string, Task[]> }).$relationsPreloaded
              .subtasks as Task[]
          ).map((t) => taskDto(t)),
        }
      : {}),
    createdAt: task.createdAt.toISO()!,
    updatedAt: task.updatedAt?.toISO() ?? null,
  }
}

// ---------- 里程碑 DTO ----------

export interface MilestoneDto {
  id: number
  projectId: number
  name: string
  description: string | null
  /** 推导后的展示态（含 at_risk/missed 叠加，供着色）。 */
  status: MilestoneStatus
  /** 持久化的人工态（编辑表单回填，避免把推导态误当人工设定）。 */
  storedStatus: MilestoneStatus
  plannedDate: string | null
  /** 展示态是否为系统推导的建议态（display ≠ stored）。 */
  autoCalculated: boolean
  displayOrder: number
  createdAt: string
  updatedAt: string | null
}

/**
 * 里程碑对外 DTO。入参为 `MilestoneView`（Service 已叠加推导展示态）。
 */
export function milestoneDto(view: MilestoneView): MilestoneDto {
  const m = view.milestone
  return {
    id: m.id,
    projectId: Number(m.projectId),
    name: m.name,
    description: m.description,
    status: view.displayStatus,
    storedStatus: view.storedStatus,
    plannedDate: m.plannedDate ? (m.plannedDate.toISODate() ?? null) : null,
    autoCalculated: view.derived,
    displayOrder: m.displayOrder,
    createdAt: m.createdAt.toISO()!,
    updatedAt: m.updatedAt?.toISO() ?? null,
  }
}

// ---------- 资源 DTO ----------

export interface ResourceDto {
  id: number
  projectId: number
  userId: number | null
  name: string
  email: string | null
  resourceType: string
  role: string
  status: string
  capacityVersion: number
  capacityCalendarPolicy: string
  dailyCapacityHours: number
  skillTags: string | null
  roleTags: string
  capacityProfile: string | null
  workDays: string
  timezone: string
  costPerUnitCents: number | null
  createdAt: string
  updatedAt: string | null
}

export interface AllocationDto {
  id: number
  resourceId: number
  taskId: number
  allocationType: string
  allocationPercent: number
  startDate: string | null
  endDate: string | null
  plannedUnits: number | null
  actualUnits: number | null
  createdAt: string
  updatedAt: string | null
}

export function resourceDto(r: Resource): ResourceDto {
  return {
    id: r.id,
    projectId: Number(r.projectId),
    userId: r.userId === null ? null : Number(r.userId),
    name: r.name,
    email: r.email,
    resourceType: r.resourceType,
    role: r.role,
    status: r.status,
    capacityVersion: r.capacityVersion,
    capacityCalendarPolicy: r.capacityCalendarPolicy,
    dailyCapacityHours: r.dailyCapacityHours,
    skillTags: r.skillTags,
    roleTags: r.roleTags,
    capacityProfile: r.capacityProfile,
    workDays: r.workDays,
    timezone: r.timezone,
    costPerUnitCents: r.costPerUnitCents === null ? null : Number(r.costPerUnitCents),
    createdAt: r.createdAt.toISO()!,
    updatedAt: r.updatedAt?.toISO() ?? null,
  }
}

export function allocationDto(a: ResourceAllocation): AllocationDto {
  return {
    id: a.id,
    resourceId: Number(a.resourceId),
    taskId: Number(a.taskId),
    allocationType: a.allocationType,
    allocationPercent: a.allocationPercent,
    startDate: a.startDate?.toISODate() ?? null,
    endDate: a.endDate?.toISODate() ?? null,
    plannedUnits: a.plannedUnits === null ? null : Number(a.plannedUnits),
    actualUnits: a.actualUnits === null ? null : Number(a.actualUnits),
    createdAt: a.createdAt.toISO()!,
    updatedAt: a.updatedAt?.toISO() ?? null,
  }
}

/**
 * 审计条目的实名解析（polish-v1-ui-and-assignment）。
 * 由控制器批量预取后按 id 传入，避免前端拿到裸数字 ID、也避免 DTO 内 N+1 查询。
 */
export interface AuditLogNames {
  /** 操作人姓名（fullName || email）。 */
  userName?: string | null
  /** 组织中文名。 */
  organizationName?: string | null
  /** 实体名（当实体为项目时=项目名；否则 null，前端回退「中文类型 #id」）。 */
  entityName?: string | null
  /** 该条目所属项目名（由 project_id 解析，作为上下文）。 */
  projectName?: string | null
}

export function auditLogListItemDto(log: AuditLog, names: AuditLogNames = {}) {
  const metadata = (log.metadata ?? {}) as Record<string, unknown>

  return {
    id: log.id,
    createdAt: log.createdAt.toISO()!,
    action: log.action,
    event: metadata.event ?? null,
    severity: log.severity,
    userId: log.userId === null ? null : Number(log.userId),
    organizationId: log.organizationId === null ? null : Number(log.organizationId),
    projectId: log.projectId === null ? null : Number(log.projectId),
    entityType: log.entityType,
    entityId: log.entityId === null ? null : Number(log.entityId),
    requestId: log.requestId,
    userName: names.userName ?? null,
    organizationName: names.organizationName ?? null,
    entityName: names.entityName ?? null,
    projectName: names.projectName ?? null,
  }
}

export function auditLogDetailDto(log: AuditLog, names: AuditLogNames = {}) {
  const metadata = (log.metadata ?? {}) as Record<string, unknown>
  const changes = log.changes as {
    before?: Record<string, unknown>
    after?: Record<string, unknown>
    truncated?: boolean
  } | null

  return {
    id: log.id,
    createdAt: log.createdAt.toISO()!,
    action: log.action,
    event: metadata.event ?? null,
    severity: log.severity,
    userId: log.userId === null ? null : Number(log.userId),
    organizationId: log.organizationId === null ? null : Number(log.organizationId),
    projectId: log.projectId === null ? null : Number(log.projectId),
    entityType: log.entityType,
    entityId: log.entityId === null ? null : Number(log.entityId),
    requestId: log.requestId,
    userName: names.userName ?? null,
    organizationName: names.organizationName ?? null,
    entityName: names.entityName ?? null,
    projectName: names.projectName ?? null,
    changes,
    metadata,
  }
}

// ---------- 通知类型 ----------

/** 通知类型枚举（与迁移 CHECK 约束一致）。 */
export type NotificationType =
  | 'task_assigned'
  | 'task_unassigned'
  | 'task_blocked'
  | 'task_completed'
  | 'task_schedule_changed'
  | 'task_predecessor_pending'
  | 'comment_added'
  | 'attachment_added'
  | 'project_archived'
  | 'project_restored'
  | 'milestone_due'
  | 'milestone_overdue'
  | 'ai_draft_confirmed'
  | 'ai_draft_imported'
  | 'report_exported'
  | 'report_export_failed'
  | 'external_link_status_changed'
  | 'general'

/** 通知严重级别。 */
export type NotificationSeverity = 'info' | 'warning' | 'error' | 'critical'

/** 通知目标引用（多态）。 */
export interface NotificationTarget {
  type: string
  id: number
}

/** 通知对外 DTO（V2 扩展：含 hiddenAt 和低敏摘要）。 */
export interface NotificationDto {
  id: number
  organizationId: number
  recipientId: number
  type: NotificationType
  title: string
  body: string | null
  severity: NotificationSeverity
  projectId: number | null
  target: NotificationTarget | null
  actionUrl: string | null
  readAt: string | null
  hiddenAt: string | null
  /** 目标资源访问状态：accessible / inaccessible / unknown */
  accessStatus?: 'accessible' | 'inaccessible' | 'unknown' | null
  /** 低敏目标摘要（目标可访问时提供泛化信息） */
  targetSummary?: {
    type: string
    status?: string
    genericTitle?: string
  } | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export interface NotificationListMetaDto {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface NotificationListResponse {
  data: NotificationDto[]
  meta: NotificationListMetaDto
}

export interface UnreadCountResponse {
  unreadCount: number
}

export interface MarkReadResponse {
  success: boolean
  readAt: string
}

export interface MarkAllReadResponse {
  success: boolean
  markedCount: number
}

// ---------- 通知中心 V2 新增类型 ----------

/** 通知类型分组（服务端常量，用于通知中心视图切换）。 */
export type NotificationTypeGroup =
  'all' | 'unread' | 'mentions' | 'assignments' | 'approvals' | 'system'

/** 通知中心筛选参数。 */
export interface NotificationCenterFilters {
  status?: 'read' | 'unread' | 'all'
  typeGroup?: NotificationTypeGroup
  type?: NotificationType
  severity?: NotificationSeverity
  projectId?: number
  dateFrom?: string
  dateTo?: string
  relatedToMe?: boolean
  hidden?: 'include' | 'exclude' | 'only'
  page?: number
  perPage?: number
}

/** 批量操作类型。 */
export type NotificationBatchAction = 'mark_read' | 'mark_unread' | 'hide'

/** 批量操作请求。 */
export interface NotificationBatchRequest {
  action: NotificationBatchAction
  /** 通知 ID 列表（优先于 filters）。 */
  notificationIds?: number[]
}

/** 批量操作响应。 */
export interface NotificationBatchResponse {
  success: boolean
  affectedCount: number
  action: NotificationBatchAction
}

/**
 * 通知对外 DTO 转换（V2 扩展：含 hiddenAt）。
 */
export function notificationDto(n: Notification): NotificationDto {
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
    metadata: metadata ?? null,
    createdAt: n.createdAt.toISO()!,
  }
}

// ---------- 高级搜索 DTO ----------

import type {
  SearchEntityType,
  SearchResultItem,
  SearchResultMeta,
  SearchSortField,
  SearchSortDirection,
  SearchScope,
} from '@aiproj/types'

/** 搜索请求 DTO（对应 POST /api/v1/search 请求体） */
export interface SearchRequestDto {
  keyword?: string
  entityTypes?: SearchEntityType[]
  projectIds?: number[]
  status?: string[]
  assigneeIds?: number[]
  tagIds?: number[]
  dateFrom?: string
  dateTo?: string
  scope?: SearchScope
  sort?: { field: SearchSortField; direction: SearchSortDirection }[]
  page?: number
  perPage?: number
}

/** 搜索响应 DTO（统一 { data, meta }） */
export interface SearchResponseDto {
  data: SearchResultItem[]
  meta: SearchResultMeta
}

/** 搜索建议 DTO */
export interface SearchSuggestionsResponseDto {
  data: {
    entityType: SearchEntityType
    entityId: number
    title: string
    summary: string | null
    target: string
    projectId?: number | null
  }[]
}
