/**
 * v3-copilot-web-search-tool — 外部检索契约单元测试
 *
 * 覆盖：
 * - 2.1 检索请求/结果条目/决策记录类型存在性
 * - 2.2 结果条目形状（URL/标题/摘要/抓取时间/快照 hash/来源标记为外部）
 * - 2.3 决策记录形状（搜索词类别/命中域名/被拒域名/失败原因/耗时）
 * - 2.4 禁存约束：记录不含搜索词原文、网页正文、prompt、模型输出、token 与 secret
 * - 2.5 负例测试：搜索词原文与网页正文不出现在任一记录字段
 * - 2.6 拒绝原因枚举完整性
 * - 2.7 fixtures 覆盖五态
 */

import { describe, expect, it } from 'vitest'
import {
  RETRIEVAL_REJECTION_REASONS,
  RETRIEVAL_REJECTION_REASON_LABELS,
  RETRIEVAL_QUERY_CATEGORIES,
  RETRIEVAL_QUERY_CATEGORY_LABELS,
  defaultCopilotWebSearchSettings,
  COPILOT_WEB_SEARCH_GATE_CODES,
  COPILOT_WEB_SEARCH_GATE_LABELS,
  COPILOT_WEB_SEARCH_OK_GATE_CODES,
  COPILOT_WEB_SEARCH_SETTINGS_KEY,
  COPILOT_WEB_SEARCH_MANAGE_PERMISSION,
  copilotWebSearchNeedsExternal,
  type RetrievalDecisionRecord,
  type RetrievalResultEntry,
  type RetrievalRejectionReason,
  type RetrievalQueryCategory,
  type ExternalEvidence,
  type CopilotWebSearchAuditShape,
} from './copilot-web-search.js'
import {
  copilotWebSearchFixtureUnauthorized,
  copilotWebSearchFixtureAuthorized,
  copilotWebSearchFixtureResultEntry,
  copilotWebSearchFixtureFailedEntry,
  copilotWebSearchFixtureResultSet,
  copilotWebSearchFixturePartialResultSet,
  copilotWebSearchFixtureDomainPolicy,
  copilotWebSearchFixtureQuotaPolicy,
  copilotWebSearchFixtureQuotaAllowed,
  copilotWebSearchFixtureQuotaExhausted,
  copilotWebSearchFixtureDecisionRecord,
  COPILOT_WEB_SEARCH_FIXTURE_DECISION_UNAUTHORIZED,
  COPILOT_WEB_SEARCH_FIXTURE_DECISION_DOMAIN_REJECTED,
  COPILOT_WEB_SEARCH_FIXTURE_DECISION_QUOTA_EXHAUSTED,
  COPILOT_WEB_SEARCH_FIXTURE_DECISION_PARTIAL_FAILURE,
  COPILOT_WEB_SEARCH_FIXTURE_DECISION_DOMAIN_ALLOWED,
  ALL_RETRIEVAL_REJECTION_REASONS,
  ALL_RETRIEVAL_QUERY_CATEGORIES,
} from './copilot-web-search-fixtures.js'

// ---------------------------------------------------------------------------
// 2.1 检索请求/结果条目/决策记录类型存在性
// ---------------------------------------------------------------------------

