/**
 * v2-triz-compiler-analysis-layer —— TrizCompilerAnalysisController。
 *
 * HTTP 入口，只处理请求解析、权限校验、响应格式化。
 * 业务逻辑下沉到 ArtifactStore（读取）+ TrizCompilerDraftHandoffService（handoff）。
 *
 * 红线：
 * - 所有读端点（index/show）零 side-effect：不触发 refresh、compiler 执行、handoff
 * - handoff 端点只创建 advisory 候选元数据，不写正式项目/任务/风险/依赖数据
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import TrizCompilerAnalysisPolicy from '#policies/triz_compiler_analysis_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import { ArtifactStore } from '#services/compiler/artifact_store'
import {
  TrizCompilerDraftHandoffService,
  TrizHandoffNotFoundError,
  TrizHandoffBlockedError,
} from '#services/triz_compiler/triz_compiler_draft_handoff_service'
import {
  trizAnalysisListValidator,
  trizAnalysisDetailValidator,
  trizDraftHandoffValidator,
} from '#validators/triz_compiler_analysis'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'

@inject()
export default class TrizCompilerAnalysisController {
  constructor(
    private policy: TrizCompilerAnalysisPolicy,
    private artifactStore: ArtifactStore,
    private handoffService: TrizCompilerDraftHandoffService,
    private audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgIdOf(ctx: HttpContext): number {
    return Number(ctx.tenant!.organizationId)
  }

  private runIdFrom(ctx: HttpContext): number {
    return Number(ctx.params.runId)
  }

  private artifactIdFrom(ctx: HttpContext): string {
    return String(ctx.params.artifactId)
  }

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  /**
   * 读守卫：检查 contradiction:view 权限。
   * 组织上下文来自 tenant，项目级权限由调用方在创建 run 时绑定。
   */
  private async guardRead(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    if (!(await this.policy.view(user, orgId, 0))) {
      throw new PermissionDeniedException('无权查看 TRIZ 分析结果')
    }
  }

  /**
   * 写守卫：检查 contradiction:view + Draft Layer 读权限。
   */
  private async guardMutate(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    if (!(await this.policy.handoff(user, orgId, 0))) {
      throw new PermissionDeniedException('无权创建 TRIZ 分析 Draft 候选')
    }
  }

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  /**
   * GET /api/v1/ai/compiler/runs/:runId/triz-analysis
   *
   * 列出某次 Compiler run 的 TRIZ 分析 artifact 列表。
   * 纯读端点，零 side-effect。
   */
  async index(ctx: HttpContext) {
    await this.guardRead(ctx)
    const orgId = this.orgIdOf(ctx)
    const runId = this.runIdFrom(ctx)
    const params = await ctx.request.validateUsing(trizAnalysisListValidator, {
      data: { runId },
    })

    const payloads = await this.artifactStore.queryByRunId(
      params.runId,
      orgId,
      'triz_analysis_artifact',
    )
    const artifacts = payloads.map(
      (p) => p as unknown as import('@aiproj/types').TrizAnalysisArtifact,
    )

    return ctx.response.ok({
      data: artifacts.map((a) => this.toSummaryDto(a)),
      meta: { total: artifacts.length, runId: params.runId },
    })
  }

  /**
   * GET /api/v1/ai/compiler/runs/:runId/triz-analysis/:artifactId
   *
   * 查看某个 TRIZ 分析 artifact 的完整详情。
   * 纯读端点，零 side-effect。
   */
  async show(ctx: HttpContext) {
    await this.guardRead(ctx)
    const orgId = this.orgIdOf(ctx)
    const runId = this.runIdFrom(ctx)
    const artifactId = this.artifactIdFrom(ctx)
    const params = await ctx.request.validateUsing(trizAnalysisDetailValidator, {
      data: { runId, artifactId },
    })

    const artifact = await this.findArtifact(params.runId, params.artifactId, orgId)
    if (!artifact) {
      throw new ResourceNotFoundException('TRIZ 分析结果未找到')
    }
    return ctx.response.ok({ data: artifact })
  }

  /**
   * POST /api/v1/ai/compiler/runs/:runId/triz-analysis/:artifactId/draft-handoff
   *
   * 从 TRIZ 分析解决路径创建 Draft Layer 候选。
   * 只创建 advisory 候选元数据，不写正式项目/任务/风险/依赖数据。
   *
   * 请求体：
   *   selectedPathId — 选中的解决路径 ID（必需）
   *   note — 可选的备注说明
   */
  async handoff(ctx: HttpContext) {
    await this.guardMutate(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const runId = this.runIdFrom(ctx)
    const artifactId = this.artifactIdFrom(ctx)
    const body = await ctx.request.validateUsing(trizDraftHandoffValidator)

    // 验证 artifact 存在（纯读）
    const artifact = await this.findArtifact(runId, artifactId, orgId)
    if (!artifact) {
      throw new ResourceNotFoundException('TRIZ 分析结果未找到，无法创建 Draft')
    }

    // 验证 selectedPathId 在 artifact 的 resolutionPaths 中
    const selectedPath = artifact.resolutionPaths.find((p) => p.pathId === body.selectedPathId)
    if (!selectedPath) {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'VALIDATION_ERROR',
          message: `解决路径「${body.selectedPathId}」不在当前分析结果中`,
        },
      })
    }

    // 验证路径是否可 handoff（source hash 校验 + path 校验含在 service 中）
    try {
      const result = await this.handoffService.createHandoff({
        compilerRunId: runId,
        artifactId,
        selectedPathId: body.selectedPathId,
        organizationId: orgId,
        projectId: 0,
        user,
        note: body.note ?? undefined,
      })

      // 审计
      await this.audit.log({
        event: AuditEvent.TRIZ_ANALYSIS_HANDOFF_CREATED,
        userId: user.id,
        organizationId: orgId,
        entityType: 'compiler_triz_analysis',
        entityId: null,
        projectId: null,
        metadata: {
          runId,
          artifactId,
          selectedPathId: body.selectedPathId,
          draftSessionRef: result.draftSessionRef,
        },
      })

      return ctx.response.created({
        data: {
          handoffStatus: result.handoffStatus,
          draftSessionRef: result.draftSessionRef,
          blockedReason: result.blockedReason,
        },
      })
    } catch (error) {
      if (error instanceof TrizHandoffBlockedError) {
        return ctx.response.unprocessableEntity({
          error: { code: 'VALIDATION_ERROR', message: error.message },
        })
      }
      if (error instanceof TrizHandoffNotFoundError) {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: error.message },
        })
      }
      throw error
    }
  }

  // ---------------------------------------------------------------------------
  // DTO
  // ---------------------------------------------------------------------------

  private toSummaryDto(artifact: import('@aiproj/types').TrizAnalysisArtifact) {
    return {
      artifactId: artifact.sourceHashes.contentHash.slice(0, 12),
      version: 1,
      status: artifact.status,
      mode: artifact.mode,
      warningCount: artifact.warnings.length,
      blockingWarningCount: artifact.warnings.filter((w) => w.severity === 'blocking').length,
      sourceContradictionCount: artifact.sourceContradictions.length,
      resolutionPathCount: artifact.resolutionPaths.length,
      handoffStatus: artifact.handoff.status,
      hasAiNarrative: artifact.aiNarrative !== null,
      requiresHumanReview: artifact.requiresHumanReview,
      createdAt: artifact.createdAt,
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * 从 ArtifactStore 查找单个 TRIZ 分析 artifact。
   * ArtifactStore.queryByRunId 返回 payload 数组，无 artifactId 索引，
   * 因此遍历匹配 contentHash 前缀。
   */
  private async findArtifact(
    runId: number,
    artifactId: string,
    organizationId: number,
  ): Promise<import('@aiproj/types').TrizAnalysisArtifact | null> {
    const payloads = await this.artifactStore.queryByRunId(
      runId,
      organizationId,
      'triz_analysis_artifact',
    )
    for (const payload of payloads) {
      const a = payload as unknown as import('@aiproj/types').TrizAnalysisArtifact
      if (a.sourceHashes.contentHash?.startsWith(artifactId)) {
        return a
      }
    }
    return null
  }
}
