/**
 * v2-triz-compiler-analysis-layer —— TrizCompilerDashboardAdapter。
 *
 * Dashboard 摘要适配器：读取最新的 TRIZ 分析 artifact 摘要。
 * 设计要点：
 * - 权限感知：无 contradiction:view 权限时返回 null（不泄漏存在性）
 * - 纯读，零 side-effect
 * - 返回 TrizCompilerAnalysisSummary 紧凑结构（不含完整 artifact payload）
 */
import type User from '#models/user'
import CompilerRun from '#models/compiler_run'
import CompilerArtifact from '#models/compiler_artifact'
import TrizCompilerAnalysisPolicy from '#policies/triz_compiler_analysis_policy'
import type { TrizAnalysisArtifact, TrizCompilerAnalysisSummary } from '@aiproj/types'
import { inject } from '@adonisjs/core'

/** 来自 CompilerArtifact 模型包装的元数据 */
interface ArtifactEnvelope {
  artifactId: string | null
  version: number
  payload: TrizAnalysisArtifact
}

@inject()
export default class TrizCompilerDashboardAdapter {
  constructor(private policy: TrizCompilerAnalysisPolicy) {}

  /**
   * 获取 Dashboard 所需的 TRIZ 分析摘要。
   *
   * 读取该组织下最新 Compiler run 的最新 TRIZ 分析 artifact。
   * 无 contradiction:view 权限时返回 null（不泄漏存在性）。
   * 无 artifact 时也返回 null。
   */
  async getDashboardSummary(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<TrizCompilerAnalysisSummary | null> {
    // 1. 权限检查 — 无 contradiction:view 则静默返回 null
    const canView = await this.policy.view(user, organizationId, projectId)
    if (!canView) return null

    // 2. 查询该组织下的最新 Compiler runs（有 artifact 的 run）
    const envelope = await this.findLatestTrizArtifact(organizationId)
    if (!envelope) return null

    const { artifactId, version, payload } = envelope

    // 3. 构建紧凑摘要
    return {
      artifactId: artifactId ?? payload.sourceHashes.contentHash.slice(0, 12),
      version,
      status: payload.status,
      warningCount: payload.warnings.length,
      blockingWarningCount: payload.warnings.filter((w) => w.severity === 'blocking').length,
      topTensions: payload.parameterTensions
        .slice(0, 3)
        .map((t) => t.technicalSummary || t.physicalSummary || ''),
      sourceContradictionCount: payload.sourceContradictions.length,
      resolutionPathCount: payload.resolutionPaths.length,
      handoffStatus: payload.handoff.status,
      hasAiNarrative: payload.aiNarrative !== null,
      calculatedAt: payload.createdAt,
      stale: payload.warnings.some((w) => w.code === 'STALE_SOURCE_CONTRADICTION'),
    }
  }

  /**
   * 查找组织下最新的 TRIZ 分析 artifact 及其包装元数据。
   *
   * 先按 organizationId 查询最新完成的 CompilerRun，
   * 再查该 run 下 kind=triz_analysis_artifact 的最新 artifact。
   */
  private async findLatestTrizArtifact(organizationId: number): Promise<ArtifactEnvelope | null> {
    // 查询该组织下最新的已完成的 run
    const latestRun = await CompilerRun.forOrganization(organizationId)
      .where('status', 'completed')
      .orderBy('completed_at', 'desc')
      .first()

    if (!latestRun) return null

    // 查询该 run 下最新的 triz_analysis_artifact
    const artifact = await CompilerArtifact.forOrganization(organizationId)
      .where('compiler_run_id', latestRun.id)
      .where('kind', 'triz_analysis_artifact')
      .orderBy('version', 'desc')
      .orderBy('id', 'desc')
      .first()

    if (!artifact) return null

    const payload = artifact.payload as unknown as TrizAnalysisArtifact
    if (!payload || !payload.sourceHashes) return null

    return {
      artifactId: artifact.artifactId,
      version: artifact.version,
      payload,
    }
  }
}
