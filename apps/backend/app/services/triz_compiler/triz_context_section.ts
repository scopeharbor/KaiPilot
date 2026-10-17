/**
 * v2-triz-compiler-analysis-layer —— TRIZ Context Section Builder（tasks 4.1, 4.5）。
 *
 * 为 hybrid TRIZ 分析 Stage 的 Context Packet 构建低敏 compact TRIZ section。
 * 只包含 refs、参数 key、原理 refs、source hashes、warning codes 和低敏摘要。
 * 不包含：完整证据正文、完整 AI 解释、敏感路径、无权限实体、完整 PDM、完整历史输出。
 */
import type { ContextSection } from '@aiproj/compiler-spec'
import { estimateTokens } from '@aiproj/compiler-spec'
import type {
  TrizAnalysisSourceRef,
  ParameterTensionSummary,
  PrincipleCandidate,
} from '@aiproj/types'

export interface TrizContextSectionInput {
  /** 来源矛盾低敏 refs */
  sourceRefs: TrizAnalysisSourceRef[]
  /** 参数张力摘要 */
  tensions: ParameterTensionSummary[]
  /** 候选原理 */
  principles: PrincipleCandidate[]
  /** Warning codes（只包含 code，不包含完整 message） */
  warningCodes: string[]
  /** 是否因 draft 矛盾发出 NEEDS_HUMAN_REVIEW */
  hasDraftContradictions: boolean
  /** 是否有 stale 矛盾 */
  hasStaleContradictions: boolean
}

/**
 * 构建低敏 TRIZ Context Section。
 * 设计上与 ContextCompilerService 的 section 构建器同构。
 *
 * 内容只包含：
 * - 矛盾数量与状态概览（不包含具体证据）
 * - 参数 key 与中文名
 * - 原理 refs（仅 id + 名称）
 * - Source hashes（稳定性检测）
 * - Warning codes（不含 evidence/message 详情）
 * - 低敏摘要
 */
export function buildTrizCompactContextSection(input: TrizContextSectionInput): ContextSection {
  const {
    sourceRefs,
    tensions,
    principles,
    warningCodes,
    hasDraftContradictions,
    hasStaleContradictions,
  } = input

  // 只保留低敏摘要：不包含完整 evidence、AI 解释、敏感路径或全量 PDM
  const contradictionSummary = sourceRefs.map((r) => ({
    key: r.key,
    title: r.title,
    type: r.type,
    status: r.status,
    severity: r.severity,
    confidence: r.confidence,
    stale: r.stale,
    improvingKey: r.improvingParameterKey,
    worseningKey: r.worseningParameterKey,
    parameterKey: r.parameterKey,
    principles: r.suggestedPrinciples.length,
  }))

  // 参数张力只保留 key 和摘要
  const tensionSummary = tensions.map((t) => ({
    improvingKey: t.improvingKey,
    worseningKey: t.worseningKey,
    physicalSummary: t.physicalSummary,
  }))

  // 原理只保留 id 和名称
  const principleSummary = principles.map((p) => ({
    principleId: p.principleId,
    name: p.name,
    relevance: p.relevance,
  }))

  const content = {
    type: 'triz_analysis_compact',
    totalContradictions: sourceRefs.length,
    hasDraftContradictions,
    hasStaleContradictions,
    warnings: warningCodes,
    contradictions: contradictionSummary,
    tensions: tensionSummary,
    principles: principleSummary,
  }

  const estimatedTokens = estimateTokens(content)

  return {
    name: 'trizAnalysis',
    priority: 'P1',
    summaryLevel: 'compact',
    requestedTokens: estimatedTokens,
    includedTokens: 0,
    content,
    sourceRefs: sourceRefs.map((r) => `contradiction:${r.key}:${r.inputSignature}`),
  }
}

/**
 * 验证 Context Section 不包含敏感数据。
 * 用于测试 4.5：assert 不包含 full evidence、full AI explanations、sensitive paths 等。
 */
export function validateTrizSectionLowSensitivity(section: ContextSection): {
  passed: boolean
  issues: string[]
} {
  const issues: string[] = []
  const content = section.content as Record<string, unknown>

  if (!content) {
    return { passed: false, issues: ['section content is null'] }
  }

  // 检查是否包含完整 evidence
  const contradictions = content.contradictions as any[] | undefined
  if (contradictions) {
    for (const c of contradictions) {
      if (c.evidence !== undefined) {
        issues.push('contradiction contains full evidence body')
      }
      if (c.aiExplanation !== undefined) {
        issues.push('contradiction contains full AI explanation')
      }
    }
  }

  // 检查是否包含完整文件路径
  if (content.fullFilePaths !== undefined) {
    issues.push('section contains full file paths')
  }

  // 检查是否包含完整 PDM
  if (content.fullPdm !== undefined) {
    issues.push('section contains full PDM')
  }

  // 检查是否包含完整历史输邮
  if (content.fullHistoricalOutputs !== undefined) {
    issues.push('section contains full historical outputs')
  }

  // 检查是否包含无权限实体
  if (content.unauthorizedEntities !== undefined) {
    issues.push('section contains unauthorized entities')
  }

  // 检查篇幅：不应超过 token 预算的合理阈值
  const estimated = estimateTokens(content)
  if (estimated > 5000) {
    issues.push(`section estimated tokens (${estimated}) exceeds compact threshold (5000)`)
  }

  return { passed: issues.length === 0, issues }
}
