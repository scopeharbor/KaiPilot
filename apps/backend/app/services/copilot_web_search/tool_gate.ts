/**
 * v3-copilot-optional-web-search-configuration §D — Copilot 网页搜索工具门。
 *
 * 顺序（design D）：
 *   组织启用？ → 场景允许？ → 权限？ → 按次同意？ → router 必要性？
 *   → 配额？ → 调用既有 RetrievalService（fixture，零真实网络）
 *   → 域名策略 → 外部内容安全 → 产出 externalEvidence（typed no-call/degraded/called）
 *
 * 不可变约束：
 * - 默认关闭：无设置 = disabled；五门缺一不调用 provider
 * - 双门授权：组织 policy ∧ 按次 consent；router 仍可拒绝
 * - internal/external 分区：evidence 带 title/url/accessedAt/provider/contentHash，
 *   不得冒充项目事实
 * - 禁存：审计只落低敏形状（无 key、无搜索词原文、无正文、无 prompt、无输出）
 * - 真实 provider conditional：本门只允许 fixture provider；真实 adapter 须另立
 *   child change 且获得用户明确授权
 */

import type {
  CopilotWebSearchGateResult,
  CopilotWebSearchAuditShape,
  CopilotWebSearchSettings,
  RetrievalQueryCategory,
  RetrievalResultEntry,
  DomainPolicy,
  RetrievalQuotaPolicy,
  RetrievalAuthorizationState,
  ExternalEvidence,
} from '@aiproj/types'
import {
  COPILOT_WEB_SEARCH_GATE_LABELS,
  EXTERNAL_EVIDENCE_MAX_EXCERPT,
  copilotWebSearchNeedsExternal,
} from '@aiproj/types'
import { type RetrievalService } from './retrieval_service.js'
import type CopilotWebSearchSettingsService from './settings_service.js'
import {
  CopilotExternalContentInjectionDetector,
  redactInjectedSentences,
} from '#services/copilot/copilot_external_content_injection_detector'
import AuditService, { AuditEvent } from '#services/audit_service'
import type { ExternalContentEntry } from '@aiproj/types'
import logger from '@adonisjs/core/services/logger'

/** 使用面：通用 Copilot 或 AI 快速创建。 */
export type CopilotWebSearchSurface = 'copilot' | 'ai_create'

/** 工具门输入。 */
export interface CopilotWebSearchGateInput {
  organizationId: number
  actorId: number
  turnId: string
  /** 用户输入（仅用于构造检索请求与 router 必要性判断，不落库）。 */
  query: string
  /** 本次按次同意（缺省 false）。 */
  consent: boolean
  surface: CopilotWebSearchSurface
  /** 权限标签（回合入口已校验 ai:trigger；此处再校验防口径漂移）。 */
  permissions: readonly string[]
}

/** 工具门依赖（可注入以便测试）。 */
export interface CopilotWebSearchToolGateDeps {
  settings: CopilotWebSearchSettingsService
  retrieval: RetrievalService
  audit?: AuditService
  injectionDetector?: CopilotExternalContentInjectionDetector
}

const DAY_MS = 86_400_000
/** 句级剔除后剩余摘要的最短长度（太短已无引用价值）。 */
const MIN_REDACTED_SNIPPET_LENGTH = 12

/** 低敏用途摘要：类别 + 长度，绝不带原文。 */
export function deriveQueryPurpose(query: string, category: RetrievalQueryCategory): string {
  return `查询[${query.length}字/${category}]`
}

/** 确定性类别派生（落账用，不落原文）。 */
export function classifyRetrievalQueryCategory(query: string): RetrievalQueryCategory {
  if (/法规|申报|消防|条例|政策|规定|标准/.test(query)) return 'regulatory'
  if (/供应商|报价|行情|市场|价格|票价/.test(query)) return 'vendor'
  if (/技术|接口|api|文档|服务|sdk/.test(query)) return 'technical'
  return 'general'
}

