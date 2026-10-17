/**
 * renderer-schema —— 确定性 UI Renderer 运行时 schema（zod，前后端共享，§1.2 P0）。
 *
 * 定义 renderer config、view-specific config、widget config、安全图标名、
 * 安全数据查询 DSL 与大小限制的 zod schema。
 *
 * 前后端使用同一套 schema 校验，防止契约分叉。
 */
import { z } from 'zod'

// ─── 大小限制 ─────────────────────────────────────────
export const RENDERER_MAX_CONFIG_SIZE = 1_000_000 // 1 MB raw JSON
export const RENDERER_MAX_VIEWS = 50
export const RENDERER_MAX_WIDGETS = 30
export const RENDERER_MAX_FILTERS = 20
export const RENDERER_MAX_SORT = 10
export const RENDERER_MAX_OVERRIDE_ENTRIES = 200
export const RENDERER_MAX_STRING_LENGTH = 200
export const RENDERER_MAX_TITLE_LENGTH = 100
export const RENDERER_MAX_FIELDS = 50

// ─── 安全图标名称白名单 ───────────────────────────────
const SAFE_ICONS = [
  'LayoutDashboard',
  'FolderKanban',
  'CheckSquare',
  'BarChart3',
  'ShieldAlert',
  'Users',
  'Calendar',
  'ScrollText',
  'FileEdit',
  'Bell',
  'Lightbulb',
  'Search',
  'Plug',
  'Settings',
  'HelpCircle',
  'List',
  'Kanban',
  'GanttChart',
  'Network',
  'Table',
  'Eye',
  'EyeOff',
  'AlertTriangle',
  'Info',
  'CheckCircle',
  'XCircle',
  'ArrowUp',
  'ArrowDown',
  'Filter',
  'SortAsc',
  'SortDesc',
  'Plus',
  'Minus',
  'Trash2',
  'Edit',
  'Copy',
  'Save',
  'RefreshCw',
  'MoreHorizontal',
  'MoreVertical',
] as const

// ─── 安全数据查询 DSL ────────────────────────────────
export const dataQuerySourceSchema = z.enum([
  'dashboard_metrics',
  'task_summary',
  'gantt_facts',
  'wbs_nodes',
  'kanban_columns',
  'risk_summary',
  'resource_summary',
  'change_impact_summary',
  'timeline_facts',
  'report_summary',
])

export const dataQueryFilterSchema = z
  .object({
    field: z.string().min(1).max(RENDERER_MAX_STRING_LENGTH),
    operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']),
    value: z.union([
      z.string().max(RENDERER_MAX_STRING_LENGTH),
      z.number(),
      z.boolean(),
      z.array(z.union([z.string().max(RENDERER_MAX_STRING_LENGTH), z.number()])).max(100),
    ]),
  })
  .strict()

export const dataQuerySortSchema = z
  .object({
    field: z.string().min(1).max(RENDERER_MAX_STRING_LENGTH),
    direction: z.enum(['asc', 'desc']),
  })
  .strict()

export const dataQueryConfigSchema = z
  .object({
    source: dataQuerySourceSchema,
    fields: z
      .array(z.string().min(1).max(RENDERER_MAX_STRING_LENGTH))
      .max(RENDERER_MAX_FIELDS)
      .optional(),
    filters: z.array(dataQueryFilterSchema).max(RENDERER_MAX_FILTERS).optional(),
    sort: z.array(dataQuerySortSchema).max(RENDERER_MAX_SORT).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    aggregate: z.enum(['count', 'sum', 'avg', 'min', 'max']).optional(),
    groupBy: z.string().min(1).max(RENDERER_MAX_STRING_LENGTH).optional(),
  })
  .strict()

// ─── Safe icon name ────────────────────────────────────
export const safeIconSchema = z.enum(SAFE_ICONS)

// ─── Widget 类型 ───────────────────────────────────────
export const widgetTypeSchema = z.enum([
  'completion_rate',
  'task_distribution',
  'risk_health',
  'resource_load',
  'overdue_tasks',
  'recent_activity',
  'milestone_progress',
  'budget_summary',
  'change_impact',
  'report_snapshot',
  'custom',
])

