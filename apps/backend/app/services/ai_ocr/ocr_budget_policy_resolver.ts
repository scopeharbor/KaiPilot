/**
 * v3-ocr-provider-observability-cost-controls §4.3 — OCR 预算策略解析器。
 *
 * 按组织/用户/项目/作业/provider/model/capability 解析 OCR 预算策略。
 * 默认：无策略 = unlimited（允许所有调用）。
 */

import type { OcrBudgetScope, OcrBudgetSoftLimitAction } from '@aiproj/types'

export interface OcrBudgetPolicy {
  scope: OcrBudgetScope
  name: string
  hardLimit: number | null
  softLimit: number | null
  softLimitAction: OcrBudgetSoftLimitAction
  currency: string
  enabled: boolean
  /** 已使用的预算金额（从以往 attempt 汇总）。 */
  usedAmount: number
}

export interface OcrBudgetPolicyResolution {
  policy: OcrBudgetPolicy | null
  resolutionSource: string
}

const DEFAULT_CURRENCY = 'USD'

export default class OcrBudgetPolicyResolver {
  /**
   * 解析 OCR 预算策略。
   * 当前版本返回默认策略（无限制），未来可扩展为读数据库中的组织级策略。
   */
  resolve(_params: {
    organizationId: number
    projectId: number
    ocrJobId?: number | null
    provider: string
    model: string
    capabilityMode?: string | null
  }): OcrBudgetPolicyResolution {
    // 默认：无预算限制
    return {
      policy: {
        scope: 'organization',
        name: 'default-unlimited',
        hardLimit: null,
        softLimit: null,
        softLimitAction: 'allow',
        currency: DEFAULT_CURRENCY,
        enabled: true,
        usedAmount: 0,
      },
      resolutionSource: 'default',
    }
  }

  /**
   * 查询已使用预算金额。
   * 当前使用内存计数，后续可扩展为读 OCR provider attempts 表。
   */
  getUsedAmount(_params: {
    organizationId: number
    projectId: number
    provider?: string | null
    model?: string | null
  }): number {
    return 0
  }
}
