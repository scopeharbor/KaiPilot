/**
 * v2-triz-decision-log-traceability —— 共享类型测试（任务 1.5）。
 */
import { describe, it, expect } from 'vitest'
import {
  TRIZ_DECISION_TYPES,
  TRIZ_DECISION_STATUSES,
  TRIZ_DECISION_SOURCE_KINDS,
  TRIZ_DECISION_VISIBILITY,
  TRIZ_SUMMARY_LEVELS,
  TRIZ_DECISION_WARNING_CODES,
  computeTrizDecisionHash,
  sanitizeReasonText,
  requiresSourceRefs,
  isTerminalDecision,
} from './triz-decision-log.js'
import type {
  TrizDecisionSubjectRef,
  TrizDecisionSourceRef,
  TrizDecisionLogEntry,
} from './triz-decision-log.js'

// ---------------------------------------------------------------------------
// 1.2 — Schema / runtime 校验（zod 等）
// ---------------------------------------------------------------------------

describe('TRIZ_DECISION_TYPES', () => {
  it('includes all expected decision types', () => {
    expect(TRIZ_DECISION_TYPES).toContain('adopt')
    expect(TRIZ_DECISION_TYPES).toContain('reject')
    expect(TRIZ_DECISION_TYPES).toContain('partial_accept')
    expect(TRIZ_DECISION_TYPES).toContain('modified_accept')
    expect(TRIZ_DECISION_TYPES).toContain('clarification_requested')
    expect(TRIZ_DECISION_TYPES).toContain('supersede')
  })

  it('has exactly 6 members', () => {
    expect(TRIZ_DECISION_TYPES).toHaveLength(6)
  })
})

describe('TRIZ_DECISION_STATUSES', () => {
  it('includes active/superseded/archived', () => {
    expect(TRIZ_DECISION_STATUSES).toContain('active')
    expect(TRIZ_DECISION_STATUSES).toContain('superseded')
    expect(TRIZ_DECISION_STATUSES).toContain('archived')
  })
})

describe('TRIZ_DECISION_SOURCE_KINDS', () => {
  it('includes contradiction and analysis_artifact', () => {
    expect(TRIZ_DECISION_SOURCE_KINDS).toContain('contradiction')
    expect(TRIZ_DECISION_SOURCE_KINDS).toContain('analysis_artifact')
  })
})

describe('TRIZ_DECISION_VISIBILITY', () => {
  it('includes public/restricted/internal', () => {
    expect(TRIZ_DECISION_VISIBILITY).toContain('public')
    expect(TRIZ_DECISION_VISIBILITY).toContain('restricted')
    expect(TRIZ_DECISION_VISIBILITY).toContain('internal')
  })
})

describe('TRIZ_SUMMARY_LEVELS', () => {
  it('includes low/medium/high', () => {
    expect(TRIZ_SUMMARY_LEVELS).toContain('low')
    expect(TRIZ_SUMMARY_LEVELS).toContain('medium')
    expect(TRIZ_SUMMARY_LEVELS).toContain('high')
  })
})

describe('TRIZ_DECISION_WARNING_CODES', () => {
  it('includes all expected warning codes', () => {
    expect(TRIZ_DECISION_WARNING_CODES).toContain('TRIZ_DECISION_MISSING_SOURCE_REFS')
    expect(TRIZ_DECISION_WARNING_CODES).toContain('TRIZ_DECISION_STALE_HASH')
    expect(TRIZ_DECISION_WARNING_CODES).toContain('TRIZ_DECISION_UNAUTHORIZED_REF')
  })
})

// ---------------------------------------------------------------------------
// 1.3 — 稳定 hash helper
// ---------------------------------------------------------------------------

describe('computeTrizDecisionHash', () => {
  const refs: TrizDecisionSubjectRef[] = [
    {
      kind: 'contradiction',
      id: 'c-1',
      version: 'v1',
      summaryLevel: 'medium',
      visibility: 'public',
    },
  ]
  const sourceRefs: TrizDecisionSourceRef[] = [
    { kind: 'analysis_artifact', id: 'a-1', hash: 'abc123' },
  ]

  it('produces a stable hash for same inputs', () => {
    const h1 = computeTrizDecisionHash(refs, sourceRefs, '采纳矛盾解决路径')
    const h2 = computeTrizDecisionHash(refs, sourceRefs, '采纳矛盾解决路径')
    expect(h1).toBe(h2)
  })

  it('produces different hashes for different reasons', () => {
    const h1 = computeTrizDecisionHash(refs, sourceRefs, '采纳路径')
    const h2 = computeTrizDecisionHash(refs, sourceRefs, '驳回路径')
    expect(h1).not.toBe(h2)
  })

  it('produces different hashes for different refs', () => {
    const otherRefs: TrizDecisionSubjectRef[] = [
      {
        kind: 'contradiction',
        id: 'c-2',
        version: 'v1',
        summaryLevel: 'medium',
        visibility: 'public',
      },
    ]
    const h1 = computeTrizDecisionHash(refs, sourceRefs, '采纳')
    const h2 = computeTrizDecisionHash(otherRefs, sourceRefs, '采纳')
    expect(h1).not.toBe(h2)
  })

  it('is case-insensitive for reason', () => {
    const h1 = computeTrizDecisionHash(refs, sourceRefs, 'Adopt Reason')
    const h2 = computeTrizDecisionHash(refs, sourceRefs, 'adopt reason')
    expect(h1).toBe(h2)
  })
})

