/**
 * v3-llm-wiki-memory-foundation —— 记忆维基请求校验（zod，与 knowledge_validator 约定一致）。
 */
import { z } from 'zod'
import { WIKI_MAX_BODY_CHARS, WIKI_SCOPE_KINDS, type WikiScopeKind } from '@aiproj/types'

const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const body = z.string().min(1, '正文不能为空').max(WIKI_MAX_BODY_CHARS)
// AdonisJS 请求体解析会把空字符串转成 null（convertEmptyStringsToNull），可选文字字段一律按空串处理
const optionalText = z
  .string()
  .max(500)
  .nullish()
  .transform((v) => v ?? '')
const changeSummary = optionalText

export const wikiSettingsSchema = z.object({ enabled: z.boolean() })

export const wikiResolveSpaceSchema = z.object({
  scopeKind: z.enum(WIKI_SCOPE_KINDS as unknown as [WikiScopeKind, ...WikiScopeKind[]]),
  scopeRefId: id.optional(),
})

export const wikiCreatePageSchema = z.object({
  slug: z.string().min(1).max(100),
  body,
  changeSummary,
})

export const wikiCreateRevisionSchema = z.object({
  body,
  baseRevisionId: id.nullable(),
  changeSummary,
})

export const wikiFileBackSchema = z.object({
  projectId: id.nullish().transform((v) => v ?? null),
  title: z
    .string()
    .max(200)
    .nullish()
    .transform((v) => v ?? ''),
  question: z.string().min(1, '问题不能为空').max(4000),
  answer: z.string().min(1, '回答不能为空').max(40000),
})

export const wikiReasonSchema = z.object({ reason: optionalText })

export const wikiRollbackSchema = z.object({ revisionId: id })

export const wikiSharingSchema = z.object({ projectIds: z.array(id).max(20) })

export const wikiPagingSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(50),
})

export const wikiAsOfSchema = z.object({ asOf: z.string().datetime({ offset: true }).optional() })

export const wikiSearchSchema = z.object({ q: z.string().min(1).max(100) })

export const wikiFindingStatusSchema = z.object({
  status: z.enum(['open', 'all']).optional().default('open'),
})

export const wikiQueueSchema = z.object({ spaceId: id.optional() })

export const wikiIdParam = id

/** v3-llm-wiki-retrospective-lessons：教训召回（q 为风险标题 / 描述等文字）。 */
export const wikiLessonRecallSchema = z.object({
  q: z
    .string()
    .max(500)
    .nullish()
    .transform((v) => v ?? ''),
  projectId: id.optional(),
})

/** v3-llm-wiki-eval-gate：问答集的结构由 parseWikiEvalQuestions 逐项校验，这里只限定外形与大小。 */
export const wikiEvalRunSchema = z.object({ questions: z.array(z.unknown()).min(1).max(50) })

/** v3-llm-wiki-rag-retirement：回答评测须显式确认费用。 */
export const wikiAnswerEvalRunSchema = z.object({ confirmCost: z.boolean().optional() })
