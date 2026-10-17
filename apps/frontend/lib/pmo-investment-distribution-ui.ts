import type {
  PmoInvestmentBucket,
  PmoInvestmentDistributionBasis,
  PmoInvestmentDistributionDimension,
  PmoInvestmentDisplayMode,
} from '@aiproj/types'

export const INVESTMENT_BASIS_LABELS: Record<PmoInvestmentDistributionBasis, string> = {
  project_count: '项目数',
  planned_effort_hours: '计划工时',
  estimated_effort_hours: '估算工时',
  resource_allocation_percent: '资源分配比例',
  budget_amount: '预算金额',
  actual_cost: '实际成本',
  forecast_cost: '预测成本',
  budget_execution_rate: '预算执行率',
  roi: 'ROI',
  revenue: '收益',
  npv: '净现值',
  irr: '内部收益率',
}

export const INVESTMENT_DIMENSION_LABELS: Record<PmoInvestmentDistributionDimension, string> = {
  project_type: '项目类型',
  lifecycle_phase: '生命周期阶段',
  priority: '优先级',
  status: '项目状态',
  manager: '负责人',
  department: '部门',
  strategic_theme: '战略主题',
  traffic_light_status: '交通灯',
}

export const INVESTMENT_DISPLAY_MODE_LABELS: Record<PmoInvestmentDisplayMode, string> = {
  donut: '环形',
  pie: '饼图',
  horizontal_bar: '横向条形',
  stacked_bar: '堆叠条',
  flow: '流向',
  matrix: '矩阵',
}

const CHART_COLORS = [
  '#3B6BEF',
  '#16A34A',
  '#D97706',
  '#7C3AED',
  '#0891B2',
  '#DC2626',
  '#64748B',
  '#0F766E',
]

export interface InvestmentChartDatum {
  key: string
  label: string
  shortLabel: string
  total: number | null
  percent: number
  projectCount: number | null
  status: PmoInvestmentBucket['status']
  color: string
  warningCount: number
}

export function toInvestmentChartData(
  buckets: readonly PmoInvestmentBucket[],
): InvestmentChartDatum[] {
  return buckets.map((bucket, index) => ({
    key: bucket.key,
    label: bucket.label,
    shortLabel: truncateLabel(bucket.label),
    total: bucket.total,
    percent: bucket.percent,
    projectCount: bucket.projectCount,
    status: bucket.status,
    color:
      bucket.status === 'redacted' || bucket.status === 'forbidden'
        ? '#94A3B8'
        : (CHART_COLORS[index % CHART_COLORS.length] ?? '#3B6BEF'),
    warningCount: bucket.warnings.length,
  }))
}

export function isUnsupportedFinancialSummary(warningCodes: readonly string[]): boolean {
  return warningCodes.some(
    (code) => code === 'FINANCIAL_BASIS_UNSUPPORTED' || code === 'FINANCIAL_SOURCE_UNAVAILABLE',
  )
}

export function formatInvestmentValue(value: number | null, basis: string): string {
  if (value === null) return '不可用'
  if (basis.endsWith('_hours')) return `${value.toLocaleString('zh-CN')} 小时`
  if (basis === 'resource_allocation_percent') return `${value.toLocaleString('zh-CN')}%`
  return value.toLocaleString('zh-CN')
}

function truncateLabel(label: string): string {
  return label.length > 12 ? `${label.slice(0, 11)}…` : label
}