export const dashboardWidgetConfigSchema = z
  .object({
    id: z.string().min(1).max(RENDERER_MAX_STRING_LENGTH),
    type: widgetTypeSchema,
    title: z.string().min(1).max(RENDERER_MAX_TITLE_LENGTH),
    icon: safeIconSchema.optional(),
    dataQuery: dataQueryConfigSchema.optional(),
    width: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(6), z.literal(12)])
      .optional(),
    height: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
    redactOnPermission: z.array(z.string()).max(10).optional(),
    sourceMetadata: z
      .object({
        type: z.enum([
          'ai_recommendation',
          'deterministic',
          'user_manual',
          'compiler',
          'migration',
          'system_default',
        ]),
        stage: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        provider: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        model: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        engineVersion: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        artifactRef: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        runId: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        inputRefs: z.array(z.string()).max(20).optional(),
        createdAt: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

// ─── 视图类型枚举 ─────────────────────────────────────
export const rendererViewTypeSchema = z.enum([
  'dashboard',
  'list',
  'kanban',
  'gantt',
  'wbs',
  'calendar',
  'timeline',
  'risk-matrix',
  'resource',
  'dependency',
  'custom',
])

// ─── 视图特定配置 schema ──────────────────────────────
const dashboardViewConfigSchema = z
  .object({
    widgets: z.array(dashboardWidgetConfigSchema).max(RENDERER_MAX_WIDGETS),
  })
  .strict()

const listViewConfigSchema = z
  .object({
    columns: z.array(z.string().max(RENDERER_MAX_STRING_LENGTH)).max(50).optional(),
    groupBy: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
    showSearch: z.boolean().optional(),
    defaultSort: dataQuerySortSchema.optional(),
  })
  .strict()

const kanbanViewConfigSchema = z
  .object({
    columnField: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
    swimlaneField: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
    collapsedColumns: z.array(z.string().max(RENDERER_MAX_STRING_LENGTH)).max(50).optional(),
    showEmptyColumns: z.boolean().optional(),
  })
  .strict()

const ganttViewConfigSchema = z
  .object({
    showDependencies: z.boolean().optional(),
    showCriticalPath: z.boolean().optional(),
    showBaseline: z.boolean().optional(),
    showProgress: z.boolean().optional(),
    showWeekends: z.boolean().optional(),
    timeScale: z.enum(['day', 'week', 'month', 'quarter']).optional(),
  })
  .strict()

const wbsViewConfigSchema = z
  .object({
    showFields: z.array(z.string().max(RENDERER_MAX_STRING_LENGTH)).max(20).optional(),
    expandedLevel: z.number().int().min(1).max(10).optional(),
    showCompletion: z.boolean().optional(),
  })
  .strict()

const calendarViewConfigSchema = z
  .object({
    mode: z.enum(['month', 'week', 'day']).optional(),
    showWeekends: z.boolean().optional(),
  })
  .strict()

const timelineViewConfigSchema = z
  .object({
    timeScale: z.enum(['day', 'week', 'month']).optional(),
    showMilestones: z.boolean().optional(),
    showDependencies: z.boolean().optional(),
  })
  .strict()

const riskMatrixViewConfigSchema = z
  .object({
    showLevel: z.enum(['all', 'critical', 'high']).optional(),
    groupBy: z.enum(['probability', 'impact']).optional(),
  })
  .strict()

const resourceViewConfigSchema = z
  .object({
    mode: z.enum(['matrix', 'requirements', 'conflicts']).optional(),
    showOverallocation: z.boolean().optional(),
  })
  .strict()

const dependencyViewConfigSchema = z
  .object({
    showCycles: z.boolean().optional(),
    showAllLevels: z.boolean().optional(),
  })
  .strict()

export const viewSpecificConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('dashboard'), config: dashboardViewConfigSchema }).strict(),
  z.object({ type: z.literal('list'), config: listViewConfigSchema }).strict(),
  z.object({ type: z.literal('kanban'), config: kanbanViewConfigSchema }).strict(),
  z.object({ type: z.literal('gantt'), config: ganttViewConfigSchema }).strict(),
  z.object({ type: z.literal('wbs'), config: wbsViewConfigSchema }).strict(),
  z.object({ type: z.literal('calendar'), config: calendarViewConfigSchema }).strict(),
  z.object({ type: z.literal('timeline'), config: timelineViewConfigSchema }).strict(),
  z.object({ type: z.literal('risk-matrix'), config: riskMatrixViewConfigSchema }).strict(),
  z.object({ type: z.literal('resource'), config: resourceViewConfigSchema }).strict(),
  z.object({ type: z.literal('dependency'), config: dependencyViewConfigSchema }).strict(),
  z.object({ type: z.literal('custom'), config: z.object({}).strict() }).strict(),
])