describe('Web search shared contracts', () => {
  describe('2.1 types exist and are usable', () => {
    it('retrieval result entry has correct shape', () => {
      const entry: RetrievalResultEntry = {
        url: 'https://example.com',
        title: 'Test',
        snippet: 'Summary',
        fetchedAt: '2026-08-19T00:00:00Z',
        snapshotHash: 'abc',
        source: 'external',
        isComplete: true,
      }
      expect(entry.source).toBe('external')
      expect(entry.url).toBe('https://example.com')
    })

    it('retrieval decision record has correct shape', () => {
      const record: RetrievalDecisionRecord = {
        id: 'r1',
        organizationId: 1,
        userId: 10,
        turnId: 't1',
        queryCategory: 'technical',
        matchedDomains: ['example.com'],
        rejectedDomainCount: 0,
        rejectionReasonCounts: {
          authorization_gated: 0,
          domain_not_in_allowlist: 0,
          domain_in_denylist: 0,
          quota_exhausted: 0,
          fetch_timeout: 0,
          fetch_failed: 0,
        },
        elapsedMs: 500,
        resultCount: 2,
        isComplete: true,
        createdAt: '2026-08-19T00:00:01Z',
      }
      expect(record.queryCategory).toBe('technical')
      expect(record.matchedDomains).toEqual(['example.com'])
    })
  })

  // ---------------------------------------------------------------------------
  // 2.2 结果条目形状
  // ---------------------------------------------------------------------------

  describe('2.2 result entry shape', () => {
    it('has url, title, snippet, fetchedAt, snapshotHash, source=external', () => {
      const entry = copilotWebSearchFixtureResultEntry()
      expect(entry).toHaveProperty('url')
      expect(entry).toHaveProperty('title')
      expect(entry).toHaveProperty('snippet')
      expect(entry).toHaveProperty('fetchedAt')
      expect(entry).toHaveProperty('snapshotHash')
      expect(entry.source).toBe('external')
    })

    it('failed entry has isComplete=false and failureReason', () => {
      const entry = copilotWebSearchFixtureFailedEntry('fetch_timeout')
      expect(entry.isComplete).toBe(false)
      expect(entry.failureReason).toBe('fetch_timeout')
    })
  })

  // ---------------------------------------------------------------------------
  // 2.3 决策记录形状
  // ---------------------------------------------------------------------------

  describe('2.3 decision record shape', () => {
    it('has queryCategory (not query text), matchedDomains, rejectedDomainCount, rejectionReasonCounts, elapsedMs', () => {
      const record = copilotWebSearchFixtureDecisionRecord()
      expect(record).toHaveProperty('queryCategory')
      expect(record).toHaveProperty('matchedDomains')
      expect(record).toHaveProperty('rejectedDomainCount')
      expect(record).toHaveProperty('rejectionReasonCounts')
      expect(record).toHaveProperty('elapsedMs')
    })

    it('queryCategory is one of the allowed categories', () => {
      const record = copilotWebSearchFixtureDecisionRecord()
      expect(RETRIEVAL_QUERY_CATEGORIES).toContain(record.queryCategory)
    })
  })

  // ---------------------------------------------------------------------------
  // 2.4 禁存约束
  // ---------------------------------------------------------------------------

  describe('2.4 no-store constraint', () => {
    it('decision record has no field for query text, page body, prompt, model output, token, or secret', () => {
      const record = copilotWebSearchFixtureDecisionRecord()
      const keys = Object.keys(record)
      const forbidden = [
        'queryText',
        'query',
        'searchQuery',
        'searchTerms',
        'body',
        'pageBody',
        'content',
        'html',
        'prompt',
        'modelOutput',
        'response',
        'token',
        'secret',
        'apiKey',
        'authorization',
      ]
      for (const f of forbidden) {
        expect(keys).not.toContain(f)
      }
    })

    it('result entry has no field for page body content', () => {
      const entry = copilotWebSearchFixtureResultEntry()
      const keys = Object.keys(entry)
      const forbidden = ['body', 'pageBody', 'content', 'html', 'rawContent']
      for (const f of forbidden) {
        expect(keys).not.toContain(f)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // 2.5 负例：搜索词原文不出现在记录字段
  // ---------------------------------------------------------------------------

  describe('2.5 query text absent from records (negative test)', () => {
    it('short query cannot be reconstructed from decision record', () => {
      const record = copilotWebSearchFixtureDecisionRecord({
        queryCategory: 'technical',
        matchedDomains: ['example.com'],
      })
      // The record stores category, not the original query
      expect(record.queryCategory).not.toContain('甲方')
      expect(record.queryCategory).not.toContain('违约金')
      expect(record.queryCategory).not.toContain('机密')
      // No query text field exists
      expect(record).not.toHaveProperty('query')
      expect(record).not.toHaveProperty('queryText')
      expect(record).not.toHaveProperty('searchQuery')
    })

    it('page body is not stored in result entry', () => {
      const entry = copilotWebSearchFixtureResultEntry()
      expect(entry).not.toHaveProperty('body')
      expect(entry).not.toHaveProperty('pageBody')
      expect(entry).not.toHaveProperty('content')
    })
  })

  // ---------------------------------------------------------------------------
  // 2.6 拒绝原因枚举
  // ---------------------------------------------------------------------------

  describe('2.6 rejection reason enumeration', () => {
    it('has all required reasons', () => {
      expect(RETRIEVAL_REJECTION_REASONS).toEqual([
        'authorization_gated',
        'domain_not_in_allowlist',
        'domain_in_denylist',
        'quota_exhausted',
        'fetch_timeout',
        'fetch_failed',
      ])
    })

    it('every reason has a label', () => {
      for (const reason of RETRIEVAL_REJECTION_REASONS) {
        expect(RETRIEVAL_REJECTION_REASON_LABELS[reason]).toBeTruthy()
      }
    })

    it('every category has a label', () => {
      for (const cat of RETRIEVAL_QUERY_CATEGORIES) {
        expect(RETRIEVAL_QUERY_CATEGORY_LABELS[cat]).toBeTruthy()
      }
    })
  })

  // ---------------------------------------------------------------------------
  // 2.7 fixtures 覆盖五态
  // ---------------------------------------------------------------------------

  describe('2.7 fixtures cover five states', () => {
    it('unauthorized state', () => {
      const state = copilotWebSearchFixtureUnauthorized()
      expect(state.authorized).toBe(false)
      expect(state.authorizedByUserId).toBeNull()
    })

    it('authorized state', () => {
      const state = copilotWebSearchFixtureAuthorized()
      expect(state.authorized).toBe(true)
    })

    it('domain allow state', () => {
      const record = COPILOT_WEB_SEARCH_FIXTURE_DECISION_DOMAIN_ALLOWED
      expect(record.matchedDomains.length).toBeGreaterThan(0)
      expect(record.rejectedDomainCount).toBe(0)
    })

    it('domain reject state', () => {
      const record = COPILOT_WEB_SEARCH_FIXTURE_DECISION_DOMAIN_REJECTED
      expect(record.rejectedDomainCount).toBe(3)
      expect(record.rejectionReasonCounts.domain_not_in_allowlist).toBe(2)
      expect(record.rejectionReasonCounts.domain_in_denylist).toBe(1)
    })

    it('quota exhausted state', () => {
      const record = COPILOT_WEB_SEARCH_FIXTURE_DECISION_QUOTA_EXHAUSTED
      expect(record.rejectionReasonCounts.quota_exhausted).toBe(1)
      expect(record.isComplete).toBe(false)
    })

    it('partial failure state', () => {
      const record = COPILOT_WEB_SEARCH_FIXTURE_DECISION_PARTIAL_FAILURE
      expect(record.isComplete).toBe(false)
      expect(record.rejectionReasonCounts.fetch_timeout).toBe(1)
    })

    it('result set partial failure has isComplete=false', () => {
      const rs = copilotWebSearchFixturePartialResultSet()
      expect(rs.isComplete).toBe(false)
      expect(rs.entries.some((e) => !e.isComplete)).toBe(true)
    })

    it('domain policy fixture has allowlist and denylist', () => {
      const policy = copilotWebSearchFixtureDomainPolicy()
      expect(policy.allowlist.length).toBeGreaterThan(0)
      expect(policy.denylist.length).toBeGreaterThan(0)
    })

    it('quota policy fixture', () => {
      const policy = copilotWebSearchFixtureQuotaPolicy()
      expect(policy.maxRetrievalsPerWindow).toBe(10)
    })

    it('quota allowed fixture', () => {
      const result = copilotWebSearchFixtureQuotaAllowed()
      expect(result.allowed).toBe(true)
    })

    it('quota exhausted fixture', () => {
      const result = copilotWebSearchFixtureQuotaExhausted()
      expect(result.allowed).toBe(false)
      expect(result.retryAfterSeconds).toBeGreaterThan(0)
    })
  })

  // ---------------------------------------------------------------------------
  // v3-copilot-optional-web-search-configuration — 组织级工具合同
  // ---------------------------------------------------------------------------

  describe('optional web search configuration contracts', () => {
    it('default settings are disabled with consent locked on', () => {
      const settings = defaultCopilotWebSearchSettings(1)
      expect(settings.enabled).toBe(false)
      expect(settings.providerConnectionId).toBeNull()
      expect(settings.requirePerTurnConsent).toBe(true)
      expect(settings.allowForAiCreate).toBe(false)
      expect(settings.allowForGeneralCopilot).toBe(false)
      expect(settings.dailyQueryLimit).toBeGreaterThan(0)
      expect(settings.allowedDomains).toEqual([])
    })

    it('default settings serialize without any secret field', () => {
      const settings = defaultCopilotWebSearchSettings(7)
      const json = JSON.stringify(settings)
      expect(json).not.toMatch(/api[_A-Z]?key|token|secret|credential/i)
      expect(settings.organizationId).toBe(7)
    })

    it('every gate code has a non-empty UI label', () => {
      for (const code of COPILOT_WEB_SEARCH_GATE_CODES) {
        const label = COPILOT_WEB_SEARCH_GATE_LABELS[code]
        expect(label.length).toBeGreaterThan(0)
      }
      expect(COPILOT_WEB_SEARCH_GATE_LABELS.web_search_disabled).toContain('未开启')
      expect(COPILOT_WEB_SEARCH_GATE_LABELS.web_search_consent_required).toContain('允许本次')
    })

    it('gate result ok codes exclude degraded labels', () => {
      const okCodes = new Set(COPILOT_WEB_SEARCH_OK_GATE_CODES)
      expect(okCodes.has('web_search_called')).toBe(true)
      expect(okCodes.has('web_search_not_needed')).toBe(true)
      expect(okCodes.has('web_search_quota_exceeded')).toBe(false)
      expect(okCodes.has('web_search_timeout')).toBe(false)
    })

    it('external evidence shape carries provenance and cannot be a project fact', () => {
      const evidence: ExternalEvidence = {
        title: '某市消防申报要求',
        canonicalUrl: 'https://example.gov.cn/req',
        accessedAt: '2026-09-01T08:00:00Z',
        provider: 'fixture',
        excerpt: '要求摘要',
        contentHash: 'abc123',
        trustBand: 'official',
        policyDecisionRef: 'ret_001',
      }
      expect(evidence.canonicalUrl.startsWith('http')).toBe(true)
      expect(evidence.trustBand).toMatch(/official|known|unverified/)
      // 外部证据必须显式携带来源字段，不能冒充内部 ContextFact
      expect(evidence.provider).toBe('fixture')
      expect(evidence.policyDecisionRef).toBeTruthy()
    })

    it('audit shape is no-secret by construction', () => {
      const audit: CopilotWebSearchAuditShape = {
        organizationId: 1,
        actorId: 10,
        turnId: 't1',
        queryCategory: 'regulatory',
        gateCode: 'web_search_called',
        resultCount: 2,
        degraded: false,
        elapsedMs: 300,
        domainDecision: 'allowed',
        queryPurpose: '查询本地消防申报要求',
        noSecret: true,
      }
      expect(audit.noSecret).toBe(true)
      const json = JSON.stringify(audit)
      // 禁存边界：不含 key/token/credential；唯一含 "secret" 的是常量标记字段 noSecret
      expect(json).not.toMatch(/api[_A-Z]?key|token|credential|password/i)
      expect((json.match(/secret/gi) ?? []).map((m) => m)[0]).toBe('Secret')
      expect(json.includes('"noSecret":true')).toBe(true)
    })

    it('needs-external helper triggers on regulatory intent', () => {
      expect(copilotWebSearchNeedsExternal('本地大型校园活动当前消防申报要求是什么？')).toBe(true)
      expect(copilotWebSearchNeedsExternal('最新行业数据')).toBe(true)
      expect(copilotWebSearchNeedsExternal('供应商市场报价')).toBe(true)
      // 时效性公共信息即使带「本周 / 团队」等内部标记也要联网
      expect(copilotWebSearchNeedsExternal('本周台积电股价走势')).toBe(true)
      expect(copilotWebSearchNeedsExternal('美国总统是谁')).toBe(true)
    })

    it('needs-external helper declines internal-only questions', () => {
      expect(copilotWebSearchNeedsExternal('项目当前有几项任务？')).toBe(false)
      expect(copilotWebSearchNeedsExternal('你好')).toBe(false)
      expect(copilotWebSearchNeedsExternal('张三的负载情况')).toBe(false)
      expect(copilotWebSearchNeedsExternal('')).toBe(false)
      expect(copilotWebSearchNeedsExternal('abc')).toBe(false)
      // 一般性问题（非项目内部数据）在用户开启网页搜索后也需要外部资料
      expect(copilotWebSearchNeedsExternal('Kubernetes 1.31 有什么变化')).toBe(true)
      expect(copilotWebSearchNeedsExternal('什么是零信任架构')).toBe(true)
      // 同时提到本项目与行业经验：仍需外部资料
      expect(
        copilotWebSearchNeedsExternal('针对本项目的灰度切流，结合行业最佳实践列出检查清单'),
      ).toBe(true)
    })
  })
})
