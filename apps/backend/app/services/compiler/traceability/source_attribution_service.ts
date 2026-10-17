/**
 * @aiproj/backend —— SourceAttributionService（tasks 3.1–3.4）。
 *
 * V2 Project Compiler 的来源归因服务。为 LLM 输出、确定性规则、
 * 用户编辑三种来源生成 SourceAttribution 并校验 ref 完整性与组织隔离。
 *
 * 红线：不存完整 artifact payload，只存摘要和 refs。
 *
 * @aiproj/backend
 */

import SourceAttribution from '#models/source_attribution'
import { createHash } from 'node:crypto'
import type { SourceIntegrityIssue } from '@aiproj/compiler-spec'

// ── Errors ──

export class SourceAttributionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourceAttributionError'
  }
}

export class RefIntegrityError extends SourceAttributionError {
  constructor(message: string) {
    super(message)
    this.name = 'RefIntegrityError'
  }
}

export class CrossOrganizationRefError extends SourceAttributionError {
  constructor(message: string) {
    super(message)
    this.name = 'CrossOrganizationRefError'
  }
}

// ── Types ──

export interface LlmOutputSource {
  contextPacketRef: string
  modelOutputRef: string
  stageId: string
  entityId?: string
  fieldPath?: string
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  confidence: number
  assumptions?: string[]
  summary: string
}

export interface DeterministicRuleSource {
  ruleId: string
  ruleName?: string
  validationEvidenceRef: string
  entityId?: string
  fieldPath?: string
  confidence?: number
  summary: string
}

export interface UserEditSource {
  draftSessionId: number
  entityId?: string
  fieldPath: string
  reviewedByUserId: number
  summary: string
}

// ── Service ──

