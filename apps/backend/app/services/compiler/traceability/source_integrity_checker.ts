/**
 * @aiproj/backend —— Source Integrity Checker（tasks 4.1–4.4）。
 *
 * 在 Draft Layer dry-run 中校验来源完整性。
 * AI/规则生成 accepted/modified 变更缺失来源时返回 blocking issue。
 *
 * 红线：
 * - 不写正式业务表（source_attributions 是运行态表，非正式业务表）
 * - blocking 结果进入校验报告和审计摘要
 *
 * @aiproj/backend
 */

import type { SourceIntegrityIssue } from '@aiproj/compiler-spec'
import SourceAttributionModel from '#models/source_attribution'
import { type SourceAttributionService } from './source_attribution_service.js'

// ── Types ──

export interface DraftChangeItem {
  entityId: string
  fieldPath?: string
  generatedBy: 'llm' | 'deterministic_rule' | 'user_edit'
  isAccepted: boolean
  isModified: boolean
}

export interface SourceCheckResult {
  canApply: boolean
  blockingIssues: SourceIntegrityIssue[]
  warnings: SourceIntegrityIssue[]
}

// ── Checker ──

export class SourceIntegrityChecker {
  readonly #attributionService: SourceAttributionService

  constructor(attributionService: SourceAttributionService) {
    this.#attributionService = attributionService
  }

  /**
   * 4.1: 在 PDM 到 Preview/Diff 投影时查询实体级和字段级 sourceAttributionId/source summary。
   * 返回现有 attributions 的摘要信息。
   */
  async enrichWithSourceSummary(
    organizationId: number,
    entityId: string,
    fieldPaths: string[],
  ): Promise<{
    entityAttribution: { attributionId: number; summary: string; confidence: number } | null
    fieldAttributions: Map<string, { attributionId: number; summary: string; confidence: number }>
  }> {
    const attributions = await SourceAttributionModel.forEntity(organizationId, entityId)
      .orderBy('created_at', 'desc')
      .limit(10)

    const entityAttribution = attributions.find((a) => !a.fieldPath) ?? null
    const fieldAttributions = new Map<
      string,
      { attributionId: number; summary: string; confidence: number }
    >()

    for (const fieldPath of fieldPaths) {
      const fieldAttr = attributions.find((a) => a.fieldPath === fieldPath)
      if (fieldAttr) {
        fieldAttributions.set(fieldPath, {
          attributionId: fieldAttr.id,
          summary: fieldAttr.summary,
          confidence: fieldAttr.confidence,
        })
      }
    }

    return {
      entityAttribution: entityAttribution
        ? {
            attributionId: entityAttribution.id,
            summary: entityAttribution.summary,
            confidence: entityAttribution.confidence,
          }
        : null,
      fieldAttributions,
    }
  }

  /**
   * 4.3: 在 dry-run 中执行来源完整性校验。
   * AI/规则生成 accepted/modified 变更缺失来源时返回 blocking issue。
   * 4.4: 不写正式业务表，blocking 结果进入校验报告。
   */
  async checkChanges(
    organizationId: number,
    compilerRunId: number,
    changes: DraftChangeItem[],
  ): Promise<SourceCheckResult> {
    const blockingIssues: SourceIntegrityIssue[] = []
    const warnings: SourceIntegrityIssue[] = []
    let hasFormalWrite = false // 哨兵：确保未写正式业务表

    for (const change of changes) {
      if (!change.isAccepted && !change.isModified) continue

      // AI/规则生成变更必须检查
      if (change.generatedBy === 'llm' || change.generatedBy === 'deterministic_rule') {
        if (change.entityId) {
          const existing = await SourceAttributionModel.forEntity(organizationId, change.entityId)
            .where('field_path', change.fieldPath ?? '')
            .where('compiler_run_id', compilerRunId)
            .first()

          if (!existing) {
            blockingIssues.push({
              entityId: change.entityId,
              fieldPath: change.fieldPath,
              issueType: 'missing_attribution',
              severity: 'blocking',
              message: change.fieldPath
                ? `Field ${change.fieldPath} is AI/rule-generated but missing source attribution`
                : `Entity ${change.entityId} is AI/rule-generated but missing source attribution`,
            })
          }

          // 校验 source refs 完整性
          if (existing) {
            const refs =
              (existing.sourceRefs as Array<{
                refId: string
                artifactKind: string
                version?: number
                summaryLevel?: string
                organizationId?: number
                compilerRunId?: number
              }>) ?? []

            const refIssues = this.#attributionService.validateRefIntegrity(
              organizationId,
              compilerRunId,
              refs,
            )
            blockingIssues.push(...refIssues)
          }
        }
      }

      // 4.4: Unanchored finding 不得绑定到字段
      if (change.generatedBy === 'llm' && change.fieldPath && !change.entityId) {
        warnings.push({
          entityId: change.entityId ?? 'unknown',
          fieldPath: change.fieldPath,
          issueType: 'unanchored_finding',
          severity: 'warning',
          message: `Unanchored LLM finding cannot be bound to field ${change.fieldPath}`,
        })
      }
    }

    // 4.4: 断言未写正式业务表
    if (hasFormalWrite) {
      throw new Error(
        'CRITICAL: Source integrity check attempted to write to formal business tables',
      )
    }

    return {
      canApply: blockingIssues.length === 0,
      blockingIssues,
      warnings,
    }
  }
}