// ---------------------------------------------------------------------------
// 1.4 — 脱敏工具
// ---------------------------------------------------------------------------

describe('sanitizeReasonText', () => {
  it('redacts long base64-like tokens', () => {
    const result = sanitizeReasonText('使用的token是 abcDEF0123456789abcdef0123456789abcDEF01')
    expect(result).toContain('[REDACTED_TOKEN]')
    expect(result).not.toContain('abcDEF0123456789abcdef0123456789abcDEF01')
  })

  it('redacts file paths', () => {
    const result = sanitizeReasonText('相关文件位于 /home/user/data/secret.txt')
    expect(result).toContain('[REDACTED_PATH]')
  })

  it('redacts auth headers', () => {
    const result = sanitizeReasonText('Authorization: bearer abcdef1234567890abcdef1234567890')
    expect(result).not.toContain('abcdef1234567890abcdef1234567890')
  })

  it('does not modify normal text', () => {
    const normal = '采纳了矛盾 tc-dur-vs-res 的解决路径'
    expect(sanitizeReasonText(normal)).toBe(normal)
  })

  it('handles empty string', () => {
    expect(sanitizeReasonText('')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 1.5 — 枚举穷尽性 + 工具函数
// ---------------------------------------------------------------------------

describe('requiresSourceRefs', () => {
  it('returns true for adopt/partial_accept/modified_accept', () => {
    expect(requiresSourceRefs('adopt')).toBe(true)
    expect(requiresSourceRefs('partial_accept')).toBe(true)
    expect(requiresSourceRefs('modified_accept')).toBe(true)
  })

  it('returns false for reject/clarification_requested/supersede', () => {
    expect(requiresSourceRefs('reject')).toBe(false)
    expect(requiresSourceRefs('clarification_requested')).toBe(false)
    expect(requiresSourceRefs('supersede')).toBe(false)
  })
})

describe('isTerminalDecision', () => {
  it('returns true for reject/adopt/supersede', () => {
    expect(isTerminalDecision('reject')).toBe(true)
    expect(isTerminalDecision('adopt')).toBe(true)
    expect(isTerminalDecision('supersede')).toBe(true)
  })

  it('returns false for other types', () => {
    expect(isTerminalDecision('partial_accept')).toBe(false)
    expect(isTerminalDecision('modified_accept')).toBe(false)
    expect(isTerminalDecision('clarification_requested')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 无效 ref 校验（接口契约测试）
// ---------------------------------------------------------------------------

describe('TrizDecisionSubjectRef contract', () => {
  it('requires kind to be a valid TrizDecisionSourceKind', () => {
    const ref: TrizDecisionSubjectRef = {
      kind: 'contradiction',
      id: 'c-1',
      version: 'v1',
      summaryLevel: 'medium',
      visibility: 'public',
    }
    expect(ref.kind).toBe('contradiction')
    expect(ref.id).toBe('c-1')
  })

  it('requires version and summaryLevel', () => {
    const ref: TrizDecisionSubjectRef = {
      kind: 'analysis_artifact',
      id: 'art-1',
      version: 'abc123',
      summaryLevel: 'high',
      visibility: 'restricted',
    }
    expect(ref.version).toBeTruthy()
    expect(ref.summaryLevel).toBe('high')
  })
})

describe('TrizDecisionLogEntry contract', () => {
  const entry: TrizDecisionLogEntry = {
    id: 1,
    organizationId: 1,
    projectId: 1,
    decisionType: 'adopt',
    decisionStatus: 'active',
    subjectRefs: [
      {
        kind: 'contradiction',
        id: 'c-1',
        version: 'v1',
        summaryLevel: 'medium',
        visibility: 'public',
      },
    ],
    sourceRefs: [],
    artifactHashes: [],
    reasonSummary: '采纳解决路径',
    reasonHash: 'a1b2c3d4',
    alternativeSummary: null,
    supersedesDecisionLogId: null,
    supersededByDecisionLogId: null,
    createdBy: 1,
    createdAt: '2026-07-16T00:00:00Z',
    updatedAt: null,
  }

  it('is valid with required fields', () => {
    expect(entry.id).toBe(1)
    expect(entry.decisionType).toBe('adopt')
    expect(entry.decisionStatus).toBe('active')
  })

  it('can link to superseded decision', () => {
    const superseded = { ...entry, id: 2, supersedesDecisionLogId: 1 }
    expect(superseded.supersedesDecisionLogId).toBe(1)
  })
})
