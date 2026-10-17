/**
 * v3-four-layer-knowledge-system —— AiStructureKnowledgeService（D4）。
 *
 * AI 对原文产出结构化候选知识记录——仅返回 draft/pending 待审草案，
 * MUST NOT 自动转权威（置信度不豁免人工确认）。
 *
 * 当前为 fixture-based 实现（无真实 AI 模型），返回确定性候选草案。
 * 后续接入 AIGateway 后替换为真实 LLM 调用。
 *
 * @aiproj/backend
 */
import { inject } from '@adonisjs/core'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  LAYER_METADATA,
  type AiStructureKnowledgeRequest,
  type AiStructureKnowledgeResult,
  type KnowledgeLifecycleStatus,
  type SourceRef,
} from '@aiproj/types'

@inject()
export default class AiStructureKnowledgeService {
  constructor(private readonly audit: AuditService) {}

  /**
   * 对原始文本进行 AI 结构化——返回 draft 候选草案。
   *
   * 设计约束（D4）：
   * - 返回的 candidates 状态固定为 draft
   * - confidence 仅供展示，不写入生产
   * - MUST NOT 自动落库或转 active
   *
   * @param organizationId 调用者组织 ID
   * @param actorId 调用者用户 ID
   * @param input 结构化请求
   */
  async structure(
    organizationId: number,
    actorId: number,
    input: AiStructureKnowledgeRequest,
  ): Promise<AiStructureKnowledgeResult> {
    // fixture-based 确定性结构化（后续替换为 AIGateway 调用）
    const candidates = this.buildFixtures(input.rawText, input.targetLayer)

    await this.audit.log({
      event: AuditEvent.KNOWLEDGE_ITEM_CREATED,
      organizationId,
      userId: actorId,
      metadata: {
        description: `AI 结构化 ${input.targetLayer} 候选草案`,
        targetLayer: input.targetLayer,
        candidatesCount: candidates.length,
        rawTextLength: input.rawText.length,
      },
    })

    return {
      candidates,
      confidence: 0.75,
      advisoryNotes:
        '以下为 AI 生成的候选草案，仅供参考。所有草案状态为 draft，需经人工审查与确认方可转为正式知识记录。',
    }
  }

  /**
   * fixture-based 确定性候选草案生成。
   * 后续接入 AIGateway 时替换此方法。
   */
  private buildFixtures(
    rawText: string,
    targetLayer: 'L1' | 'L2',
  ): AiStructureKnowledgeResult['candidates'] {
    const now = new Date().toISOString()
    const truncated = rawText.slice(0, 100)

    const baseSource: SourceRef = {
      layer: targetLayer,
      sourceId: `ai-structure-${Date.now()}`,
      title: 'AI 结构化输入',
      retrievedAt: now,
    }

    return [
      {
        organizationId: 0, // 由调用方填充
        layer: targetLayer,
        layerMeta: LAYER_METADATA[targetLayer],
        title: `${targetLayer} 结构化草案：${truncated}`,
        content: { raw: rawText, structured: true },
        status: 'draft' as KnowledgeLifecycleStatus,
        domain: '待分类',
        purpose: '待分类',
        complexity: null as unknown as undefined,
        provenance: {
          sources: [baseSource],
          reviewHistory: [],
        },
        isSynthetic: false,
        syntheticMethod: undefined,
        createdBy: 0,
        updatedBy: null as unknown as undefined,
        lastReferencedAt: null as unknown as undefined,
        retentionDays: null as unknown as undefined,
      },
    ]
  }
}
