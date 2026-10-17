import { ValidationException } from '#exceptions/api_exception'
import AuditService, { AuditEvent } from '#services/audit_service'
import type { DiagramSpec, DiagramMetadata } from '@aiproj/types'
import { inject } from '@adonisjs/core'
import type { AuthContext } from '#types/auth'

/**
 * AI DiagramSpec 人工确认守卫（Tasks 6.1-6.3）。
 *
 * 确保：
 * 1. AI 草案中的 DiagramSpec 保持草案来源 metadata
 * 2. 禁止绕过草案审查直接写入正式图表记录
 * 3. AI DiagramSpec 正式保存必须在人工确认与反幻觉/转换规则通过之后
 */
@inject()
export default class AiDiagramGuard {
  constructor(private audit: AuditService) {}

  /**
   * 检查 DiagramSpec 是否来自 AI 草案。
   * 如果是，必须携带 sourceDraftId 且不能直接写入正式图表记录。
   */
  assertNotDirectAiWrite(spec: DiagramSpec): void {
    if (spec.metadata.generatedBy === 'ai') {
      throw new ValidationException(
        'AI 生成的 DiagramSpec 不允许直接写入正式图表记录，必须通过人工确认流程',
        {
          details: {
            generatedBy: 'ai',
            sourceDraftId: spec.metadata.sourceDraftId,
          },
        },
      )
    }
  }

  /**
   * 在人工确认后，将 AI DiagramSpec 转换为正式图表记录时调用。
   * 验证 AI metadata 完整性并记录审计。
   */
  async confirmAndPersist(
    spec: DiagramSpec,
    projectId: number,
    organizationId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<DiagramSpec> {
    if (spec.metadata.generatedBy !== 'ai') {
      return spec
    }

    // 验证 AI metadata 完整性
    if (typeof spec.metadata.confidence !== 'number') {
      throw new ValidationException('AI DiagramSpec 缺少 confidence')
    }
    if (!Array.isArray(spec.metadata.assumptions)) {
      throw new ValidationException('AI DiagramSpec 缺少 assumptions')
    }
    if (!Array.isArray(spec.metadata.missingInputs)) {
      throw new ValidationException('AI DiagramSpec 缺少 missingInputs')
    }

    // 记录审计：AI DiagramSpec 经人工确认后正式保存
    await this.audit.log({
      event: AuditEvent.DIAGRAM_CREATED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'diagram',
      metadata: {
        source: 'ai_draft_confirmed',
        sourceDraftId: spec.metadata.sourceDraftId,
        confidence: spec.metadata.confidence,
        assumptionsCount: spec.metadata.assumptions.length,
        missingInputsCount: spec.metadata.missingInputs.length,
      },
      requestId: ctx.requestId ?? null,
    })

    return spec
  }

  /**
   * 为 AI 生成的 DiagramSpec 设置正确的草案 metadata。
   */
  setDraftMetadata(
    spec: DiagramSpec,
    sourceDraftId: string,
    sourceDraftVersion?: number,
  ): DiagramSpec {
    return {
      ...spec,
      metadata: {
        ...spec.metadata,
        generatedBy: 'ai',
        sourceDraftId,
        sourceDraftVersion,
      } as DiagramMetadata,
    }
  }
}