// ─── ViewConfig schema ─────────────────────────────────
export const viewConfigSchema = z
  .object({
    id: z.string().min(1).max(RENDERER_MAX_STRING_LENGTH),
    type: rendererViewTypeSchema,
    title: z.string().min(1).max(RENDERER_MAX_TITLE_LENGTH),
    icon: safeIconSchema.optional(),
    config: viewSpecificConfigSchema,
    dataQuery: dataQueryConfigSchema.optional(),
    requiresPermission: z.array(z.string()).max(10).optional(),
    sourceMetadata: z
      .object({
        type: z.enum([
          'ai_recommendation',
          'deterministic',
          'user_manual',
          'compiler',
          'migration',
          'system_default',
        ]),
        stage: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        provider: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        model: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        engineVersion: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        artifactRef: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        runId: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        inputRefs: z.array(z.string()).max(20).optional(),
        createdAt: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

// ─── ProjectViewConfig schema（顶层，含大小限制） ────
export const projectViewConfigSchema = z
  .object({
    schemaVersion: z.number().int().min(1).max(99),
    projectId: z.number().int().positive(),
    defaultViewId: z.string().min(1).max(RENDERER_MAX_STRING_LENGTH),
    views: z.array(viewConfigSchema).max(RENDERER_MAX_VIEWS),
    sourceMetadata: z
      .object({
        type: z.enum([
          'ai_recommendation',
          'deterministic',
          'user_manual',
          'compiler',
          'migration',
          'system_default',
        ]),
        stage: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        provider: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        model: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        engineVersion: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        artifactRef: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        runId: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
        inputRefs: z.array(z.string()).max(20).optional(),
        createdAt: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

// ─── UserViewOverride schemas ─────────────────────────
export const userViewOverrideEntrySchema = z
  .object({
    viewId: z.string().min(1).max(RENDERER_MAX_STRING_LENGTH),
    schemaVersion: z.number().int().min(1).max(99),
    path: z.string().min(1).max(500),
    value: z.unknown(),
    actorUserId: z.number().int().positive(),
    timestamp: z.string(),
  })
  .strict()

export const userViewOverrideSchema = z
  .object({
    id: z.string().min(1).max(RENDERER_MAX_STRING_LENGTH),
    organizationId: z.number().int().positive(),
    projectId: z.number().int().positive(),
    userId: z.number().int().positive(),
    baseViewId: z.string().min(1).max(RENDERER_MAX_STRING_LENGTH),
    overrides: z.array(userViewOverrideEntrySchema).max(RENDERER_MAX_OVERRIDE_ENTRIES),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()

// ─── AI 候选配置 schema ──────────────────────────────
export const candidateStatusSchema = z.enum(['pending_review', 'approved', 'rejected', 'expired'])

export const validationIssueSchema = z
  .object({
    severity: z.enum(['error', 'warning', 'info']),
    code: z.string().min(1).max(RENDERER_MAX_STRING_LENGTH),
    message: z.string().min(1).max(1000),
    path: z.string().max(500).optional(),
    suggestedValue: z.unknown().optional(),
  })
  .strict()

const _validationResultSchema = z
  .object({
    valid: z.boolean(),
    errors: z.array(validationIssueSchema),
    warnings: z.array(validationIssueSchema),
    configHash: z.string().optional(),
  })
  .strict()

/** 导出为避免与 completeness-ledger 的 validationResultSchema 冲突 */
export const rendererValidationResultSchema = _validationResultSchema

export const configSourceMetadataSchema = z
  .object({
    type: z.enum([
      'ai_recommendation',
      'deterministic',
      'user_manual',
      'compiler',
      'migration',
      'system_default',
    ]),
    stage: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
    provider: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
    model: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
    engineVersion: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
    artifactRef: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
    runId: z.string().max(RENDERER_MAX_STRING_LENGTH).optional(),
    inputRefs: z.array(z.string()).max(20).optional(),
    createdAt: z.string().optional(),
  })
  .strict()

export const aiRendererCandidateSchema = z
  .object({
    id: z.string().min(1).max(RENDERER_MAX_STRING_LENGTH),
    config: viewConfigSchema,
    schemaVersion: z.number().int().min(1).max(99),
    sourceMetadata: configSourceMetadataSchema,
    confidence: z.number().min(0).max(1),
    status: candidateStatusSchema,
    validationResult: _validationResultSchema,
    fallbackConfig: viewConfigSchema.optional(),
    humanReviewNote: z.string().max(2000).optional(),
    createdAt: z.string(),
    reviewdAt: z.string().optional(),
    reviewedByUserId: z.number().int().positive().optional(),
  })
  .strict()

// ─── 配置哈希 schema ──────────────────────────────────
export const configHashSchema = z
  .object({
    algorithm: z.literal('sha256'),
    hash: z.string().length(64),
    includedPaths: z.array(z.string()).max(50),
  })
  .strict()

// ─── 默认入口解析结果 schema ──────────────────────────
export const defaultEntryResolveResultSchema = z
  .object({
    viewConfig: projectViewConfigSchema.nullable(),
    targetView: viewConfigSchema.nullable(),
    usedFallback: z.boolean(),
    fallbackReason: z.string().optional(),
    fallbackMessage: z.string().optional(),
    validationWarnings: z.array(validationIssueSchema).optional(),
  })
  .strict()

// ─── SchemaVersion 常量与 Migrator（§1.3 P0）─────────
export const RENDERER_CURRENT_SCHEMA_VERSION = 1
export const RENDERER_OLD_SUPPORTED_VERSIONS = [0] as const
export const RENDERER_UNSUPPORTED_VERSIONS = [] as const

export type RendererSchemaVersion = 1

export interface MigrationResult {
  success: boolean
  config: unknown
  warnings?: string[]
  error?: string
}

export interface MigrationPath {
  from: number
  to: number
  migrate: (config: Record<string, unknown>) => MigrationResult
}

const MIGRATION_PATHS: MigrationPath[] = [
  {
    from: 0,
    to: 1,
    migrate: (config) => ({
      success: true,
      config: { ...config, schemaVersion: 1 },
      warnings: ['Migrated renderer config schemaVersion from 0 to 1'],
    }),
  },
]

/**
 * 尝试将配置迁移到目标版本。
 * 支持链式迁移（如 v1 -> v2 -> v3）。
 */
export function migrateConfigVersion(
  config: Record<string, unknown>,
  fromVersion: number,
  toVersion: number = RENDERER_CURRENT_SCHEMA_VERSION,
): MigrationResult {
  if (fromVersion === toVersion) {
    return { success: true, config }
  }

  // 检查旧版本是否仍受支持
  const isOldSupported = RENDERER_OLD_SUPPORTED_VERSIONS.some((v) => v === fromVersion) as boolean
  if (!isOldSupported) {
    const unsupported = RENDERER_UNSUPPORTED_VERSIONS.some((v) => v === fromVersion)
    return {
      success: false,
      config,
      error: unsupported
        ? `Schema version ${fromVersion} is no longer supported and cannot be migrated`
        : `Unknown schema version ${fromVersion}`,
    }
  }

  // 链式迁移：from -> from+1 -> ... -> to
  let current = { ...config }
  const warnings: string[] = []

  for (let v = fromVersion; v < toVersion; v++) {
    const path = MIGRATION_PATHS.find((p) => p.from === v && p.to === v + 1)
    if (!path) {
      return {
        success: false,
        config: current,
        error: `No migration path found from version ${v} to ${v + 1}`,
      }
    }

    const result = path.migrate(current)
    if (!result.success) {
      return {
        success: false,
        config: current,
        error: result.error || `Migration from v${v} to v${v + 1} failed`,
        warnings: [...warnings, ...(result.warnings || [])],
      }
    }

    if (result.warnings?.length) {
      warnings.push(...result.warnings)
    }
    current = { ...current, ...(result.config as Record<string, unknown>), schemaVersion: v + 1 }
  }

  return { success: true, config: current, warnings: warnings.length > 0 ? warnings : undefined }
}

/**
 * 校验配置 schema 版本是否可读且可迁移。
 */
export function checkConfigReadiness(config: Record<string, unknown>): {
  ready: boolean
  shouldMigrate: boolean
  result?: MigrationResult
} {
  const sv = config.schemaVersion as number | undefined
  if (sv === undefined || sv === null || typeof sv !== 'number') {
    return { ready: false, shouldMigrate: false }
  }

  if (sv === RENDERER_CURRENT_SCHEMA_VERSION) {
    return { ready: true, shouldMigrate: false }
  }

  if (sv < RENDERER_CURRENT_SCHEMA_VERSION) {
    const migrationResult = migrateConfigVersion(config, sv)
    return {
      ready: migrationResult.success,
      shouldMigrate: true,
      result: migrationResult,
    }
  }

  // 未来版本（> current），不可迁移
  return { ready: false, shouldMigrate: false }
}

// ─── 工具：安全校验大 JSON ───────────────────────────
export function validateConfigSize(raw: unknown): { valid: boolean; error?: string } {
  try {
    const serialized = JSON.stringify(raw)
    if (serialized.length > RENDERER_MAX_CONFIG_SIZE) {
      return {
        valid: false,
        error: `Config JSON exceeds maximum size of ${RENDERER_MAX_CONFIG_SIZE} bytes`,
      }
    }
    return { valid: true }
  } catch {
    return { valid: false, error: 'Failed to serialize config for size validation' }
  }
}

// ─── 工具：拒绝未知字段（strip unknown）───────────────
export const STRICT_VIEW_CONFIG_SCHEMA = viewConfigSchema.strict()
export const STRICT_PROJECT_VIEW_CONFIG_SCHEMA = projectViewConfigSchema.strict()
export const STRICT_DATA_QUERY_SCHEMA = dataQueryConfigSchema.strict()
