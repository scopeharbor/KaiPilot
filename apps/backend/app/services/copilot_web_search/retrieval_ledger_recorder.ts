/**
 * v3-copilot-web-search-tool §7 — 检索决策落账。
 *
 * 设计纪律 D5：落账记录搜索词的类别而非原文。
 * 搜索词可能含项目机密（"甲方 XX 项目 违约金"）。
 * 落账只记类别（如 technical / regulatory / vendor），原文不落库。
 * 备选是 hash 后落库，被否：hash 对短查询可被字典攻击还原。
 *
 * 禁存边界：落账不含搜索词原文、网页正文、prompt、模型输出、token 与 secret。
 *
 * 职责：
 * - 检索决策落账，字段按低敏形状
 * - 搜索词类别化：只落类别，不落原文，也不落 hash
 * - 被拒域名与失败原因的分类计数
 * - 检索耗时与命中率的低敏计数
 */

import type {
  RetrievalDecisionRecord,
  RetrievalRejectionReason,
  RetrievalQueryCategory,
} from '@aiproj/types'
import { RETRIEVAL_REJECTION_REASONS } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 决策记录持久化接口
// ---------------------------------------------------------------------------

/** 决策记录持久化接口（由 service 层注入）。 */
export interface RetrievalDecisionRecorder {
  record(decision: Omit<RetrievalDecisionRecord, 'id'>): Promise<void>
}

// ---------------------------------------------------------------------------
// 内存级实现（测试用）
// ---------------------------------------------------------------------------

/** 内存级决策记录器（测试/开发用）。 */
export class InMemoryRetrievalDecisionRecorder implements RetrievalDecisionRecorder {
  readonly records: RetrievalDecisionRecord[] = []
  private nextId = 1

  async record(decision: Omit<RetrievalDecisionRecord, 'id'>): Promise<void> {
    this.records.push({
      ...decision,
      id: `ret_${String(this.nextId++).padStart(4, '0')}`,
    })
  }

  /** 清空记录。 */
  clear(): void {
    this.records.length = 0
    this.nextId = 1
  }
}

// ---------------------------------------------------------------------------
// 决策记录构造辅助
// ---------------------------------------------------------------------------

/**
 * 构造空的拒绝原因计数。
 */
function emptyRejectionCounts(): Record<RetrievalRejectionReason, number> {
  const counts = {} as Record<RetrievalRejectionReason, number>
  for (const r of RETRIEVAL_REJECTION_REASONS) {
    counts[r] = 0
  }
  return counts
}

/**
 * 从判定结果构造决策记录（低敏形状）。
 *
 * @param params 判定参数
 * @returns 决策记录（不含 id，由 recorder 分配）
 */
export function buildRetrievalDecisionRecord(params: {
  organizationId: number
  userId: number
  turnId: string
  queryCategory: RetrievalQueryCategory
  matchedDomains: string[]
  rejectedDomainCount: number
  rejectionReasonCounts?: Record<RetrievalRejectionReason, number>
  elapsedMs: number
  resultCount: number
  isComplete: boolean
}): Omit<RetrievalDecisionRecord, 'id'> {
  return {
    organizationId: params.organizationId,
    userId: params.userId,
    turnId: params.turnId,
    queryCategory: params.queryCategory,
    matchedDomains: [...new Set(params.matchedDomains)], // 去重
    rejectedDomainCount: params.rejectedDomainCount,
    rejectionReasonCounts: params.rejectionReasonCounts ?? emptyRejectionCounts(),
    elapsedMs: params.elapsedMs,
    resultCount: params.resultCount,
    isComplete: params.isComplete,
    createdAt: new Date().toISOString(),
  }
}
