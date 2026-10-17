import AuditService, { AuditEvent } from '#services/audit_service'
import { resolveAdapter } from '#services/ai_m0/resolver'
import CryptoService from '#services/crypto_service'
import { ValidationException } from '#exceptions/api_exception'
import { randomUUID } from 'node:crypto'
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import type { RiskAiSuggestion, RiskCategory } from '@aiproj/types'

const MAX_SUGGESTIONS = 10
const MAX_TITLE_LENGTH = 200
const MAX_DESCRIPTION_LENGTH = 2000
const MAX_MITIGATION_LENGTH = 2000
const MAX_REASON_LENGTH = 1000
type AdapterResolver = typeof resolveAdapter

/** 限流状态（内存级，V1 足够） */
const rateLimitState = new Map<string, number[]>()

export function resetRiskSuggestionRateLimitForTest() {
  rateLimitState.clear()
}

function checkRateLimit(key: string, windowMs: number, maxCount: number): boolean {
  const now = Date.now()
  const timestamps = rateLimitState.get(key) ?? []
  const recent = timestamps.filter((t) => now - t < windowMs)
  if (recent.length >= maxCount) return false
  recent.push(now)
  rateLimitState.set(key, recent)
  return true
}

@inject()
export default class RiskSuggestionService {
  private adapterResolver: AdapterResolver = resolveAdapter

  constructor(
    private audit: AuditService,
    private crypto: CryptoService,
  ) {}

  setAdapterResolverForTest(resolver: AdapterResolver): this {
    this.adapterResolver = resolver
    return this
  }

