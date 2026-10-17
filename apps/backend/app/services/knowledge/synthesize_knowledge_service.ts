/**
 * v3-four-layer-knowledge-system —— SynthesizeKnowledgeService（D2/D4）。
 *
 * L3 合成治理——由 L1+L2 交叉验证生成合成案例，强制 isSynthetic=true，
 * 记录 baseKnowledge（sourceId+章节）、生成参数（model/temperature/seed）、
 * reviewedBy。合成不改写上游 L1/L2 源记录。
 *
 * 当前为 fixture-based 实现（无真实 AI 模型）。
 * 后续接入 AIGateway 后替换为真实 LLM 调用。
 *
 * @aiproj/backend
 */
import { inject } from '@adonisjs/core'
import AuditService, { AuditEvent } from '#services/audit_service'
import KnowledgeService from './knowledge_service.js'
import KnowledgeItem from '#models/knowledge_item'
import { LAYER_METADATA, type SynthesizeL3Request, type SourceRef } from '@aiproj/types'

@inject()
export default class SynthesizeKnowledgeService {
  constructor(
    private readonly audit: AuditService,
    private readonly knowledge: KnowledgeService,
  ) {}

  /**
   * 合成 L3 案例——由 L1+L2 交叉验证生成。
   *
   * 约束（D2/D4）：
   * - 强制 isSynthetic = true、syntheticMethod 非空
   * - 记录 baseKnowledge 引用、生成参数（model/temperature/seed）、reviewedBy
   * - 合成不改写上游 L1/L2 源记录（只读引用）
   * - 产物状态 = draft，需经人工确认
   *
   * @param organizationId 调用者组织 ID
   * @param actorId 调用者用户 ID
   * @param input 合成请求
   */
  async synthesize(
    organizationId: number,
    actorId: number,
    input: SynthesizeL3Request,
  ): Promise<KnowledgeItem> {
    // 验证 baseKnowledge 引用存在（只读，不改写）
    const baseSources: SourceRef[] = []
    for (const baseId of input.baseKnowledgeIds) {
      const baseItem = await this.knowledge.getById(organizationId, baseId)
      baseSources.push({
        layer: baseItem.layer,
        sourceId: `knowledge-${baseItem.id}`,
        title: baseItem.title,
        section: baseItem.domain,
      })
    }

    if (baseSources.length === 0) {
      throw new Error('L3 合成必须至少引用一条 baseKnowledge')
    }

    const syntheticMethod = `model=${input.model}, temperature=${input.temperature}, seed=${input.seed}`

    // fixture-based 合成（后续替换为 AIGateway 调用）
    const fixtureContent = {
      baseKnowledgeIds: input.baseKnowledgeIds,
      baseKnowledge: baseSources.map((s) => s.title),
      model: input.model,
      temperature: input.temperature,
      seed: input.seed,
      syntheticCase: `基于 ${baseSources.length} 条 L1/L2 知识合成`,
    }

    const item = new KnowledgeItem()
    item.organizationId = organizationId
    item.layer = 'L3'
    item.layerMeta = LAYER_METADATA['L3']
    item.title = `L3 合成案例：${input.domain} / ${input.purpose}`
    item.content = fixtureContent
    item.status = 'draft'
    item.domain = input.domain
    item.purpose = input.purpose
    item.complexity = null
    item.provenance = {
      sources: baseSources,
      reviewHistory: [],
    }
    item.reviewHistory = []
    item.isSynthetic = true
    item.syntheticMethod = syntheticMethod
    item.createdBy = actorId
    item.updatedBy = null
    item.lastReferencedAt = null
    item.retentionDays = null

    await item.save()

    await this.audit.log({
      event: AuditEvent.KNOWLEDGE_ITEM_SYNTHESIZED,
      organizationId,
      userId: actorId,
      metadata: {
        description: `合成 L3 案例: ${input.domain} / ${input.purpose}`,
        knowledgeItemId: item.id,
        baseKnowledgeIds: input.baseKnowledgeIds,
        model: input.model,
        temperature: input.temperature,
        seed: input.seed,
        reviewedBy: input.reviewedBy,
      },
    })

    return item
  }
}
