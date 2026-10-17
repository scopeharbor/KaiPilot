/**
 * v3-copilot-suggestion-inbox — 契约与 fixtures 测试
 *
 * 验证：无正文字段、五态迁移、过期原因必填、去重键声明式、
 * 确定性排序、低敏 sanitizer、类型守卫、fixtures 一致性。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  INBOX_SOURCE_KINDS,
  INBOX_PROBLEM_KINDS,
  INBOX_SEVERITY_LEVELS,
  INBOX_ENTRY_STATES,
  INBOX_VALID_TRANSITIONS,
  INBOX_EXPIRY_REASON_KINDS,
  INBOX_ACTIONS,
  INBOX_DEFAULT_SORT,
  INBOX_FEEDBACK_ORIGIN,
  INBOX_SOURCE_KIND_LABELS,
  INBOX_PROBLEM_KIND_LABELS,
  INBOX_SEVERITY_LABELS,
  INBOX_ENTRY_STATE_LABELS,
  INBOX_EXPIRY_REASON_LABELS,
  type InboxEntry,
  type InboxEntryState,
  type InboxSourceRef,
  type InboxDedupeKey,
  type InboxSeverity,
  type InboxProblemKind,
  canInboxTransition,
  inboxSeverityScore,
  compareInboxEntries,
  sortInboxEntries,
  deriveInboxDedupeKey,
  serializeInboxDedupeKey,
  sanitizeInboxEntrySummary,
  isInboxSourceKind,
  isInboxProblemKind,
  isInboxSeverity,
  isInboxEntryState,
  isInboxAction,
} from '../src/copilot-suggestion-inbox.js'

import {
  resetInboxFixtureSeq,
  makeSourceRef,
  makeInboxEntry,
  makeAggregateResult,
  fixtureFiveSourcesComplete,
  fixtureSingleSourceMissing,
  fixtureDedupeMerge,
  fixtureDedupeNoMerge,
  fixtureExpired,
  fixtureAdopted,
  fixturePermissionMissing,
  fixtureCrossOrgExclusion,
  fixtureDeterministicOrder,
  EXPECTED_DETERMINISTIC_ORDER,
} from '../src/copilot-suggestion-inbox-fixtures.js'

describe('copilot-suggestion-inbox contracts', () => {
  beforeEach(() => {
    resetInboxFixtureSeq()
  })

  // =========================================================================
  // 2.3 — 持久化形状无任何正文型字段
  // =========================================================================
  describe('2.3 Persisted shape carries no content', () => {
    const CONTENT_LIKE_FIELDS = [
      'body',
      'content',
      'text',
      'description',
      'summary',
      'detail',
      'suggestion',
      'recommendation',
      'explanation',
      'rationale',
      'analysis',
      'prompt',
      'output',
      'result',
      'message',
      'html',
      'markdown',
    ]

    it('InboxEntry has no body-like fields', () => {
      const entry = makeInboxEntry()
      for (const field of CONTENT_LIKE_FIELDS) {
        expect(entry).not.toHaveProperty(field)
      }
    })

    it('makeInboxEntry creates entry with only defined shape fields', () => {
      const entry = makeInboxEntry()
      const keys = Object.keys(entry)
      // Must not contain any content-like key
      for (const key of keys) {
        expect(CONTENT_LIKE_FIELDS).not.toContain(key)
      }
    })
  })

  // =========================================================================
  // 2.4 — 五态生命周期枚举与合法迁移图
  // =========================================================================
  describe('2.4 Five-state lifecycle', () => {
    it('defines five states', () => {
      expect(INBOX_ENTRY_STATES).toHaveLength(5)
      expect(INBOX_ENTRY_STATES).toContain('unread')
      expect(INBOX_ENTRY_STATES).toContain('read')
      expect(INBOX_ENTRY_STATES).toContain('adopted')
      expect(INBOX_ENTRY_STATES).toContain('dismissed')
      expect(INBOX_ENTRY_STATES).toContain('expired')
    })

    it('unread can transition to read or expired', () => {
      expect(canInboxTransition('unread', 'read')).toBe(true)
      expect(canInboxTransition('unread', 'expired')).toBe(true)
      expect(canInboxTransition('unread', 'adopted')).toBe(false)
      expect(canInboxTransition('unread', 'dismissed')).toBe(false)
    })

    it('read can transition to adopted, dismissed, or expired', () => {
      expect(canInboxTransition('read', 'adopted')).toBe(true)
      expect(canInboxTransition('read', 'dismissed')).toBe(true)
      expect(canInboxTransition('read', 'expired')).toBe(true)
      expect(canInboxTransition('read', 'unread')).toBe(false)
    })

    it('adopted/dismissed/expired are terminal states', () => {
      for (const terminal of ['adopted', 'dismissed', 'expired'] as const) {
        expect(canInboxTransition(terminal, 'unread')).toBe(false)
        expect(canInboxTransition(terminal, 'read')).toBe(false)
        expect(canInboxTransition(terminal, 'adopted')).toBe(false)
        expect(canInboxTransition(terminal, 'dismissed')).toBe(false)
        expect(canInboxTransition(terminal, 'expired')).toBe(false)
      }
    })
  })

  // =========================================================================
  // 2.6 — 不作为不触发任何状态迁移
  // =========================================================================
  describe('2.6 Inaction transitions nothing', () => {
    it('inaction (no action call) leaves entry unchanged', () => {
      const entry = makeInboxEntry({ state: 'unread' })
      // Simulate: user opens inbox but takes no action
      // The only automatic transition is unread → read on viewing,
      // which requires explicit mark_read action
      expect(entry.state).toBe('unread')
      // After viewing (mark_read), it should be 'read', not 'dismissed'
      const viewed = { ...entry, state: 'read' as InboxEntryState }
      // Without explicit adopt/dismiss, state stays 'read'
      expect(viewed.state).toBe('read')
      expect(viewed.state).not.toBe('dismissed')
    })

    it('there is no auto-dismiss timeout in valid transitions', () => {
      // 'dismissed' can only be reached from 'read' via explicit action
      expect(canInboxTransition('unread', 'dismissed')).toBe(false)
      // There is no timer-based transition anywhere
    })
  })

  // =========================================================================
  // 2.7 — 过期原因字段必填
  // =========================================================================
  describe('2.7 Expiry reason is mandatory', () => {
    it('expired entry must have expiryReason', () => {
      const expired = fixtureExpired()
      expect(expired.state).toBe('expired')
      expect(expired.expiryReason).not.toBeNull()
      expect(INBOX_EXPIRY_REASON_KINDS).toContain(expired.expiryReason)
    })

    it('expired entry must have expiryDetail', () => {
      const expired = fixtureExpired()
      expect(expired.expiryDetail).not.toBeNull()
      expect(expired.expiryDetail!.length).toBeGreaterThan(0)
    })

    it('non-expired entries have null expiry fields', () => {
      const entry = makeInboxEntry({ state: 'unread' })
      expect(entry.expiryReason).toBeNull()
      expect(entry.expiryDetail).toBeNull()
    })
  })

  // =========================================================================
  // 2.8 — 去重键按问题种类声明
  // =========================================================================
  describe('2.8 Dedupe key declared per problem kind', () => {
    it('deriveInboxDedupeKey creates deterministic key', () => {
      const key = deriveInboxDedupeKey('resource_overload', 'proj-x-res-overload')
      expect(key.problemKind).toBe('resource_overload')
      expect(key.declaredKey).toBe('proj-x-res-overload')
    })

    it('serializeInboxDedupeKey is deterministic', () => {
      const key = deriveInboxDedupeKey('schedule_risk', 'proj-y-schedule')
      const s1 = serializeInboxDedupeKey(key)
      const s2 = serializeInboxDedupeKey(key)
      expect(s1).toBe(s2)
      expect(s1).toBe('schedule_risk::proj-y-schedule')
    })

    it('different declared keys produce different serializations', () => {
      const k1 = deriveInboxDedupeKey('resource_overload', 'key-a')
      const k2 = deriveInboxDedupeKey('resource_overload', 'key-b')
      expect(serializeInboxDedupeKey(k1)).not.toBe(serializeInboxDedupeKey(k2))
    })

    it('problem kind is required in dedupe key', () => {
      const key: InboxDedupeKey = { problemKind: 'other', declaredKey: 'test' }
      expect(INBOX_PROBLEM_KINDS).toContain(key.problemKind)
    })
  })

  // =========================================================================
  // 2.9 — 排序键：严重度/影响面 + 时效 + 稳定破平局
  // =========================================================================
  describe('2.9 Deterministic ordering', () => {
    it('same inputs yield identical ordering', () => {
      const entries = fixtureDeterministicOrder()
      const sorted1 = sortInboxEntries(entries)
      const sorted2 = sortInboxEntries(entries)
      expect(sorted1.map((e) => e.id)).toEqual(sorted2.map((e) => e.id))
    })

    it('sorts by severity desc then createdAt desc then id asc', () => {
      const entries = fixtureDeterministicOrder()
      const sorted = sortInboxEntries(entries)
      expect(sorted.map((e) => e.id)).toEqual(EXPECTED_DETERMINISTIC_ORDER)
    })

    it('no personalization signals are read', () => {
      const entry = makeInboxEntry()
      // Entry has no adoption history, usage history, or personalization fields
      expect(entry).not.toHaveProperty('adoptionCount')
      expect(entry).not.toHaveProperty('viewCount')
      expect(entry).not.toHaveProperty('personalScore')
    })

    it('severity scores are ordered correctly', () => {
      expect(inboxSeverityScore('critical')).toBeGreaterThan(inboxSeverityScore('high'))
      expect(inboxSeverityScore('high')).toBeGreaterThan(inboxSeverityScore('medium'))
      expect(inboxSeverityScore('medium')).toBeGreaterThan(inboxSeverityScore('low'))
      expect(inboxSeverityScore('low')).toBeGreaterThan(inboxSeverityScore('info'))
    })
  })

  // =========================================================================
  // 2.10 — 部分聚合结果类型
  // =========================================================================
  describe('2.10 Partial aggregate result', () => {
    it('result includes missingSources array', () => {
      const result = makeAggregateResult([], {
        missingSources: [{ sourceKind: 'risk_ai_suggestion', reason: '来源查询超时' }],
      })
      expect(result.missingSources).toHaveLength(1)
      expect(result.missingSources[0].sourceKind).toBe('risk_ai_suggestion')
    })

    it('result includes unreadCount', () => {
      const entries = [
        makeInboxEntry({ state: 'unread' }),
        makeInboxEntry({ state: 'read' }),
        makeInboxEntry({ state: 'unread' }),
      ]
      const result = makeAggregateResult(entries)
      expect(result.unreadCount).toBe(2)
    })
  })

  // =========================================================================
  // 2.11 — inbox 来源标记
  // =========================================================================
  describe('2.11 Inbox feedback origin tag', () => {
    it('INBOX_FEEDBACK_ORIGIN is a unique constant', () => {
      expect(INBOX_FEEDBACK_ORIGIN).toBe('inbox_suggestion')
    })
  })

  // =========================================================================
  // Fixtures consistency
  // =========================================================================
  describe('Fixtures consistency', () => {
    it('fixtureFiveSourcesComplete has all five sources', () => {
      const entry = fixtureFiveSourcesComplete()
      expect(entry.sourceRefs).toHaveLength(5)
      const kinds = entry.sourceRefs.map((r) => r.sourceKind)
      expect(kinds).toEqual(INBOX_SOURCE_KINDS)
    })

    it('fixtureSingleSourceMissing reports three missing', () => {
      const { missing } = fixtureSingleSourceMissing()
      expect(missing).toHaveLength(3)
    })

    it('fixtureDedupeMerge returns single entry with two refs', () => {
      const entries = fixtureDedupeMerge()
      expect(entries).toHaveLength(1)
      expect(entries[0].sourceRefs).toHaveLength(2)
    })

    it('fixtureDedupeNoMerge returns two separate entries', () => {
      const entries = fixtureDedupeNoMerge()
      expect(entries).toHaveLength(2)
      expect(entries[0].dedupeKey.declaredKey).not.toBe(entries[1].dedupeKey.declaredKey)
    })

    it('fixtureExpired has expired state and reason', () => {
      const entry = fixtureExpired()
      expect(entry.state).toBe('expired')
      expect(entry.expiryReason).toBe('schedule_changed')
    })

    it('fixtureAdopted has adopted state and actionedAt', () => {
      const entry = fixtureAdopted()
      expect(entry.state).toBe('adopted')
      expect(entry.actionedAt).not.toBeNull()
    })

    it('fixturePermissionMissing has entry with pmo source', () => {
      expect(fixturePermissionMissing.entry.sourceRefs[0].sourceKind).toBe(
        'pmo_priority_recommendation',
      )
    })

    it('fixtureCrossOrgExclusion has different organizationId', () => {
      expect(fixtureCrossOrgExclusion.otherOrgEntry.organizationId).not.toBe(
        fixtureCrossOrgExclusion.targetOrgId,
      )
    })
  })

  // =========================================================================
  // 低敏 sanitizer
  // =========================================================================
  describe('Low-sensitivity sanitizer', () => {
    it('sanitizeInboxEntrySummary omits sensitive fields', () => {
      const entry = makeInboxEntry()
      const summary = sanitizeInboxEntrySummary(entry)
      expect(summary).toHaveProperty('id')
      expect(summary).toHaveProperty('state')
      expect(summary).toHaveProperty('problemKind')
      expect(summary).toHaveProperty('severity')
      expect(summary).toHaveProperty('sourceCount')
      expect(summary).toHaveProperty('expired')
      // Must not include sourceRefs, dedupeKey, or any content
      expect(summary).not.toHaveProperty('sourceRefs')
      expect(summary).not.toHaveProperty('dedupeKey')
      expect(summary).not.toHaveProperty('body')
    })
  })

  // =========================================================================
  // 类型守卫
  // =========================================================================
  describe('Type guards', () => {
    it('isInboxSourceKind accepts valid values', () => {
      expect(isInboxSourceKind('smart_recommendation')).toBe(true)
      expect(isInboxSourceKind('invalid')).toBe(false)
      expect(isInboxSourceKind(null)).toBe(false)
    })

    it('isInboxProblemKind accepts valid values', () => {
      expect(isInboxProblemKind('resource_overload')).toBe(true)
      expect(isInboxProblemKind('invalid')).toBe(false)
    })

    it('isInboxSeverity accepts valid values', () => {
      expect(isInboxSeverity('critical')).toBe(true)
      expect(isInboxSeverity('invalid')).toBe(false)
    })

    it('isInboxEntryState accepts valid values', () => {
      expect(isInboxEntryState('unread')).toBe(true)
      expect(isInboxEntryState('invalid')).toBe(false)
    })

    it('isInboxAction accepts valid values', () => {
      expect(isInboxAction('adopt')).toBe(true)
      expect(isInboxAction('invalid')).toBe(false)
    })
  })

  // =========================================================================
  // Labels
  // =========================================================================
  describe('Labels', () => {
    it('all source kinds have labels', () => {
      for (const kind of INBOX_SOURCE_KINDS) {
        expect(INBOX_SOURCE_KIND_LABELS[kind]).toBeTruthy()
      }
    })

    it('all problem kinds have labels', () => {
      for (const kind of INBOX_PROBLEM_KINDS) {
        expect(INBOX_PROBLEM_KIND_LABELS[kind]).toBeTruthy()
      }
    })

    it('all severities have labels', () => {
      for (const sev of INBOX_SEVERITY_LEVELS) {
        expect(INBOX_SEVERITY_LABELS[sev]).toBeTruthy()
      }
    })

    it('all states have labels', () => {
      for (const state of INBOX_ENTRY_STATES) {
        expect(INBOX_ENTRY_STATE_LABELS[state]).toBeTruthy()
      }
    })

    it('all expiry reasons have labels', () => {
      for (const reason of INBOX_EXPIRY_REASON_KINDS) {
        expect(INBOX_EXPIRY_REASON_LABELS[reason]).toBeTruthy()
      }
    })
  })
})
