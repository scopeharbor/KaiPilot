/**
 * ai-draft-generation / T036·T037 —— 草案 API 入参校验（tasks 3.1）。
 *
 * 用 zod 做 gate 级校验（与 ai_m0 控制器一致）：只强约束契约关键字段，
 * 完整 `ConfirmedProjectContext` / 草案选择集从原始 body 透传给服务层
 * （避免 gate schema 漏字段导致生成输入被裁剪）。失败由 controller 统一渲染 422。
 */

import { z } from 'zod'
import { PROJECT_TYPES, DRAFT_CONFIRM_MODES, DRAFT_UNSELECTED_STRATEGIES } from '@aiproj/types'

/** 生成请求 gate：context 必须是 ready 的版本化确认上下文。 */
export const generateDraftBodySchema = z.object({
  context: z.object({
    schemaVersion: z.literal('1.0'),
    rawInput: z.string().min(1),
    parsedIntent: z.object({
      projectType: z.enum(PROJECT_TYPES),
    }),
  }),
  connectionId: z.number().int().positive().optional(),
  modelId: z.number().int().positive().optional(),
})

/** retry 请求 gate：可选切换连接。 */
export const retryDraftBodySchema = z.object({
  connectionId: z.number().int().positive().optional(),
  modelId: z.number().int().positive().optional(),
})

const draftSelectionSchema = z.object({
  taskIds: z.array(z.string()),
  wbsNodeIds: z.array(z.string()),
  acceptanceIds: z.array(z.string()),
  milestoneIds: z.array(z.string()),
  riskHintIds: z.array(z.string()).default([]),
  unselectedStrategy: z.enum(DRAFT_UNSELECTED_STRATEGIES),
})

const draftModificationSchema = z.object({
  path: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
})

/** 确认导入请求 gate（Section 6 使用）。 */
export const confirmDraftBodySchema = z.object({
  version: z.number().int().positive(),
  mode: z.enum(DRAFT_CONFIRM_MODES),
  selection: draftSelectionSchema.optional(),
  modifications: z.array(draftModificationSchema).optional(),
  acknowledgedWarnings: z.boolean(),
  /** 审查页的人员分配：草案角色 → 组织成员（导入时按角色负载均衡指派任务）。 */
  roleAssignments: z
    .array(
      z.object({
        role: z.string().min(1).max(80),
        userIds: z.array(z.number().int().positive()).max(50),
      }),
    )
    .max(60)
    .optional(),
  /**
   * 转正发起方式：user = 用户在审查页点击；ai_colleague_autopilot = 用户在 AI 同事里明确选择了
   * 「全自动（包括转为正式项目）」后由 AI 同事代为确认（仍走同一套阻断校验，审计单独标记）。
   */
  confirmedVia: z.enum(['user', 'ai_colleague_autopilot']).optional(),
})

/** 全自动修正阻断项：`POST /ai/project-drafts/:id/ai-fix`（模型提出字段修改，零写入）。 */
export const aiFixDraftBodySchema = z
  .object({
    /** 之前几轮已经采纳的修改（在此基础上继续修）。 */
    modifications: z.array(draftModificationSchema).max(300).optional(),
    /** 调用方手上的草案版本（与活动版本不一致时拒绝，避免在旧版本上修）。 */
    version: z.number().int().positive().optional(),
    connectionId: z.number().int().positive().optional(),
    modelId: z.number().int().positive().optional(),
  })
  .strict()

export const validateDraftBodySchema = z
  .object({
    phase: z.enum(['self_checking', 'validating', 'all']).optional(),
    selection: draftSelectionSchema.optional(),
    autoFix: z.boolean().optional(),
    modifications: z.array(draftModificationSchema).optional(),
  })
  .strict()

export type GenerateDraftBody = z.infer<typeof generateDraftBodySchema>
export type ConfirmDraftBody = z.infer<typeof confirmDraftBodySchema>
export type ValidateDraftBody = z.infer<typeof validateDraftBodySchema>
