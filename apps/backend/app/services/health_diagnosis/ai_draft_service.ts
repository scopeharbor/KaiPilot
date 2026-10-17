/**
 * ProjectHealthAiDraftService —— 健康诊断 AI 草稿生成服务。
 *
 * v2-ai-project-health-diagnosis / Group 4
 *
 * 红线：AI 输出不改变规则评分、严重度、证据或正式业务数据。
 * 默认使用 fake provider，测试不调用真实模型。
 */
import logger from '@adonisjs/core/services/logger'
import AuditService, { AuditEvent } from '#services/audit_service'
import ProjectHealthDiagnosis from '#models/project_health_diagnosis'
import { inject } from '@adonisjs/core'
import type { HealthDiagnosisSummary, HealthAiDraft, HealthDataWarning } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface AiDraftParams {
  diagnosisId: number
  organizationId: number
  projectId: number
  userId: number
}

export interface AiDraftResult {
  success: boolean
  draft: HealthAiDraft | null
  warnings: HealthDataWarning[]
  costSummary: AiCostSummary | null
}

export interface AiCostSummary {
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCost: number
  latencyMs: number
  finishReason: string
  errorCategory: string | null
  budgetVerdict: 'passed' | 'hard_blocked' | 'soft_blocked'
}

const FAKE_PROVIDER = 'fake'
const FAKE_MODEL = 'test-model'
const BUDGET_HARD_LIMIT_USD = 0.05
const ESTIMATED_COST_PER_DRAFT = 0.001
const MAX_PROMPT_TOKENS = 3000
const MAX_RESPONSE_TOKENS = 1500

@inject()
export default class ProjectHealthAiDraftService {
  constructor(private audit: AuditService) {}

  async generateAiDraft(params: AiDraftParams): Promise<AiDraftResult> {
    const warnings: HealthDataWarning[] = []

    const diagnosis = await ProjectHealthDiagnosis.query()
      .where('id', params.diagnosisId)
      .where('organization_id', params.organizationId)
      .where('project_id', params.projectId)
      .first()

    if (!diagnosis) throw new Error('RESOURCE_NOT_FOUND')

    // 预算 preflight
    if (ESTIMATED_COST_PER_DRAFT > BUDGET_HARD_LIMIT_USD) {
      warnings.push({
        dimension: 'progress',
        code: 'AI_BUDGET_BLOCKED',
        message: 'AI 预算硬限制阻止了模型调用，当前使用规则版诊断',
        blocking: false,
      })
      diagnosis.status = 'ai_failed'
      await diagnosis.save()

      await this.audit.log({
        event: AuditEvent.HEALTH_DIAGNOSIS_AI_DRAFT_FAILED,
        userId: params.userId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        entityType: 'project_health_diagnosis',
        entityId: diagnosis.id,
        metadata: { budgetVerdict: 'hard_blocked', reason: '预算超限' },
      })

      return {
        success: false,
        draft: null,
        warnings,
        costSummary: {
          provider: FAKE_PROVIDER,
          model: FAKE_MODEL,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCost: 0,
          latencyMs: 0,
          finishReason: 'budget_blocked',
          errorCategory: 'budget_blocked',
          budgetVerdict: 'hard_blocked',
        },
      }
    }

    const summary = diagnosis.summary
    if (!summary) {
      warnings.push({
        dimension: 'progress',
        code: 'AI_SKIPPED_NO_SUMMARY',
        message: '诊断无摘要数据，跳过 AI 草稿生成',
        blocking: false,
      })
      diagnosis.status = 'ai_failed'
      await diagnosis.save()
      return { success: false, draft: null, warnings, costSummary: null }
    }

    const startTime = Date.now()
    let parsedDraft: HealthAiDraft
    let finishReason = 'completed'
    let errorCategory: string | null = null

    try {
      parsedDraft = await this.callAiProvider(summary)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'unknown_error'
      finishReason = 'error'
      errorCategory = this.categorizeError(errorMsg)

      diagnosis.status = 'ai_failed'
      await diagnosis.save()

      const latencyMs = Date.now() - startTime
      await this.audit.log({
        event: AuditEvent.HEALTH_DIAGNOSIS_AI_DRAFT_FAILED,
        userId: params.userId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        entityType: 'project_health_diagnosis',
        entityId: diagnosis.id,
        metadata: {
          provider: FAKE_PROVIDER,
          model: FAKE_MODEL,
          finishReason,
          errorCategory,
          latencyMs,
        },
      })

      warnings.push({
        dimension: 'progress',
        code: 'AI_GENERATION_FAILED',
        message: `AI 草稿生成失败（${errorCategory}），已降级为规则版诊断`,
        blocking: false,
      })
      return {
        success: false,
        draft: null,
        warnings,
        costSummary: {
          provider: FAKE_PROVIDER,
          model: FAKE_MODEL,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCost: 0,
          latencyMs,
          finishReason,
          errorCategory,
          budgetVerdict: 'passed',
        },
      }
    }

    const latencyMs = Date.now() - startTime

    diagnosis.aiDraft = parsedDraft
    diagnosis.status = 'ai_ready'
    await diagnosis.save()

    const costSummary: AiCostSummary = {
      provider: FAKE_PROVIDER,
      model: FAKE_MODEL,
      promptTokens: this.estimatePromptTokens(summary),
      completionTokens: this.estimateCompletionTokens(parsedDraft),
      totalTokens: this.estimatePromptTokens(summary) + this.estimateCompletionTokens(parsedDraft),
      estimatedCost: ESTIMATED_COST_PER_DRAFT,
      latencyMs,
      finishReason,
      errorCategory: null,
      budgetVerdict: 'passed',
    }

    await this.audit.log({
      event: AuditEvent.HEALTH_DIAGNOSIS_AI_DRAFT_GENERATED,
      userId: params.userId,
      organizationId: params.organizationId,
      projectId: params.projectId,
      entityType: 'project_health_diagnosis',
      entityId: diagnosis.id,
      metadata: {
        provider: costSummary.provider,
        model: costSummary.model,
        totalTokens: costSummary.totalTokens,
        latencyMs,
        finishReason,
      },
    })

    return { success: true, draft: parsedDraft, warnings, costSummary }
  }

