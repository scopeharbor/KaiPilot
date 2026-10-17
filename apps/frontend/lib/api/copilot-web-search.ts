import { apiFetch } from '@/lib/api-client'
import type { CopilotWebSearchSettingsSummary, CopilotWebSearchSettings } from '@aiproj/types'

/** 状态投影（含今日配额）。 */
export type CopilotWebSearchStatusDto = CopilotWebSearchSettingsSummary & {
  quota: {
    usedToday: number
    limitToday: number
    remainingToday: number
  }
}

/** 设置更新载荷（部分更新；provider 连接 id 留空 = 清空）。 */
export type CopilotWebSearchSettingsUpdateInput = Partial<
  Pick<
    CopilotWebSearchSettings,
    | 'enabled'
    | 'providerConnectionId'
    | 'allowedDomains'
    | 'deniedDomains'
    | 'dailyQueryLimit'
    | 'maxResultsPerQuery'
    | 'timeoutMs'
    | 'cacheTtlMinutes'
    | 'retainDecisionDays'
    | 'allowForAiCreate'
    | 'allowForGeneralCopilot'
    | 'providerKind'
    | 'providerBaseUrl'
  >
> & {
  /** 只写：新的提供方密钥；空串 = 清除；不传 = 不变。 */
  providerApiKey?: string | null
}

/**
 * Copilot 工具：外部网页搜索设置客户端（v3-copilot-optional-web-search-configuration）。
 *
 * 契约：GET 只返回低敏投影（configured + masked label），永不返回 credential；
 * 更新路径 /settings/copilot-tools/web-search（需要 copilot:web_search:manage）。
 */
export const copilotWebSearchApi = {
  getSettings: () =>
    apiFetch<CopilotWebSearchSettingsSummary>('/settings/copilot-tools/web-search'),
  getStatus: () => apiFetch<CopilotWebSearchStatusDto>('/settings/copilot-tools/web-search/status'),
  updateSettings: (input: CopilotWebSearchSettingsUpdateInput) =>
    apiFetch<CopilotWebSearchSettingsSummary>('/settings/copilot-tools/web-search', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
}
