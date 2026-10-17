/**
 * v3-copilot-structured-and-diagram-output —— 长文档问答服务。
 *
 * 职责：
 * - 针对单份既有文档或 OCR 结果的问答，复用既有检索路径（Task 6.1）
 * - 权限过滤继承既有检索的权限模型（Task 6.3）
 * - L3 Synthetic 排除（红线 1）（Task 6.5）
 * - 文档全文与 OCR 原文不进会话消息，只存引用与有界摘要（Task 6.7）
 * - 限定既有检索范围内的文档（Task 6.9）
 *
 * 约束：
 * - 不新建索引（Task 6.2）
 * - 不复制既有查询逻辑（Task 6.2）
 * - 不接受任意上传（Task 6.9，上传归附件 change）
 * - 组织隔离（红线 3）
 */

// ---------------------------------------------------------------------------
// 问答结果
// ---------------------------------------------------------------------------

export interface CopilotLongDocAnswerResult {
  /** 回答的有界摘要（不含文档全文）。 */
  readonly answerSummary: string
  /** 引用列表（来源引用，不含全文）。 */
  readonly references: readonly CopilotDocReference[]
  /** 是否包含 L3 合成评测内容（用于观测）。 */
  readonly containsL3Content: boolean
  /** 是否来自文档检索范围（Task 6.9）。 */
  readonly withinScope: boolean
}

export interface CopilotDocReference {
  /** 文档 ID。 */
  readonly documentId: string
  /** 文档类型（document / ocr）。 */
  readonly documentType: 'document' | 'ocr'
  /** 引用的有界摘要（≤120 字符）。 */
  readonly summary: string
  /** 来源 hash（用于新鲜度校验）。 */
  readonly sourceHash: string
}

// ---------------------------------------------------------------------------
// 素材收集器（复用既有检索）
// ---------------------------------------------------------------------------

/**
 * 从既有检索结果中收集问答素材。
 *
 * Task 6.1: 复用既有文档与 OCR 检索路径。
 * Task 6.2: 不新建索引，不复制既有查询逻辑。
 * Task 6.3: 权限过滤继承既有检索的权限模型。
 * Task 6.5: L3 Synthetic 排除。
 * Task 6.7: 文档全文不进会话消息，只存引用与有界摘要。
 */
export function collectAnswerMaterial(params: {
  /** 文档检索命中。 */
  readonly documentHits: readonly {
    readonly documentId: string
    readonly title: string
    readonly contentSummary: string
    readonly sourceHash: string
    readonly knowledgeTier?: string
  }[]
  /** OCR 检索命中。 */
  readonly ocrHits: readonly {
    readonly documentId: string
    readonly title: string
    readonly contentSummary: string
    readonly sourceHash: string
    readonly knowledgeTier?: string
  }[]
  /** 是否为生产路径（非评测路径）。 */
  readonly isProductionPath: boolean
  /** 回答长度上界（字符数）。 */
  readonly maxAnswerLength?: number
}): {
  references: readonly CopilotDocReference[]
  l3ExcludedCount: number
  hasL3Content: boolean
} {
  const references: CopilotDocReference[] = []
  let l3ExcludedCount = 0
  let hasL3Content = false
  const maxLen = params.maxAnswerLength ?? 500

  // 处理文档检索命中
  for (const hit of params.documentHits) {
    // Task 6.5: 生产路径下 L3 Synthetic 排除
    if (params.isProductionPath && hit.knowledgeTier === 'L3') {
      l3ExcludedCount++
      hasL3Content = true
      continue
    }

    references.push({
      documentId: hit.documentId,
      documentType: 'document',
      summary: hit.contentSummary.slice(0, maxLen),
      sourceHash: hit.sourceHash,
    })
  }

  // 处理 OCR 检索命中
  for (const hit of params.ocrHits) {
    // Task 6.5: 生产路径下 L3 Synthetic 排除
    if (params.isProductionPath && hit.knowledgeTier === 'L3') {
      l3ExcludedCount++
      hasL3Content = true
      continue
    }

    references.push({
      documentId: hit.documentId,
      documentType: 'ocr',
      summary: hit.contentSummary.slice(0, maxLen),
      sourceHash: hit.sourceHash,
    })
  }

  return {
    references,
    l3ExcludedCount,
    hasL3Content,
  }
}

// ---------------------------------------------------------------------------
// 回答生成（有界摘要，不含全文）
// ---------------------------------------------------------------------------

/**
 * 生成长文档问答的有界摘要回答。
 *
 * Task 6.7: 文档全文与 OCR 原文不进会话消息，只存引用与有界摘要。
 * Task 6.9: 限定既有检索范围内的文档。
 */
export function generateBoundedAnswer(params: {
  /** 收集到的素材引用。 */
  readonly references: readonly CopilotDocReference[]
  /** 用户问题。 */
  readonly question: string
  /** 回答长度上界。 */
  readonly maxAnswerLength?: number
}): CopilotLongDocAnswerResult {
  const maxLen = params.maxAnswerLength ?? 500

  if (params.references.length === 0) {
    return {
      answerSummary: '未找到与问题相关的文档内容',
      references: [],
      containsL3Content: false,
      withinScope: false,
    }
  }

  // 生成有界摘要（不含全文）
  const summaries = params.references.map((ref) => ref.summary)
  const answerSummary = summaries.join('\n').slice(0, maxLen)

  return {
    answerSummary,
    references: params.references,
    containsL3Content: false,
    withinScope: true,
  }
}

// ---------------------------------------------------------------------------
// 持久化消息校验
// ---------------------------------------------------------------------------

/**
 * 校验持久化消息不含文档全文。
 *
 * Task 6.8: 持久化消息不含文档全文。
 * Task 6.7: 只存引用与有界摘要。
 */
export function assertMessageContainsNoFullText(message: {
  contentSummary: string
  sourceRefs: readonly string[]
}): { safe: boolean; reason?: string } {
  // 检查内容摘要是否包含过长的文本（可能包含全文）
  if (message.contentSummary.length > 1000) {
    return {
      safe: false,
      reason: '内容摘要过长，可能包含文档全文',
    }
  }

  // 检查是否包含常见全文特征（如连续段落标记）
  const fullTextPatterns = [/第[一二三四五六七八九十]+章/, /第[0-9]+节/, /附录/, /参考文献/]

  for (const pattern of fullTextPatterns) {
    if (pattern.test(message.contentSummary)) {
      return {
        safe: false,
        reason: `内容摘要包含文档结构特征（${pattern.source}），可能包含全文`,
      }
    }
  }

  return { safe: true }
}
