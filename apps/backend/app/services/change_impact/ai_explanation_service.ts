import ChangeImpactAnalysis from '#models/change_impact_analysis'
import ChangeImpactItem from '#models/change_impact_item'
import AuditService, { AuditEvent } from '#services/audit_service'
import ChangeRequest from '#models/change_request'
import { inject } from '@adonisjs/core'
import type { AiExplanation } from '@aiproj/types'

/**
 * AI 影响解释建议服务（v2-change-management-impact-analysis §7, D3）。
 *
 * 基于影响分析快照生成 AI 解释建议，与确定性事实分离。
 * AI 输出标记 provider/model/置信度/待确认状态，禁止覆盖确定性严重度。
 */
@inject()
export default class AiExplanationService {
  constructor(private audit: AuditService) {}

  /**
   * 生成 AI 影响解释建议。
   * AI 建议保持待确认状态，不自动写入分析摘要。
   */
  async generateExplanation(
    analysisId: number,
    projectId: number,
    userId: number,
    _focus?: string | null,
    requestId?: string | null,
  ): Promise<AiExplanation> {
    // 读取分析快照
    const analysis = await ChangeImpactAnalysis.query()
      .where('id', analysisId)
      .where('project_id', projectId)
      .first()

    if (!analysis) {
      const { ResourceNotFoundException } = await import('#exceptions/api_exception')
      throw new ResourceNotFoundException('影响分析不存在')
    }

    const items = await ChangeImpactItem.query()
      .where('analysis_id', analysisId)
      .orderBy('score', 'desc')

    const cr = await ChangeRequest.query()
      .where('id', analysis.changeRequestId)
      .where('project_id', projectId)
      .first()

    // 构建低敏 prompt（不包含完整描述或敏感正文）
    const evidenceSummary = items
      .filter((i) => i.isVisible)
      .slice(0, 10)
      .map(
        (i) =>
          `[${i.severity}] ${i.entityType}:${i.entityId} — ${i.evidence?.substring(0, 80) ?? '无'}`,
      )
      .join('\n')

    const severityDist = (analysis.summary?.severityDistribution ?? {}) as Record<string, number>
    const crTypeString = cr && typeof cr === 'object' ? String((cr as any).changeType ?? '') : ''
    const prompt = `你是一位项目管理专家。请根据以下影响分析数据，生成简洁的中文影响解释和补充问题。

变更请求：${cr?.title ?? '未知'}
影响类型：${crTypeString || '未知'}
严重度分布：critical=${severityDist.critical ?? 0}, high=${severityDist.high ?? 0}, medium=${severityDist.medium ?? 0}, low=${severityDist.low ?? 0}
受影响实体数：${analysis.summary?.totalAffected ?? 0}
关键路径受影响：${analysis.summary?.criticalPathAffected ? '是' : '否'}

主要证据摘要：
${evidenceSummary || '无详细证据'}

请生成：
1. 一段简短的影响解释摘要（2-3句话）
2. 2-3个需要人工关注的问题
3. 主要假设条件

以 JSON 格式返回 {"summary":"...", "questions":["..."], "assumptions":["..."]}`

    // 使用 AIGateway 生成（如有可用连接）
    let aiResult: { summary: string; questions: string[]; assumptions: string[] }
    let provider: string | null = null
    let model: string | null = null
    let tokenCost: number | null = null

    try {
      if (process.env.CHANGE_IMPACT_USE_REAL_AI !== 'true') {
        throw new Error('Real AI disabled for deterministic tests')
      }
      // 尝试使用 AIGateway 生成
      const gatewayMod: any = await import('#services/ai_m0/gateway')
      const GatewayClass = gatewayMod.AIGateway ?? gatewayMod.default
      if (typeof GatewayClass === 'function') {
        const gateway = new GatewayClass()
        const response = await (gateway as any).generateOnce({
          sentence: prompt,
          strategy: 'N',
        })
        const content = (response as any)?.content ?? (response as any)?.text ?? '{}'
        const parsed = typeof content === 'string' ? JSON.parse(content) : content
        aiResult = {
          summary: parsed.summary ?? '',
          questions: Array.isArray(parsed.questions) ? parsed.questions : [],
          assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
        }
        provider = (response as any)?.provider ?? null
        model = (response as any)?.model ?? null
        tokenCost = (response as any)?.tokenCost ?? null
      } else {
        throw new Error('AIGateway not available')
      }
    } catch {
      // 降级：返回基于规则的解释
      aiResult = {
        summary: this.buildFallbackSummary(analysis, items),
        questions: this.buildFallbackQuestions(items),
        assumptions: ['分析基于当前项目快照'],
      }
    }

    const explanation: AiExplanation = {
      summary: aiResult.summary,
      confidence: 0.7,
      provider,
      model,
      assumptions: aiResult.assumptions,
      needsConfirmation: true, // AI 建议必须经人工确认
      tokenCost,
    }

    // 保存 AI 建议到分析记录
    analysis.aiExplanation = explanation
    await analysis.save()

    // 审计
    await this.audit.log({
      event: AuditEvent.CHANGE_IMPACT_AI_EXPLANATION_GENERATED as any,
      userId,
      organizationId: analysis.organizationId,
      projectId,
      entityType: 'change_impact_analysis',
      entityId: analysis.id,
      requestId: requestId ?? null,
      metadata: {
        analysisId: analysis.id,
        provider,
        model,
        tokenCost,
        needsConfirmation: true,
      },
    })

    return explanation
  }

