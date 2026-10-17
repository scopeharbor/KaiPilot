import { apiFetch } from '@/lib/api-client'
import type { UsageSurfaceResponse } from '@aiproj/types'

/** 用量页时段（与后端 `window` 参数一致）。 */
export type AiUsageWindow = 'last_24_hours' | 'last_7_days' | 'last_30_days' | 'monthly' | 'all'

export interface AiCostSettings {
  displayCurrency: string
  exchangeRateSource: string
  exchangeRateAsOf: string | null
  exchangeRateStale: boolean
  supportedCurrencies: string[]
}

/**
 * 组织级 AI 用量只读视图（GET /api/v1/ai/usage-surface，需 ai:usage:view）。
 * 数据源为统一 AI 调用账本：AI 生成项目、AI 同事对话、编译器、OCR 等所有经网关的调用。
 */
export const aiUsageApi = {
  surface: (window: AiUsageWindow) =>
    apiFetch<UsageSurfaceResponse>(
      `/ai/usage-surface?window=${encodeURIComponent(window)}&topN=10`,
    ),
}

export const aiCostSettingsApi = {
  show: () => apiFetch<AiCostSettings>('/ai/cost-settings'),
  update: (displayCurrency: string) =>
    apiFetch<AiCostSettings>('/ai/cost-settings', {
      method: 'PUT',
      body: JSON.stringify({ displayCurrency }),
    }),
}

export const aiUsageKeys = {
  all: ['ai-usage'] as const,
  surface: (window: AiUsageWindow) => [...aiUsageKeys.all, 'surface', window] as const,
  costSettings: () => [...aiUsageKeys.all, 'cost-settings'] as const,
}
