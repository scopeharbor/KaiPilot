/**
 * ai-structured-output-poc / M0 —— 前端草案 zod schema（浏览器侧运行时校验）。
 *
 * 前端为什么再定义一份 schema？——`@aiproj/types` 只有静态类型（跨端零依赖包），
 * 运行时校验要在**收 SSE 流后就近做**，防止后端未部署或返回被篡改时把脏数据渲染到 DraftReviewPanel。
 * 后端 zod schema 与本文件互为镜像；两侧的字段清单和策略应同步（tasks 2.3）。
 *
 * 用途：接住 SSE 全量文本 → parseDraft → 交给 DraftReviewPanel 渲染。
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

const wbsBase = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable(),
  outlineCode: z.string().min(1),
  name: marked(z.string().min(1)),
  description: marked(z.string()),
})
type WbsShape = z.infer<typeof wbsBase> & { children: WbsShape[] }
const wbsNode: z.ZodType<WbsShape> = wbsBase.extend({
  get children() {
    return z.array(wbsNode)
  },
}) as z.ZodType<WbsShape>

const dependency = z.object({
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
  dependencies: z.array(dependency),
  assigneeHint: marked(z.string()),
}) satisfies z.ZodType<DraftTask>

const acceptanceCriterion = z.object({
  id: z.string().min(1),
  statement: marked(z.string().min(1)),
  linkedSuccessIndex: z.number().int().nonnegative().nullable(),
})

export const aiProjectDraftSchema: z.ZodType<AiProjectDraft> = z.object({
  charter,
  wbs: z.array(wbsNode).min(1),
  tasks: z.array(task).min(1),
  acceptanceCriteria: z.array(acceptanceCriterion).min(1),
})

/** 简单 wrapper：safeParse + 归一 issue 输出。 */
export function parseDraft(
  raw: unknown,
): { ok: true; value: AiProjectDraft } | { ok: false; issues: string[] } {
  const r = aiProjectDraftSchema.safeParse(raw)
  if (r.success) return { ok: true, value: r.data }
  return { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
}

// 编译期防退化。
const _shapeCheck: WbsShape extends DraftWbsNode ? true : false = true
void _shapeCheck