export class CopilotWebSearchToolGate {
  readonly #settings: CopilotWebSearchSettingsService
  readonly #retrieval: RetrievalService
  readonly #audit: AuditService
  readonly #injectionDetector: CopilotExternalContentInjectionDetector

  constructor(deps: CopilotWebSearchToolGateDeps) {
    this.#settings = deps.settings
    this.#retrieval = deps.retrieval
    this.#audit = deps.audit ?? new AuditService()
    this.#injectionDetector =
      deps.injectionDetector ?? new CopilotExternalContentInjectionDetector()
  }

  /**
   * 门判定主流程。永不抛（provider 意外也不得打断普通 Copilot），
   * 结果一律为 typed no-call / degraded / called。
   */
  async fetchEvidence(input: CopilotWebSearchGateInput): Promise<CopilotWebSearchGateResult> {
    const start = Date.now()

    // 1. 启用（双层同意：超级管理员在平台开启；团队 / 企业组织还要组织管理员开启）
    let settings: CopilotWebSearchSettings
    try {
      settings = await this.#settings.getEffectiveSettings(input.organizationId)
    } catch {
      settings = {
        organizationId: input.organizationId,
        enabled: false,
        providerConnectionId: null,
        allowedDomains: [],
        deniedDomains: [],
        dailyQueryLimit: 0,
        maxResultsPerQuery: 0,
        timeoutMs: 0,
        cacheTtlMinutes: 0,
        retainDecisionDays: 0,
        requirePerTurnConsent: true,
        allowForAiCreate: false,
        allowForGeneralCopilot: false,
      }
    }

    if (!settings.enabled) {
      await this.#auditDenied(input, 'web_search_disabled', Date.now() - start)
      return this.#noCall('web_search_disabled')
    }

    // 2. 场景允许
    const scenarioAllowed =
      input.surface === 'copilot' ? settings.allowForGeneralCopilot : settings.allowForAiCreate
    if (!scenarioAllowed) {
      await this.#auditDenied(input, 'web_search_disabled', Date.now() - start)
      return this.#noCall('web_search_disabled')
    }

    // 3. 权限（防口径漂移：回合入口 ai:trigger 之外再验）
    if (!input.permissions.includes('ai:trigger')) {
      await this.#auditDenied(input, 'web_search_permission_denied', Date.now() - start)
      return this.#noCall('web_search_permission_denied')
    }

    // 4. 按次同意
    if (!input.consent) {
      await this.#auditDenied(input, 'web_search_consent_required', Date.now() - start)
      return this.#noCall('web_search_consent_required')
    }

    // 5. router 必要性
    if (!copilotWebSearchNeedsExternal(input.query)) {
      // 纯路由决定，不落审计（内部问题不需要外部资料不是策略拒绝）
      return this.#noCall('web_search_not_needed')
    }

    // 6. 配额
    const quotaState = await this.#settings.readQuota(input.organizationId)
    const quotaCheck = this.#settings.quotaAllowed(quotaState, settings.dailyQueryLimit)
    if (!quotaCheck.allowed) {
      await this.#auditDegraded(
        input,
        'web_search_quota_exceeded',
        Date.now() - start,
        0,
        'blocked',
      )
      return {
        status: 'degraded',
        code: 'web_search_quota_exceeded',
        message: COPILOT_WEB_SEARCH_GATE_LABELS.web_search_quota_exceeded,
        evidence: [],
      }
    }

    // 7. 调用既有 RetrievalService（fixture；consume 在调用前计数）
    const output = await this.#runRetrieval(input, settings, quotaState)
    const resultSet = output.resultSet

