'use client'

/**
 * 风险镜头共享静态元数据与确定性纯函数
 * （v3-ui-next-chart-gallery tasks 4.1-4.3，仅服务风险矩阵 / 登记底册 / 新建抽屉）。
 *
 * - 全部为静态标签表与纯函数（RL-14 确定性渲染：零运行时注入、零副作用）；
 * - 色带规则对齐既有 5×5 矩阵语义：敞口分值 score = 概率 × 影响，
 *   低危 1-4（绿/蓝）、中危 5-9（黄）、高危 10-25（红）三色区间；
 * - 状态机合法转换以共享包 @aiproj/types 的 RISK_ALLOWED_TRANSITIONS 为唯一事实来源，
 *   与后端 transitionStatus 校验严格一致（避免前端给出注定被拒的选项）。
 */
import { RISK_ALLOWED_TRANSITIONS } from '@aiproj/types'
import type { RiskCategory, RiskStatus } from '@/lib/api/risks'

/** 5×5 矩阵单元格选中引用（概率 × 影响坐标，1-5 级）。 */
export interface RiskCellRef {
  probability: number
  impact: number
}

/** 三色区带：低危 / 中危 / 高危。 */
export type RiskTone = 'low' | 'medium' | 'high'

export const RISK_TONE_LABELS: Record<RiskTone, string> = {
  low: '低危',
  medium: '中危',
  high: '高危',
}

/** 概率/影响 1-5 级语义标签（矩阵轴与表单共用）。 */
export const RISK_SCALE_LABELS = ['极低', '低', '中', '高', '极高'] as const

/** 概率/影响 1-5 级极简标签（单元格 aria 用）。 */
export const RISK_LEVEL_SHORT_LABELS = ['1 极低', '2 低', '3 中', '4 高', '5 极高'] as const

export const RISK_CATEGORY_LABELS: Record<RiskCategory, string> = {
  technical: '技术',
  schedule: '进度',
  cost: '成本',
  resource: '资源',
  external: '外部',
  organizational: '组织',
  legal: '法律',
  other: '其他',
}

export const RISK_CATEGORY_OPTIONS: ReadonlyArray<{ value: RiskCategory; label: string }> = (
  [
    'technical',
    'schedule',
    'cost',
    'resource',
    'external',
    'organizational',
    'legal',
    'other',
  ] as const
).map((value) => ({ value, label: RISK_CATEGORY_LABELS[value] }))

export const RISK_STATUS_LABELS: Record<RiskStatus, string> = {
  identified: '已识别',
  analyzing: '分析中',
  mitigating: '缓解中',
  resolved: '已解决',
  accepted: '已接受',
  closed: '已关闭',
}

export const RISK_STATUS_OPTIONS: ReadonlyArray<{ value: RiskStatus; label: string }> = (
  ['identified', 'analyzing', 'mitigating', 'resolved', 'accepted', 'closed'] as const
).map((value) => ({ value, label: RISK_STATUS_LABELS[value] }))

/** 敞口分值（后端 computeScore 同式：概率 × 影响）。 */
export function riskExposureScore(probability: number, impact: number): number {
  return probability * impact
}

/** 三色区间：低危 1-4 / 中危 5-9 / 高危 10-25（对齐既有 5×5 矩阵语义）。 */
export function riskExposureTone(probability: number, impact: number): RiskTone {
  const score = riskExposureScore(probability, impact)
  if (score >= 10) return 'high'
  if (score >= 5) return 'medium'
  return 'low'
}

/** 依据数值敞口分（1-25 区间）判定色带；登记表分值列着色与矩阵语义同源。 */
export function riskScoreTone(score: number): RiskTone {
  if (score >= 10) return 'high'
  if (score >= 5) return 'medium'
  return 'low'
}

/** 当前状态可合法推进到的目标状态（与后端 RISK_ALLOWED_TRANSITIONS 同源）。 */
export function nextRiskStatuses(status: RiskStatus): RiskStatus[] {
  return [...(RISK_ALLOWED_TRANSITIONS[status] ?? [])]
}

/** 1-5 级滑杆/下拉的可选项（表单共用）。 */
export const RISK_SCALE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  1, 2, 3, 4, 5,
].map((value) => ({ value, label: `${value} · ${RISK_SCALE_LABELS[value - 1]}` }))
