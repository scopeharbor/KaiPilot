import vine from '@vinejs/vine'

/**
 * 任务校验器（task-management / task-status-workflow）。
 *
 * 仅做字段级格式校验；跨字段（end_date ≥ start_date）与存在性（assignee/reviewer/
 * parent 属同项目、被指派者为活跃成员）经 Service 层判定（design D1，业务规则在 Service）。
 */

const taskName = () => vine.string().trim().minLength(1).maxLength(255)
const nullableString = (max: number) => vine.string().trim().maxLength(max).nullable().optional()

const isoDate = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()

const taskStatus = () =>
  vine.enum(['not_started', 'in_progress', 'completed', 'blocked', 'on_hold', 'cancelled'] as const)

const taskPriority = () => vine.enum(['lowest', 'low', 'medium', 'high', 'highest'] as const)

const taskType = () => vine.enum(['task', 'milestone', 'summary', 'deliverable'] as const)

const idField = () => vine.number().withoutDecimals().positive()
const taskIds = () => vine.array(idField()).minLength(1).maxLength(100).distinct()

/**
 * 创建任务：name 必填，其余选填。project_id 取自路由，不接受请求体覆盖（spec）。
 * 不接受 dependencies 数组（留 T015）。
 * V3：assignee_type 可选（'user' | 'agent'），默认 'user'。
 */
export const createTaskValidator = vine.compile(
  vine.object({
    name: taskName(),
    description: nullableString(5000),
    status: taskStatus().optional(),
    priority: taskPriority().optional(),
    taskType: taskType().optional(),
    startDate: isoDate(),
    endDate: isoDate(),
    durationDays: vine.number().withoutDecimals().range([0, 100000]).optional(),
    estimatedHours: vine.number().withoutDecimals().range([0, 1000000]).optional(),
    assigneeId: idField().optional(),
    assigneeType: vine.enum(['user', 'agent'] as const).optional(),
    reviewerId: idField().optional(),
    parentTaskId: idField().optional(),
    wbsNodeId: idField().optional(),
    milestoneId: idField().optional(),
    costEstimateCents: vine
      .number()
      .withoutDecimals()
      .range([0, Number.MAX_SAFE_INTEGER])
      .optional(),
    customFields: vine.any().optional(),
    // V3 图表馆 RACI/LOB（v3-chart-gallery-data-foundation）：RACI 指派/知会人数组
    // （正整数去重；成员存在性由 TaskService 校验）与流水空间单元/工序阶段。
    consultedUserIds: vine.array(idField()).maxLength(100).distinct().nullable().optional(),
    informedUserIds: vine.array(idField()).maxLength(100).distinct().nullable().optional(),
    locationUnit: vine.string().trim().maxLength(64).nullable().optional(),
    cycleStage: vine.string().trim().maxLength(64).nullable().optional(),
  }),
)

/**
 * 编辑任务：全部选填（部分更新）。状态变更须遵循状态机（Service 层校验）。
 * V3：assignee_type 可选（'user' | 'agent'）。
 */
export const updateTaskValidator = vine.compile(
  vine.object({
    name: taskName().optional(),
    description: nullableString(5000),
    status: taskStatus().optional(),
    priority: taskPriority().optional(),
    taskType: taskType().optional(),
    startDate: isoDate(),
    endDate: isoDate(),
    durationDays: vine.number().withoutDecimals().range([0, 100000]).optional(),
    estimatedHours: vine.number().withoutDecimals().range([0, 1000000]).optional(),
    actualHours: vine.number().withoutDecimals().range([0, 1000000]).optional(),
    assigneeId: idField().nullable().optional(),
    assigneeType: vine.enum(['user', 'agent'] as const).optional(),
    reviewerId: idField().nullable().optional(),
    parentTaskId: idField().nullable().optional(),
    wbsNodeId: idField().nullable().optional(),
    milestoneId: idField().nullable().optional(),
    costEstimateCents: vine
      .number()
      .withoutDecimals()
      .range([0, Number.MAX_SAFE_INTEGER])
      .optional(),
    costActualCents: vine.number().withoutDecimals().range([0, Number.MAX_SAFE_INTEGER]).optional(),
    progressPercent: vine.number().withoutDecimals().range([0, 100]).optional(),
    customFields: vine.any().optional(),
    // V3 图表馆 RACI/LOB（v3-chart-gallery-data-foundation）：RACI 指派/知会人数组
    // （正整数去重；组织成员存在性由 TaskService 校验）与流水线空间单元/工序阶段。
    consultedUserIds: vine.array(idField()).maxLength(100).distinct().nullable().optional(),
    informedUserIds: vine.array(idField()).maxLength(100).distinct().nullable().optional(),
    locationUnit: vine.string().trim().maxLength(64).nullable().optional(),
    cycleStage: vine.string().trim().maxLength(64).nullable().optional(),
  }),
)

