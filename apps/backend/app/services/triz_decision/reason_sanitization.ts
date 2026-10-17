/**
 * v2-triz-decision-log-traceability —— 理由脱敏/摘要工具（tasks 2.7, 7.1）。
 *
 * 对决策理由进行脱敏、截断、hash 一致性管理。
 * 复用 @aiproj/types 的 sanitizeReasonText / computeTrizDecisionHash 函数，
 * 在此 Service 层提供额外边界守卫与 fallback 摘要生成。
 */
import {
  sanitizeReasonText as libSanitizeReasonText,
  computeTrizDecisionHash,
  type TrizDecisionSubjectRef,
  type TrizDecisionSourceRef,
} from '@aiproj/types'

/** 理由摘要的最大字符数（含脱敏后） */
const MAX_REASON_LENGTH = 2000

/** 自动 fallback 摘要的最大字符数 */
const MAX_FALLBACK_SUMMARY_LENGTH = 200

/**
 * 脱敏并截断理由文本。
 * 先做脱敏替换，再截断至上限，末尾附加截断标记。
 */
export function sanitizeReasonText(text: string, maxLength: number = MAX_REASON_LENGTH): string {
  let sanitized = libSanitizeReasonText(text)

  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength - 20) + '…[已截断]'
  }

  return sanitized
}

/**
 * 从结构化 refs 生成确定性 fallback 摘要。
 * 用于 AI draft 降级或用户未提供理由时的兜底文案。
 */
export function generateFallbackSummary(
  decisionType: string,
  subjectRefs: TrizDecisionSubjectRef[],
  sourceRefs: TrizDecisionSourceRef[],
): string {
  const typeLabel = decisionTypeLabels[decisionType] ?? decisionType
  const subjectKinds = [...new Set(subjectRefs.map((r) => r.kind))]
  const subjectLabels = subjectKinds.map((k) => subjectKindLabels[k] ?? k).join('、')
  const sourceCount = sourceRefs.length

  let summary = `${typeLabel}：涉及 ${subjectLabels}`

  if (sourceCount > 0) {
    summary += `，依据 ${sourceCount} 个来源`
  }

  if (summary.length > MAX_FALLBACK_SUMMARY_LENGTH) {
    summary = summary.slice(0, MAX_FALLBACK_SUMMARY_LENGTH - 3) + '…'
  }

  return summary
}

/**
 * 从决策类型/refs 计算稳定 hash。
 * 委托给 @aiproj/types 的 computeTrizDecisionHash。
 */
export function computeReasonHash(
  subjectRefs: TrizDecisionSubjectRef[],
  sourceRefs: TrizDecisionSourceRef[],
  reasonSummary: string,
): string {
  return computeTrizDecisionHash(subjectRefs, sourceRefs, reasonSummary)
}

// ── Helpers ──

const decisionTypeLabels: Record<string, string> = {
  adopt: '采纳',
  reject: '驳回',
  partial_accept: '部分采纳',
  modified_accept: '修改后采纳',
  clarification_requested: '请求补充说明',
  supersede: '废止旧决策',
}

const subjectKindLabels: Record<string, string> = {
  contradiction: 'TRIZ 矛盾',
  analysis_artifact: '分析结果',
  resolution_path: '解决路径',
  draft_item: 'Draft 变更项',
  source_attribution: '来源归属',
  traceability_link: '可追溯链路',
  formal_entity: '正式实体',
}
