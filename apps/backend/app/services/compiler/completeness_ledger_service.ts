/**
 * CompletenessLedgerService —— 从 Manifest 初始化的生成状态单一事实来源。
 *
 * 核心语义：
 * - 从 Manifest 的每个实体创建 Ledger Entry
 * - 状态机流转守卫（拒绝非法跳转）
 * - Attempt 记录、重试计数、failed_retryable / needs_human_review 转换
 * - Completeness 聚合（overall、blocking items、warnings、状态计数）
 * - Resume 队列分类（跳过已完成、验证已有 artifact、恢复崩溃残留的 generating）
 *
 * @aiproj/backend compiler
 */

import type {
  AttemptRecord,
  BlockingItem,
  CompletenessLedger,
  CompletenessSummary,
  GenerationManifest,
  LedgerEntry,
  LedgerEntryStatus,
  ResumeQueue,
  ValidationResult,
} from '@aiproj/compiler-spec'

/**
 * 允许的状态机转移映射。
 * key = "from→to" 字符串。
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending: ['ready'],
  ready: ['generating'],
  generating: ['generated', 'failed_retryable', 'needs_human_review'],
  generated: ['validating'],
  validating: ['validated', 'failed_retryable'],
  validated: ['committed_to_pdm', 'failed_retryable'],
  committed_to_pdm: [],
  failed_retryable: ['ready', 'needs_human_review', 'generating'],
  needs_human_review: ['ready'],
  skipped_by_user: [],
}

export class TransitionError extends Error {
  constructor(entityId: string, from: string, to: string) {
    super(`Illegal state transition for entity ${entityId}: ${from} → ${to}`)
    this.name = 'TransitionError'
  }
}

export interface LedgerServiceOptions {
  /** 默认最大重试次数。 */
  defaultMaxRetries?: number
}

const DEFAULT_OPTIONS: Required<LedgerServiceOptions> = {
  defaultMaxRetries: 3,
}

/**
 * CompletenessLedgerService —— 增强型 Ledger 管理器。
 */
export class CompletenessLedgerService {
  #ledger: CompletenessLedger
  readonly #options: Required<LedgerServiceOptions>

  constructor(options?: LedgerServiceOptions) {
    this.#options = { ...DEFAULT_OPTIONS, ...options }
    // Ledger will be set via initialize()
    this.#ledger = this.#createEmptyLedger(0, 1)
  }

  // ── Initialization (3.1) ──