    // 8. 结果映射：只保留通过域名策略 + 完整抓取 + 安全检查的条目
    //    （决策记录 id 可能缺失时回退派生，仅作引用；禁存不依赖它）
    const decisionRecordInfo = output.decisionRecord as
      | {
          id?: string
          queryCategory: RetrievalQueryCategory
          rejectionReasonCounts: Record<string, number>
        }
      | undefined
    const decisionRecordId =
      output.decisionRecord && 'id' in output.decisionRecord
        ? output.decisionRecord.id
        : `ret_${input.turnId}`
    const rejectionReasonCounts = decisionRecordInfo?.rejectionReasonCounts ?? {}
    const queryCategory =
      decisionRecordInfo?.queryCategory ?? classifyRetrievalQueryCategory(input.query)
    const evidence: ExternalEvidence[] = []
    let injectionDropped = 0
    for (const entry of resultSet.entries) {
      if (!entry.isComplete || entry.failureReason) continue
      const safe = this.#injectionDetector.detectEntry(
        this.#toDetectionEntry(entry, input.organizationId),
        input.organizationId,
      )
      if (safe.verdict === 'passed') {
        evidence.push(this.#toEvidence(entry, settings, decisionRecordId))
        continue
      }
      // 规则命中：只剔除命中的句子，剩余部分再次整体检测通过才使用（命中原句永不进上下文）
      const redacted = safe.verdict === 'rejected' ? redactInjectedSentences(entry.snippet) : ''
      const redactedEntry = { ...entry, snippet: redacted }
      if (
        redacted.length >= MIN_REDACTED_SNIPPET_LENGTH &&
        this.#injectionDetector.detectEntry(
          this.#toDetectionEntry(redactedEntry, input.organizationId),
          input.organizationId,
        ).verdict === 'passed'
      ) {
        evidence.push(this.#toEvidence(redactedEntry, settings, decisionRecordId))
        continue
      }
      injectionDropped++
    }

    const elapsed = Date.now() - start
    const domainDecision =
      resultSet.rejectedDomainCount > 0
        ? resultSet.entries.length > 0
          ? 'mixed'
          : 'blocked'
        : 'allowed'

    // 9. 零证据降级判定（外部失败不得中断普通 Copilot）
    if (evidence.length === 0) {
      if (injectionDropped > 0) {
        await this.#auditDegraded(input, 'web_search_content_unsafe', elapsed, 0, domainDecision)
        return {
          status: 'degraded',
          code: 'web_search_content_unsafe',
          message: COPILOT_WEB_SEARCH_GATE_LABELS.web_search_content_unsafe,
          evidence: [],
        }
      }
      if (resultSet.rejectedDomainCount > 0) {
        await this.#auditDegraded(input, 'web_search_domain_blocked', elapsed, 0, 'blocked')
        return {
          status: 'degraded',
          code: 'web_search_domain_blocked',
          message: COPILOT_WEB_SEARCH_GATE_LABELS.web_search_domain_blocked,
          evidence: [],
        }
      }
      const hasFetchIssue =
        rejectionReasonCounts.fetch_timeout > 0 || rejectionReasonCounts.fetch_failed > 0
      if (hasFetchIssue) {
        await this.#auditDegraded(input, 'web_search_timeout', elapsed, 0, domainDecision)
        return {
          status: 'degraded',
          code: 'web_search_timeout',
          message: COPILOT_WEB_SEARCH_GATE_LABELS.web_search_timeout,
          evidence: [],
        }
      }
      // 搜索一条结果都没有：如实说「没找到」，不能说成「未通过安全检查」
      if (resultSet.entries.length === 0) {
        await this.#auditDegraded(input, 'web_search_no_results', elapsed, 0, domainDecision)
        return {
          status: 'degraded',
          code: 'web_search_no_results',
          message: COPILOT_WEB_SEARCH_GATE_LABELS.web_search_no_results,
          evidence: [],
        }
      }
      // 仅剩 malformed（空标题/无摘要等）
      await this.#auditDegraded(input, 'web_search_content_unsafe', elapsed, 0, domainDecision)
      return {
        status: 'degraded',
        code: 'web_search_content_unsafe',
        message: COPILOT_WEB_SEARCH_GATE_LABELS.web_search_content_unsafe,
        evidence: [],
      }
    }

