/**
 * v3-copilot-live-submission-channel —— 搜索建议 → 提及候选的纯函数映射（任务 6.2）。
 *
 * 数据源是**既有** `GET /api/v1/search/suggestions`（12 类 adapter，权限与组织
 * 过滤已在 `search_service` 内完成）。本模块只做形状映射，**不做二次过滤放宽**，
 * 也不新建索引（spec REQ）。
 *
 * 确定性：同输入同输出，排序稳定，不依赖时钟与随机源。
 */

import type { CompletionMentionCandidate, MentionableEntityType } from '@aiproj/types'
import { MAX_CANDIDATE_LABEL_LENGTH, isMentionableEntityType } from '@aiproj/types'
import type { SearchSuggestion } from '@/lib/api/search'

/**
 * 映射单条建议。
 *
 * 返回 null 表示该候选**缺席**——用于三种情形：
 * - 实体类型不属于可提及集合（如 activity）；
 * - 缺少构成引用的必需字段（entityId / title）；
 * - 标签为空白。
 *
 * 缺席而非渲染空标签是 spec 明确要求（避免出现无法点选的空条目）。
 */
export function toMentionCandidate(
  suggestion: SearchSuggestion,
): CompletionMentionCandidate | null {
  if (!isMentionableEntityType(suggestion.entityType)) return null

  const entityId = Number(suggestion.entityId)
  if (!Number.isFinite(entityId) || entityId <= 0) return null

  const label = typeof suggestion.title === 'string' ? suggestion.title.trim() : ''
  if (label.length === 0) return null

  const entityType = suggestion.entityType as MentionableEntityType
  const projectId =
    typeof suggestion.projectId === 'number' && Number.isFinite(suggestion.projectId)
      ? suggestion.projectId
      : undefined

  return {
    kind: 'mention',
    entityType,
    entityId,
    label: label.slice(0, MAX_CANDIDATE_LABEL_LENGTH),
    summary: suggestion.summary ?? undefined,
    projectId,
    sortKey: {
      // 本期不做个性化：相关性一律 medium，由后端返回顺序承担相关性
      relevanceTier: 'medium',
      impactSeverity: 0,
      // 稳定破平局：类型 + ID，确定性且与展示标签无关
      stableTieBreak: `${entityType}:${entityId}`,
    },
  }
}

/**
 * 批量映射并保持后端返回顺序。
 *
 * 不做 recency 权重与使用历史排序（确定性优先）；缺席候选直接剔除，
 * 不留占位，也不因剔除而改变其余候选的相对顺序。
 */
export function toMentionCandidates(
  suggestions: readonly SearchSuggestion[],
  maxCandidates: number,
): readonly CompletionMentionCandidate[] {
  const result: CompletionMentionCandidate[] = []
  for (const suggestion of suggestions) {
    if (result.length >= maxCandidates) break
    const candidate = toMentionCandidate(suggestion)
    if (candidate) result.push(candidate)
  }
  return result
}

/**
 * 候选 → 结构化引用。
 *
 * `organizationId` 由调用方从当前会话上下文提供——**不从候选推导**，
 * 因为服务端会独立复核组织归属，客户端声明只是双轨表达的一半。
 */
export function toMentionReference(candidate: CompletionMentionCandidate, organizationId: number) {
  return {
    entityType: candidate.entityType,
    entityId: candidate.entityId,
    label: candidate.label,
    organizationId,
    projectId: candidate.projectId,
  }
}