  /**
   * 从 Manifest 初始化 Ledger。
   * 为 Manifest 中每个实体创建初始 pending 状态的 Entry。
   */
  initialize(manifest: GenerationManifest, runId: number): void {
    const now = new Date().toISOString()
    const entries: LedgerEntry[] = manifest.entities.map((entity) => ({
      entityId: entity.entityId,
      entityType: entity.entityType,
      label: entity.label,
      status: 'pending',
      currentAttempt: 0,
      maxRetries: entity.maxRetries ?? this.#options.defaultMaxRetries,
      attempts: [],
      validationResults: [],
      blockingItemIds: [],
      outputRef: entity.outputRef,
      responsibleStageId: entity.stageId,
      createdAt: now,
      updatedAt: now,
    }))

    // 标记依赖满足的为 ready
    for (const entry of entries) {
      const entity = manifest.entities.find((e) => e.entityId === entry.entityId)
      if (entity && (!entity.dependencies || entity.dependencies.length === 0)) {
        entry.status = 'ready'
      }
    }

    this.#ledger = {
      meta: {
        schemaVersion: '2.0',
        runId,
        manifestVersion: manifest.meta.manifestVersion,
        initializedAt: now,
        updatedAt: now,
      },
      entries,
      summary: this.#computeSummary(entries),
    }
  }

  // ── State Transition Guard (3.2) ──

  /**
   * 校验状态转移是否合法。
   * 拒绝非法跳转并抛出 TransitionError。
   */
  transitionTo(entityId: string, newStatus: LedgerEntryStatus): void {
    const entry = this.#getEntry(entityId)
    const allowed = ALLOWED_TRANSITIONS[entry.status]

    if (!allowed || !allowed.includes(newStatus)) {
      throw new TransitionError(entityId, entry.status, newStatus)
    }

    entry.status = newStatus
    entry.updatedAt = new Date().toISOString()

    // 进入 needs_human_review 时记录错误摘要
    if (newStatus === 'needs_human_review' && entry.attempts.length > 0) {
      const lastAttempt = entry.attempts[entry.attempts.length - 1]
      if (lastAttempt?.errorSummary) {
        entry.blockingItemIds.push(`block_${entityId}_${entry.attempts.length}`)
      }
    }

    this.#ledger.meta.updatedAt = new Date().toISOString()
    this.#ledger.summary = this.#computeSummary(this.#ledger.entries)
  }

  /**
   * 批量状态转移。
   */
  transitionBatch(updates: Array<{ entityId: string; status: LedgerEntryStatus }>): void {
    for (const update of updates) {
      this.transitionTo(update.entityId, update.status)
    }
  }

  // ── Attempt Recording (3.3) ──

  /**
   * 记录一次 attempt。
   * 如果失败未达上限 → failed_retryable；达上限 → needs_human_review。
   */
  recordAttempt(
    entityId: string,
    attempt: Omit<AttemptRecord, 'attemptNumber'>,
  ): { newStatus: LedgerEntryStatus; attemptNumber: number } {
    const entry = this.#getEntry(entityId)
    const attemptNumber = entry.currentAttempt + 1

    entry.attempts.push({
      ...attempt,
      attemptNumber,
    })
    entry.currentAttempt = attemptNumber
    entry.updatedAt = new Date().toISOString()

    this.#ledger.meta.updatedAt = new Date().toISOString()
    return { newStatus: entry.status, attemptNumber }
  }

  /**
   * 标记失败并判断是否进入人工复核。
   * @returns 新的状态
   */
  markFailed(entityId: string, errorSummary: string): LedgerEntryStatus {
    const entry = this.#getEntry(entityId)

    // 记录 attempt
    this.recordAttempt(entityId, {
      startedAt: new Date(Date.now() - 1000).toISOString(),
      endedAt: new Date().toISOString(),
      status: 'failed',
      errorSummary,
      tokenUsed: 0,
    })

    if (entry.currentAttempt >= entry.maxRetries) {
      this.transitionTo(entityId, 'needs_human_review')
    } else {
      this.transitionTo(entityId, 'failed_retryable')
    }

    return entry.status
  }

  /**
   * 标记成功进入 PDM。
   */
  markCommitted(entityId: string, outputRef: string): void {
    const entry = this.#getEntry(entityId)
    entry.outputRef = outputRef
    this.transitionTo(entityId, 'committed_to_pdm')
  }

  // ── Validation Recording (3.2) ──

  /**
   * 记录验证结果。
   */
  recordValidation(entityId: string, validation: ValidationResult): void {
    const entry = this.#getEntry(entityId)
    entry.validationResults.push(validation)
    entry.updatedAt = new Date().toISOString()
    this.#ledger.meta.updatedAt = new Date().toISOString()
  }

  // ── Completeness Aggregation (3.4) ──

  /**
   * 计算整体完整度。
   * 输出整体 complete %、blocking items、warnings、各状态计数。
   */
  getSummary(): CompletenessSummary {
    return { ...this.#ledger.summary }
  }

  /**
   * 计算 blocking items 列表。
   */
  getBlockingItems(): BlockingItem[] {
    return [...this.#ledger.summary.blockingItems]
  }

  /**
   * 获取是否存在 blocking items 阻止自动完成。
   */
  hasBlockingItems(): boolean {
    return this.#ledger.summary.blockingItems.length > 0
  }

  // ── Resume Queue Classification (3.5) ──

  /**
   * Resume 队列分类。
   * 基于 Ledger 当前状态决定哪些实体可跳过、需验证、需重试、需人工审查。
   */
  classifyResumeQueue(): ResumeQueue {
    const resumeQueue: ResumeQueue = {
      skipped: [],
      needsValidation: [],
      needsRetry: [],
      needsHumanReview: [],
    }

    for (const entry of this.#ledger.entries) {
      switch (entry.status) {
        case 'committed_to_pdm':
          resumeQueue.skipped.push(entry.entityId)
          break

        case 'generated':
        case 'validating':
          // 有输出但未完成验证 → 继续验证
          resumeQueue.needsValidation.push(entry.entityId)
          break

        case 'failed_retryable':
          // 可以重试
          resumeQueue.needsRetry.push(entry.entityId)
          break

        case 'generating':
          // 崩溃残留 → 转为重试
          resumeQueue.needsRetry.push(entry.entityId)
          break

        case 'needs_human_review':
          resumeQueue.needsHumanReview.push(entry.entityId)
          break

        default:
          // pending/ready/skipped_by_user — 不特殊处理
          break
      }
    }

    return resumeQueue
  }

  /**
   * 获取所有 needs_human_review 的实体。
   * 用于 Task 7.1 阻止运行进入可应用状态。
   */
  getNeedsHumanReviewEntities(): LedgerEntry[] {
    return this.#ledger.entries.filter((e) => e.status === 'needs_human_review')
  }

  /**
   * 检查是否有必须人工复核的阻塞项。
   */
  hasNeedsHumanReviewBlocking(): boolean {
    return this.#ledger.entries.some((e) => e.status === 'needs_human_review')
  }

  // ── Query ──

  /** 获取完整 Ledger。 */
  get(): CompletenessLedger {
    return this.#ledger
  }

  /** 获取指定实体 Entry。 */
  getEntry(entityId: string): LedgerEntry | undefined {
    return this.#ledger.entries.find((e) => e.entityId === entityId)
  }

  /** 按状态筛选 Entry。 */
  getEntriesByStatus(status: LedgerEntryStatus): LedgerEntry[] {
    return this.#ledger.entries.filter((e) => e.status === status)
  }

  /** 获取 entry 数量。 */
  get entryCount(): number {
    return this.#ledger.entries.length
  }

  /** 获取已完成（committed_to_pdm）数量。 */
  get completedCount(): number {
    return this.#ledger.entries.filter((e) => e.status === 'committed_to_pdm').length
  }

  /** 检查所有实体是否完成。 */
  get isComplete(): boolean {
    return this.#ledger.entries.every(
      (e) => e.status === 'committed_to_pdm' || e.status === 'skipped_by_user',
    )
  }

  // ── Private Helpers ──

  #getEntry(entityId: string): LedgerEntry {
    const entry = this.#ledger.entries.find((e) => e.entityId === entityId)
    if (!entry) {
      throw new Error(`Ledger entry not found: ${entityId}`)
    }
    return entry
  }

  /** 计算完整度聚合摘要。 */
  #computeSummary(entries: LedgerEntry[]): CompletenessSummary {
    const total = entries.length
    const statusCounts: Record<string, number> = {}
    const blockingItems: BlockingItem[] = []
    const warnings: string[] = []

    for (const entry of entries) {
      statusCounts[entry.status] = (statusCounts[entry.status] ?? 0) + 1

      // 收集阻塞项
      if (entry.status === 'needs_human_review' || entry.status === 'failed_retryable') {
        for (const bid of entry.blockingItemIds) {
          const lastAttempt = entry.attempts[entry.attempts.length - 1]
          blockingItems.push({
            itemId: bid,
            entityId: entry.entityId,
            reason: lastAttempt?.errorSummary ?? `${entry.entityId} 未完成`,
            category:
              entry.status === 'needs_human_review'
                ? 'human_review_required'
                : 'validation_failure',
            createdAt: entry.updatedAt,
          })
        }
      }
    }

    const completed = statusCounts.committed_to_pdm ?? 0
    const overallCompleteness = total > 0 ? Math.round((completed / total) * 100) / 100 : 0

    // 生成 warnings
    const failedCount = statusCounts.failed_retryable ?? 0
    const reviewCount = statusCounts.needs_human_review ?? 0
    if (failedCount > 0) warnings.push(`${failedCount} 个实体待重试`)
    if (reviewCount > 0) warnings.push(`${reviewCount} 个实体需人工复核`)

    return {
      overallCompleteness,
      totalEntries: total,
      statusCounts,
      blockingItems,
      warnings,
      needsHumanReviewCount: reviewCount,
      failedRetryableCount: failedCount,
    }
  }

  /** 创建空 Ledger。 */
  #createEmptyLedger(runId: number, manifestVersion: number): CompletenessLedger {
    const now = new Date().toISOString()
    return {
      meta: {
        schemaVersion: '2.0',
        runId,
        manifestVersion,
        initializedAt: now,
        updatedAt: now,
      },
      entries: [],
      summary: {
        overallCompleteness: 0,
        totalEntries: 0,
        statusCounts: {},
        blockingItems: [],
        warnings: [],
        needsHumanReviewCount: 0,
        failedRetryableCount: 0,
      },
    }
  }
}
