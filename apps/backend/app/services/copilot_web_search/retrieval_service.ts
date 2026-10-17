/**
 * v3-copilot-web-search-tool §6 — 外部检索服务（主编排器）。
 *
 * 职责：
 * - 搜索、抓取、摘要三步编排
 * - provider 为可替换适配器，默认实现为 fixture
 * - 授权门短路（在发出请求之前）
 * - 域名策略准入
 * - 配额守卫
 * - 部分失败降级（不使整轮失败）
 * - 抓取结果不建索引、不进生产知识层
 * - 检索决策落账
 *
 * 设计约束：
 * - D1：授权门短路点在"发出请求之前"
 * - D4：单次抓取超时或失败不使整轮失败
 * - D6：抓取结果不建索引、不进生产知识层
 */

import type {
  RetrievalRequest,
  RetrievalResultEntry,
  RetrievalResultSet,
  RetrievalDecisionRecord,
  RetrievalSearchProvider,
  RetrievalFetchProvider,
  RetrievalSummaryProvider,
  RetrievalRejectionReason,
  DomainPolicy,
  RetrievalQuotaPolicy,
  RetrievalAuthorizationState,
} from '@aiproj/types'
import { RETRIEVAL_REJECTION_REASONS } from '@aiproj/types'
import { RetrievalAuthorizationGate } from './authorization_gate.js'
import { DomainPolicyService } from './domain_policy_service.js'
import { RetrievalBudgetGuard } from './retrieval_budget_guard.js'
import {
  buildRetrievalDecisionRecord,
  type RetrievalDecisionRecorder,
  InMemoryRetrievalDecisionRecorder,
} from './retrieval_ledger_recorder.js'
import {
  FixtureSearchProvider,
  FixtureFetchProvider,
  FixtureSummaryProvider,
} from './fixture_provider.js'

// ---------------------------------------------------------------------------
// 检索服务配置
// ---------------------------------------------------------------------------

/** 检索服务配置。 */
export interface RetrievalServiceConfig {
  /** 默认抓取超时（毫秒） */
  defaultFetchTimeoutMs?: number
  /** 默认最大结果数 */
  defaultMaxResults?: number
}

// ---------------------------------------------------------------------------
// 检索服务输入/输出
// ---------------------------------------------------------------------------

/** 检索服务输入。 */
export interface RetrievalServiceInput {
  /** 检索请求 */
  request: RetrievalRequest
  /** 组织级授权状态 */
  authorizationState: RetrievalAuthorizationState
  /** 组织级域名策略 */
  domainPolicy: DomainPolicy
  /** 组织级配额策略 */
  quotaPolicy: RetrievalQuotaPolicy
  /** 当前窗口已用次数 */
  currentQuotaCount: number
  /** 窗口开始时间 */
  windowStart: Date
  /** 窗口结束时间 */
  windowEnd: Date
}

/** 检索服务输出。 */
export interface RetrievalServiceOutput {
  /** 结果集 */
  resultSet: RetrievalResultSet
  /** 决策记录 */
  decisionRecord: Omit<RetrievalDecisionRecord, 'id'> | RetrievalDecisionRecord
}

// ---------------------------------------------------------------------------
// 检索服务
// ---------------------------------------------------------------------------

/**
 * 外部检索服务（主编排器）。
 *
 * 编排搜索、抓取、摘要三步，集成授权门、域名策略、配额守卫。
 * 默认使用 fixture provider，不发起任何真实 HTTP 请求。
 */
export class RetrievalService {
  readonly #authGate: RetrievalAuthorizationGate
  readonly #domainPolicyService: DomainPolicyService
  readonly #budgetGuard: RetrievalBudgetGuard
  readonly #searchProvider: RetrievalSearchProvider
  readonly #fetchProvider: RetrievalFetchProvider
  readonly #summaryProvider: RetrievalSummaryProvider
  readonly #recorder: RetrievalDecisionRecorder
  readonly #config: RetrievalServiceConfig

  constructor(options: {
    searchProvider?: RetrievalSearchProvider
    fetchProvider?: RetrievalFetchProvider
    summaryProvider?: RetrievalSummaryProvider
    recorder?: RetrievalDecisionRecorder
    config?: RetrievalServiceConfig
  }) {
    this.#authGate = new RetrievalAuthorizationGate()
    this.#domainPolicyService = new DomainPolicyService()
    this.#budgetGuard = new RetrievalBudgetGuard()
    this.#searchProvider = options.searchProvider ?? new FixtureSearchProvider()
    this.#fetchProvider = options.fetchProvider ?? new FixtureFetchProvider()
    this.#summaryProvider = options.summaryProvider ?? new FixtureSummaryProvider()
    this.#recorder = options.recorder ?? new InMemoryRetrievalDecisionRecorder()
    this.#config = options.config ?? {}
  }

  /**
   * 执行外部检索。
   *
   * 完整流程：
   * 1. 授权门检查（短路点在发出请求之前）
   * 2. 配额检查
   * 3. 搜索（获取候选 URL）
   * 4. 域名策略过滤
   * 5. 抓取（带超时和部分失败降级）
   * 6. 摘要（可选）
   * 7. 落账
   */
  async retrieve(input: RetrievalServiceInput): Promise<RetrievalServiceOutput> {
    const startTime = Date.now()
    const { request } = input

    // 1. 授权门检查（D1：短路点在发出请求之前）
    const authResult = this.#authGate.check(
      { organizationId: request.organizationId, userId: request.userId, turnId: request.turnId },
      input.authorizationState,
    )

