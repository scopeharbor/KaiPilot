import ProjectContradiction from '#models/project_contradiction'
import AuditService, { AuditEvent } from '#services/audit_service'
import ProjectContradictionService from '#services/triz_contradiction/project_contradiction_service'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import {
  deterministicHash,
  getParameter,
  type ContradictionAiCost,
  type ContradictionAiExplanation,
  type ProjectParameterKey,
} from '@aiproj/types'

const FAKE_PROVIDER = 'fake'
const FAKE_MODEL = 'triz-contradiction-fixture'

export interface ExplainContradictionParams {
  organizationId: number
  projectId: number
  contradictionId: number
  userId: number
  focus?: string | null
  requestId?: string | null
}

/**
 * TRIZ 矛盾 AI 解释服务。
 *
 * 默认 fake/fallback，不触真实模型；输出只保存低敏草稿和成本摘要。
 */
@inject()
export default class AiContradictionExplanationService {
  constructor(
    private audit: AuditService,
    private contradictions: ProjectContradictionService,
  ) {}

  async explain(params: ExplainContradictionParams): Promise<ContradictionAiExplanation> {
    const record = await ProjectContradiction.query()
      .where('id', params.contradictionId)
      .where('organization_id', params.organizationId)
      .where('project_id', params.projectId)
      .first()
    if (!record) throw new ResourceNotFoundException('矛盾记录不存在')

    const startedAt = Date.now()
    let explanation = this.buildFixtureExplanation(record, params.focus)
    explanation = this.validateTraceability(record, explanation)
    explanation.cost = this.buildCost(record, startedAt, explanation)

    await this.contradictions.saveAiExplanation(
      params.organizationId,
      params.projectId,
      params.contradictionId,
      explanation,
    )

    await this.audit.log({
      event: AuditEvent.CONTRADICTION_EXPLAINED,
      userId: params.userId,
      organizationId: params.organizationId,
      projectId: params.projectId,
      entityType: 'project_contradiction',
      entityId: record.id,
      requestId: params.requestId ?? null,
      metadata: {
        provider: explanation.provider,
        model: explanation.model,
        inputHash: explanation.cost?.inputHash ?? null,
        outputRef: explanation.cost?.outputRef ?? null,
        fallback: explanation.isFallback,
        hallucinationChecked: explanation.hallucinationChecked,
        ruleVersion: record.ruleVersion,
      },
    })

    return explanation
  }

  private buildFixtureExplanation(
    record: ProjectContradiction,
    focus?: string | null,
  ): ContradictionAiExplanation {
    const parameterNames = this.referencedParameterKeys(record)
      .map((key) => getParameter(key)?.name ?? key)
      .join('、')
    const principleNames = record.suggestedPrinciples
      .map((p) => p.name)
      .slice(0, 3)
      .join('、')
    const focusText = focus ? `重点关注：${focus}。` : ''
    const narrative = [
      `${record.title}。`,
      `该矛盾来自规则 ${record.ruleId}，涉及参数：${parameterNames || '未识别参数'}。`,
      principleNames
        ? `可先参考 ${principleNames} 等候选原理形成待审核解决方向。`
        : '当前没有高置信度候选原理，建议先人工复核证据。',
      focusText,
      '该解释仅作为待审核草稿，不会自动修改任务、资源、风险或计划。',
    ]
      .filter(Boolean)
      .join('')

    return {
      narrative,
      isFallback: false,
      hallucinationChecked: true,
      degradedReason: null,
      referencedPrincipleIds: record.suggestedPrinciples.map((p) => p.principleId),
      referencedParameterKeys: this.referencedParameterKeys(record),
      confidence: Math.min(0.9, Math.max(0.4, record.confidence)),
      provider: FAKE_PROVIDER,
      model: FAKE_MODEL,
      needsConfirmation: true,
    }
  }

  private validateTraceability(
    record: ProjectContradiction,
    explanation: ContradictionAiExplanation,
  ): ContradictionAiExplanation {
    const allowedPrinciples = new Set(record.suggestedPrinciples.map((p) => p.principleId))
    const allowedParameters = new Set(this.referencedParameterKeys(record))
    const principleOk = explanation.referencedPrincipleIds.every((id) => allowedPrinciples.has(id))
    const parameterOk = explanation.referencedParameterKeys.every((key) =>
      allowedParameters.has(key),
    )

    if (principleOk && parameterOk) return explanation

    return this.fallback(record, 'AI 草稿引用了不可追溯的参数或发明原理')
  }

  private fallback(record: ProjectContradiction, reason: string): ContradictionAiExplanation {
    return {
      narrative: `${record.title}。该矛盾由规则 ${record.ruleId} 派生，请以结构化证据与候选原理为准进行人工复核。`,
      isFallback: true,
      hallucinationChecked: true,
      degradedReason: reason,
      referencedPrincipleIds: record.suggestedPrinciples.map((p) => p.principleId),
      referencedParameterKeys: this.referencedParameterKeys(record),
      confidence: Math.min(record.confidence, 0.6),
      provider: FAKE_PROVIDER,
      model: FAKE_MODEL,
      needsConfirmation: true,
    }
  }

  private referencedParameterKeys(record: ProjectContradiction): ProjectParameterKey[] {
    const keys = [
      record.improvingParameterKey,
      record.worseningParameterKey,
      record.parameterKey,
    ].filter(Boolean) as ProjectParameterKey[]
    return Array.from(new Set(keys))
  }

  private buildCost(
    record: ProjectContradiction,
    startedAt: number,
    explanation: ContradictionAiExplanation,
  ): ContradictionAiCost {
    const inputHash = `in-${deterministicHash(
      JSON.stringify({
        id: record.id,
        inputSignature: record.inputSignature,
        outputHash: record.outputHash,
        principles: record.suggestedPrinciples.map((p) => p.principleId),
      }),
    )}`
    return {
      promptTokens: 0,
      completionTokens: Math.ceil(explanation.narrative.length / 4),
      estimatedCost: 0,
      latencyMs: Date.now() - startedAt,
      finishReason: explanation.isFallback ? 'fallback' : 'completed',
      errorCategory: explanation.isFallback ? 'hallucination_guard' : null,
      inputHash,
      outputRef: `triz-explain-${record.id}-${deterministicHash(explanation.narrative)}`,
    }
  }
}
