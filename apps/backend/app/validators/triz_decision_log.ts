import vine from '@vinejs/vine'
import { TRIZ_DECISION_TYPES, TRIZ_DECISION_SOURCE_KINDS } from '@aiproj/types'

/**
 * v2-triz-decision-log-traceability —— TRIZ 决策日志校验器。
 *
 * 所有校验器仅验证请求体的结构与类型，
 * 业务存在性与权限由 Controller/Service 层判定。
 */

/**
 * 列表/查询校验：projectId 路径参数 + 可选分页。
 */
export const trizDecisionListValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
    status: vine.string().trim().maxLength(20).optional(),
  }),
)

/**
 * 创建决策日志校验。
 */
export const trizDecisionCreateValidator = vine.compile(
  vine.object({
    decisionType: vine.enum(TRIZ_DECISION_TYPES),
    subjectRefs: vine
      .array(
        vine.object({
          kind: vine.enum(TRIZ_DECISION_SOURCE_KINDS),
          id: vine.string().trim().minLength(1).maxLength(255),
          version: vine.string().trim().minLength(1).maxLength(255),
          summaryLevel: vine.enum(['low', 'medium', 'high']),
          visibility: vine.enum(['public', 'restricted', 'internal']),
          title: vine.string().trim().maxLength(500).optional().nullable(),
        }),
      )
      .minLength(1),
    sourceRefs: vine.array(
      vine.object({
        kind: vine.string().trim().minLength(1).maxLength(100),
        id: vine.string().trim().minLength(1).maxLength(255),
        hash: vine.string().trim().minLength(1).maxLength(255),
        summary: vine.string().trim().maxLength(500).optional().nullable(),
      }),
    ),
    artifactHashes: vine.array(
      vine.object({
        label: vine.string().trim().minLength(1).maxLength(100),
        hash: vine.string().trim().minLength(1).maxLength(255),
        algorithm: vine.string().trim().maxLength(50).optional(),
      }),
    ),
    reasonSummary: vine.string().trim().maxLength(2000),
    alternativeSummary: vine.string().trim().maxLength(2000).optional().nullable(),
  }),
)

/**
 * 废止决策日志校验。
 */
export const trizDecisionSupersedeValidator = vine.compile(
  vine.object({
    decisionType: vine.enum(TRIZ_DECISION_TYPES),
    subjectRefs: vine
      .array(
        vine.object({
          kind: vine.enum(TRIZ_DECISION_SOURCE_KINDS),
          id: vine.string().trim().minLength(1).maxLength(255),
          version: vine.string().trim().minLength(1).maxLength(255),
          summaryLevel: vine.enum(['low', 'medium', 'high']),
          visibility: vine.enum(['public', 'restricted', 'internal']),
          title: vine.string().trim().maxLength(500).optional().nullable(),
        }),
      )
      .minLength(1),
    sourceRefs: vine.array(
      vine.object({
        kind: vine.string().trim().minLength(1).maxLength(100),
        id: vine.string().trim().minLength(1).maxLength(255),
        hash: vine.string().trim().minLength(1).maxLength(255),
        summary: vine.string().trim().maxLength(500).optional().nullable(),
      }),
    ),
    artifactHashes: vine.array(
      vine.object({
        label: vine.string().trim().minLength(1).maxLength(100),
        hash: vine.string().trim().minLength(1).maxLength(255),
        algorithm: vine.string().trim().maxLength(50).optional(),
      }),
    ),
    reasonSummary: vine.string().trim().maxLength(2000),
    alternativeSummary: vine.string().trim().maxLength(2000).optional().nullable(),
  }),
)

/**
 * 主题查询校验。
 */
export const trizDecisionSubjectLookupValidator = vine.compile(
  vine.object({
    kind: vine.enum(TRIZ_DECISION_SOURCE_KINDS),
    id: vine.string().trim().minLength(1).maxLength(255),
    version: vine.string().trim().maxLength(255).optional().nullable(),
  }),
)

/**
 * AI 理由草稿校验。
 */
export const trizDecisionAiDraftValidator = vine.compile(
  vine.object({
    subjectRefs: vine
      .array(
        vine.object({
          kind: vine.enum(TRIZ_DECISION_SOURCE_KINDS),
          id: vine.string().trim().minLength(1).maxLength(255),
          version: vine.string().trim().minLength(1).maxLength(255),
          summaryLevel: vine.enum(['low', 'medium', 'high']),
          visibility: vine.enum(['public', 'restricted', 'internal']),
          title: vine.string().trim().maxLength(500).optional().nullable(),
        }),
      )
      .minLength(1),
    sourceRefs: vine.array(
      vine.object({
        kind: vine.string().trim().minLength(1).maxLength(100),
        id: vine.string().trim().minLength(1).maxLength(255),
        hash: vine.string().trim().minLength(1).maxLength(255),
        summary: vine.string().trim().maxLength(500).optional().nullable(),
      }),
    ),
    decisionType: vine.enum(TRIZ_DECISION_TYPES),
  }),
)
