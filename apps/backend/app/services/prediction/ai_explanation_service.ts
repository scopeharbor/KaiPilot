/**
 * PredictionAiExplanationService —— AI 风险与进度预测解释服务。
 *
 * v2-ai-risk-progress-prediction / AI Explanation Service
 *
 * 红线：AI 解释只建议，不改变预测信号、严重度或正式业务数据。
 * 默认使用 fake provider，测试不调用真实模型。
 * Real AI smoke 必须通过显式 env（AIPROJ_PREDICTION_AI_PROVIDER）启用。
 */
import logger from '@adonisjs/core/services/logger'
import { inject } from '@adonisjs/core'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import AuditService, { AuditEvent } from '#services/audit_service'
import { resolveAdapter } from '#services/ai_m0/resolver'
import ProjectPredictionSnapshot from '#models/project_prediction_snapshot'
import ProjectPredictionSignal from '#models/project_prediction_signal'
import type {
  PredictionAiExplanation,
  PredictionSignalType,
  PredictionSeverity,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface ExplainPredictionParams {
  snapshotId: number
  userId: number
  organizationId: number
  projectId: number
  requestId?: string | null
}

export interface ExplainPredictionResult {
  success: boolean
  explanation: PredictionAiExplanation | null
  failureCode: string | null
  failureMessage: string | null
}

type AdapterResolver = typeof resolveAdapter

const FAKE_PROVIDER = 'fake'
const FAKE_MODEL = 'prediction-explanation-fixture'
const AI_PROVIDER_ENV = 'AIPROJ_PREDICTION_AI_PROVIDER'

/**
 * 解析后的 AI 输出中间类型（jsonSchema 对应）。
 */
interface ParsedExplanation {
  narrative: string
  focusPoints: string[]
  suggestedActions: string[]
  assumptions: string[]
  confidence: number
}

const SYSTEM_PROMPT =
  '你是一个项目风险与进度预测解释助手。基于以下预测数据，用简体中文生成预测解释。'

@inject()
export default class PredictionAiExplanationService {
  private adapterResolver: AdapterResolver = resolveAdapter

  constructor(private audit: AuditService) {}

  /** 测试注入 fake adapter resolver */
  setAdapterResolverForTest(resolver: AdapterResolver): this {
    this.adapterResolver = resolver
    return this
  }

  // -----------------------------------------------------------------------
  // 主入口
  // -----------------------------------------------------------------------

  async explain(params: ExplainPredictionParams): Promise<ExplainPredictionResult> {
    const snapshot = await ProjectPredictionSnapshot.query()
      .where('id', params.snapshotId)
      .where('organization_id', params.organizationId)
      .where('project_id', params.projectId)
      .first()

    if (!snapshot) {
      throw new ResourceNotFoundException('预测快照不存在')
    }

    const signals = await ProjectPredictionSignal.query()
      .where('snapshot_id', snapshot.id)
      .orderBy('score', 'desc')

    const provider = process.env[AI_PROVIDER_ENV] ?? 'fake'

    if (provider === 'fake' || provider === 'test') {
      return this.generateFixture(snapshot, signals, params)
    }

    return this.generateReal(snapshot, signals, params)
  }

  // -----------------------------------------------------------------------
  // Real AI provider 路径
  // -----------------------------------------------------------------------

  private async generateReal(
    snapshot: ProjectPredictionSnapshot,
    signals: ProjectPredictionSignal[],
    params: ExplainPredictionParams,
  ): Promise<ExplainPredictionResult> {
    const startTime = Date.now()

    try {
      const userPrompt = this.buildPrompt(snapshot, signals)
      const jsonSchema = this.buildJsonSchema()

      const resolved = await this.adapterResolver({
        organizationId: params.organizationId,
      })

      const result = await resolved.gateway.generate({
        sentence: `${SYSTEM_PROMPT}\n\n${userPrompt}`,
        strategy: 'prompt',
        jsonSchema,
        temperature: 0.7,
      })

      const latencyMs = Date.now() - startTime
      const parsed = this.parseExplanation(result.rawText)
      const explanation = this.assembleExplanation(
        parsed,
        resolved.provider,
        resolved.model,
        'pending',
        null,
        null,
        latencyMs,
      )

      snapshot.aiExplanation = explanation
      await snapshot.save()

      await this.audit.log({
        event: AuditEvent.PREDICTION_AI_EXPLANATION_GENERATED,
        userId: params.userId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        entityType: 'project_prediction_snapshot',
        entityId: snapshot.id,
        requestId: params.requestId ?? null,
        metadata: {
          provider: resolved.provider,
          model: resolved.model,
          totalTokens: result.outputTokens ?? 0,
          latencyMs,
        },
      })

      return { success: true, explanation, failureCode: null, failureMessage: null }
    } catch (err) {
      const latencyMs = Date.now() - startTime
      const errorMsg = err instanceof Error ? err.message : 'unknown_error'
      const failureCode = this.categorizeError(errorMsg)

      const explanation = this.assembleExplanation(
        null,
        FAKE_PROVIDER,
        FAKE_MODEL,
        'failed',
        failureCode,
        errorMsg,
        latencyMs,
      )

      snapshot.aiExplanation = explanation
      await snapshot.save()

      await this.audit.log({
        event: AuditEvent.PREDICTION_FAILED,
        userId: params.userId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        entityType: 'project_prediction_snapshot',
        entityId: snapshot.id,
        requestId: params.requestId ?? null,
        metadata: {
          failureCode,
          failureMessage: errorMsg,
          latencyMs,
        },
      })

      return { success: false, explanation, failureCode, failureMessage: errorMsg }
    }
  }

  // -----------------------------------------------------------------------
  // Fake / fixture 路径（默认）
  // -----------------------------------------------------------------------

  private async generateFixture(
    snapshot: ProjectPredictionSnapshot,
    signals: ProjectPredictionSignal[],
    params: ExplainPredictionParams,
  ): Promise<ExplainPredictionResult> {
    const startTime = Date.now()
    const explanation = this.buildFixtureExplanation(snapshot, signals)

    snapshot.aiExplanation = explanation
    await snapshot.save()

    await this.audit.log({
      event: AuditEvent.PREDICTION_AI_EXPLANATION_GENERATED,
      userId: params.userId,
      organizationId: params.organizationId,
      projectId: params.projectId,
      entityType: 'project_prediction_snapshot',
      entityId: snapshot.id,
      requestId: params.requestId ?? null,
      metadata: {
        provider: FAKE_PROVIDER,
        model: FAKE_MODEL,
        fixture: true,
        latencyMs: Date.now() - startTime,
      },
    })

    return { success: true, explanation, failureCode: null, failureMessage: null }
  }

  // -----------------------------------------------------------------------
  // Prompt 构建
  // -----------------------------------------------------------------------

  private buildPrompt(
    snapshot: ProjectPredictionSnapshot,
    signals: ProjectPredictionSignal[],
  ): string {
    const { severityDist, typeDist } = this.computeDistributions(signals)

    const severityLines = Object.entries(severityDist)
      .filter(([, count]) => count > 0)
      .map(([sev, count]) => `  ${this.severityLabel(sev as PredictionSeverity)}: ${count} 条`)
      .join('\n')

    const typeLines = Object.entries(typeDist)
      .filter(([, count]) => count > 0)
      .map(([t, count]) => `  ${this.signalTypeLabel(t as PredictionSignalType)}: ${count} 条`)
      .join('\n')

    const topSignals = signals
      .slice(0, 8)
      .map(
        (s, i) =>
          `${i + 1}. [${this.severityLabel(s.severity)}] ${this.signalTypeLabel(s.signalType)} — ${s.description}`,
      )
      .join('\n')

    const warnings = snapshot.warnings ?? []
    const warningLines =
      warnings.length > 0 ? warnings.map((w) => `  - ${w.code}: ${w.message}`).join('\n') : '  无'

    return [
      `预测窗口：${snapshot.window} 天`,
      `信号总数：${signals.length}`,
      '',
      '严重度分布：',
      severityLines || '  无',
      '',
      '信号类型分布：',
      typeLines || '  无',
      '',
      'Top 信号：',
      topSignals || '  无',
      '',
      '数据质量警告：',
      warningLines,
    ].join('\n')
  }

  // -----------------------------------------------------------------------
  // JSON Schema
  // -----------------------------------------------------------------------

  private buildJsonSchema(): Record<string, unknown> {
    return {
      type: 'object',
      required: ['narrative', 'focusPoints', 'suggestedActions', 'assumptions', 'confidence'],
      properties: {
        narrative: { type: 'string', description: '总体预测解释，用简体中文' },
        focusPoints: {
          type: 'array',
          description: '关注要点（3-5条）',
          items: { type: 'string' },
          minItems: 3,
          maxItems: 5,
        },
        suggestedActions: {
          type: 'array',
          description: '建议动作（2-3条）',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 3,
        },
        assumptions: {
          type: 'array',
          description: '假设条件',
          items: { type: 'string' },
          minItems: 1,
        },
        confidence: {
          type: 'number',
          description: '置信度 0-1',
          minimum: 0,
          maximum: 1,
        },
      },
    }
  }

  // -----------------------------------------------------------------------
  // 响应解析
  // -----------------------------------------------------------------------

  private parseExplanation(rawText: string): ParsedExplanation {
    // 提取 JSON（模型可能返回 markdown 包裹的 JSON）
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      logger.error({ rawText: rawText.slice(0, 500) }, 'No JSON object found in AI explanation')
      throw new Error('schema_invalid')
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      logger.error({ rawText: rawText.slice(0, 500) }, 'Failed to parse AI explanation JSON')
      throw new Error('schema_invalid')
    }

    if (typeof parsed.narrative !== 'string' || parsed.narrative.trim().length === 0) {
      logger.error({ parsed }, 'Missing or empty narrative in AI explanation')
      throw new Error('schema_invalid')
    }

    const focusPoints = Array.isArray(parsed.focusPoints)
      ? parsed.focusPoints.filter((f: unknown): f is string => typeof f === 'string').slice(0, 5)
      : []

    const suggestedActions = Array.isArray(parsed.suggestedActions)
      ? parsed.suggestedActions
          .filter((a: unknown): a is string => typeof a === 'string')
          .slice(0, 3)
      : []

    const assumptions = Array.isArray(parsed.assumptions)
      ? parsed.assumptions.filter((a: unknown): a is string => typeof a === 'string')
      : []

    const confidence =
      typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5

    return { narrative: parsed.narrative, focusPoints, suggestedActions, assumptions, confidence }
  }

  // -----------------------------------------------------------------------
  // Fixture 生成（fake 路径）
  // -----------------------------------------------------------------------

  private buildFixtureExplanation(
    snapshot: ProjectPredictionSnapshot,
    signals: ProjectPredictionSignal[],
  ): PredictionAiExplanation {
    const criticalCount = signals.filter((s) => s.severity === 'critical').length
    const highCount = signals.filter((s) => s.severity === 'high').length
    const topSignals = signals.slice(0, 3)

    const parts: string[] = [
      `基于 ${snapshot.window} 天预测窗口的分析，共检测到 ${signals.length} 个信号。`,
    ]

    if (criticalCount > 0 || highCount > 0) {
      parts.push(`其中关键信号 ${criticalCount} 个，高风险信号 ${highCount} 个，需要重点关注。`)
    } else {
      parts.push('当前未检测到高风险信号，整体状态平稳。')
    }

    if (topSignals.length > 0) {
      parts.push(
        `主要关注领域：${topSignals.map((s) => this.signalTypeLabel(s.signalType)).join('、')}。`,
      )
    }

    parts.push('该解释仅作为待审核草稿，不会自动修改任务、资源、风险或计划。')

    const narrative = parts.filter(Boolean).join('')

    const focusPoints: string[] = []
    if (criticalCount > 0) focusPoints.push(`有 ${criticalCount} 个关键信号需要立即处理`)
    if (highCount > 0) focusPoints.push(`有 ${highCount} 个高风险信号需要评估`)
    for (const s of topSignals.slice(0, 3)) {
      focusPoints.push(s.description)
    }
    while (focusPoints.length < 3) {
      focusPoints.push('持续监控项目整体进展')
    }
    if (focusPoints.length > 5) focusPoints.length = 5

    const suggestedActions: string[] = [
      '审查高风险信号对应的任务和里程碑',
      '与相关干系人沟通风险应对措施',
    ]

    const assumptions: string[] = [
      '预测数据基于最近一次快照生成时的项目状态',
      '信号置信度受数据完整性和时效性影响',
      '实际结果可能因外部因素变化而偏离预测',
    ]

    return this.assembleExplanation(
      { narrative, focusPoints, suggestedActions, assumptions, confidence: 0.75 },
      FAKE_PROVIDER,
      FAKE_MODEL,
      'pending',
      null,
      null,
      0,
    )
  }

  // -----------------------------------------------------------------------
  // 组装 Final PredictionAiExplanation
  // -----------------------------------------------------------------------

  private assembleExplanation(
    parsed: ParsedExplanation | null,
    provider: string,
    model: string,
    status: 'pending' | 'failed',
    failureCode: string | null,
    failureMessage: string | null,
    latencyMs: number,
  ): PredictionAiExplanation {
    const now = new Date().toISOString()

    return {
      narrative: parsed?.narrative ?? '',
      focusPoints: parsed?.focusPoints ?? [],
      suggestedActions: parsed?.suggestedActions ?? [],
      assumptions: parsed?.assumptions ?? [],
      confidence: parsed?.confidence ?? 0,
      provider,
      model,
      status,
      failureCode: failureCode as PredictionAiExplanation['failureCode'],
      failureMessage,
      outputHash: parsed ? this.makeOutputHash(parsed) : null,
      costSummary: {
        provider,
        model,
        inputTokens: 0,
        outputTokens: Math.ceil((parsed?.narrative?.length ?? 0) / 4),
        totalCost: 0,
        currency: 'USD',
        latencyMs,
      },
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectReason: null,
      generatedAt: now,
    }
  }

  // -----------------------------------------------------------------------
  // 工具方法
  // -----------------------------------------------------------------------

  private computeDistributions(signals: ProjectPredictionSignal[]): {
    severityDist: Record<string, number>
    typeDist: Record<string, number>
  } {
    const severityDist: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    }
    const typeDist: Record<string, number> = {}

    for (const s of signals) {
      if (s.severity in severityDist) severityDist[s.severity]++
      typeDist[s.signalType] = (typeDist[s.signalType] ?? 0) + 1
    }

    return { severityDist, typeDist }
  }

  private makeOutputHash(parsed: ParsedExplanation): string {
    const payload = [
      parsed.narrative,
      parsed.focusPoints.join(','),
      parsed.suggestedActions.join(','),
      parsed.assumptions.join(','),
      parsed.confidence,
    ].join('|')

    let h = 5381
    for (let i = 0; i < payload.length; i++) {
      h = ((h << 5) + h + payload.charCodeAt(i)) >>> 0
    }
    return `out-${h.toString(36)}`
  }

  private severityLabel(severity: PredictionSeverity): string {
    const labels: Record<string, string> = {
      critical: '关键',
      high: '高',
      medium: '中',
      low: '低',
      info: '参考',
    }
    return labels[severity] ?? severity
  }

  private signalTypeLabel(type: PredictionSignalType): string {
    const labels: Record<string, string> = {
      schedule_risk: '排期风险',
      critical_path_drift: '关键路径漂移',
      milestone_pressure: '里程碑压力',
      dependency_block: '依赖阻塞',
      resource_bottleneck: '资源瓶颈',
      risk_escalation: '风险升级',
      change_impact: '变更影响',
      data_staleness: '数据过期',
      data_quality: '数据质量',
    }
    return labels[type] ?? type
  }

  private categorizeError(errorMsg: string): string {
    const lower = errorMsg.toLowerCase()
    if (lower.includes('timeout') || lower.includes('time out')) return 'provider_timeout'
    if (lower.includes('rate limit') || lower.includes('429')) return 'rate_limited'
    if (
      lower.includes('auth') ||
      lower.includes('key') ||
      lower.includes('401') ||
      lower.includes('403')
    )
      return 'unauthorized'
    if (lower.includes('budget')) return 'budget_blocked'
    if (lower.includes('parse') || lower.includes('json') || lower.includes('schema'))
      return 'schema_invalid'
    return 'unknown'
  }
}
