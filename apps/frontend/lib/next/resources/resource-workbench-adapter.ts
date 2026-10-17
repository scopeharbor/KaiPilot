/**
 * 资源域工作台纯函数适配层（v3-ui-next-resource-team-domains W1 · tasks 1.1）。
 *
 * - 团队负载计算 100% 复用 `lib/next/charts/resource-load-adapter.ts` 的成熟纯函数与
 *   色彩常量（buildTeamRows / createDefaultLoadWindow / resourceRoleLabel /
 *   NX_NORMAL_COLOR / NX_OVERLOAD_COLOR 等），保证资源工作台紧凑负荷面板与图表馆
 *   深度直方图的数据契约、警戒阈值（>100%）与色彩规范同源一致；
 * - 轻量封装：全类型资源多维条件过滤（类型 / 状态 / 名称模糊）、类型与状态展示
 *   标签、技能标签解析、单位成本格式化、分配窗口文本与紧凑负荷条带分段计算；
 * - 新建资源表单 Zod 校验契约（名称 / 类型必填，工时 / 时区 / 单价合法性）；
 * - 纯函数、零 DOM、零网络（RL-01 只读分析），jsdom 单测直接调用。
 */
import { z } from 'zod'
import type {
  AllocationType,
  Resource,
  ResourceRole,
  ResourceStatus,
  ResourceType,
} from '@/lib/api/resources'
import {
  NX_NORMAL_COLOR,
  NX_OVERLOAD_COLOR,
  buildTeamRows,
  createDefaultLoadWindow,
  formatHours,
  resourceRoleLabel,
  type LoadWindow,
  type TeamMemberRow,
} from '@/lib/next/charts/resource-load-adapter'

// ---------------------------------------------------------------------------
// 图表馆同源再导出（工作台只读视图与深度直方图共享同一批纯函数/色彩/阈值）
// ---------------------------------------------------------------------------
export {
  NX_NORMAL_COLOR,
  NX_OVERLOAD_COLOR,
  buildTeamRows,
  createDefaultLoadWindow,
  formatHours,
  resourceRoleLabel,
}
export type { LoadWindow, TeamMemberRow }

// ---------------------------------------------------------------------------
// 展示标签映射（全类型资源底册）
// ---------------------------------------------------------------------------

/** 资源类型代码 → 简体中文标签。 */
export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  human: '人员',
  material: '物料',
  equipment: '设备',
  budget: '预算',
}

/** 资源状态代码 → 简体中文标签。 */
export const RESOURCE_STATUS_LABELS: Record<ResourceStatus, string> = {
  active: '活跃',
  inactive: '停用',
}

/** 分配类型代码 → 简体中文标签。 */
export const ALLOCATION_TYPE_LABELS: Record<AllocationType, string> = {
  assigned: '已指派',
  allocated: '已分配',
  reserved: '预留',
}

/** 资源角色枚举（新建表单角色下拉白名单）。 */
export const RESOURCE_ROLE_OPTIONS: ReadonlyArray<ResourceRole> = [
  'owner',
  'project_manager',
  'team_lead',
  'member',
  'viewer',
]

/** 类型标签：未知代码兜底返回原文。 */
export function resourceTypeLabel(type: ResourceType | string): string {
  return RESOURCE_TYPE_LABELS[type as ResourceType] ?? type
}

/** 状态标签：未知代码兜底返回原文。 */
export function resourceStatusLabel(status: ResourceStatus | string): string {
  return RESOURCE_STATUS_LABELS[status as ResourceStatus] ?? status
}

/** 分配类型标签：未知代码兜底返回原文。 */
export function allocationTypeLabel(type: AllocationType | string): string {
  return ALLOCATION_TYPE_LABELS[type as AllocationType] ?? type
}

// ---------------------------------------------------------------------------
// 多维条件过滤（类型 / 状态 / 名称模糊，客户端即时收敛）
// ---------------------------------------------------------------------------

export interface ResourceFilterCriteria {
  /** 'all' 与 '' 等价于不过滤。 */
  resourceType?: ResourceType | 'all' | '' | null
  status?: ResourceStatus | 'all' | '' | null
  /** 名称不区分大小写子串匹配；空白与空串不过滤。 */
  keyword?: string | null
}

/** 全类型资源底册多维过滤纯函数：交集过滤，任一条件缺省即不过滤。 */
export function filterResources(
  resources: readonly Resource[],
  criteria: ResourceFilterCriteria = {},
): Resource[] {
  const type = criteria.resourceType
  const status = criteria.status
  const keyword = criteria.keyword?.trim().toLowerCase() ?? ''
  return resources.filter((resource) => {
    if (type && type !== 'all' && resource.resourceType !== type) return false
    if (status && status !== 'all' && resource.status !== status) return false
    if (keyword && !resource.name.toLowerCase().includes(keyword)) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// 展示格式化
// ---------------------------------------------------------------------------

/**
 * 技能标签解析：后端可能存 JSON 数组字符串或逗号/顿号分隔文本，
 * 一律归一为去空数组（纯函数，容忍非法输入）。
 */
export function parseSkillTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  const trimmed = raw.trim()
  if (trimmed === '') return []
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      const tags = parsed.filter((tag): tag is string => typeof tag === 'string')
      return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)))
    }
    // 合法 JSON 但非数组（对象/标量）——不当作逗号分隔技能文本，返回空。
    return []
  } catch {
    /* 非 JSON 文本，回落分隔符解析 */
  }
  return Array.from(
    new Set(
      trimmed
        .split(/[,，、;；|]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  )
}

/** 单位成本（分）→ 人民币文本；null 返回 '—'。 */
export function formatUnitCost(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return `¥${(cents / 100).toFixed(2)}`
}

/** 分配窗口文本：单侧缺失展示单边，双侧缺失返回 '—'。 */
export function formatAllocationRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): string {
  if (!startDate && !endDate) return '—'
  if (startDate && endDate) return `${startDate} ~ ${endDate}`
  return startDate ? `自 ${startDate}` : `至 ${endDate}`
}

