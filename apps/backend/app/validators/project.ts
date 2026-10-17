import vine from '@vinejs/vine'
import { PROJECT_INVESTMENT_TYPE_VALUES, PROJECT_PORTFOLIO_FACT_SOURCE_VALUES } from '@aiproj/types'

const projectCode = () =>
  vine
    .string()
    .trim()
    .minLength(1)
    .maxLength(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9\-_]*$/)

const projectName = () => vine.string().trim().minLength(1).maxLength(255)
const nullableString = (maxLength: number) =>
  vine.string().trim().maxLength(maxLength).nullable().optional()

const projectStatus = () =>
  vine.enum([
    'draft',
    'planning',
    'active',
    'on_hold',
    'completed',
    'cancelled',
    'archived',
  ] as const)

const projectPriority = () => vine.enum(['low', 'medium', 'high', 'critical'] as const)

const isoDateString = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()

const currency = () => vine.string().trim().maxLength(3).optional()

const settingsSchema = () =>
  vine
    .object({
      workdays: vine.array(vine.number().range([0, 6])).optional(),
      holidays: vine.array(vine.string()).optional(),
      timezone: vine.string().trim().maxLength(64).optional(),
    })
    .nullable()
    .optional()

// ── v3-database-schema-expansion §4.1 —— V3 组合事实校验 ──
// investment_type / portfolio_fact_source 绑定共享契约枚举白名单（拒绝不支持值）。
// department_key / department_name / business_line / strategy_theme / program_key 为有界字符串。
// forecast_cost_cents 为正整数（分）；forecast_end_date 为 ISO 日期。
// project_manager_id 为正整数（user id），成员归属在 service 层校验（非泄露）。
// custom_fields 接受任意 JSON 对象（拒绝 root array），深度/键数/可执行键/secret-like
// 在 service 层调 validateBoundedProjectCustomFields 二次强制（vine 难以表达深度与内容语义）。
const investmentType = () =>
  vine.enum(PROJECT_INVESTMENT_TYPE_VALUES as readonly string[] as never).optional()

const portfolioFactSource = () =>
  vine.enum(PROJECT_PORTFOLIO_FACT_SOURCE_VALUES as readonly string[] as never).optional()

const departmentKey = () => vine.string().trim().maxLength(64).optional()
const departmentName = () => vine.string().trim().maxLength(128).nullable().optional()
const businessLine = () => vine.string().trim().maxLength(128).nullable().optional()
const strategyTheme = () => vine.string().trim().maxLength(128).nullable().optional()
const programKey = () => vine.string().trim().maxLength(64).optional()

const forecastCostCents = () => vine.number().withoutDecimals().positive().optional()
const forecastEndDate = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
const projectManagerId = () => vine.number().withoutDecimals().positive().optional()

// vine.accept 接受任意 JSON 值；service 层 validateBoundedProjectCustomFields 强制 object 形状与安全。
const customFields = () => vine.any().optional()

export const createProjectValidator = vine.create({
  name: projectName(),
  code: projectCode().optional(),
  description: nullableString(2000),
  category: nullableString(64),
  status: projectStatus().optional(),
  priority: projectPriority().optional(),
  startDate: isoDateString(),
  endDate: isoDateString(),
  budgetCents: vine.number().withoutDecimals().positive().optional(),
  currency: currency(),
  settings: settingsSchema(),
  // V3 组合事实
  projectManagerId: projectManagerId(),
  departmentKey: departmentKey(),
  departmentName: departmentName(),
  businessLine: businessLine(),
  investmentType: investmentType(),
  strategyTheme: strategyTheme(),
  programKey: programKey(),
  forecastCostCents: forecastCostCents(),
  forecastEndDate: forecastEndDate(),
  customFields: customFields(),
  portfolioFactSource: portfolioFactSource(),
})

export const updateProjectValidator = vine.create({
  name: projectName().optional(),
  code: projectCode().optional(),
  description: nullableString(2000),
  category: nullableString(64),
  status: projectStatus().optional(),
  priority: projectPriority().optional(),
  startDate: isoDateString(),
  endDate: isoDateString(),
  budgetCents: vine.number().withoutDecimals().positive().optional(),
  currency: currency(),
  settings: settingsSchema(),
  // V3 组合事实（全部选填，部分更新；projectManagerId 可显式置 null 清空经理）
  // vine.union 跨类型成员有类型限制，改用 vine.any() + controller/service 归一（与 customFields 同策略）
  projectManagerId: vine.any().optional(),
  departmentKey: vine.string().trim().maxLength(64).nullable().optional(),
  departmentName: departmentName(),
  businessLine: businessLine(),
  investmentType: investmentType(),
  strategyTheme: strategyTheme(),
  programKey: vine.string().trim().maxLength(64).nullable().optional(),
  forecastCostCents: vine.number().withoutDecimals().positive().nullable().optional(),
  forecastEndDate: forecastEndDate(),
  customFields: vine.any().optional(),
  portfolioFactSource: portfolioFactSource(),
})

export const workingCalendarValidator = vine.create({
  version: vine.number().withoutDecimals().optional(),
  workdays: vine.array(vine.number()).optional(),
  holidays: vine.array(vine.string()).optional(),
  extraWorkdays: vine.array(vine.string()).optional(),
})
