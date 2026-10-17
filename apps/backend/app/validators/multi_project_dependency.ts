import vine from '@vinejs/vine'

// ---------------------------------------------------------------------------
// 枚举白名单常量
// ---------------------------------------------------------------------------

const endpointTypeSchema = vine.enum(['project', 'milestone', 'task', 'external'] as const)
const dependencyCategorySchema = vine.enum([
  'deliverable',
  'milestone',
  'technical',
  'resource',
  'external',
] as const)
const dependencyTypeSchema = vine.enum(['fs', 'ss', 'ff', 'sf'] as const)
const dependencyStrengthSchema = vine.enum(['hard', 'soft', 'advisory'] as const)
const dependencyStatusSchema = vine.enum([
  'draft',
  'active',
  'at_risk',
  'blocked',
  'resolved',
  'archived',
] as const)
const riskLevelSchema = vine.enum(['critical', 'high', 'medium', 'low', 'none'] as const)
const sourceModeSchema = vine.enum(['manual', 'rule_suggestion', 'ai_suggestion'] as const)

// ---------------------------------------------------------------------------
// 列表查询验证器
// ---------------------------------------------------------------------------

export const listMultiProjectDependenciesValidator = vine.compile(
  vine.object({
    projectIds: vine.array(vine.number().withoutDecimals().positive()).optional(),
    endpointType: endpointTypeSchema.optional(),
    category: dependencyCategorySchema.optional(),
    type: dependencyTypeSchema.optional(),
    status: vine.array(dependencyStatusSchema).optional(),
    riskLevel: riskLevelSchema.optional(),
    sourceMode: sourceModeSchema.optional(),
    freshness: vine.enum(['fresh', 'stale'] as const).optional(),
    dateFrom: vine.string().optional(),
    dateTo: vine.string().optional(),
    search: vine.string().maxLength(200).optional(),
    sort: vine.string().maxLength(50).optional(),
    page: vine.number().withoutDecimals().positive().optional(),
    perPage: vine.number().withoutDecimals().positive().max(100).optional(),
  }),
)

// ---------------------------------------------------------------------------
// 图谱查询验证器
// ---------------------------------------------------------------------------

export const graphMultiProjectDependenciesValidator = vine.compile(
  vine.object({
    projectIds: vine.array(vine.number().withoutDecimals().positive()).minLength(1).maxLength(100),
    endpointType: endpointTypeSchema.optional(),
    category: dependencyCategorySchema.optional(),
    status: vine.array(dependencyStatusSchema).optional(),
    riskLevel: riskLevelSchema.optional(),
    maxDepth: vine.number().withoutDecimals().positive().max(20),
    nodeLimit: vine.number().withoutDecimals().positive().max(2000),
    edgeLimit: vine.number().withoutDecimals().positive().max(5000),
    freshnessThreshold: vine.enum(['fresh', 'stale', 'all'] as const).optional(),
  }),
)

// ---------------------------------------------------------------------------
// 创建预览验证器
// ---------------------------------------------------------------------------

export const createMultiProjectDependencyPreviewValidator = vine.compile(
  vine.object({
    // provider 端点
    providerEndpointType: endpointTypeSchema,
    providerProjectId: vine.number().withoutDecimals().positive().nullable().optional(),
    providerMilestoneId: vine.number().withoutDecimals().positive().nullable().optional(),
    providerTaskId: vine.number().withoutDecimals().positive().nullable().optional(),
    providerExternalLabel: vine.string().maxLength(255).nullable().optional(),
    providerExternalKey: vine.string().maxLength(255).nullable().optional(),

    // consumer 端点
    consumerEndpointType: endpointTypeSchema,
    consumerProjectId: vine.number().withoutDecimals().positive().nullable().optional(),
    consumerMilestoneId: vine.number().withoutDecimals().positive().nullable().optional(),
    consumerTaskId: vine.number().withoutDecimals().positive().nullable().optional(),
    consumerExternalLabel: vine.string().maxLength(255).nullable().optional(),
    consumerExternalKey: vine.string().maxLength(255).nullable().optional(),

    // 依赖属性
    category: dependencyCategorySchema,
    type: dependencyTypeSchema.optional(),
    lagDays: vine.number().withoutDecimals().optional(),
    strength: dependencyStrengthSchema.optional(),
    bufferDays: vine.number().withoutDecimals().min(0).optional(),
    riskLevel: riskLevelSchema.optional(),
    sourceMode: sourceModeSchema.optional(),
  }),
)

