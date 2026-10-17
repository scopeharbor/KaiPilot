/**
 * ResourceDemandForecastingAiAdvisor —— 资源需求预测 AI 咨询扩展（P1 5.1-5.2）。
 *
 * v3-resource-demand-forecasting §5：手动触发的低敏 AI 咨询路径。
 *
 * 红线：
 *   - advisoryOnly：只生成叙述与建议，不落库，不写回。
 *   - 只接收低敏摘要数据（无项目名、资源名、任务详情）。
 *   - 失败时返回降级咨询，不抛异常。
 *   - 测试模式下不发起真实 AI 调用。
 *   - AI 只建议不自动执行。
 *
 * 依赖：
 *   - AIGateway（apps/backend/app/services/ai_m0/gateway.ts）
 *   - @aiproj/types 中的 ForecastAiAdvisory、FORECAST_WARNING_CODES、FORECAST_CONFIDENCE_BANDS
 */

import type { AIGateway } from '#services/ai_m0/gateway'
import type { ForecastAiAdvisory, ForecastWarningCode } from '@aiproj/types'
import { FORECAST_WARNING_CODES, FORECAST_CONFIDENCE_BANDS } from '@aiproj/types'
import logger from '@adonisjs/core/services/logger'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 传给 AI 咨询的摘要（仅含低敏字段） */
export interface ForecastAdvisoryInput {
  /** 中文摘要文本：KPI 数值、趋势方向、缺口规模等（不含项目/资源名称） */
  summaryText: string
  /** 按缺口小时数降序排列的 Top 缺口（仅含角色/技能标签与小时数） */
  topGaps: Array<{
    role?: string
    skill?: string
    gapHours: number
  }>
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 系统提示词：约束模型只生成咨询性输出 */
const SYSTEM_PROMPT = [
  '你是一个资源需求预测顾问，为项目经理提供辅助分析。',
  '请基于以下预测摘要，生成一段中文叙述和若干行动建议。',
  '',
  '重要约束：',
  '- 只提供分析和建议，不得声称可以执行任何操作。',
  '- 不得生成项目名称、资源姓名、任务标题等敏感信息。',
  '- 输出必须为严格的 JSON 格式，不含任何额外文字。',
  '- 如果数据不足以给出可靠建议，请明确说明。',
  '',
  'JSON 结构：',
  '{',
  '  "narrative": "string（一段流畅的中文叙述，2-4 句）",',
  '  "suggestedActions": ["string", ...]（3-5 条可操作的行动建议，每条一句话）',
  '}',
].join('\n')

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ResourceDemandForecastingAiAdvisor {
  /**
   * @param gateway - AIGateway 实例（注入）
   * @param isTestMode - 测试模式标志。为 true 时不发起真实 AI 调用，直接返回降级结果。
   *                     默认读取 NODE_ENV，非 production 即视为测试模式。
   */
  constructor(
    private gateway: AIGateway,
    private isTestMode: boolean = process.env.NODE_ENV !== 'production',
  ) {}

  // -----------------------------------------------------------------------
  // generateAdvisory
  // -----------------------------------------------------------------------

  /**
   * 生成 AI 咨询建议。
   *
   * @param organizationId - 组织 ID（仅用于日志与审计，不传给 AI 提示词）
   * @param input - 低敏预测摘要
   * @returns ForecastAiAdvisory —— advisoryOnly=true, writesApplied=false
   */
  async generateAdvisory(
    organizationId: number,
    input: ForecastAdvisoryInput,
  ): Promise<ForecastAiAdvisory> {
    // ── 测试模式：直接返回降级结果 ──────────────────────────
    if (this.isTestMode) {
      return this.degradedAdvisory(
        input,
        FORECAST_WARNING_CODES.AI_UNAVAILABLE,
        '当前环境为测试/开发模式，未启用真实 AI 咨询。',
      )
    }

    // ── 输入校验：摘要不可为空 ──────────────────────────────
    if (!input.summaryText || input.summaryText.trim().length === 0) {
      return this.degradedAdvisory(
        input,
        FORECAST_WARNING_CODES.INSUFFICIENT_HISTORY,
        '预测摘要数据不足，无法生成有意义的咨询建议。',
      )
    }

    // ── 构建用户提示词 ──────────────────────────────────────
    const userPrompt = this.buildUserPrompt(input)

    // ── 调用 AI Gateway ─────────────────────────────────────
    try {
      const result = await this.gateway.generate({
        sentence: userPrompt,
        promptSet: {
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
        },
        strategy: 'N' as any, // strategy N = native structured output
        temperature: 0.3, // 低温度：咨询输出需要一致性与稳定性
      })

      // 解析 AI 返回的 JSON
      const advisory = this.parseAiResponse(result.rawText, input)

      logger.info(
        { organizationId, model: this.gateway.model, tokens: result.outputTokens },
        '[ResourceDemandForecastingAiAdvisor] AI advisory generated',
      )

      return advisory
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(
        { organizationId, error: message },
        '[ResourceDemandForecastingAiAdvisor] AI call failed, returning degraded advisory',
      )

      return this.degradedAdvisory(
        input,
        FORECAST_WARNING_CODES.AI_UNAVAILABLE,
        `AI 咨询服务暂时不可用：${message.slice(0, 120)}`,
      )
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** 构建用户提示词：仅含低敏摘要字段 */
  private buildUserPrompt(input: ForecastAdvisoryInput): string {
    const lines: string[] = []

    lines.push('以下是某组织的资源需求预测摘要：')
    lines.push('')
    lines.push(input.summaryText)
    lines.push('')

    if (input.topGaps.length > 0) {
      lines.push('Top 资源缺口（按小时数降序）：')
      for (const gap of input.topGaps) {
        const label = [gap.role, gap.skill].filter(Boolean).join(' / ') || '未指定维度'
        lines.push(`  - ${label}：缺口 ${gap.gapHours} 小时`)
      }
    } else {
      lines.push('当前没有显著的资源缺口。')
    }

    lines.push('')
    lines.push('请分析以上摘要，生成叙述和行动建议。')

    return lines.join('\n')
  }

  /** 解析 AI 返回的 JSON 字符串 */
  private parseAiResponse(rawText: string, input: ForecastAdvisoryInput): ForecastAiAdvisory {
    try {
      // 尝试提取 JSON（某些模型可能在 JSON 前后包裹 markdown 代码块）
      let jsonStr = rawText.trim()
      const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1]!.trim()
      }

      const parsed = JSON.parse(jsonStr) as {
        narrative?: string
        suggestedActions?: string[]
      }

      const narrative =
        typeof parsed.narrative === 'string' && parsed.narrative.trim().length > 0
          ? parsed.narrative.trim()
          : '未能生成有效的预测叙述，请稍后重试。'

      const suggestedActions = Array.isArray(parsed.suggestedActions)
        ? parsed.suggestedActions
            .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
            .slice(0, 5)
        : []

      return {
        advisoryOnly: true as const,
        writesApplied: false as const,
        narrative,
        relatedGaps: input.topGaps.map((g) => ({
          role: g.role,
          skill: g.skill,
          gapHours: g.gapHours,
        })),
        suggestedActions,
        warnings: [],
        confidence: FORECAST_CONFIDENCE_BANDS.MEDIUM,
        model: this.gateway.model,
      }
    } catch {
      // JSON 解析失败：返回部分有效的咨询
      return {
        advisoryOnly: true as const,
        writesApplied: false as const,
        narrative: 'AI 模型返回了非结构化响应，无法解析为咨询建议。请检查摘要数据或稍后重试。',
        relatedGaps: input.topGaps.map((g) => ({
          role: g.role,
          skill: g.skill,
          gapHours: g.gapHours,
        })),
        suggestedActions: [],
        warnings: [FORECAST_WARNING_CODES.AI_UNAVAILABLE],
        confidence: FORECAST_CONFIDENCE_BANDS.LOW,
        model: undefined,
      }
    }
  }

  /** 生成降级咨询（AI 不可用或输入不足时） */
  private degradedAdvisory(
    input: ForecastAdvisoryInput,
    warningCode: ForecastWarningCode,
    message: string,
  ): ForecastAiAdvisory {
    return {
      advisoryOnly: true as const,
      writesApplied: false as const,
      narrative: message,
      relatedGaps: input.topGaps.map((g) => ({
        role: g.role,
        skill: g.skill,
        gapHours: g.gapHours,
      })),
      suggestedActions: [],
      warnings: [warningCode],
      confidence: FORECAST_CONFIDENCE_BANDS.UNKNOWN,
      model: undefined,
    }
  }
}
