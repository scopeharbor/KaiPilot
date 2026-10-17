import vine from '@vinejs/vine'

const clarificationAnswer = vine.object({
  field: vine.string().trim(),
  action: vine.enum(['answer', 'default', 'skip']),
  value: vine.any().nullable(),
  marker: vine.any().nullable().optional(),
  cardId: vine.string().trim().maxLength(160).optional(),
  source: vine.enum(['core', 'conditional', 'agent', 'triz']).optional(),
})

export const analyzeProjectIntentValidator = vine.create({
  rawInput: vine.string().trim().minLength(10).maxLength(50_000),
  /** 长需求（超过 8,000 字）的整理稿，由 /ai/project-intents/brief 生成、用户确认后随请求带上。 */
  requirementBrief: vine.string().trim().maxLength(30_000).optional(),
  answers: vine.record(clarificationAnswer).optional(),
  questionPlanRevision: vine.string().trim().maxLength(64).optional(),
  agentQuestionPlanToken: vine.string().trim().maxLength(32_000).optional(),
  adaptiveSessionToken: vine.string().trim().maxLength(64_000).optional(),
  requestPreliminaryDraft: vine.boolean().optional(),
  /** 守卫态重试：带上现有会话令牌重跑这一步，已确认答案保留。 */
  retryGuardedSession: vine.boolean().optional(),
  adaptiveResponse: vine
    .object({
      text: vine.string().trim().minLength(1).maxLength(1_000),
      intents: vine.array(vine.any()).maxLength(8).optional(),
    })
    .optional(),
  connectionId: vine.number().positive().optional(),
  modelId: vine.number().positive().optional(),
  /**
   * 按次网页搜索同意（v3-copilot-optional-web-search-configuration）。
   * 服务端记录于审计但草案生成链路暂不调用工具门（见 change 内记录）；
   * accept 保证「默认不联网」语义在前端请求形状上成立。
   */
  webSearchConsent: vine.boolean().optional(),
})

/**
 * 「我不了解这道题」的流式解释入参。只读链路：会话令牌用非 mutation 的 consume
 * 校验，history 由客户端持有（服务端不存本题解释对话）。
 */
export const explainClarificationQuestionValidator = vine.create({
  rawInput: vine.string().trim().minLength(10).maxLength(50_000),
  /** 长需求（超过 8,000 字）的整理稿，由 /ai/project-intents/brief 生成、用户确认后随请求带上。 */
  requirementBrief: vine.string().trim().maxLength(30_000).optional(),
  adaptiveSessionToken: vine.string().trim().maxLength(64_000),
  question: vine.string().trim().maxLength(1_000).optional(),
  history: vine
    .array(
      vine.object({
        role: vine.enum(['user', 'assistant']),
        text: vine.string().trim().minLength(1).maxLength(4_000),
      }),
    )
    .maxLength(16)
    .optional(),
  connectionId: vine.number().positive().optional(),
  modelId: vine.number().positive().optional(),
})

/** 需求附件：文件以 base64 传来（≤15 MB 原文件），读成文字返回，不落库。 */
export const requirementAttachmentValidator = vine.create({
  fileName: vine.string().trim().minLength(1).maxLength(255),
  dataBase64: vine.string().minLength(1).maxLength(21_000_000),
  connectionId: vine.number().positive().optional(),
  modelId: vine.number().positive().optional(),
})

/** 长需求整理：原文最多 5 万字，整理成逐条保留具体事项的需求清单。 */
export const requirementBriefValidator = vine.create({
  rawInput: vine.string().trim().minLength(10).maxLength(50_000),
  connectionId: vine.number().positive().optional(),
  modelId: vine.number().positive().optional(),
})
