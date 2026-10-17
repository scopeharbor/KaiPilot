/**
 * resource-adapter —— 资源工作台配置适配器（V2 resource-management-full）。
 *
 * 只捕获筛选、窗口和展示模式；禁止捕获资源、需求、冲突等业务数据。
 */

import type { CustomViewConfig } from '@aiproj/types'
import type { ViewConfigAdapter } from './types'

export type ResourceWorkbenchViewMode = 'matrix' | 'requirements' | 'conflicts'

export interface ResourceLocalState {
  viewMode?: ResourceWorkbenchViewMode
  density?: 'comfortable' | 'compact'
}

function splitParam(value: string | null): string[] | undefined {
  const parts = value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return parts?.length ? parts : undefined
}

function normalizeMode(value: string | null | undefined): ResourceWorkbenchViewMode {
  if (value === 'requirements' || value === 'conflicts') return value
  return 'matrix'
}

export const resourceAdapter: ViewConfigAdapter<ResourceLocalState> = {
  capture(searchParams, localState) {
    const from = searchParams.get('from') || undefined
    const to = searchParams.get('to') || undefined
    const roles = splitParam(searchParams.get('role'))
    const skills = splitParam(searchParams.get('skill'))
    const loadStatuses = splitParam(searchParams.get('loadStatus'))
    const statuses = splitParam(searchParams.get('resourceStatus'))
    const search = searchParams.get('search') || undefined

    const filters: CustomViewConfig['filters'] = {}
    if (search) filters.search = search
    if (roles?.length) filters.roles = roles
    if (skills?.length) filters.skills = skills
    if (loadStatuses?.length) filters.loadStatuses = loadStatuses
    if (statuses?.length) filters.statuses = statuses
    if (from) filters.dateFrom = from
    if (to) filters.dateTo = to

    return {
      schemaVersion: 1,
      baseViewType: 'resource',
      filters: Object.keys(filters).length ? filters : undefined,
      display: {
        density: localState.density ?? 'comfortable',
        resourceViewMode: normalizeMode(searchParams.get('mode') ?? localState.viewMode),
      },
      scope: from || to ? { timeRange: { start: from ?? '', end: to ?? '' } } : undefined,
    }
  },

  apply(_config: CustomViewConfig) {
    // 消费方（资源工作台页面）读取 config 并写回 URL 与本地状态。
  },

  toSearchParams(config) {
    const params = new URLSearchParams()
    const from = config.filters?.dateFrom ?? config.scope?.timeRange?.start
    const to = config.filters?.dateTo ?? config.scope?.timeRange?.end
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (config.filters?.roles?.length) params.set('role', config.filters.roles.join(','))
    if (config.filters?.skills?.length) params.set('skill', config.filters.skills.join(','))
    if (config.filters?.loadStatuses?.length) {
      params.set('loadStatus', config.filters.loadStatuses.join(','))
    }
    if (config.filters?.statuses?.length) {
      params.set('resourceStatus', config.filters.statuses.join(','))
    }
    if (config.filters?.search) params.set('search', config.filters.search)
    if (config.display?.resourceViewMode) params.set('mode', config.display.resourceViewMode)
    return params
  },

  summarize(config) {
    const parts: string[] = []
    const mode = config.display?.resourceViewMode
    if (mode === 'requirements') parts.push('需求视图')
    else if (mode === 'conflicts') parts.push('冲突视图')
    else parts.push('矩阵视图')
    if (config.filters?.dateFrom || config.filters?.dateTo) {
      parts.push(
        `窗口 ${[config.filters.dateFrom, config.filters.dateTo].filter(Boolean).join(' ~ ')}`,
      )
    }
    if (config.filters?.roles?.length) parts.push(`${config.filters.roles.length} 个角色`)
    if (config.filters?.skills?.length) parts.push(`${config.filters.skills.length} 个技能`)
    if (config.filters?.loadStatuses?.length) {
      parts.push(`${config.filters.loadStatuses.length} 个负载状态`)
    }
    return parts.join('，')
  },
}
