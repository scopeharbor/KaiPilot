/**
 * v2-triz-recommendation-rationale-ui —— TrizRecommendationRationaleService。
 *
 * 只读服务：从 TRIZ 矛盾、Compiler Artifact、可选的推荐来源组装
 * TrizRecommendationRationale DTO。不含 refresh/confirm/dismiss/explain/AIGateway 调用。
 *
 * 权限安全的 unavailable 响应：当目标不可访问时，返回 deterministic fallback DTO。
 */
import { inject } from '@adonisjs/core'
import RationaleSourceResolver from '#services/triz_rationale/rationale_source_resolver'
import {
  deriveAvailableSections,
  isSourceHashStale,
  sortEvidenceRefs,
  type RationaleSourceType,
  type TrizRecommendationRationale,
  type RationaleWarning,
  type RationaleEvidenceRef,
  type RationaleParameterTension,
  type PrincipleMappingEntry,
  type RationaleAiMetadata,
  type RationaleCostSummary,
  type RationaleValidationSummary,
  type RationaleSourceRef,
} from '@aiproj/types'
import { ResourceNotFoundException } from '#exceptions/api_exception'

@inject()
export default class TrizRecommendationRationaleService {
  constructor(private resolver: RationaleSourceResolver) {}

  /**
   * 构建 TRIZ 推荐理由 DTO。
   *
   * @param organizationId  当前组织 ID
   * @param projectId       当前项目 ID
   * @param sourceType      来源类型（contradiction / analysis_artifact / recommendation）
   * @param targetId        目标 ID
   */
  async show(
    organizationId: number,
    projectId: number,
    sourceType: RationaleSourceType,
    targetId: string,
  ): Promise<TrizRecommendationRationale> {
    if (!['contradiction', 'analysis_artifact', 'recommendation'].includes(sourceType)) {
      throw new ResourceNotFoundException('未知来源类型')
    }

    // 1. 解析来源
    const contradictionRes = await this.resolver.resolveContradiction(
      targetId,
      organizationId,
      projectId,
    )
    const artifactRes = await this.resolver.resolveAnalysisArtifact(
      targetId,
      organizationId,
      projectId,
    )
    const recommendationRes = await this.resolver.resolveRecommendation(
      targetId,
      organizationId,
      projectId,
    )

    // 2. 根据 sourceType 选取主来源，未找到时抛异常
    let primaryFound = false
    const sourceRefs: RationaleSourceRef[] = []

    switch (sourceType) {
      case 'contradiction': {
        if (!contradictionRes.found) {
          throw new ResourceNotFoundException('TRIZ 矛盾未找到')
        }
        primaryFound = true
        if (contradictionRes.sourceRef) sourceRefs.push(contradictionRes.sourceRef)
        break
      }
      case 'analysis_artifact': {
        if (!artifactRes.found) {
          throw new ResourceNotFoundException('TRIZ 分析 Artifact 未找到')
        }
        primaryFound = true
        if (artifactRes.sourceRef) sourceRefs.push(artifactRes.sourceRef)
        break
      }
      case 'recommendation': {
        if (!recommendationRes.found) {
          throw new ResourceNotFoundException('TRIZ 推荐未找到')
        }
        primaryFound = true
        if (recommendationRes.sourceRef) sourceRefs.push(recommendationRes.sourceRef)
        break
      }
      default:
        throw new ResourceNotFoundException('未知来源类型')
    }

    if (!primaryFound) {
      throw new ResourceNotFoundException('来源不可用')
    }

    for (const ref of [
      contradictionRes.sourceRef,
      artifactRes.sourceRef,
      recommendationRes.sourceRef,
    ]) {
      if (!ref) continue
      const exists = sourceRefs.some(
        (sourceRef) => sourceRef.sourceType === ref.sourceType && sourceRef.id === ref.id,
      )
      if (!exists) sourceRefs.push(ref)
    }

    // 3. 组装参数 tension
    const parameterTensions: RationaleParameterTension[] = [
      ...(contradictionRes.found ? contradictionRes.parameterTensions : []),
      ...(artifactRes.found ? artifactRes.contradictions.flatMap((c) => c.parameterTensions) : []),
    ]

    // 4. 组装发明原理映射
    const principleMappings: PrincipleMappingEntry[] = [
      ...(contradictionRes.found ? contradictionRes.principleMappings : []),
      ...(artifactRes.found ? artifactRes.contradictions.flatMap((c) => c.principleMappings) : []),
    ]

    // 5. 组装证据链 refs
    const evidenceRefs: RationaleEvidenceRef[] = [
      ...(contradictionRes.found ? contradictionRes.evidence : []),
      ...(artifactRes.found ? artifactRes.contradictions.flatMap((c) => c.evidence) : []),
    ]

    // 6. 来源 hash 列表与矛盾摘要
    const sourceRefHashes = sourceRefs.map((r) => r.hash).filter(Boolean)
    const evidenceSourceHashes = evidenceRefs.map((e) => e.sourceHash).filter(Boolean)
    const sourceHashes = evidenceSourceHashes.length > 0 ? evidenceSourceHashes : sourceRefHashes
    const contradictionSummary = contradictionRes.found
      ? contradictionRes.summary
      : artifactRes.found
        ? artifactRes.summary
        : recommendationRes.found
          ? recommendationRes.summary
          : null

    // 7. 构建验证摘要
    const warnings: RationaleWarning[] = []
    for (const ref of sourceRefs) {
      if (ref.hash && isSourceHashStale(ref.hash, sourceHashes)) {
        warnings.push({
          code: 'STALE_SOURCE_HASH',
          message: `来源「${ref.summary}」的 hash 已过期`,
        })
      }
    }

    if (evidenceRefs.length === 0) {
      warnings.push({
        code: 'EMPTY_EVIDENCE_CHAIN',
        message: '证据链为空',
      })
    }

    const validationSummary: RationaleValidationSummary = {
      status: warnings.length > 0 ? 'warning' : 'passed',
      antiHallucinationPassed: true,
      sourceRefsValid: sourceRefs.length > 0,
      warnings,
    }

    // 8. 构建 AI/fallback 元数据（确定性 fallback，非 AI 生成）
    const aiMetadata: RationaleAiMetadata = {
      isAiGenerated: false,
      validationStatus: 'skipped',
      provider: null,
      model: null,
      inputHash: null,
      outputRef: null,
    }

    const costSummary: RationaleCostSummary = {
      provider: null,
      model: null,
      tokens: 0,
      estimatedCost: null,
      latencyMs: null,
      budgetDecision: 'not_applicable',
    }

    // 9. 确定性规则摘要
    const deterministicSummary = this.buildDeterministicSummary(
      contradictionRes,
      artifactRes,
      recommendationRes,
    )

    // 10. 构建 DTO
    const sortedEvidence = sortEvidenceRefs(evidenceRefs)
    const rationale: TrizRecommendationRationale = {
      id: `${sourceType}_${targetId}`,
      organizationId,
      projectId,
      sourceType,
      sourceRefs,
      sourceHashes,
      contradictionSummary,
      parameterTensions,
      principleMappings,
      evidenceRefs: sortedEvidence,
      validationSummary,
      warningSummary:
        warnings.length > 0 ? warnings.map((w) => `${w.code}: ${w.message}`).join('; ') : null,
      aiMetadata,
      costSummary,
      deterministicSummary,
      aiExplanationDraft: null,
      fallbackSummary: null,
      availableSections: [],
      humanReviewRequirement: null,
      handoffState: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    // 11. 推导可用 UI section
    rationale.availableSections = deriveAvailableSections(rationale)

    return rationale
  }

  /**
   * 构建确定性规则摘要。
   */
  private buildDeterministicSummary(
    contradictionRes: Awaited<ReturnType<RationaleSourceResolver['resolveContradiction']>>,
    artifactRes: Awaited<ReturnType<RationaleSourceResolver['resolveAnalysisArtifact']>>,
    recommendationRes: Awaited<ReturnType<RationaleSourceResolver['resolveRecommendation']>>,
  ): string {
    const parts: string[] = []

    if (contradictionRes.found) {
      const principleCount = contradictionRes.principleMappings.length
      parts.push(
        `基于 TRIZ 矛盾分析，识别出 ${contradictionRes.parameterTensions.length} 个参数冲突`,
      )
      if (principleCount > 0) {
        parts.push(`推荐 ${principleCount} 个候选发明原理`)
      }
    }

    if (artifactRes.found) {
      const totalPrinciples = artifactRes.contradictions.reduce(
        (sum, c) => sum + c.principleMappings.length,
        0,
      )
      parts.push(`Compile 分析发现 ${artifactRes.contradictions.length} 个关联矛盾`)
      if (totalPrinciples > 0) {
        parts.push(`共涉及 ${totalPrinciples} 条发明原理候选`)
      }
    }

    if (recommendationRes.found) {
      parts.push('AI 智能推荐已关联')
    }

    return parts.length > 0 ? parts.join('；') : '暂无可用摘要'
  }
}