export class SourceAttributionService {
  /**
   * 3.1: 从 LLM 输出创建来源归因。
   */
  async createForLlmOutput(
    organizationId: number,
    compilerRunId: number,
    source: LlmOutputSource,
  ): Promise<SourceAttribution> {
    this.#validateBasicRefs(source)

    const contentHash = this.#computeContentHash({
      compilerRunId,
      stageId: source.stageId,
      entityId: source.entityId,
      fieldPath: source.fieldPath,
      contextPacketRef: source.contextPacketRef,
      modelOutputRef: source.modelOutputRef,
      summary: source.summary,
    })

    const attribution = await SourceAttribution.create({
      organizationId,
      compilerRunId,
      stageId: source.stageId,
      entityId: source.entityId ?? null,
      fieldPath: source.fieldPath ?? null,
      sourceRefs: [
        {
          refId: source.contextPacketRef,
          artifactKind: 'context_packet',
          version: 1,
          summaryLevel: 'compact',
          label: 'Context Packet',
          organizationId,
          compilerRunId,
          stageId: source.stageId,
        },
        {
          refId: source.modelOutputRef,
          artifactKind: 'model_output',
          version: 1,
          summaryLevel: 'compact',
          label: 'Model Output',
          organizationId,
          compilerRunId,
          stageId: source.stageId,
        },
      ],
      generatedByKind: 'llm',
      generatedByProvider: source.provider ?? null,
      generatedByModel: source.model ?? null,
      tokenSummary:
        source.inputTokens !== undefined
          ? {
              inputTokens: source.inputTokens,
              outputTokens: source.outputTokens ?? 0,
              totalTokens: source.totalTokens ?? source.inputTokens + (source.outputTokens ?? 0),
            }
          : null,
      confidence: source.confidence,
      assumptions: source.assumptions ?? [],
      summary: source.summary,
      contentHash,
    })

    return attribution
  }

  /**
   * 3.2: 从确定性规则创建来源归因。
   * 禁止伪装为模型输出（generatedByKind 必须为 'deterministic_rule'）。
   */
  async createForDeterministicRule(
    organizationId: number,
    compilerRunId: number,
    source: DeterministicRuleSource,
  ): Promise<SourceAttribution> {
    const contentHash = this.#computeContentHash({
      compilerRunId,
      ruleId: source.ruleId,
      entityId: source.entityId,
      fieldPath: source.fieldPath,
      validationEvidenceRef: source.validationEvidenceRef,
      summary: source.summary,
    })

    const attribution = await SourceAttribution.create({
      organizationId,
      compilerRunId,
      stageId: 'deterministic',
      entityId: source.entityId ?? null,
      fieldPath: source.fieldPath ?? null,
      sourceRefs: [
        {
          refId: source.validationEvidenceRef,
          artifactKind: 'validation_feedback',
          version: 1,
          summaryLevel: 'compact',
          label: 'Validation Evidence',
          organizationId,
          compilerRunId,
        },
      ],
      generatedByKind: 'deterministic_rule',
      ruleId: source.ruleId,
      ruleName: source.ruleName ?? null,
      confidence: source.confidence ?? 1,
      summary: source.summary,
      contentHash,
    })

    return attribution
  }

  /**
   * 3.3: 在 Draft Review 用户编辑字段时生成或更新 fieldPath 来源状态。
   */
  async createForUserEdit(
    organizationId: number,
    compilerRunId: number,
    source: UserEditSource,
  ): Promise<SourceAttribution> {
    const contentHash = this.#computeContentHash({
      compilerRunId,
      draftSessionId: source.draftSessionId,
      entityId: source.entityId,
      fieldPath: source.fieldPath,
      reviewedByUserId: source.reviewedByUserId,
      summary: source.summary,
    })

    const attribution = await SourceAttribution.create({
      organizationId,
      compilerRunId,
      draftSessionId: source.draftSessionId,
      stageId: 'user_review',
      entityId: source.entityId ?? null,
      fieldPath: source.fieldPath,
      generatedByKind: 'user_edit',
      confidence: 1,
      summary: source.summary,
      contentHash,
      humanReviewStatus: 'reviewed_and_accepted',
      humanReviewedBy: source.reviewedByUserId,
    })

    return attribution
  }

  /**
   * 3.4: Ref 完整性校验。
   * 拒绝跨组织、未版本化、不可解析或 compilerRun 不一致的 source refs。
   */
  validateRefIntegrity(
    organizationId: number,
    compilerRunId: number,
    refs: Array<{
      refId: string
      artifactKind: string
      version?: number
      summaryLevel?: string
      organizationId?: number
      compilerRunId?: number
    }>,
  ): SourceIntegrityIssue[] {
    const issues: SourceIntegrityIssue[] = []

    for (const ref of refs) {
      // 跨组织拒绝
      // v3-multitenant-database-isolation §5.2：拒绝消息不得带任何组织 ID——
      // 原实现把 ref 的组织 id 与当前组织 id 都写进 message，等于告知调用方
      // 「这个 ref 属于组织 X」（他租归属泄露）。issue 会随 integrity 报告返回，
      // 因此只保留「该 ref 不可用」这一事实。
      if (ref.organizationId !== undefined && ref.organizationId !== organizationId) {
        issues.push({
          entityId: ref.refId,
          issueType: 'missing_source_ref',
          severity: 'blocking',
          message: 'Source ref rejected: not available in the current organization scope',
        })
      }

      // 未版本化
      if (ref.version === undefined || ref.version < 1) {
        issues.push({
          entityId: ref.refId,
          issueType: 'missing_source_ref',
          severity: 'blocking',
          message: `Unversioned ref rejected: ref ${ref.refId} must have version >= 1`,
        })
      }

      // 缺少 summaryLevel
      if (!ref.summaryLevel) {
        issues.push({
          entityId: ref.refId,
          issueType: 'missing_source_ref',
          severity: 'blocking',
          message: `Ref missing summaryLevel: ${ref.refId}`,
        })
      }

      // compilerRun 不一致
      if (ref.compilerRunId !== undefined && ref.compilerRunId !== compilerRunId) {
        issues.push({
          entityId: ref.refId,
          issueType: 'missing_source_ref',
          severity: 'blocking',
          message: `CompilerRun mismatch: ref compilerRunId=${ref.compilerRunId} does not match current=${compilerRunId}`,
        })
      }
    }

    return issues
  }

  /**
   * 查询指定 compiler run 下的 attributions。
   */
  async listByCompilerRun(
    organizationId: number,
    compilerRunId: number,
  ): Promise<SourceAttribution[]> {
    return SourceAttribution.forCompilerRun(organizationId, compilerRunId).orderBy(
      'created_at',
      'desc',
    )
  }

  /**
   * 查询单个 attribution。
   */
  async getById(organizationId: number, id: number): Promise<SourceAttribution | null> {
    return SourceAttribution.forOrganization(organizationId).where('id', id).first()
  }

  /**
   * 按实体查询 attributions。
   */
  async listByEntity(organizationId: number, entityId: string): Promise<SourceAttribution[]> {
    return SourceAttribution.forEntity(organizationId, entityId).orderBy('created_at', 'desc')
  }

  // ── Private ──

  #validateBasicRefs(source: LlmOutputSource): void {
    if (!source.contextPacketRef) {
      throw new RefIntegrityError('contextPacketRef is required for LLM output attribution')
    }
    if (!source.modelOutputRef) {
      throw new RefIntegrityError('modelOutputRef is required for LLM output attribution')
    }
  }

  #computeContentHash(data: Record<string, unknown>): string {
    const serialized = JSON.stringify(data, Object.keys(data).sort())
    return createHash('sha256').update(serialized).digest('hex')
  }
}