/**
 * 状态端点：status 必填，可选 actual_hours / progress_percent / note。
 */
export const changeTaskStatusValidator = vine.compile(
  vine.object({
    status: taskStatus(),
    actualHours: vine.number().withoutDecimals().range([0, 1000000]).optional(),
    progressPercent: vine.number().withoutDecimals().range([0, 100]).optional(),
    note: vine.string().trim().maxLength(2000).optional(),
  }),
)

/**
 * 列表查询参数：过滤 / 排序 / 分页（perPage ≤ 100，默认 20）。
 */
export const listTasksValidator = vine.compile(
  vine.object({
    status: vine
      .enum(['not_started', 'in_progress', 'completed', 'blocked', 'on_hold', 'cancelled'] as const)
      .optional(),
    priority: vine.enum(['lowest', 'low', 'medium', 'high', 'highest'] as const).optional(),
    assigneeId: idField().optional(),
    search: vine.string().trim().maxLength(255).optional(),
    roleHint: vine.string().trim().maxLength(64).optional(),
    dateFrom: isoDate(),
    dateTo: isoDate(),
    sort: vine.string().trim().maxLength(64).optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
  }),
)

const batchUpdateData = vine.object({
  priority: taskPriority().optional(),
  startDate: isoDate(),
  endDate: isoDate(),
  estimatedHours: vine.number().withoutDecimals().range([0, 1000000]).optional(),
  progressPercent: vine.number().withoutDecimals().range([0, 100]).optional(),
  reviewerId: idField().nullable().optional(),
})

/**
 * 批量动作使用判别式契约，避免任意 Partial<Task> 绕过结构字段与专用权限。
 */
export const batchTasksValidator = vine.compile(
  vine.union([
    vine.union.if(
      (value) => value.action === 'update',
      vine.object({
        action: vine.literal('update'),
        taskIds: taskIds(),
        data: batchUpdateData,
      }),
    ),
    vine.union.if(
      (value) => value.action === 'reassign',
      vine.object({
        action: vine.literal('reassign'),
        taskIds: taskIds(),
        data: vine.object({
          assigneeId: idField().nullable(),
          assigneeType: vine.enum(['user', 'agent'] as const).optional(),
        }),
      }),
    ),
    vine.union.if(
      (value) => value.action === 'change_status',
      vine.object({
        action: vine.literal('change_status'),
        taskIds: taskIds(),
        data: vine.object({
          status: taskStatus(),
          actualHours: vine.number().withoutDecimals().range([0, 1000000]).optional(),
          progressPercent: vine.number().withoutDecimals().range([0, 100]).optional(),
          note: vine.string().trim().maxLength(2000).optional(),
        }),
      }),
    ),
    vine.union.if(
      (value) => value.action === 'delete',
      vine.object({
        action: vine.literal('delete'),
        taskIds: taskIds(),
      }),
    ),
  ]),
)

export const listRecycleBinTasksValidator = vine.compile(
  vine.object({
    search: vine.string().trim().maxLength(255).optional(),
    sort: vine.enum(['-deletedAt', '+deletedAt', '+name', '-name'] as const).optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
  }),
)

export const batchRestoreTasksValidator = vine.compile(
  vine.object({
    taskIds: taskIds(),
  }),
)
