// v3-bi-dashboard-builder §3.2 & §4.2 — BI Dashboard Builder Validator。
// 验证 registry、list/get/current/preview/create/update/copy/default/archive/restore 参数。

import vine from '@vinejs/vine'
import {
  BI_DASHBOARD_SCOPES,
  BI_DASHBOARD_WIDGET_KEY_VALUES,
  BI_DASHBOARD_MAX_WIDGETS,
  BI_DASHBOARD_MAX_GLOBAL_FILTERS,
  BI_DASHBOARD_WINDOW_MAX_DAYS,
  BI_DASHBOARD_MAX_BREAKPOINTS,
  BI_DASHBOARD_MIN_COLUMNS,
  BI_DASHBOARD_MAX_COLUMNS,
} from '@aiproj/types'

// ─── 共享子 schema ──────────────────────────────────────────────────────────

const widgetPosition = vine.object({
  x: vine.number().min(0),
  y: vine.number().min(0),
  w: vine.number().min(1).max(4),
  h: vine.number().min(1).max(4),
})

const widgetSettings = vine.object({}).allowUnknownProperties()

const widgetInstance = vine.object({
  widgetKey: vine.enum(BI_DASHBOARD_WIDGET_KEY_VALUES),
  size: vine.enum(['small', 'medium', 'large', 'full']),
  position: widgetPosition,
  settings: widgetSettings.optional(),
  visualization: vine.string().optional(),
})

const breakpoint = vine.object({
  minWidth: vine.number().min(320),
  columns: vine.number().min(BI_DASHBOARD_MIN_COLUMNS).max(BI_DASHBOARD_MAX_COLUMNS),
})

const layout = vine.object({
  columns: vine.number().min(BI_DASHBOARD_MIN_COLUMNS).max(BI_DASHBOARD_MAX_COLUMNS),
  density: vine.enum(['comfortable', 'compact']),
  breakpoints: vine.array(breakpoint).maxLength(BI_DASHBOARD_MAX_BREAKPOINTS).optional(),
})

const globalFilter = vine.object({
  key: vine.string().minLength(1).maxLength(100),
  label: vine.string().minLength(1).maxLength(200),
  type: vine.enum(['portfolio', 'project_status', 'risk_level', 'time_range', 'tag']),
  value: vine.any(),
})

const timeWindow = vine.object({
  mode: vine.enum(['last_n_days', 'custom']),
  days: vine.number().min(1).max(BI_DASHBOARD_WINDOW_MAX_DAYS).optional(),
  startDate: vine.string().optional(),
  endDate: vine.string().optional(),
})

const freshnessPolicy = vine.object({
  maxAgeSeconds: vine
    .number()
    .min(60)
    .max(86400 * 30), // max 30 days
  staleBehavior: vine.enum(['warning', 'block']),
})

// ─── 预览 payload ──────────────────────────────────────────────────────────

export const biDashboardPreviewValidator = vine.compile(
  vine.object({
    layout: layout,
    widgets: vine.array(widgetInstance).minLength(0).maxLength(BI_DASHBOARD_MAX_WIDGETS),
    globalFilters: vine.array(globalFilter).maxLength(BI_DASHBOARD_MAX_GLOBAL_FILTERS).optional(),
    timeWindow: timeWindow.optional(),
  }),
)

// ─── 创建 payload ───────────────────────────────────────────────────────────

export const biDashboardCreateValidator = vine.compile(
  vine.object({
    name: vine.string().minLength(1).maxLength(200).trim(),
    scope: vine.enum([BI_DASHBOARD_SCOPES.PERSONAL, BI_DASHBOARD_SCOPES.ORGANIZATION_SHARED]),
    layout: layout,
    widgets: vine.array(widgetInstance).minLength(0).maxLength(BI_DASHBOARD_MAX_WIDGETS),
    globalFilters: vine.array(globalFilter).maxLength(BI_DASHBOARD_MAX_GLOBAL_FILTERS).optional(),
    timeWindow: timeWindow.optional(),
    freshnessPolicy: freshnessPolicy.optional(),
  }),
)

// ─── 更新 payload ───────────────────────────────────────────────────────────

export const biDashboardUpdateValidator = vine.compile(
  vine.object({
    name: vine.string().minLength(1).maxLength(200).trim(),
    scope: vine.enum([BI_DASHBOARD_SCOPES.PERSONAL, BI_DASHBOARD_SCOPES.ORGANIZATION_SHARED]),
    version: vine.number().min(1),
    layout: layout,
    widgets: vine.array(widgetInstance).minLength(0).maxLength(BI_DASHBOARD_MAX_WIDGETS),
    globalFilters: vine.array(globalFilter).maxLength(BI_DASHBOARD_MAX_GLOBAL_FILTERS).optional(),
    timeWindow: timeWindow.optional(),
    freshnessPolicy: freshnessPolicy.optional(),
  }),
)

// ─── 查询参数 ───────────────────────────────────────────────────────────────

export const biDashboardListValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    scope: vine
      .enum([BI_DASHBOARD_SCOPES.PERSONAL, BI_DASHBOARD_SCOPES.ORGANIZATION_SHARED])
      .optional(),
    includeArchived: vine.boolean().optional(),
  }),
)

// ─── Widget Registry 验证 ───────────────────────────────────────────────────

/** 验证 widget instances 是否符合 registry */
export function validateWidgetsAgainstRegistry(
  widgets: Record<string, unknown>[],
  availableKeys: Set<string>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (widgets.length > BI_DASHBOARD_MAX_WIDGETS) {
    errors.push(`widget count ${widgets.length} exceeds maximum ${BI_DASHBOARD_MAX_WIDGETS}`)
  }

  for (const w of widgets) {
    const key = w.widgetKey as string | undefined
    if (!key) {
      errors.push('widget missing widgetKey')
      continue
    }
    if (!availableKeys.has(key)) {
      errors.push(`unknown or unavailable widget key: ${key}`)
    }
    // Reject unsafe payload fields
    const unsafeFields = ['query', 'sql', 'script', 'formula', 'prompt', 'url', 'secret', 'token']
    const settings = (w.settings ?? {}) as Record<string, unknown>
    for (const field of unsafeFields) {
      if (field in settings) {
        errors.push(`widget ${key} contains forbidden field: ${field}`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}
