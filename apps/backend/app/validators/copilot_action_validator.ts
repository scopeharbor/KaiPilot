/**
 * v3-copilot-action-and-preview-boundary —— Copilot 动作入参校验（任务 4.x/5.x 端点侧）。
 *
 * zod gate 级校验：禁止客户端提交 organizationId、完整 PDM JSON、
 * 规则开关、幂等键自定义（幂等键由服务端从归一化输入 + 目标引用 + source 签名重算）。
 */
import { z } from 'zod'

/** source 签名：内容 hash + 捕获时间戳缺一不可（spec Requirement 2）。 */
const sourceSignatureSchema = z.object({
  sourceRef: z.string().min(1),
  contentHash: z.string().min(1),
  capturedAt: z.string().min(1),
})

/** 动作提交请求（物化为草案层会话 + change set）。 */
export const copilotActionSubmitSchema = z.object({
  actionCardId: z.string().min(1),
  normalizedActionInput: z.string().min(1),
  idempotencyKey: z.string().min(1).max(200),
  sourceSignaturePrefixes: z.array(z.string()).default([]),
  reliedOnSubstitutedDefaults: z.boolean().default(false),
  changes: z.array(
    z.object({
      targetRef: z.string().min(1),
      operation: z.enum(['create', 'update', 'delete']),
      value: z.record(z.string(), z.unknown()),
      oldValue: z.record(z.string(), z.unknown()).nullable().optional(),
      confidence: z.number().min(0).max(1),
      dependsOn: z.array(z.number().int().positive()).optional(),
    }),
  ),
})

/** 单条确认请求。 */
export const copilotActionConfirmSchema = z.object({
  sessionId: z.number().int().positive(),
  actionCardId: z.string().min(1),
  changeId: z.number().int().positive(),
  decision: z.enum(['accept', 'reject', 'modify', 'skip']),
  userModifiedValue: z.unknown().optional(),
  userNote: z.string().max(2000).optional().nullable(),
  requiredPermissions: z.array(z.string()).default([]),
  requestSources: z.array(sourceSignatureSchema),
  recordedSources: z.array(sourceSignatureSchema),
  confirmedTargetRefs: z.array(z.string()),
  writeTargetRefs: z.array(z.string()),
  dryRunCanApply: z.boolean(),
  idempotencyKey: z.string().min(1).max(200),
  attempt: z.number().int().min(1).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
})
