/**
 * v3-triz-decision-center 单元测试 —— 覆盖 DTO guards 与纯函数。
 */

import { describe, it, expect } from 'vitest'
import {
  computeDecisionCenterItemId,
  isSourceHashStale,
  groupItemsByQueueStatus,
  computeDecisionCenterSummary,
  aggregateWarnings,
  redactSensitiveItemData,
  sanitizeDecisionCenterText,
  sortDecisionCenterItems,
  filterDecisionCenterItems,
  canEnterDraftReview,
  requiresExplicitConfirmation,
  validateConfirmation,
  defaultPriorityForStatus,
} from './triz-decision-center.js'
import {
  fixtureDecisionCenterItem,
  fixtureMixedQueue,
  fixtureStaleQueue,
  fixtureEmptyQueue,
  fixtureDraftBlockerQueue,
  fixtureVisibleSourceDigest,
  fixtureWarning,
} from './triz-decision-center.fixtures.js'

// ---------------------------------------------------------------------------
// 2.1 DTO 类型验证
// ---------------------------------------------------------------------------

describe('TrizDecisionCenter DTO types', () => {
  it('fixtureDecisionCenterItem has expected shape', () => {
    const item = fixtureDecisionCenterItem()
    expect(item).toBeDefined()
    expect(item.id).toBe('dc-abc12345')
    expect(item.queueStatus).toBe('pending_decision')
    expect(item.source.sourceKind).toBe('contradiction')
    expect(item.organizationId).toBe(1)
    expect(item.projectId).toBe(1)
    expect(item.hasAccess).toBe(true)
  })

  it('fixtureMixedQueue has 6 items', () => {
    const queue = fixtureMixedQueue()
    expect(queue.length).toBe(6)
  })

  it('fixtureEmptyQueue is empty', () => {
    expect(fixtureEmptyQueue()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 2.2 Pure helpers — stable item identity
// ---------------------------------------------------------------------------

describe('computeDecisionCenterItemId', () => {
  it('produces stable id for same input', () => {
    const id1 = computeDecisionCenterItemId('contradiction', 'contra-001', 'abc123')
    const id2 = computeDecisionCenterItemId('contradiction', 'contra-001', 'abc123')
    expect(id1).toBe(id2)
  })

  it('produces different ids for different hashes', () => {
    const id1 = computeDecisionCenterItemId('contradiction', 'contra-001', 'abc123')
    const id2 = computeDecisionCenterItemId('contradiction', 'contra-001', 'xyz789')
    expect(id1).not.toBe(id2)
  })

  it('produces different ids for different source kinds', () => {
    const id1 = computeDecisionCenterItemId('contradiction', 'contra-001', 'abc123')
    const id2 = computeDecisionCenterItemId('compiler_triz_analysis', 'contra-001', 'abc123')
    expect(id1).not.toBe(id2)
  })

  it('starts with dc- prefix', () => {
    const id = computeDecisionCenterItemId('decision_log', 'dl-1', 'hash1')
    expect(id.startsWith('dc-')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2.2 Pure helpers — source hash comparison
// ---------------------------------------------------------------------------

describe('isSourceHashStale', () => {
  it('returns true when hashes differ', () => {
    expect(isSourceHashStale('abc', 'def')).toBe(true)
  })

  it('returns false when hashes match', () => {
    expect(isSourceHashStale('abc', 'abc')).toBe(false)
  })

  it('is case sensitive', () => {
    expect(isSourceHashStale('ABC', 'abc')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2.2 Pure helpers — queue grouping
// ---------------------------------------------------------------------------

describe('groupItemsByQueueStatus', () => {
  it('groups mixed queue into 6 groups', () => {
    const items = fixtureMixedQueue()
    const groups = groupItemsByQueueStatus(items)
    expect(groups.pending_decision).toHaveLength(1)
    expect(groups.stale_source).toHaveLength(1)
    expect(groups.missing_reason).toHaveLength(1)
    expect(groups.ready_for_draft).toHaveLength(1)
    expect(groups.blocked).toHaveLength(1)
    expect(groups.recently_decided).toHaveLength(1)
  })

  it('handles empty queue', () => {
    const groups = groupItemsByQueueStatus([])
    Object.values(groups).forEach((g) => expect(g).toHaveLength(0))
  })
})

// ---------------------------------------------------------------------------
// 2.2 Pure helpers — summary counting
// ---------------------------------------------------------------------------

describe('computeDecisionCenterSummary', () => {
  it('counts total items correctly', () => {
    const items = fixtureMixedQueue()
    const summary = computeDecisionCenterSummary(items)
    expect(summary.totalItems).toBe(6)
  })

  it('counts queue statuses correctly', () => {
    const items = fixtureMixedQueue()
    const { queueCounts } = computeDecisionCenterSummary(items)
    expect(queueCounts.pending_decision).toBe(1)
    expect(queueCounts.blocked).toBe(1)
  })

  it('counts warning codes correctly', () => {
    const items = fixtureDraftBlockerQueue()
    const { warningCounts } = computeDecisionCenterSummary(items)
    expect(warningCounts.TRIZ_DC_NO_DECISION_LOG).toBe(1)
  })

  it('handles empty queue with all zeros', () => {
    const summary = computeDecisionCenterSummary([])
    expect(summary.totalItems).toBe(0)
    Object.values(summary.queueCounts).forEach((c) => expect(c).toBe(0))
    Object.values(summary.warningCounts).forEach((c) => expect(c).toBe(0))
  })
})

// ---------------------------------------------------------------------------
// 2.2 Pure helpers — warning aggregation
// ---------------------------------------------------------------------------

describe('aggregateWarnings', () => {
  it('does not duplicate warnings with same code', () => {
    const warnings = [
      { code: 'TRIZ_DC_STALE_SOURCE_HASH' as const, message: 'stale 1', details: ['d1'] },
      { code: 'TRIZ_DC_STALE_SOURCE_HASH' as const, message: 'stale 2', details: ['d2'] },
    ]
    const result = aggregateWarnings(warnings)
    expect(result).toHaveLength(1)
  })

  it('merges details from duplicate codes', () => {
    const warnings = [
      { code: 'TRIZ_DC_NO_DECISION_LOG' as const, message: 'no log', details: ['item 1'] },
      { code: 'TRIZ_DC_NO_DECISION_LOG' as const, message: 'no log', details: ['item 2'] },
    ]
    const result = aggregateWarnings(warnings)
    expect(result).toHaveLength(1)
    expect(result[0].details).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// 2.2 Pure helpers — redaction
// ---------------------------------------------------------------------------

describe('redactSensitiveItemData', () => {
  it('keeps accessible source summary redacted', () => {
    const item = fixtureDecisionCenterItem({
      source: fixtureVisibleSourceDigest({ summary: 'Normal summary text' }),
    })
    const redacted = redactSensitiveItemData(item)
    expect(redacted.source.summary).toBe('Normal summary text')
  })

  it('nullifies inaccessible source summary', () => {
    const item = fixtureDecisionCenterItem()
    const inaccessible = {
      ...item,
      source: { ...item.source, accessible: false, summary: 'hidden' },
    }
    const redacted = redactSensitiveItemData(inaccessible)
    expect(redacted.source.summary).toBeNull()
  })

  it('redacts token-like strings', () => {
    const text = 'API key: abc123def456ghi789jkl012mno345pqr678stu901vwx234yz56789ab'
    const result = sanitizeDecisionCenterText(text)
    expect(result).not.toContain('abc123def')
    expect(result).toContain('[REDACTED]')
  })

  it('does not modify normal text', () => {
    const text = '这是一个普通的决策理由摘要'
    expect(sanitizeDecisionCenterText(text)).toBe(text)
  })
})

// ---------------------------------------------------------------------------
// 2.2 Pure helpers — stable sorting
// ---------------------------------------------------------------------------

describe('sortDecisionCenterItems', () => {
  it('sorts by priority ascending', () => {
    const items = [
      fixtureDecisionCenterItem({ id: 'a', priority: 5 }),
      fixtureDecisionCenterItem({ id: 'b', priority: 1 }),
      fixtureDecisionCenterItem({ id: 'c', priority: 10 }),
    ]
    const sorted = sortDecisionCenterItems(items, 'priority', 'asc')
    expect(sorted[0].id).toBe('b')
    expect(sorted[1].id).toBe('a')
    expect(sorted[2].id).toBe('c')
  })

  it('sorts by priority descending', () => {
    const items = [
      fixtureDecisionCenterItem({ id: 'a', priority: 5 }),
      fixtureDecisionCenterItem({ id: 'b', priority: 1 }),
    ]
    const sorted = sortDecisionCenterItems(items, 'priority', 'desc')
    expect(sorted[0].id).toBe('a')
    expect(sorted[1].id).toBe('b')
  })

  it('does not mutate original', () => {
    const items = [fixtureDecisionCenterItem({ id: 'a' })]
    sortDecisionCenterItems(items, 'priority')
    expect(items[0].id).toBe('a')
  })
})

// ---------------------------------------------------------------------------
// 2.2 Pure helpers — filtering
// ---------------------------------------------------------------------------

describe('filterDecisionCenterItems', () => {
  const items = fixtureMixedQueue()

  it('filters by status', () => {
    const filtered = filterDecisionCenterItems(items, { status: 'blocked' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].queueStatus).toBe('blocked')
  })

  it('filters by source kind', () => {
    const filtered = filterDecisionCenterItems(items, { sourceKind: 'contradiction' })
    expect(filtered).toHaveLength(2) // pending_decision + recently_decided
  })

  it('filters by search text', () => {
    const filtered = filterDecisionCenterItems(items, { search: '矛盾' })
    expect(filtered.length).toBeGreaterThanOrEqual(2) // contradiction items contain 矛盾
  })

  it('returns all items when no filters', () => {
    const filtered = filterDecisionCenterItems(items, {})
    expect(filtered.length).toBe(items.length)
  })
})

// ---------------------------------------------------------------------------
// 2.2 Pure helpers — Draft readiness
// ---------------------------------------------------------------------------

describe('canEnterDraftReview', () => {
  it('returns true for ready item with start_draft_review action', () => {
    const item = fixtureDecisionCenterItem({
      readiness: 'ready',
      allowedActions: ['start_draft_review', 'view_detail'],
      warnings: [],
    })
    expect(canEnterDraftReview(item)).toBe(true)
  })

  it('returns false for not_ready item', () => {
    const item = fixtureDecisionCenterItem({ readiness: 'not_ready' })
    expect(canEnterDraftReview(item)).toBe(false)
  })

  it('returns false for stale item', () => {
    const item = fixtureDecisionCenterItem({
      readiness: 'ready',
      warnings: [fixtureWarning({ code: 'TRIZ_DC_STALE_SOURCE_HASH' })],
    })
    expect(canEnterDraftReview(item)).toBe(false)
  })

  it('returns false without start_draft_review action', () => {
    const item = fixtureDecisionCenterItem({
      readiness: 'ready',
      allowedActions: ['view_detail'],
    })
    expect(canEnterDraftReview(item)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2.2 Pure helpers — explicit confirmation
// ---------------------------------------------------------------------------

describe('requiresExplicitConfirmation', () => {
  it.each(['adopt', 'reject', 'partial_accept', 'modified_accept', 'supersede'] as const)(
    '%s requires confirmation',
    (action) => {
      expect(requiresExplicitConfirmation(action)).toBe(true)
    },
  )

  it.each([
    'supplement',
    'generate_reason_draft',
    'start_draft_review',
    'view_detail',
    'request_clarification',
  ] as const)('%s does not require confirmation', (action) => {
    expect(requiresExplicitConfirmation(action)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2.2 Pure helpers — confirmation validation
// ---------------------------------------------------------------------------

describe('validateConfirmation', () => {
  it('validates complete confirmation', () => {
    const result = validateConfirmation({
      confirmed: true,
      confirmedBy: 1,
      confirmedAt: '2026-07-31T10:00:00.000Z',
      sourceHashes: ['abc123'],
      warningAcknowledged: true,
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects unconfirmed actions', () => {
    const result = validateConfirmation({
      confirmed: false,
      confirmedBy: 1,
      confirmedAt: '2026-07-31T10:00:00.000Z',
      sourceHashes: ['abc123'],
      warningAcknowledged: true,
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('confirmation.confirmed must be true')
  })

  it('rejects empty source hashes', () => {
    const result = validateConfirmation({
      confirmed: true,
      confirmedBy: 1,
      confirmedAt: '2026-07-31T10:00:00.000Z',
      sourceHashes: [],
      warningAcknowledged: true,
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('confirmation.sourceHashes must not be empty')
  })

  it('rejects unacknowledged warnings', () => {
    const result = validateConfirmation({
      confirmed: true,
      confirmedBy: 1,
      confirmedAt: '2026-07-31T10:00:00.000Z',
      sourceHashes: ['abc123'],
      warningAcknowledged: false,
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('confirmation.warningAcknowledged must be true')
  })
})

// ---------------------------------------------------------------------------
// 2.2 Pure helpers — default priority
// ---------------------------------------------------------------------------

describe('defaultPriorityForStatus', () => {
  it('blocked has highest priority', () => {
    expect(defaultPriorityForStatus('blocked')).toBe(10)
  })

  it('recently_decided has lowest priority', () => {
    expect(defaultPriorityForStatus('recently_decided')).toBe(1)
  })

  it('pending_decision > ready_for_draft', () => {
    expect(defaultPriorityForStatus('pending_decision')).toBeGreaterThan(
      defaultPriorityForStatus('ready_for_draft'),
    )
  })
})
