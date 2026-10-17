/**
 * 34 阶段代码生成候选运行 Validator
 * （v3-codegen-34-stage-candidate-runtime-execution）。
 *
 * `executionMode` 枚举**只含 fixture**：真实模型编译属授权门
 * （V3 baseline §6 / v2.5-release-map.md:511），因此真实模式在本能力中
 * 不是「默认关闭」而是「不可达」——校验层直接拒绝。
 */

import vine from '@vinejs/vine'

/** 创建候选运行 */
export const createCodegenCandidateRunValidator = vine.compile(
  vine.object({
    provider: vine.enum(['openai_responses', 'openai_chat_compat', 'anthropic_messages']),
    runtimeSessionId: vine.string().trim().minLength(1).maxLength(128).optional(),
    executionMode: vine.enum(['fixture']).optional(),
  }),
)

/** 候选运行列表过滤 */
export const listCodegenCandidateRunsValidator = vine.compile(
  vine.object({
    status: vine
      .enum(['pending', 'running', 'candidate_ready_pending_review', 'halted'])
      .optional(),
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
  }),
)

/** stage 记录列表分页 */
export const listCodegenStageRecordsValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
  }),
)
