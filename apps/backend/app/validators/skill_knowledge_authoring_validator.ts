/**
 * v3-skill-knowledge-authoring —— 知识创作验证器。
 *
 * put-draft: sections 形状 + kind 枚举 + sourceRefs 形状
 * commit: 确认标志或空体
 * ai-assist: hint 参数
 * preview: 空体
 */
import vine from '@vinejs/vine'

// ── KnowledgeSourceRef 形状校验 ──────────────────────────────

const sourceRefSchema = vine.object({
  layer: vine.string().optional(),
  sourceId: vine.string().optional(),
  section: vine.string().optional(),
  manual: vine.boolean(),
})

// ── 知识 section 校验 ────────────────────────────────────────

const VALID_KINDS = [
  'rules',
  'patterns',
  'antiPatterns',
  'examples',
  'checklists',
  'rubric',
] as const

const sectionSchema = vine.object({
  id: vine.string().trim().minLength(1),
  kind: vine.enum(VALID_KINDS),
  title: vine.string().trim().minLength(1).maxLength(200),
  content: vine.object({}).allowUnknownProperties(),
  sourceRefs: vine.array(sourceRefSchema).minLength(1),
  provenance: vine
    .object({
      source: vine.enum(['ai_assisted', 'manual', 'imported'] as const).optional(),
      authorId: vine.number().optional(),
      importedAt: vine.string().optional(),
      note: vine.string().optional(),
    })
    .optional(),
  status: vine.enum(['draft', 'reviewed', 'source_linked'] as const),
})

// ── PUT draft validator ──────────────────────────────────────

export const putDraftValidator = vine.compile(
  vine.object({
    sections: vine.array(sectionSchema).minLength(1),
  }),
)

// ── commit validator (空体或确认标志) ────────────────────────

export const commitValidator = vine.compile(
  vine.object({
    confirm: vine.boolean().optional(),
  }),
)

// ── ai-assist validator ──────────────────────────────────────

export const aiAssistValidator = vine.compile(
  vine.object({
    hint: vine.object({
      domain: vine.string().trim().minLength(1).optional(),
      purpose: vine.string().trim().minLength(1).optional(),
      complexity: vine.number().min(1).max(10).optional(),
      targetKind: vine.enum(VALID_KINDS).optional(),
    }),
  }),
)

// ── preview validator (空体) ─────────────────────────────────

export const previewValidator = vine.compile(vine.object({}))