// ---------------------------------------------------------------------------
// 紧凑负荷条带分段（Compact Load HUD）
// ---------------------------------------------------------------------------

export interface CompactLoadBarModel {
  /** 条带基准量（容量与分配中的较大值），保证双段不溢出容器。 */
  scaleHours: number
  /** 额定容量以内蓝色段（占条带宽度 %，0~100）。 */
  normalPercent: number
  /** 超过 100% 的警戒红段（占条带宽度 %，超载时 >0）。 */
  overloadPercent: number
  totalCapacityHours: number
  totalAllocatedHours: number
  utilizationPercent: number
  overloaded: boolean
  idle: boolean
}

/**
 * 负荷条带分段计算：以 max(总额定容量, 总分配工时) 为条带基准宽度——
 * - 正常成员：蓝色段 = 已分配/额定容量，余下为未利用留白；
 * - 超载成员：条带先铺满额定容量（冷蓝），随后超载部分以警戒红追加至满带，
 *   双通道色与图表馆直方图（正常 NX_NORMAL_COLOR / 超载 NX_OVERLOAD_COLOR）完全同源。
 */
export function buildCompactLoadBar(row: TeamMemberRow): CompactLoadBarModel {
  const scaleHours = Math.max(row.totalCapacityHours, row.totalAllocatedHours, 1)
  const normalHours = Math.min(row.totalAllocatedHours, row.totalCapacityHours)
  const overloadHours = Math.max(0, row.totalAllocatedHours - row.totalCapacityHours)
  return {
    scaleHours,
    normalPercent: Math.round((normalHours / scaleHours) * 10_000) / 100,
    overloadPercent: Math.round((overloadHours / scaleHours) * 10_000) / 100,
    totalCapacityHours: row.totalCapacityHours,
    totalAllocatedHours: row.totalAllocatedHours,
    utilizationPercent: row.utilizationPercent,
    overloaded: row.overloaded,
    idle: row.idle,
  }
}

// ---------------------------------------------------------------------------
// 新建资源表单 Zod 校验契约（名称/类型必填，工时/时区/单价合法性）
// ---------------------------------------------------------------------------

/** 成本输入以元为单位的表单载荷。 */
export interface ResourceFormFields {
  name: string
  resourceType: ResourceType
  role: ResourceRole
  /** 元字符串，空串按 null 处理。 */
  costInput: string
  email: string
  timezone: string
  /** 0.5~24 的日额定工时。 */
  dailyCapacityHoursInput: string
  skillTagText: string
}

export const resourceFormSchema = z.object({
  name: z.string().trim().min(1, '请输入资源名称').max(120, '资源名称最长 120 个字符'),
  resourceType: z.enum(['human', 'material', 'equipment', 'budget']),
  role: z.enum(['owner', 'project_manager', 'team_lead', 'member', 'viewer']),
  timezone: z.string().trim().min(1, '请输入时区').max(64, '时区标识过长'),
  email: z
    .string()
    .trim()
    .refine((value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
      message: '邮箱格式不合法',
    }),
  dailyCapacityHoursInput: z
    .string()
    .trim()
    .min(1, '请填写日额定工时')
    .refine((value) => {
      const hours = Number(value)
      return Number.isFinite(hours) && hours >= 0.5 && hours <= 24
    }, '日额定工时需在 0.5 ~ 24 小时之间'),
  costInput: z
    .string()
    .trim()
    .refine((value) => {
      if (value === '') return true
      const cost = Number(value)
      return Number.isFinite(cost) && cost >= 0 && cost <= 1_000_000
    }, '单价需为 0 ~ 1000000 之间的非负数'),
  skillTagText: z.string().trim().max(500, '技能标签过长'),
})

export type ResourceFormValues = z.infer<typeof resourceFormSchema>

/** 表单载荷 → POST /resources 请求体（元 → 分，标签文本 → 数组）。 */
export function toCreateResourceInput(values: ResourceFormValues): {
  name: string
  resourceType: ResourceType
  role: ResourceRole
  timezone: string
  email: string | null
  dailyCapacityHours: number
  costPerUnitCents: number | null
  skillTags: string[]
} {
  return {
    name: values.name.trim(),
    resourceType: values.resourceType,
    role: values.role,
    timezone: values.timezone.trim(),
    email: values.email.trim() === '' ? null : values.email.trim(),
    dailyCapacityHours: Number(values.dailyCapacityHoursInput),
    costPerUnitCents:
      values.costInput.trim() === '' ? null : Math.round(Number(values.costInput) * 100),
    skillTags: values.skillTagText === '' ? [] : parseSkillTags(values.skillTagText),
  }
}
