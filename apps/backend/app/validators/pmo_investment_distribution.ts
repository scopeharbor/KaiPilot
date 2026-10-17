import vine from '@vinejs/vine'
import {
  PMO_INVESTMENT_DISTRIBUTION_BASIS_VALUES,
  PMO_INVESTMENT_DISTRIBUTION_DIMENSION_VALUES,
  PMO_INVESTMENT_DISPLAY_MODE_VALUES,
  PMO_INVESTMENT_MAX_TOP_N,
  PMO_INVESTMENT_TREND_WINDOW_VALUES,
} from '@aiproj/types'

const basis = () => vine.enum(PMO_INVESTMENT_DISTRIBUTION_BASIS_VALUES)
const dimension = () => vine.enum(PMO_INVESTMENT_DISTRIBUTION_DIMENSION_VALUES)
const displayMode = () => vine.enum(PMO_INVESTMENT_DISPLAY_MODE_VALUES)
const trendWindow = () => vine.enum(PMO_INVESTMENT_TREND_WINDOW_VALUES)

/**
 * PMO 非财务投入分布验证器（v3-pmo-investment-distribution §3.1）。
 * 所有组织级聚合参数必须在运行查询前被白名单和上限约束。
 */
export const pmoInvestmentDistributionSummaryValidator = vine.compile(
  vine.object({
    basis: basis().optional(),
    dimension: dimension().optional(),
    displayMode: displayMode().optional(),
    topN: vine.number().positive().max(PMO_INVESTMENT_MAX_TOP_N).optional(),
    filterStatus: vine.string().maxLength(50).optional(),
    filterPriority: vine.string().maxLength(50).optional(),
    search: vine.string().maxLength(200).optional(),
  }),
)

export const pmoInvestmentDistributionTrendValidator = vine.compile(
  vine.object({
    basis: basis().optional(),
    dimension: dimension().optional(),
    displayMode: displayMode().optional(),
    topN: vine.number().positive().max(PMO_INVESTMENT_MAX_TOP_N).optional(),
    trendWindow: trendWindow().optional(),
    filterStatus: vine.string().maxLength(50).optional(),
    filterPriority: vine.string().maxLength(50).optional(),
    search: vine.string().maxLength(200).optional(),
  }),
)

export const pmoInvestmentDistributionDrillDownValidator = vine.compile(
  vine.object({
    bucketKey: vine.string().trim().maxLength(120),
    basis: basis().optional(),
    dimension: dimension().optional(),
    displayMode: displayMode().optional(),
    topN: vine.number().positive().max(PMO_INVESTMENT_MAX_TOP_N).optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
    filterStatus: vine.string().maxLength(50).optional(),
    filterPriority: vine.string().maxLength(50).optional(),
    search: vine.string().maxLength(200).optional(),
  }),
)
