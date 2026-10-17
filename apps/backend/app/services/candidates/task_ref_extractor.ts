/**
 * v2-5-code-repository-auto-linking —— 固定版本任务编号规范化提取器。
 *
 * 设计 D2:
 * - 使用固定版本规则，从 branch ref、commit message 和 PR title/body 的有限字段
 *   识别规范任务 key。
 * - 对同一事件去重并保留字段类型、脱敏片段/位置、规则版本。
 * - 匹配不到、匹配多个组织内任务或跨项目不可见时不猜测。
 */

import type { ReferenceEvidence, ExtractionResult, ReferenceSourceField } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 当前规则版本 */
export const EXTRACTOR_RULE_VERSION = 1

/**
 * 任务编号正则：<PROJECT_KEY>-<NUMBER>
 * - PROJECT_KEY: 2-10 个大写字母（不区分大小写，提取时规范化）
 * - NUMBER: 1-99999 的数字
 * - 前后为单词边界
 */
const TASK_REFERENCE_PATTERN = /\b([A-Za-z]{2,10})-(\d{1,5})\b/g

/** 证据片段最大长度（截断） */
const EVIDENCE_PREVIEW_MAX_LENGTH = 120

/** commit message 最大处理长度 */
const COMMIT_MESSAGE_MAX_LENGTH = 4096

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

/**
 * 规范化任务引用：大写项目 key + 数字。
 * 例：'proj-123' → 'PROJ-123', 'FEATURE-42' → 'FEATURE-42'
 */
export function normalizeReference(raw: string): string {
  const parts = raw.split('-')
  if (parts.length >= 2) {
    const numberPart = parts.slice(1).join('-')
    return `${parts[0].toUpperCase()}-${numberPart.toUpperCase()}`
  }
  return raw.toUpperCase()
}

/**
 * 从单个文本中提取所有规范任务引用，返回去重后的结果。
 */
export function extractReferences(
  text: string,
  sourceField: ReferenceSourceField,
): ExtractionResult {
  if (!text || typeof text !== 'string') {
    return { normalizedReference: '', evidences: [], uniqueReferenceCount: 0 }
  }

  // 限制输入长度
  const limitedText = text.slice(0, COMMIT_MESSAGE_MAX_LENGTH)
  const refs = new Map<string, ReferenceEvidence>()

  let match
  while ((match = TASK_REFERENCE_PATTERN.exec(limitedText)) !== null) {
    const normalized = normalizeReference(match[0])
    const matchStart = match.index
    const matchEnd = match.index + match[0].length

    // 截断证据片段
    const preview = limitedText
      .slice(Math.max(0, matchStart - 20), Math.min(limitedText.length, matchEnd + 20))
      .trim()

    // 只保留第一条匹配作为去重证据
    if (!refs.has(normalized)) {
      refs.set(normalized, {
        sourceField,
        matchedPreview: preview.slice(0, EVIDENCE_PREVIEW_MAX_LENGTH),
        matchStart,
        matchEnd,
        ruleVersion: EXTRACTOR_RULE_VERSION,
      })
    }
  }

  const evidences = Array.from(refs.values())
  const normalizedReference = evidences.length > 0 ? Array.from(refs.keys())[0] : ''

  return {
    normalizedReference,
    evidences,
    uniqueReferenceCount: evidences.length,
  }
}

/**
 * 从 branch ref 中提取任务引用。
 * 处理常见的 refs/heads/ 前缀和 feature/ 风格。
 */
export function extractFromBranchRef(branchRef: string): ExtractionResult {
  if (!branchRef) {
    return { normalizedReference: '', evidences: [], uniqueReferenceCount: 0 }
  }

  // 去掉 refs/heads/ 前缀
  const cleanRef = branchRef.replace(/^refs\/(heads|tags)\//, '')
  // 分割路径取最后一段
  const segments = cleanRef.split('/')
  const lastSegment = segments[segments.length - 1] || cleanRef

  return extractReferences(lastSegment, 'branchRef')
}

/**
 * 从 commit message 中提取任务引用。
 * 通常在第一行（subject）即可发现引用。
 */
export function extractFromCommitMessage(message: string): ExtractionResult {
  return extractReferences(message, 'commitMessagePreview')
}

/**
 * 从 PR 标题中提取任务引用。
 */
export function extractFromPullRequestTitle(title: string): ExtractionResult {
  return extractReferences(title, 'pullRequestTitle')
}

/**
 * 从 PR body 中提取任务引用。
 */
export function extractFromPullRequestBody(body: string): ExtractionResult {
  return extractReferences(body, 'pullRequestBodyPreview')
}

/**
 * 从事件中提取所有去重后的任务引用。
 * 按 field 优先级：branchRef > commitMessage > PR title > PR body
 * 返回合并的去重结果。
 */
export function extractFromEvent(fields: {
  branchRef?: string
  commitMessage?: string
  pullRequestTitle?: string
  pullRequestBody?: string
}): ExtractionResult[] {
  const results: ExtractionResult[] = []
  const seen = new Set<string>()

  const extractors: Array<{ text: string | undefined; extract: (t: string) => ExtractionResult }> =
    [
      { text: fields.branchRef, extract: extractFromBranchRef },
      { text: fields.commitMessage, extract: extractFromCommitMessage },
      { text: fields.pullRequestTitle, extract: extractFromPullRequestTitle },
      { text: fields.pullRequestBody, extract: extractFromPullRequestBody },
    ]

  for (const { text, extract } of extractors) {
    if (!text) continue
    const result = extract(text)
    if (result.normalizedReference && !seen.has(result.normalizedReference)) {
      seen.add(result.normalizedReference)
      results.push(result)
    }
  }

  return results
}

/**
 * 从 RepositoryReferenceEvent 字段中提取任务引用。
 * 返回按出现顺序去重的结果列表。
 */
export function extractFromReferenceEventFields(
  fields: Record<string, string | undefined>,
): ExtractionResult[] {
  return extractFromEvent({
    branchRef: fields.branchRef,
    commitMessage: fields.commitMessagePreview ?? fields.commitMessage,
    pullRequestTitle: fields.pullRequestTitle,
    pullRequestBody: fields.pullRequestBodyPreview ?? fields.pullRequestBody,
  })
}
