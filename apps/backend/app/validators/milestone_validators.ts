import vine from '@vinejs/vine'

/**
 * 里程碑校验器（milestone-management）。
 *
 * 仅做字段级格式校验；组织/项目归属、`achieved` 显式确认守卫、状态推导等业务规则在 Service 层
 * （对齐 task 校验器分工，design D2）。
 */

const milestoneName = () => vine.string().trim().minLength(1).maxLength(255)
const description = () => vine.string().trim().maxLength(5000).nullable().optional()

/** 目标日期：'YYYY-MM-DD'，可为 null（清空）或省略。 */
const plannedDate = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()

const milestoneStatus = () =>
  vine.enum(['not_started', 'planned', 'at_risk', 'achieved', 'missed'] as const)

const displayOrder = () => vine.number().withoutDecimals().range([0, 100000]).optional()

/**
 * 创建里程碑：name 必填，其余选填。project_id 取自路由，不接受请求体覆盖。
 */
export const createMilestoneValidator = vine.compile(
  vine.object({
    name: milestoneName(),
    description: description(),
    status: milestoneStatus().optional(),
    plannedDate: plannedDate(),
    displayOrder: displayOrder(),
  }),
)

/**
 * 编辑里程碑：全部选填（部分更新）。`achieved` 的显式确认守卫在 Service 层。
 */
export const updateMilestoneValidator = vine.compile(
  vine.object({
    name: milestoneName().optional(),
    description: description(),
    status: milestoneStatus().optional(),
    plannedDate: plannedDate(),
    displayOrder: displayOrder(),
  }),
)

/**
 * 列表查询参数：状态过滤 / 排序 / 分页（perPage ≤ 100，默认 50）。
 */
export const listMilestonesValidator = vine.compile(
  vine.object({
    status: milestoneStatus().optional(),
    sort: vine.string().trim().maxLength(64).optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
  }),
)