  private async callAiProvider(summary: HealthDiagnosisSummary): Promise<HealthAiDraft> {
    const signalSummary = this.buildLowSensitivityPrompt(summary)
    const provider = process.env.AIPROJ_HEALTH_DIAGNOSIS_AI_PROVIDER ?? 'fake'

    if (provider === 'fake' || provider === 'test') return this.fakeProvider(signalSummary)

    logger.warn({ provider }, 'health diagnosis AI real provider not yet connected, using fake')
    return this.fakeProvider(signalSummary)
  }

  private buildLowSensitivityPrompt(summary: HealthDiagnosisSummary): string {
    const dims = summary.dimensionScores.map(
      (d) =>
        `- ${d.dimension}：得分 ${d.score}，严重度 ${d.severity}，证据 ${d.evidence.length} 条`,
    )
    return [
      `项目健康诊断总分：${summary.overallScore}（${summary.overallLabel}）`,
      '',
      '各维度评分：',
      ...dims,
      '',
      summary.warnings.length > 0
        ? `警告：${summary.warnings.map((w) => w.message).join('；')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  private fakeProvider(_signalSummary: string): HealthAiDraft {
    return {
      narrativeDraft:
        '项目整体运行状态需关注。进度维度出现逾期任务，关键路径上部分任务存在延期风险。建议优先处理逾期任务，检查关键路径依赖关系，确保资源分配合理。',
      recommendedActionsText:
        '1. 审查逾期任务清单，为每个任务制定追赶计划\n2. 检查关键路径依赖，消除阻塞因素\n3. 重新评估资源分配，避免资源超载',
      assumptions: [
        '诊断数据已反映最近一次快照生成时的项目状态',
        '资源负载数据基于当前分配情况',
        '风险暴露基于已登记的风险条目',
      ],
      confidence: 0.75,
      questions: [
        '是否需要调整里程碑计划以反映当前进展？',
        '是否需要对超载资源进行重新分配？',
        '高风险项是否需要制定新的应对措施？',
      ],
      provider: FAKE_PROVIDER,
      model: FAKE_MODEL,
    }
  }

  private estimatePromptTokens(summary: HealthDiagnosisSummary): number {
    return Math.min(MAX_PROMPT_TOKENS, 200 + summary.dimensionScores.length * 100)
  }

  private estimateCompletionTokens(draft: HealthAiDraft): number {
    const text = `${draft.narrativeDraft} ${draft.recommendedActionsText} ${draft.assumptions.join(' ')} ${draft.questions.join(' ')}`
    return Math.min(MAX_RESPONSE_TOKENS, Math.ceil(text.length / 4))
  }

  private categorizeError(errorMsg: string): string {
    const lower = errorMsg.toLowerCase()
    if (lower.includes('timeout') || lower.includes('time out')) return 'timeout'
    if (lower.includes('rate limit') || lower.includes('429')) return 'rate_limited'
    if (
      lower.includes('auth') ||
      lower.includes('key') ||
      lower.includes('401') ||
      lower.includes('403')
    )
      return 'auth_error'
    if (lower.includes('parse') || lower.includes('json')) return 'parse_error'
    if (lower.includes('empty') || lower.includes('null')) return 'empty_output'
    return 'provider_error'
  }
}