    if (!authResult.authorized) {
      // 授权门短路：落账并返回空结果
      const decisionRecord = this.#authGate.makeGatedDecision(
        { organizationId: request.organizationId, userId: request.userId, turnId: request.turnId },
        request.queryCategory,
      )
      await this.#recorder.record(decisionRecord)

      return {
        resultSet: {
          entries: [],
          isComplete: false,
          rejectedDomainCount: 0,
          queryCategory: request.queryCategory,
          elapsedMs: Date.now() - startTime,
        },
        decisionRecord,
      }
    }

    // 2. 配额检查（D3：单独计量）
    const budgetResult = this.#budgetGuard.check(
      {
        organizationId: request.organizationId,
        currentCount: input.currentQuotaCount,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
      },
      input.quotaPolicy,
    )

    if (!budgetResult.allowed) {
      // 超额：明确拒绝（D4：不降级为少抓几个）
      const decisionRecord = buildRetrievalDecisionRecord({
        organizationId: request.organizationId,
        userId: request.userId,
        turnId: request.turnId,
        queryCategory: request.queryCategory,
        matchedDomains: [],
        rejectedDomainCount: 0,
        rejectionReasonCounts: this.makeRejectionCounts('quota_exhausted'),
        elapsedMs: Date.now() - startTime,
        resultCount: 0,
        isComplete: false,
      })
      await this.#recorder.record(decisionRecord)

      return {
        resultSet: {
          entries: [],
          isComplete: false,
          rejectedDomainCount: 0,
          queryCategory: request.queryCategory,
          elapsedMs: Date.now() - startTime,
        },
        decisionRecord,
      }
    }

    // 3. 搜索（获取候选 URL）
    const searchResults = await this.#searchProvider.search(
      request.query,
      request.maxResults ?? this.#config.defaultMaxResults ?? 10,
    )

    // 4. 域名策略过滤
    const matchedDomains: string[] = []
    const rejectedDomains: string[] = []
    const entries: RetrievalResultEntry[] = []
    const rejectionCounts = this.makeRejectionCounts()

    for (const result of searchResults) {
      const domain = this.extractDomain(result.url)
      const policyResult = this.#domainPolicyService.check(
        { domain, organizationId: request.organizationId },
        input.domainPolicy,
      )

      if (!policyResult.allowed) {
        rejectedDomains.push(domain)
        if (policyResult.rejectionReason) {
          rejectionCounts[policyResult.rejectionReason]++
        }
        continue
      }

      matchedDomains.push(domain)

      // 5. 抓取（带超时和部分失败降级）
      const fetchResult = await this.#fetchProvider.fetch(
        result.url,
        this.#config.defaultFetchTimeoutMs ?? 15_000,
      )

      if (!fetchResult.success) {
        // 部分失败：返回已获得的部分并标注缺失（D4）
        entries.push({
          url: result.url,
          title: result.title,
          snippet: '',
          fetchedAt: new Date().toISOString(),
          snapshotHash: '',
          source: 'external',
          isComplete: false,
          failureReason: fetchResult.failureReason,
        })
        if (fetchResult.failureReason) {
          rejectionCounts[fetchResult.failureReason]++
        }
        continue
      }

      // 6. 摘要（可选）
      let snippet = result.snippet
      if (fetchResult.body) {
        snippet = await this.#summaryProvider.summarize(fetchResult.body, request.query)
      }

      entries.push({
        url: result.url,
        title: result.title,
        snippet,
        fetchedAt: new Date().toISOString(),
        snapshotHash: this.computeSnapshotHash(fetchResult.body ?? ''),
        source: 'external',
        isComplete: true,
      })
    }

    // 判定结果集是否完整
    const isComplete = entries.every((e) => e.isComplete)

    // 7. 落账（D5：搜索词类别化，不落原文）
    const decisionRecord = buildRetrievalDecisionRecord({
      organizationId: request.organizationId,
      userId: request.userId,
      turnId: request.turnId,
      queryCategory: request.queryCategory,
      matchedDomains,
      rejectedDomainCount: rejectedDomains.length,
      rejectionReasonCounts: rejectionCounts,
      elapsedMs: Date.now() - startTime,
      resultCount: entries.length,
      isComplete,
    })
    await this.#recorder.record(decisionRecord)

    return {
      resultSet: {
        entries,
        isComplete,
        rejectedDomainCount: rejectedDomains.length,
        queryCategory: request.queryCategory,
        elapsedMs: Date.now() - startTime,
      },
      decisionRecord,
    }
  }

  /**
   * 从 URL 提取域名。
   */
  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  }

  /**
   * 计算快照 hash（确定性摘要，不存正文本身）。
   */
  private computeSnapshotHash(body: string): string {
    // 简单的确定性 hash（生产环境应使用 crypto.createHash）
    let hash = 0
    for (let i = 0; i < body.length; i++) {
      const char = body.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash |= 0 // 转为 32 位整数
    }
    return `snap_${Math.abs(hash).toString(16)}`
  }

  /**
   * 构造空的拒绝原因计数。
   */
  private makeRejectionCounts(
    primaryReason?: RetrievalRejectionReason,
  ): Record<RetrievalRejectionReason, number> {
    const counts = {} as Record<RetrievalRejectionReason, number>
    for (const r of RETRIEVAL_REJECTION_REASONS) {
      counts[r] = r === primaryReason ? 1 : 0
    }
    return counts
  }
}
