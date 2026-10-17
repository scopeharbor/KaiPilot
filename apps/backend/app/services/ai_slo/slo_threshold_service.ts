/**
 * v3-ai-quality-cost-console-deferred-p1 —— SLO 阈值持久化读取服务。
 *
 * 设计 D1/D2：
 * - 每组织每指标一行（ai_slo_thresholds），缺失指标用声明式默认阈值兜底；
 * - 空表启动合法：全部指标回退到声明式默认值；
 * - 组织隔离：全部查询附加 organization_id 过滤；
 * - 只读：本服务不提供任何写路径（阈值受控写另立范围）。
 *
 * @aiproj/backend
 */

import type { AiSloDefinition, AiSloIndicator } from '@aiproj/types'
import { AI_SLO_INDICATORS, isAiSloIndicator } from '@aiproj/types'
import AiSloThreshold from '#models/ai_slo_threshold'

/** 声明式默认阈值的来源标记。 */
export const DECLARED_DEFAULT_SOURCE = 'declared_default'

/** 默认评估窗口：24 小时。 */
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000

/** 默认定义的固定声明时间（确定性，不随请求漂移）。 */
const DEFAULT_DECLARED_AT = '2026-01-01T00:00:00.000Z'

interface DefaultSloSeed {
  warning: { operator: 'gt' | 'gte' | 'lt' | 'lte'; value: number; unit: string }
  critical: { operator: 'gt' | 'gte' | 'lt' | 'lte'; value: number; unit: string }
}

/**
 * 声明式默认阈值（D2）。
 * 阈值语义：上限语义，越界 = 实际值超过阈值（compareAiSloThreshold）。
 */
const DEFAULT_SLO_SEEDS: Record<AiSloIndicator, DefaultSloSeed> = {
  ttft: {
    warning: { operator: 'gt', value: 2000, unit: 'ms' },
    critical: { operator: 'gt', value: 5000, unit: 'ms' },
  },
  failure_rate: {
    warning: { operator: 'gt', value: 0.05, unit: 'ratio' },
    critical: { operator: 'gt', value: 0.2, unit: 'ratio' },
  },
  degradation_rate: {
    warning: { operator: 'gt', value: 0.1, unit: 'ratio' },
    critical: { operator: 'gt', value: 0.3, unit: 'ratio' },
  },
  budget_burn: {
    warning: { operator: 'gt', value: 0.8, unit: 'ratio' },
    critical: { operator: 'gt', value: 1.0, unit: 'ratio' },
  },
  latency_violation: {
    warning: { operator: 'gt', value: 0.05, unit: 'ratio' },
    critical: { operator: 'gt', value: 0.2, unit: 'ratio' },
  },
}

/** 由种子生成声明式默认定义。 */
function buildDefaultDefinition(
  organizationId: number,
  indicator: AiSloIndicator,
): AiSloDefinition {
  const seed = DEFAULT_SLO_SEEDS[indicator]
  return {
    id: `default-${indicator}`,
    organizationId,
    indicator,
    warning: { ...seed.warning, source: DECLARED_DEFAULT_SOURCE },
    critical: { ...seed.critical, source: DECLARED_DEFAULT_SOURCE },
    windowMs: DEFAULT_WINDOW_MS,
    runbookRef: `runbook://ai-slo/${indicator}`,
    createdAt: DEFAULT_DECLARED_AT,
    updatedAt: DEFAULT_DECLARED_AT,
  }
}

/** 防御性时间转换：SQLite 读出的 timestamp 可能是 Date 或 ISO 字符串。 */
function toIso(value: unknown, fallbackIso: string): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return fallbackIso
}

/** 持久化行的最小形状（纯函数入参，便于单测）。 */
export interface SloThresholdRowLike {
  id: number
  organizationId: number
  indicator: string
  warningOperator: string
  warningValue: number
  warningUnit: string
  criticalOperator: string
  criticalValue: number
  criticalUnit: string
  windowMs: number
  runbookRef: string
  thresholdSource: string
  createdAt: unknown
  updatedAt: unknown
}

/**
 * 纯函数：把持久化行与声明式默认合并为完整五指标定义。
 * 持久化行优先；非法 indicator 行被跳过；缺失指标用默认补齐。
 */
export function mergeSloDefinitionsWithDefaults(
  rows: readonly SloThresholdRowLike[],
  organizationId: number,
): AiSloDefinition[] {
  const persisted = new Map<AiSloIndicator, AiSloDefinition>()
  for (const row of rows) {
    if (!isAiSloIndicator(row.indicator)) continue
    persisted.set(row.indicator, {
      id: `persisted-${row.id}`,
      organizationId: row.organizationId,
      indicator: row.indicator,
      warning: {
        operator: row.warningOperator as AiSloDefinition['warning']['operator'],
        value: row.warningValue,
        unit: row.warningUnit,
        source: row.thresholdSource,
      },
      critical: {
        operator: row.criticalOperator as AiSloDefinition['critical']['operator'],
        value: row.criticalValue,
        unit: row.criticalUnit,
        source: row.thresholdSource,
      },
      windowMs: row.windowMs,
      runbookRef: row.runbookRef,
      createdAt: toIso(row.createdAt, DEFAULT_DECLARED_AT),
      updatedAt: toIso(row.updatedAt, DEFAULT_DECLARED_AT),
    })
  }

  return AI_SLO_INDICATORS.map(
    (indicator) => persisted.get(indicator) ?? buildDefaultDefinition(organizationId, indicator),
  )
}

export class SloThresholdService {
  /**
   * 读取某组织的全部 SLO 定义：持久化行优先，缺失指标用声明式默认补齐。
   * 全部五个指标恒有定义（空表 = 全默认）。
   */
  async getDefinitions(organizationId: number): Promise<AiSloDefinition[]> {
    const rows = await AiSloThreshold.query().where('organization_id', organizationId)
    return mergeSloDefinitionsWithDefaults(rows, organizationId)
  }
}

export const sloThresholdService = new SloThresholdService()
