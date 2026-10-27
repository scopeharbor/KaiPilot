/**
 * v3-llm-wiki-ingest-pipeline —— 编入模型端口（维基目录中唯一引用模型网关的文件，架构测试守护）。
 *
 * 默认实现经既有 `resolveAdapter` 解析组织的 AI 连接（自动接入统一调用账本与限流），
 * 只解析到模拟适配器时返回 null：模拟输出不得充当编入结果（RL-13）。测试通过容器 swap 注入假端口。
 */
import { resolveAdapter } from '#services/ai_m0/resolver'

export const WIKI_INGEST_CAPABILITY = 'wiki_ingest'
export const WIKI_INGEST_SURFACE = 'wiki_ingest'

export interface WikiIngestModelRequest {
  systemPrompt: string
  userPrompt: string
  maxOutputTokens: number
  /** 账本中的提示词名；缺省为编入（流程解读传 `wiki.process.interpret`）。 */
  promptName?: string
}

export interface WikiIngestModelResponse {
  rawText: string
  outputTokens: number | null
}

export interface WikiIngestModelPort {
  readonly provider: string | null
  readonly model: string | null
  generate(request: WikiIngestModelRequest): Promise<WikiIngestModelResponse>
}

export interface WikiIngestModelContext {
  organizationId: number
  projectId: number | null
  userId: number | null
  idempotencyKey: string
  estimatedTokens: number
}

export default class WikiIngestModelProvider {
  async create(ctx: WikiIngestModelContext): Promise<WikiIngestModelPort | null> {
    const resolved = await resolveAdapter({
      organizationId: ctx.organizationId,
      requiredCapabilities: ['structured_output'],
      estimatedTokens: ctx.estimatedTokens,
      recordContext: {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        userId: ctx.userId,
        capability: WIKI_INGEST_CAPABILITY,
        surface: WIKI_INGEST_SURFACE,
        idempotencyKey: ctx.idempotencyKey,
        source: 'user',
      },
    })
    if (!resolved.usingRealAdapter) return null
    return {
      provider: resolved.provider,
      model: resolved.model,
      async generate(request) {
        const result = await resolved.gateway.generate({
          sentence: request.userPrompt,
          promptSet: { systemPrompt: request.systemPrompt, userPrompt: request.userPrompt },
          strategy: 'native',
          maxOutputTokens: request.maxOutputTokens,
          promptName: request.promptName ?? 'wiki.ingest.page_ops',
        })
        return { rawText: result.rawText, outputTokens: result.outputTokens }
      },
    }
  }
}