  /**
   * 手动触发 AI 风险建议（design D1/D6）。
   * 不落库；返回结构化候选数组供前端逐条采纳。
   */
  async suggest(
    organizationId: number,
    projectId: number,
    projectContext: {
      title: string
      description?: string
      taskCount?: number
      resourceCount?: number
      domainType?: string
    },
    actorUserId: number,
  ): Promise<{ suggestions: RiskAiSuggestion[]; suggestionBatchId: string }> {
    // 限流：每项目 30 秒 1 次
    if (!checkRateLimit(`risk-suggest:${projectId}`, 30_000, 1)) {
      throw new ValidationException('操作过于频繁，请 30 秒后重试')
    }
    // 限流：每组织每分钟 20 次
    if (!checkRateLimit(`risk-suggest-org:${organizationId}`, 60_000, 20)) {
      throw new ValidationException('组织级 AI 建议配额已用尽，请稍后重试')
    }

    // 按组织解析可用连接（含个人版的平台统一 AI 配置回退）；只接受真实用户连接。
    const resolved = await this.adapterResolver({
      organizationId,
      crypto: this.crypto,
    })
    if (resolved.source !== 'user') {
      throw new ValidationException('未配置可用的 AI 连接')
    }

    const suggestionBatchId = randomUUID()

    // 构建 Prompt 上下文
    const systemPrompt = `你是一个项目风险管理专家。根据提供的项目信息，识别潜在风险并生成风险建议。
每条建议必须包含：title（风险标题，≤${MAX_TITLE_LENGTH}字符）、description（风险描述，≤${MAX_DESCRIPTION_LENGTH}字符）、category（技术/进度/成本/资源/外部/组织/法律/其他之一）、probability（概率1-5）、impact（影响1-5）、suggestedMitigation（建议缓解措施，≤${MAX_MITIGATION_LENGTH}字符）、aiMarker（含confidence 0-1、source枚举inferred/explicit/default、reason文本≤${MAX_REASON_LENGTH}字符、needsConfirmation布尔）。
最多返回${MAX_SUGGESTIONS}条。只返回 JSON 数组，不要其他文字。`

    const userPrompt = `项目信息：
标题：${projectContext.title}
${projectContext.description ? `描述：${projectContext.description}` : ''}
${projectContext.taskCount ? `任务数量：${projectContext.taskCount}` : ''}
${projectContext.resourceCount ? `资源数量：${projectContext.resourceCount}` : ''}
${projectContext.domainType ? `领域类型：${projectContext.domainType}` : ''}

请识别该项目的潜在风险，返回 JSON 数组格式的风险建议。`

    const jsonSchema = {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'title',
          'description',
          'category',
          'probability',
          'impact',
          'suggestedMitigation',
          'aiMarker',
        ],
        properties: {
          title: { type: 'string', maxLength: MAX_TITLE_LENGTH },
          description: { type: 'string', maxLength: MAX_DESCRIPTION_LENGTH },
          category: {
            type: 'string',
            enum: [
              'technical',
              'schedule',
              'cost',
              'resource',
              'external',
              'organizational',
              'legal',
              'other',
            ],
          },
          probability: { type: 'integer', minimum: 1, maximum: 5 },
          impact: { type: 'integer', minimum: 1, maximum: 5 },
          suggestedMitigation: { type: 'string', maxLength: MAX_MITIGATION_LENGTH },
          aiMarker: {
            type: 'object',
            required: ['confidence', 'source', 'reason', 'needsConfirmation'],
            properties: {
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              source: { type: 'string', enum: ['inferred', 'explicit', 'default'] },
              reason: { type: 'string', maxLength: MAX_REASON_LENGTH },
              needsConfirmation: { type: 'boolean' },
            },
          },
        },
      },
    }

    let rawText: string
    try {
      const result = await resolved.gateway.generate({
        sentence: `${systemPrompt}\n\n${userPrompt}`,
        strategy: 'prompt',
        jsonSchema,
        temperature: 0.7,
      })
      rawText = result.rawText
    } catch (err) {
      logger.error({ err, organizationId, projectId }, 'AI risk suggestion gateway error')
      throw new ValidationException('AI 服务暂时不可用，请稍后重试')
    }

    // 解析 JSON 响应
    let candidates: unknown[]
    try {
      // 提取 JSON 数组（模型可能返回带 markdown 包裹的 JSON）
      const jsonMatch = rawText.match(/\[[\s\S]*\]/)
      if (!jsonMatch) throw new Error('No JSON array found')
      candidates = JSON.parse(jsonMatch[0])
    } catch {
      logger.error({ rawText: rawText.slice(0, 500) }, 'Failed to parse AI risk suggestions')
      throw new ValidationException('AI 返回的数据格式不正确')
    }

    if (!Array.isArray(candidates)) {
      throw new ValidationException('AI 返回的数据格式不正确')
    }

    // 校验 + 截断 + 剔除不完整候选
    const suggestions: RiskAiSuggestion[] = []
    for (const candidate of candidates) {
      if (suggestions.length >= MAX_SUGGESTIONS) break
      if (!candidate || typeof candidate !== 'object') continue

      const c = candidate as Record<string, unknown>
      const aiMarker = c.aiMarker as Record<string, unknown> | undefined

      // AIMarker 完整性校验
      if (
        !aiMarker ||
        typeof aiMarker.confidence !== 'number' ||
        !['inferred', 'explicit', 'default'].includes(aiMarker.source as string) ||
        typeof aiMarker.reason !== 'string' ||
        (aiMarker.reason as string).trim().length === 0 ||
        typeof aiMarker.needsConfirmation !== 'boolean'
      ) {
        logger.warn({ candidate }, 'Dropped risk suggestion: incomplete AIMarker')
        continue
      }

      const title = typeof c.title === 'string' ? c.title.slice(0, MAX_TITLE_LENGTH) : ''
      const description =
        typeof c.description === 'string' ? c.description.slice(0, MAX_DESCRIPTION_LENGTH) : ''
      const suggestedMitigation =
        typeof c.suggestedMitigation === 'string'
          ? c.suggestedMitigation.slice(0, MAX_MITIGATION_LENGTH)
          : ''
      const reason = (aiMarker.reason as string).slice(0, MAX_REASON_LENGTH)

      if (!title || !description) continue

      const probability =
        typeof c.probability === 'number' ? Math.min(5, Math.max(1, Math.round(c.probability))) : 3
      const impact =
        typeof c.impact === 'number' ? Math.min(5, Math.max(1, Math.round(c.impact))) : 3
      const validCategories: RiskCategory[] = [
        'technical',
        'schedule',
        'cost',
        'resource',
        'external',
        'organizational',
        'legal',
        'other',
      ]
      const category = validCategories.includes(c.category as RiskCategory)
        ? (c.category as RiskCategory)
        : 'other'

      suggestions.push({
        title,
        description,
        category,
        probability,
        impact,
        suggestedMitigation,
        suggestionBatchId,
        aiMarker: {
          confidence: Math.min(1, Math.max(0, aiMarker.confidence as number)),
          source: aiMarker.source as 'inferred' | 'explicit' | 'default',
          reason,
          needsConfirmation: aiMarker.needsConfirmation as boolean,
        },
      })
    }

    await this.audit.log({
      event: AuditEvent.RISK_AI_SUGGESTED,
      userId: actorUserId,
      organizationId,
      projectId,
      metadata: {
        suggestionBatchId,
        candidateCount: suggestions.length,
      },
    })

    return { suggestions, suggestionBatchId }
  }
}
