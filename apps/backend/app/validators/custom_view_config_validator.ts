/**
 * custom_view_config_validator —— 服务端自定义视图配置白名单校验。
 *
 * 校验 JSON 内容是否符合白名单 schema，防止任意字段透传到查询层。
 * 每个基础视图类型有独立的允许字段列表。
 * 校验由 Service 层在保存/更新时调用，不依赖 HTTP 请求。
 */
import { ValidationException } from '#exceptions/api_exception'
import type { CustomViewConfig, CustomViewBaseType, CustomViewSort } from '@aiproj/types'
import { CURRENT_CUSTOM_VIEW_SCHEMA_VERSION } from '@aiproj/types'

// ─── 白名单：各基础视图允许的配置字段 ───────────────
const ALLOWED_FILTER_FIELDS: Record<CustomViewBaseType, string[]> = {
  kanban: ['search', 'priorities', 'assigneeIds'],
  list: ['search', 'statuses', 'priorities', 'assigneeIds', 'dateFrom', 'dateTo'],
  calendar: ['search', 'assigneeIds', 'dateFrom', 'dateTo'],
  gantt: ['search', 'statuses', 'assigneeIds', 'dateFrom', 'dateTo'],
  wbs: ['search'],
  resource: ['search', 'roles', 'skills', 'loadStatuses', 'statuses', 'dateFrom', 'dateTo'],
}

const ALLOWED_SORT_FIELDS: Record<CustomViewBaseType, string[]> = {
  kanban: [],
  list: [
    'name',
    'priority',
    'status',
    'assignee',
    'progressPercent',
    'endDate',
    'estimatedHours',
    'actualHours',
    'createdAt',
    'updatedAt',
  ],
  calendar: ['startDate', 'endDate', 'name'],
  gantt: ['startDate', 'endDate', 'name', 'priority', 'status'],
  wbs: ['name', 'priority', 'status'],
  resource: ['name', 'role', 'loadStatus', 'utilizationPercent'],
}

const ALLOWED_DISPLAY_FIELDS: Record<CustomViewBaseType, string[]> = {
  kanban: ['columnDisplay'],
  list: ['columns', 'density'],
  calendar: ['mode'],
  gantt: [
    'showDependencies',
    'showCriticalPath',
    'showBaseline',
    'showProgress',
    'showWeekends',
    'density',
  ],
  wbs: ['showFields', 'density'],
  resource: ['density', 'resourceViewMode'],
}

const ALLOWED_SCOPE_FIELDS: Record<CustomViewBaseType, string[]> = {
  kanban: [],
  list: [],
  calendar: ['anchorDate', 'timeRange'],
  gantt: ['expandedNodes', 'timeRange'],
  wbs: ['expandedNodes'],
  resource: ['timeRange'],
}

const ALLOWED_STATE_FIELDS: Record<CustomViewBaseType, string[]> = {
  kanban: ['columnPage'],
  list: ['scrollPosition'],
  calendar: [],
  gantt: [],
  wbs: [],
  resource: [],
}

const ALLOWED_VISIBILITIES = ['personal', 'shared'] as const
const ALLOWED_BASE_VIEW_TYPES = ['kanban', 'list', 'calendar', 'gantt', 'wbs', 'resource'] as const

// ─── 配置 JSON 大小限制（50 KB） ────────────────────
const MAX_CONFIG_JSON_SIZE = 50 * 1024

/**
 * 校验自定义视图配置。
 * 抛出 ValidationException 如果校验失败。
 */
