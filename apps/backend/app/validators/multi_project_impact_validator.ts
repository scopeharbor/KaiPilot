/**
 * v3-multi-project-impact-analysis —— MultiProjectImpact Validator（§4.1）
 *
 * 覆盖 plan/run/list/read/refresh/what-if/export/follow-up/AI explanation/drill-down。
 * 所有 scope、日期窗口、深度、节点、边、场景数、分页和排序均使用 allowlist 与上限。
 */

import vine from '@vinejs/vine'
import {
  MULTI_PROJECT_IMPACT_SOURCE_TYPES,
  MULTI_PROJECT_IMPACT_SEVERITIES,
  MULTI_PROJECT_IMPACT_SNAPSHOT_STATUSES,
  MULTI_PROJECT_IMPACT_SCENARIO_TYPES,
  MULTI_PROJECT_IMPACT_FOLLOW_UP_TARGETS,
  MULTI_PROJECT_IMPACT_DEFAULTS,
} from '@aiproj/types'

// ─── 可复用 schema 片段 ───────────────────────────────────────────

const projectIdsSchema = vine
  .array(vine.number().min(1).withoutDecimals())
  .minLength(1)
  .maxLength(MULTI_PROJECT_IMPACT_DEFAULTS.MAX_PROJECTS_PER_SCOPE)

const scopeSchema = vine.object({
  projectIds: projectIdsSchema,
  sources: vine
    .array(
      vine.object({
        sourceType: vine.enum(MULTI_PROJECT_IMPACT_SOURCE_TYPES),
        sourceId: vine.number().min(1).withoutDecimals(),
        sourceLabel: vine.string().maxLength(255),
        projectId: vine.number().min(1).withoutDecimals(),
        description: vine.string().maxLength(2000).optional().nullable(),
      }),
    )
    .maxLength(100)
    .optional(),
  maxPropagationDepth: vine
    .number()
    .min(1)
    .max(MULTI_PROJECT_IMPACT_DEFAULTS.MAX_PROPAGATION_DEPTH),
  maxNodes: vine.number().min(1).max(MULTI_PROJECT_IMPACT_DEFAULTS.MAX_NODES),
  maxEdges: vine.number().min(1).max(MULTI_PROJECT_IMPACT_DEFAULTS.MAX_EDGES),
  dateWindowStart: vine.string().optional().nullable(),
  dateWindowEnd: vine.string().optional().nullable(),
  maxScenarios: vine.number().min(0).max(MULTI_PROJECT_IMPACT_DEFAULTS.MAX_SCENARIOS),
})

const runTokenSchema = vine.string().trim().minLength(8).maxLength(128)

// ─── 各端点 validator ─────────────────────────────────────────────

/** Plan 分析计划 */
export const planImpactAnalysisValidator = vine.compile(
  vine.object({
    scope: scopeSchema,
  }),
)

/** Run 运行分析 */
export const runImpactAnalysisValidator = vine.compile(
  vine.object({
    runToken: runTokenSchema,
  }),
)

/** List 列出快照 */
export const listImpactSnapshotsValidator = vine.compile(
  vine.object({
    projectIds: vine.array(vine.number().min(1).withoutDecimals()).maxLength(100).optional(),
    sourceType: vine.enum(MULTI_PROJECT_IMPACT_SOURCE_TYPES).optional(),
    severity: vine.enum(MULTI_PROJECT_IMPACT_SEVERITIES).optional(),
    isStale: vine.boolean().optional(),
    status: vine.enum(MULTI_PROJECT_IMPACT_SNAPSHOT_STATUSES).optional(),
    dateWindowStart: vine.string().optional(),
    dateWindowEnd: vine.string().optional(),
    snapshotId: vine.number().min(1).withoutDecimals().optional(),
    scenarioType: vine.enum(MULTI_PROJECT_IMPACT_SCENARIO_TYPES).optional(),
    sort: vine.string().optional(),
    page: vine.number().min(1).withoutDecimals().optional(),
    perPage: vine
      .number()
      .min(1)
      .max(MULTI_PROJECT_IMPACT_DEFAULTS.MAX_PER_PAGE)
      .withoutDecimals()
      .optional(),
  }),
)

/** Read 读取快照详情 */
export const readImpactSnapshotValidator = vine.compile(
  vine.object({
    snapshotId: vine.number().min(1).withoutDecimals(),
  }),
)

/** Refresh 刷新快照 */
export const refreshImpactSnapshotValidator = vine.compile(
  vine.object({
    snapshotId: vine.number().min(1).withoutDecimals(),
  }),
)

/** What-if 场景对比 */
export const whatIfImpactAnalysisValidator = vine.compile(
  vine.object({
    snapshotId: vine.number().min(1).withoutDecimals(),
    scenarios: vine
      .array(
        vine.object({
          scenarioType: vine.enum(MULTI_PROJECT_IMPACT_SCENARIO_TYPES),
          assumption: vine.string().trim().minLength(1).maxLength(2000),
          targetEndpointType: vine.string().trim().minLength(1).maxLength(64),
          targetEndpointId: vine.number().min(1).withoutDecimals(),
          params: vine.object({
            delayDays: vine.number().min(0).max(365).withoutDecimals().optional(),
            newStatus: vine.string().maxLength(32).optional(),
            dependencyIdToDisable: vine.number().min(1).withoutDecimals().optional(),
            bufferAdjustmentDays: vine.number().min(-365).max(365).withoutDecimals().optional(),
            newRiskLevel: vine.string().maxLength(32).optional(),
            completionAssumption: vine.string().maxLength(2000).optional(),
          }),
        }),
      )
      .minLength(1)
      .maxLength(MULTI_PROJECT_IMPACT_DEFAULTS.MAX_SCENARIOS),
  }),
)

/** Export 导出 */
export const exportImpactAnalysisValidator = vine.compile(
  vine.object({
    snapshotId: vine.number().min(1).withoutDecimals(),
    format: vine.enum(['json', 'csv']),
  }),
)

/** Follow-up draft 后续动作草案 */
export const followUpImpactAnalysisValidator = vine.compile(
  vine.object({
    snapshotId: vine.number().min(1).withoutDecimals(),
    affectedEndpointHashes: vine
      .array(vine.string().trim().minLength(8).maxLength(64))
      .minLength(1)
      .maxLength(100),
    targetCapability: vine.enum(MULTI_PROJECT_IMPACT_FOLLOW_UP_TARGETS),
  }),
)

/** AI explanation AI 解释 */
export const aiExplanationImpactAnalysisValidator = vine.compile(
  vine.object({
    snapshotId: vine.number().min(1).withoutDecimals(),
    focus: vine.string().maxLength(1000).optional().nullable(),
  }),
)

/** Drill-down 安全下钻 */
export const drillDownImpactAnalysisValidator = vine.compile(
  vine.object({
    snapshotId: vine.number().min(1).withoutDecimals(),
    endpointHash: vine.string().trim().minLength(8).maxLength(64),
  }),
)

// ─── 统一错误信封 helper ───────────────────────────────────────────

/**
 * 返回统一的验证错误信封
 */
export function formatMultiProjectImpactValidationError(error: unknown): {
  error: { code: string; message: string; details?: unknown }
} {
  if (error instanceof Error) {
    return {
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: undefined,
      },
    }
  }
  return {
    error: {
      code: 'VALIDATION_ERROR',
      message: '请求参数校验失败',
      details: error,
    },
  }
}
