/**
 * ai-structured-output-poc / M0 —— 后端草案 zod schema（运行时校验）。
 *
 * 与 `@aiproj/types` 的静态类型互为镜像：类型定义在共享包，运行时校验在后端。
 * 依据 spec「M0 结构化一致性必须按分布口径三档测量」：
 *   - `strict` = 一次通过、零修复；
 *   - `repaired` = 经预清洗或轻量修复通过；
 *   - `failed` = 重试上限内仍不通过。
 * 本文件只负责 schema 定义与 safeParse 包装，三档判定由 `services/ai_m0/judge.ts` 完成。
 */

import { z } from 'zod'
import type { AiMarker, AiProjectDraft, DraftTask, DraftWbsNode } from '@aiproj/types'
import { AI_MARKER_SOURCES, DRAFT_DEPENDENCY_TYPES, DRAFT_TASK_STATUSES } from '@aiproj/types'

const aiMarker = z.object({
  confidence: z.number().min(0).max(1),
  source: z.enum(AI_MARKER_SOURCES),
  reason: z.string().min(1),
  needsConfirmation: z.boolean(),
}) satisfies z.ZodType<AiMarker>

const marked = <T extends z.ZodTypeAny>(value: T) => z.object({ value, marker: aiMarker })

const charter = z.object({
  title: marked(z.string().min(1)),
  vision: marked(z.string().min(1)),
  scope: marked(z.string().min(1)),
  successCriteria: marked(z.array(z.string().min(1)).min(1)),
  startDate: marked(z.string()),
  endDate: marked(z.string()),
})

const wbsNodeBase = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable(),
  outlineCode: z.string().min(1),
  name: marked(z.string().min(1)),
  description: marked(z.string()),
})
type WbsNodeShape = z.infer<typeof wbsNodeBase> & { children: WbsNodeShape[] }
const wbsNode: z.ZodType<WbsNodeShape> = wbsNodeBase.extend({
  get children() {
    return z.array(wbsNode)
  },
}) as z.ZodType<WbsNodeShape>

const taskDependency = z.object({
  predecessorId: z.string().min(1),
  type: z.enum(DRAFT_DEPENDENCY_TYPES),
  lagDays: marked(z.number()),
})

const task = z.object({
  id: z.string().min(1),
  wbsNodeId: z.string().min(1),
  name: marked(z.string().min(1)),
  description: marked(z.string()),
  status: z.enum(DRAFT_TASK_STATUSES),
  durationDays: marked(z.number().nonnegative()),
  startDate: marked(z.string()),
  endDate: marked(z.string()),
  dependencies: z.array(taskDependency),
  assigneeHint: marked(z.string()),
}) satisfies z.ZodType<DraftTask>

const acceptanceCriterion = z.object({
  id: z.string().min(1),
  statement: marked(z.string().min(1)),
  linkedSuccessIndex: z.number().int().nonnegative().nullable(),
})

export const aiProjectDraftSchema = z.object({
  charter,
  wbs: z.array(wbsNode).min(1),
  tasks: z.array(task).min(1),
  acceptanceCriteria: z.array(acceptanceCriterion).min(1),
}) satisfies z.ZodType<AiProjectDraft>

/** 把运行时 zod schema 转为 Provider 的 JSON Schema；prompt 策略无需传入。 */
export function draftJsonSchemaForStrategy(
  strategy: import('@aiproj/types').AiM0Strategy,
): Record<string, unknown> | undefined {
  if (strategy === 'prompt') return undefined
  return z.toJSONSchema(aiProjectDraftSchema) as Record<string, unknown>
}

export type ParsedDraftResult =
  { ok: true; value: AiProjectDraft } | { ok: false; issues: z.core.$ZodIssue[] }

/**
 * 严格解析：完全经 zod 校验，任何字段错误都会返回 `ok:false` 与 issues 列表。
 * 由三档判定器（`judge.ts`）分类：一次通过 → strict；预清洗后通过 → repaired。
 */
export function parseDraft(raw: unknown): ParsedDraftResult {
  const result = aiProjectDraftSchema.safeParse(raw)
  if (result.success) {
    return { ok: true, value: result.data }
  }
  return { ok: false, issues: result.error.issues }
}

/** 深度只读的 wbs 树类型，供其他工具复用。 */
export type WbsNodeSchemaShape = WbsNodeShape
// 编译期防退化：确保共享类型与 zod 推断类型不漂移。
// eslint-disable-next-line @typescript-eslint/naming-convention
const _shapeCheck: WbsNodeSchemaShape extends DraftWbsNode ? true : false = true
void _shapeCheck