export function validateCustomViewConfig(
  config: unknown,
  baseViewType: CustomViewBaseType,
): asserts config is CustomViewConfig {
  if (!config || typeof config !== 'object') {
    throw new ValidationException('配置必须是 JSON 对象')
  }

  const jsonSize = new TextEncoder().encode(JSON.stringify(config)).length
  if (jsonSize > MAX_CONFIG_JSON_SIZE) {
    throw new ValidationException(
      `配置 JSON 大小超过限制（${Math.round(jsonSize / 1024)}KB > ${Math.round(MAX_CONFIG_JSON_SIZE / 1024)}KB）`,
    )
  }

  const c = config as Record<string, unknown>

  // schemaVersion
  if (c.schemaVersion === undefined || c.schemaVersion === null) {
    throw new ValidationException('缺少 schemaVersion')
  }
  if (typeof c.schemaVersion !== 'number' || !Number.isInteger(c.schemaVersion)) {
    throw new ValidationException('schemaVersion 必须是整数')
  }
  if (c.schemaVersion > CURRENT_CUSTOM_VIEW_SCHEMA_VERSION) {
    throw new ValidationException(
      `不支持的 schemaVersion: ${c.schemaVersion}（当前最高: ${CURRENT_CUSTOM_VIEW_SCHEMA_VERSION}）`,
    )
  }

  // baseViewType in config
  if (c.baseViewType !== undefined && c.baseViewType !== baseViewType) {
    throw new ValidationException('配置中的 baseViewType 与请求路径不一致')
  }

  // filters（白名单字段校验）
  if (c.filters !== undefined) {
    validateConfigSection('filters', c.filters, ALLOWED_FILTER_FIELDS[baseViewType], baseViewType)
  }

  // sort
  if (c.sort !== undefined) {
    if (!Array.isArray(c.sort)) {
      throw new ValidationException('sort 必须是数组')
    }
    const allowedFields = ALLOWED_SORT_FIELDS[baseViewType]
    for (const sortItem of c.sort) {
      if (!sortItem || typeof sortItem !== 'object') {
        throw new ValidationException('排序项必须是对象')
      }
      const s = sortItem as Record<string, unknown>
      if (!allowedFields.includes(String(s.field))) {
        throw new ValidationException(
          `排序字段 "${String(s.field)}" 不允许用于 ${baseViewType} 视图`,
        )
      }
      if (!['asc', 'desc'].includes(String(s.direction))) {
        throw new ValidationException('排序方向必须是 asc 或 desc')
      }
    }
  }

  // display
  if (c.display !== undefined) {
    validateConfigSection('display', c.display, ALLOWED_DISPLAY_FIELDS[baseViewType], baseViewType)
  }

  // scope
  if (c.scope !== undefined) {
    validateConfigSection('scope', c.scope, ALLOWED_SCOPE_FIELDS[baseViewType], baseViewType)
  }

  // state
  if (c.state !== undefined) {
    validateConfigSection('state', c.state, ALLOWED_STATE_FIELDS[baseViewType], baseViewType)
  }

  // 禁止未知顶级字段
  const knownTopFields = [
    'schemaVersion',
    'baseViewType',
    'filters',
    'sort',
    'display',
    'scope',
    'state',
  ]
  for (const key of Object.keys(c)) {
    if (!knownTopFields.includes(key)) {
      throw new ValidationException(`未知配置字段: "${key}"`)
    }
  }
}

/**
 * 校验配置的某个小节（filters/display/scope/state）
 * 检查是否有不允许的字段。
 */
function validateConfigSection(
  sectionName: string,
  section: unknown,
  allowedFields: string[],
  baseViewType: CustomViewBaseType,
): void {
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw new ValidationException(`${sectionName} 必须是对象`)
  }
  const s = section as Record<string, unknown>
  for (const key of Object.keys(s)) {
    if (!allowedFields.includes(key)) {
      throw new ValidationException(
        `${sectionName} 中的字段 "${key}" 不允许用于 ${baseViewType} 视图`,
      )
    }
  }
}

/**
 * 迁移旧版本配置到当前版本。
 * 返回迁移后的配置，无法迁移时抛出 ValidationException。
 */
export function migrateCustomViewConfig(
  config: Record<string, unknown>,
  targetVersion = CURRENT_CUSTOM_VIEW_SCHEMA_VERSION,
): CustomViewConfig {
  const currentVersion = (config.schemaVersion as number) || 0

  if (currentVersion === targetVersion) {
    return config as unknown as CustomViewConfig
  }

  if (currentVersion > targetVersion) {
    throw new ValidationException(
      `配置版本 ${currentVersion} 高于当前支持版本 ${targetVersion}，无法降级`,
    )
  }

  // v0 → v1：为旧配置填充默认值
  if (currentVersion < 1) {
    return migrateToV1(config)
  }

  // 未来更多迁移...
  throw new ValidationException(`不支持从版本 ${currentVersion} 迁移到 ${targetVersion}`)
}

function normalizeSort(value: unknown): CustomViewSort[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const sort = item as Record<string, unknown>
    const direction = sort.direction === 'desc' ? 'desc' : 'asc'
    if (typeof sort.field !== 'string' || sort.field.length === 0) return []
    return [{ field: sort.field, direction }]
  })
}

function migrateToV1(config: Record<string, unknown>): CustomViewConfig {
  return {
    schemaVersion: 1,
    baseViewType: (config.baseViewType as CustomViewBaseType) || 'kanban',
    filters: (config.filters as Record<string, unknown>) || {},
    sort: normalizeSort(config.sort),
    display: (config.display as Record<string, unknown>) || {},
    scope: (config.scope as Record<string, unknown>) || {},
    state: (config.state as Record<string, unknown>) || {},
  }
}

export function isBaseViewType(value: string): value is CustomViewBaseType {
  return (ALLOWED_BASE_VIEW_TYPES as readonly string[]).includes(value)
}

export function isVisibility(value: string): value is (typeof ALLOWED_VISIBILITIES)[number] {
  return (ALLOWED_VISIBILITIES as readonly string[]).includes(value)
}