  /**
   * 确认 AI 建议（用户编辑后确认写入人工摘要）。
   */
  async confirmAiExplanation(
    analysisId: number,
    projectId: number,
    userId: number,
    editedSummary: string,
    requestId?: string | null,
  ): Promise<void> {
    const analysis = await ChangeImpactAnalysis.query()
      .where('id', analysisId)
      .where('project_id', projectId)
      .first()

    if (!analysis) {
      const { ResourceNotFoundException } = await import('#exceptions/api_exception')
      throw new ResourceNotFoundException('影响分析不存在')
    }

    // 更新 AI 解释——标记为已确认
    if (analysis.aiExplanation) {
      analysis.aiExplanation = {
        ...analysis.aiExplanation,
        summary: editedSummary,
        needsConfirmation: false,
      }
      await analysis.save()
    }

    await this.audit.log({
      event: AuditEvent.CHANGE_IMPACT_ANALYSIS_CONFIRMED as any,
      userId,
      organizationId: analysis.organizationId,
      projectId,
      entityType: 'change_impact_analysis',
      entityId: analysis.id,
      requestId: requestId ?? null,
      metadata: { analysisId, action: 'ai_confirmation_saved' },
    })
  }

  private buildFallbackSummary(analysis: ChangeImpactAnalysis, items: ChangeImpactItem[]): string {
    const total = analysis.summary?.totalAffected ?? 0
    const blocking = items.filter((i) => i.severity === 'critical' || i.severity === 'high').length
    if (total === 0) return '当前分析未发现受影响项。'
    return `影响分析发现 ${total} 个受影响项，其中 ${blocking} 项为高严重度。建议重点关注关键路径和资源负载变化。`
  }

  private buildFallbackQuestions(items: ChangeImpactItem[]): string[] {
    const questions: string[] = []
    const blockingItems = items.filter((i) => i.severity === 'critical' || i.severity === 'high')
    if (blockingItems.length > 0) {
      questions.push(`是否确认 ${blockingItems.length} 项高严重度影响的应对措施？`)
    }
    const requiresReview = items.filter((i) => i.requiresReview)
    if (requiresReview.length > 0) {
      questions.push(`是否需要人工复核 ${requiresReview.length} 项标记为需复核的影响？`)
    }
    questions.push('变更实施计划是否已包含足够的缓冲时间？')
    return questions
  }
}
