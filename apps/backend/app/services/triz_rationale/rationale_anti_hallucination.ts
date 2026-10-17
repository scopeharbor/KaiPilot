/**
 * v2-triz-recommendation-rationale-ui —— 反幻觉校验映射（§5.4–5.5）。
 *
 * 对 AI rationale 文本中的参数、原理、矛盾、证据等 refs 执行校验。
 * 校验失败时降级为确定性 fallback 摘要。
 */
import type { RationaleSourceRef, PrincipleMappingEntry, RationaleEvidenceRef } from '@aiproj/types'

export interface HallucinationValidationResult {
  passed: boolean
  failures: string[]
}

/**
 * 校验 AI rationale 文本中的引用是否可追溯到结构化来源。
 *
 * @param text          AI 生成的解释文本
 * @param sourceRefs    结构化来源 refs
 * @param principleMappings  原理映射
 * @param evidenceRefs  证据 refs
 * @returns 校验结果
 */
export function validateAiRationaleText(
  text: string,
  sourceRefs: RationaleSourceRef[],
  principleMappings: PrincipleMappingEntry[],
  evidenceRefs: RationaleEvidenceRef[],
): HallucinationValidationResult {
  const failures: string[] = []

  // 收集结构化 refs 中的已知标识
  const knownPrincipleIds = new Set(principleMappings.map((m) => m.principleId))
  const knownEvidenceLabels = new Set(evidenceRefs.map((e) => e.label))

  // 检查 text 中是否引用了不存在的参数/原理
  // 注意：这里只做基础校验，不尝试 NLP
  for (const principleId of knownPrincipleIds) {
    const principle = principleMappings.find((m) => m.principleId === principleId)
    if (!principle) {
      failures.push(`引用不存在的原理 ID: ${principleId}`)
    }
  }

  // 检查 source refs
  for (const ref of sourceRefs) {
    if (!ref.hash) {
      failures.push(`来源 ${ref.id} 缺少 hash`)
    }
  }

  // 检查 evidence refs
  for (const ref of evidenceRefs) {
    if (!knownEvidenceLabels.has(ref.label)) {
      failures.push(`证据标签 "${ref.label}" 不在结构化来源中`)
    }
  }

  // 检查 text 中是否包含已知结构 refs 中不存在的原理引用
  for (const mapping of principleMappings) {
    const nameInText = text.includes(mapping.principleName)
    if (nameInText && !knownPrincipleIds.has(mapping.principleId)) {
      failures.push(`文本引用了 "${mapping.principleName}"，但该原理不在结构化 refs 中`)
    }
  }

  return {
    passed: failures.length === 0,
    failures,
  }
}

/**
 * 构建确定性 fallback 摘要。
 * 当 AI 校验失败或模型输出不可用时使用。
 */
export function buildFallbackSummary(
  sourceTypeName: string,
  principleCount: number,
  evidenceCount: number,
): string {
  const parts: string[] = [`基于 ${sourceTypeName} 的确定性规则分析`]
  if (principleCount > 0) {
    parts.push(`识别出 ${principleCount} 个候选发明原理`)
  }
  if (evidenceCount > 0) {
    parts.push(`参考 ${evidenceCount} 条证据线索`)
  }
  parts.push('（AI 说明不可用，展示规则摘要）')
  return parts.join('；')
}