// ---------------------------------------------------------------------------
// 更新预览验证器
// ---------------------------------------------------------------------------

export const updateMultiProjectDependencyPreviewValidator = vine.compile(
  vine.object({
    dependencyId: vine.number().withoutDecimals().positive(),
    category: dependencyCategorySchema.optional(),
    type: dependencyTypeSchema.optional(),
    lagDays: vine.number().withoutDecimals().optional(),
    strength: dependencyStrengthSchema.optional(),
    bufferDays: vine.number().withoutDecimals().min(0).optional(),
    status: dependencyStatusSchema.optional(),
    riskLevel: riskLevelSchema.optional(),
    ownerUserId: vine.number().withoutDecimals().positive().nullable().optional(),
  }),
)

// ---------------------------------------------------------------------------
// 归档/删除预览验证器
// ---------------------------------------------------------------------------

export const archiveMultiProjectDependencyPreviewValidator = vine.compile(
  vine.object({
    dependencyId: vine.number().withoutDecimals().positive(),
  }),
)

// ---------------------------------------------------------------------------
// 恢复预览验证器
// ---------------------------------------------------------------------------

export const restoreMultiProjectDependencyPreviewValidator = vine.compile(
  vine.object({
    dependencyId: vine.number().withoutDecimals().positive(),
  }),
)

// ---------------------------------------------------------------------------
// 确认验证器（通用）
// ---------------------------------------------------------------------------

export const confirmMultiProjectDependencyValidator = vine.compile(
  vine.object({
    previewId: vine.string().maxLength(64),
    confirmationHash: vine.string().maxLength(64),
    idempotencyKey: vine.string().maxLength(64),
  }),
)

// ---------------------------------------------------------------------------
// 影响分析验证器
// ---------------------------------------------------------------------------

export const impactAnalysisValidator = vine.compile(
  vine.object({
    sourceType: vine.enum(['endpoint', 'hypothetical'] as const),
    sourceEndpoint: vine
      .object({
        endpointType: endpointTypeSchema,
        projectId: vine.number().withoutDecimals().positive().nullable().optional(),
        taskId: vine.number().withoutDecimals().positive().nullable().optional(),
        milestoneId: vine.number().withoutDecimals().positive().nullable().optional(),
        externalKey: vine.string().maxLength(255).nullable().optional(),
      })
      .optional(),
    hypotheticalDelayDays: vine.number().withoutDecimals().positive().optional(),
    hypotheticalDescription: vine.string().maxLength(500).optional(),
    maxDepth: vine.number().withoutDecimals().positive().max(20),
    edgeLimit: vine.number().withoutDecimals().positive().max(5000),
    includeLocalContext: vine.boolean().optional(),
    projectIds: vine.array(vine.number().withoutDecimals().positive()).maxLength(100).optional(),
  }),
)

// ---------------------------------------------------------------------------
// 下钻验证器
// ---------------------------------------------------------------------------

export const drillDownValidator = vine.compile(
  vine.object({
    opaqueToken: vine.string().maxLength(128),
    refType: vine.string().maxLength(20),
    targetId: vine.number().withoutDecimals().positive(),
  }),
)

// ---------------------------------------------------------------------------
// 建议列表验证器
// ---------------------------------------------------------------------------

export const listSuggestionsValidator = vine.compile(
  vine.object({
    suggestionType: vine.enum(['rule', 'ai'] as const).optional(),
    status: vine.enum(['pending', 'accepted', 'dismissed', 'expired'] as const).optional(),
    page: vine.number().withoutDecimals().positive().optional(),
    perPage: vine.number().withoutDecimals().positive().max(100).optional(),
  }),
)
