/**
 * v2-triz-recommendation-rationale-ui —— RationaleSourceResolver。
 *
 * 解析矛盾、分析 Artifact、推荐等来源目标，返回低敏摘要与 hash。
 * 所有解析器均强制执行组织/项目隔离。
 */
import type { RationaleSourceRef } from '@aiproj/types'

export interface ContradictionResolution {
  found: boolean
  sourceRef: RationaleSourceRef | null
  summary: string
  parameterTensions: Array<{
    improvingParameter: string
    improvingParameterName: string
    worseningParameter: string
    worseningParameterName: string
    severity: string
  }>
  principleMappings: Array<{
    principleId: string
    principleName: string
    rationale: string
    relevance: string
    applicability: string
    nonApplicability: string
  }>
  evidence: Array<{
    label: string
    description: string
    sourceHash: string
    navigationUrl: string | null
  }>
}

export interface AnalysisArtifactResolution {
  found: boolean
  sourceRef: RationaleSourceRef | null
  summary: string
  contradictions: ContradictionResolution[]
}

export interface RecommendationResolution {
  found: boolean
  sourceRef: RationaleSourceRef | null
  summary: string
}

class RationaleSourceResolver {
  // ── Contradiction ──────────────────────────────────────────────────

  /**
   * 解析矛盾来源目标。
   * 通过 contradictionId 在组织/项目范围内查询 ProjectContradiction。
   */
  async resolveContradiction(
    contradictionId: string,
    organizationId: number,
    projectId: number,
  ): Promise<ContradictionResolution> {
    const { default: ProjectContradiction } = await import('#models/project_contradiction')

    const contradiction = await ProjectContradiction.query()
      .where('id', Number.parseInt(contradictionId, 10) || 0)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!contradiction) {
      return {
        found: false,
        sourceRef: null,
        summary: '矛盾不可用',
        parameterTensions: [],
        principleMappings: [],
        evidence: [],
      }
    }

    const sourceRef: RationaleSourceRef = {
      sourceType: 'contradiction',
      id: String(contradiction.id),
      hash: contradiction.outputHash ?? `v${contradiction.id}`,
      summary: contradiction.title,
    }

    const improvingName = contradiction.improvingParameterKey ?? ''
    const worseningName = contradiction.worseningParameterKey ?? ''

    const parameterTensions = []
    if (improvingName || worseningName) {
      parameterTensions.push({
        improvingParameter: improvingName || 'unknown',
        improvingParameterName: improvingName || '未知参数',
        worseningParameter: worseningName || 'unknown',
        worseningParameterName: worseningName || '未知参数',
        severity: contradiction.severity,
      })
    }

    const principleMappings = (contradiction.suggestedPrinciples ?? []).map((sp: any) => ({
      principleId: sp.principleId ?? sp.id ?? '',
      principleName: sp.principleName ?? sp.name ?? '',
      rationale: sp.rationale ?? '',
      relevance: sp.relevance ?? 'medium',
      applicability: sp.applicability ?? '',
      nonApplicability: sp.nonApplicability ?? '',
    }))

    const evidence = (contradiction.evidence ?? []).map((ev: any) => ({
      label: ev.label ?? 'evidence',
      description: ev.description ?? '',
      sourceHash: ev.sourceHash ?? contradiction.outputHash ?? '',
      navigationUrl: ev.navigationUrl ?? null,
    }))

    return {
      found: true,
      sourceRef,
      summary: `矛盾「${contradiction.title}」(${contradiction.type}, ${contradiction.severity})`,
      parameterTensions,
      principleMappings,
      evidence,
    }
  }

  // ── Analysis Artifact ──────────────────────────────────────────────

  /**
   * 解析 Compiler 分析 Artifact 来源目标。
   * 通过 artifactId 在组织/项目范围内查询 CompilerArtifact（kind=triz_analysis_artifact）。
   */
  async resolveAnalysisArtifact(
    artifactId: string,
    organizationId: number,
    _projectId: number,
  ): Promise<AnalysisArtifactResolution> {
    const { ArtifactStore } = await import('#services/compiler/artifact_store')
    const store = new ArtifactStore()
    const numericId = Number.parseInt(artifactId, 10)
    const artifact = Number.isNaN(numericId)
      ? null
      : await store.latest(numericId, 'triz_analysis_artifact')

    if (!artifact || artifact.organizationId !== organizationId) {
      return {
        found: false,
        sourceRef: null,
        summary: '分析 Artifact 不可用',
        contradictions: [],
      }
    }

    const sourceRef: RationaleSourceRef = {
      sourceType: 'analysis_artifact',
      id: String(artifact.id),
      hash: artifact.contentHash ?? `v${artifact.version}`,
      summary: `分析结果(v${artifact.version})`,
    }

    // 从 payload 中提取矛盾摘要
    const payload = artifact.payload ?? {}
    const rawContradictions = Array.isArray(payload.contradictions) ? payload.contradictions : []

    const contradictions: ContradictionResolution[] = rawContradictions.map((c: any) => ({
      found: true,
      sourceRef: null,
      summary: c.title ?? c.summary ?? '',
      parameterTensions: [
        {
          improvingParameter: c.improvingParameter ?? c.improving ?? '',
          improvingParameterName: c.improvingParameterName ?? c.improving ?? '',
          worseningParameter: c.worseningParameter ?? c.worsening ?? '',
          worseningParameterName: c.worseningParameterName ?? c.worsening ?? '',
          severity: c.severity ?? 'medium',
        },
      ],
      principleMappings: (c.suggestedPrinciples ?? []).map((sp: any) => ({
        principleId: sp.principleId ?? sp.id ?? '',
        principleName: sp.principleName ?? sp.name ?? '',
        rationale: sp.rationale ?? '',
        relevance: sp.relevance ?? 'medium',
        applicability: sp.applicability ?? '',
        nonApplicability: sp.nonApplicability ?? '',
      })),
      evidence: (c.evidence ?? []).map((ev: any) => ({
        label: ev.label ?? 'evidence',
        description: ev.description ?? '',
        sourceHash: ev.sourceHash ?? '',
        navigationUrl: ev.navigationUrl ?? null,
      })),
    }))

    return {
      found: true,
      sourceRef,
      summary: `分析 Artifact「v${artifact.version}」`,
      contradictions,
    }
  }

  // ── Recommendation ─────────────────────────────────────────────────

  /**
   * 解析推荐来源目标（可选适配器）。
   * 当推荐记录不存在时返回 unavailable。
   */
  async resolveRecommendation(
    recommendationId: string,
    organizationId: number,
    projectId: number,
  ): Promise<RecommendationResolution> {
    const { default: ProjectRecommendation } = await import('#models/project_recommendation')

    const recommendation = await ProjectRecommendation.query()
      .where('id', Number.parseInt(recommendationId, 10) || 0)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!recommendation) {
      return {
        found: false,
        sourceRef: null,
        summary: '推荐不可用',
      }
    }

    const sourceRef: RationaleSourceRef = {
      sourceType: 'recommendation',
      id: String(recommendation.id),
      hash:
        recommendation.evidenceHash ?? String(recommendation.updatedAt?.toMillis?.() ?? Date.now()),
      summary: recommendation.summary,
    }

    return {
      found: true,
      sourceRef,
      summary: recommendation.summary,
    }
  }
}

export default RationaleSourceResolver