    // 10. 正常/部分成功：外部 citation 只来自通过项
    await this.#auditCalled(
      input,
      elapsed,
      evidence.length,
      domainDecision,
      queryCategory,
      decisionRecordId,
    )
    return {
      status: 'called',
      evidence,
      resultCount: evidence.length,
      policyDecisionRef: decisionRecordId,
    }
  }

  // -------------------------------------------------------------------------
  // 内部实现
  // -------------------------------------------------------------------------

  async #runRetrieval(
    input: CopilotWebSearchGateInput,
    settings: CopilotWebSearchSettings,
    quotaState: { currentCount: number; windowStart: string },
  ) {
    const queryCategory = classifyRetrievalQueryCategory(input.query)
    const now = new Date()

    // 调用前计数（尽力而为；失败不阻断）
    await this.#settings.consumeQuota(input.organizationId)

    const authorizationState: RetrievalAuthorizationState = {
      organizationId: input.organizationId,
      authorized: true,
      authorizedByUserId: input.actorId,
      authorizedAt: now.toISOString(),
    }

    const domainPolicy: DomainPolicy = {
      organizationId: input.organizationId,
      allowlist: settings.allowedDomains.map((pattern) => ({
        pattern,
        type: pattern.startsWith('*.') ? ('suffix_wildcard' as const) : ('exact' as const),
      })),
      denylist: settings.deniedDomains.map((pattern) => ({
        pattern,
        type: pattern.startsWith('*.') ? ('suffix_wildcard' as const) : ('exact' as const),
      })),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }

    const windowStart = new Date(quotaState.windowStart)
    const quotaPolicy: RetrievalQuotaPolicy = {
      organizationId: input.organizationId,
      maxRetrievalsPerWindow: settings.dailyQueryLimit,
      windowMs: DAY_MS,
    }

    let output
    try {
      output = await this.#retrieval.retrieve({
        request: {
          organizationId: input.organizationId,
          userId: input.actorId,
          query: input.query,
          queryCategory,
          maxResults: settings.maxResultsPerQuery,
          turnId: input.turnId,
        },
        authorizationState,
        domainPolicy,
        quotaPolicy,
        currentQuotaCount: quotaState.currentCount,
        windowStart,
        windowEnd: new Date(windowStart.getTime() + DAY_MS),
      })
    } catch (err) {
      // provider 意外（fixture 不应发生，但防回归）：降级为 timeout，不中断 Copilot
      logger.error(
        { err, organizationId: input.organizationId },
        '网页搜索 provider 意外失败，降级',
      )
      await this.#auditDegraded(input, 'web_search_timeout', 0, 0, 'blocked')
      return {
        decisionRecord: {
          id: `ret_unexpected_${input.turnId}`,
          organizationId: input.organizationId,
          userId: input.actorId,
          turnId: input.turnId,
          queryCategory,
          matchedDomains: [],
          rejectedDomainCount: 0,
          rejectionReasonCounts: {
            authorization_gated: 0,
            domain_not_in_allowlist: 0,
            domain_in_denylist: 0,
            quota_exhausted: 0,
            fetch_timeout: 1,
            fetch_failed: 0,
          },
          elapsedMs: 0,
          resultCount: 0,
          isComplete: false,
          createdAt: now.toISOString(),
        },
        resultSet: {
          entries: [],
          isComplete: false,
          rejectedDomainCount: 0,
          queryCategory,
          elapsedMs: 0,
        },
      }
    }

    // 追加配额窗口内的内部配额判定：retrieval 自身 quota guard 使用当前计数的
    // 快照（消费发生在调用前，因此一次调用正好消耗 1 单位，窗口语义自洽）。
    return output
  }

  #toDetectionEntry(entry: RetrievalResultEntry, organizationId: number): ExternalContentEntry {
    return {
      entryId: `ws-${entry.url}`,
      url: entry.url,
      fetchedAt: entry.fetchedAt,
      snapshotHash: entry.snapshotHash,
      sourceMarker: 'external',
      lowSensitivitySummary: entry.snippet,
      detectionVerdict: 'passed',
      organizationId,
    }
  }

  #toEvidence(
    entry: RetrievalResultEntry,
    settings: CopilotWebSearchSettings,
    policyDecisionRef: string,
  ): ExternalEvidence {
    const domain = this.#hostnameOf(entry.url)
    const exactAllowed = settings.allowedDomains.filter((d) => !d.startsWith('*.')).includes(domain)
    const trustBand: ExternalEvidence['trustBand'] =
      domain.endsWith('.gov.cn') ||
      domain.endsWith('.gov') ||
      domain.endsWith('.edu.cn') ||
      domain.endsWith('.org.cn')
        ? 'official'
        : exactAllowed
          ? 'known'
          : 'unverified'
    return {
      title: entry.title.slice(0, 240),
      canonicalUrl: entry.url,
      accessedAt: entry.fetchedAt,
      provider: settings.providerKind ?? 'fixture',
      excerpt: entry.snippet.slice(0, EXTERNAL_EVIDENCE_MAX_EXCERPT),
      contentHash: entry.snapshotHash,
      trustBand,
      policyDecisionRef,
    }
  }

  #hostnameOf(url: string): string {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  }

  #noCall(
    code:
      | 'web_search_disabled'
      | 'web_search_consent_required'
      | 'web_search_permission_denied'
      | 'web_search_not_needed',
  ): CopilotWebSearchGateResult {
    return { status: 'not_called', code, message: COPILOT_WEB_SEARCH_GATE_LABELS[code] }
  }

  async #auditDenied(
    input: CopilotWebSearchGateInput,
    code: CopilotWebSearchAuditShape['gateCode'],
    elapsedMs: number,
  ) {
    await this.#auditWebSearch(input, code, elapsedMs, 0, 'blocked', false, null)
  }

  async #auditDegraded(
    input: CopilotWebSearchGateInput,
    code: CopilotWebSearchAuditShape['gateCode'],
    elapsedMs: number,
    resultCount: number,
    domainDecision: CopilotWebSearchAuditShape['domainDecision'],
  ) {
    await this.#auditWebSearch(input, code, elapsedMs, resultCount, domainDecision, true, null)
  }

  async #auditCalled(
    input: CopilotWebSearchGateInput,
    elapsedMs: number,
    resultCount: number,
    domainDecision: CopilotWebSearchAuditShape['domainDecision'],
    category: RetrievalQueryCategory | null,
    _decisionRef: string,
  ) {
    await this.#auditWebSearch(
      input,
      'web_search_called',
      elapsedMs,
      resultCount,
      domainDecision,
      false,
      category,
    )
  }

  /** 低敏审计统一入口：只落形状，不落原文/secret。 */
  async #auditWebSearch(
    input: CopilotWebSearchGateInput,
    gateCode: CopilotWebSearchAuditShape['gateCode'],
    elapsedMs: number,
    resultCount: number,
    domainDecision: CopilotWebSearchAuditShape['domainDecision'],
    degraded: boolean,
    category: RetrievalQueryCategory | null,
  ) {
    const shape: CopilotWebSearchAuditShape = {
      organizationId: input.organizationId,
      actorId: input.actorId,
      turnId: input.turnId,
      queryCategory: category ?? classifyRetrievalQueryCategory(input.query),
      gateCode,
      resultCount,
      degraded,
      elapsedMs,
      domainDecision,
      queryPurpose: deriveQueryPurpose(
        input.query,
        category ?? classifyRetrievalQueryCategory(input.query),
      ),
      noSecret: true,
    }
    try {
      const event =
        gateCode === 'web_search_called'
          ? AuditEvent.COPILOT_WEB_SEARCH_CALLED
          : degraded
            ? AuditEvent.COPILOT_WEB_SEARCH_DEGRADED
            : AuditEvent.COPILOT_WEB_SEARCH_DENIED
      await this.#audit.log({
        event,
        userId: input.actorId,
        organizationId: input.organizationId,
        entityType: 'copilot_web_search',
        metadata: shape as unknown as Record<string, unknown>,
      })
    } catch (err) {
      logger.warn({ err }, '网页搜索工具审计落账失败（不阻断）')
    }
  }
}
