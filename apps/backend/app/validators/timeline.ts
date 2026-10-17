import vine from '@vinejs/vine'

/** 分页上限（与服务层 TIMELINE_MAX_PER_PAGE 对齐）。 */
export const TIMELINE_MAX_PER_PAGE = 50

const TIMELINE_CATEGORIES = [
  'project',
  'task',
  'wbs',
  'dependency',
  'gantt',
  'milestone',
  'risk',
  'change_request',
  'document',
  'attachment',
  'diagram',
  'report',
  'comment',
  'ai_draft',
  'draft_layer',
  'member',
  'other',
] as const

const TIMELINE_IMPORTANCE = ['low', 'normal', 'high', 'critical'] as const

/**
 * GET /projects/:id/timeline 查询参数白名单。
 */
export const listTimelineValidator = vine.compile(
  vine.object({
    /** 逗号分隔 category，如 task,milestone,risk */
    category: vine.string().trim().optional(),
    importance: vine.string().trim().optional(),
    keyOnly: vine.boolean().optional(),
    relatedToMe: vine.boolean().optional(),
    actorId: vine.number().withoutDecimals().positive().optional(),
    from: vine.string().trim().optional(),
    to: vine.string().trim().optional(),
    search: vine.string().trim().maxLength(100).optional(),
    cursor: vine.string().trim().maxLength(512).optional(),
    perPage: vine.number().withoutDecimals().positive().optional(),
    /** 仅允许 -occurredAt（默认） */
    sort: vine.enum(['-occurredAt', '+occurredAt']).optional(),
  }),
)

export { TIMELINE_CATEGORIES, TIMELINE_IMPORTANCE }

export function parseCategoryList(raw?: string): string[] | undefined {
  if (!raw) return undefined
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((c) => (TIMELINE_CATEGORIES as readonly string[]).includes(c))
}

export function parseImportanceList(raw?: string): string[] | undefined {
  if (!raw) return undefined
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((c) => (TIMELINE_IMPORTANCE as readonly string[]).includes(c))
}
