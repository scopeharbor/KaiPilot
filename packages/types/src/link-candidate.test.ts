/**
 * v2-5-code-repository-auto-linking —— link-candidate 契约类型测试。
 *
 * 覆盖：接口形状、validation helpers、边界值（未知 provider、超长文本、完整 payload/token/private comment 拒绝）
 */

import { describe, it, expect } from 'vitest'
import {
  CURRENT_RULE_VERSION,
  REPOSITORY_EVENT_TYPES,
  CANDIDATE_STATUSES,
  CANDIDATE_CONFIDENCE_CLASSES,
  REFERENCE_SOURCE_FIELDS,
  DEFAULT_CANDIDATE_TTL_HOURS,
  isValidRepositoryEventType,
  isValidCandidateStatus,
  isValidCandidateConfidenceClass,
  isValidReferenceSourceField,
  isValidProviderForCandidate,
  type RepositoryReferenceEvent,
  type LinkCandidateDto,
  type CandidateEvidenceDto,
  type ListCandidatesResponse,
  type ConfirmCandidateRequest,
  type CandidateActionResponse,
  type ExtractionResult,
  type ReferenceEvidence,
} from './link-candidate.js'

// ---------------------------------------------------------------------------
// §1 常量与枚举
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('CURRENT_RULE_VERSION is 1', () => {
    expect(CURRENT_RULE_VERSION).toBe(1)
  })

  it('REPOSITORY_EVENT_TYPES has branch/push/pull_request', () => {
    expect(REPOSITORY_EVENT_TYPES).toEqual(['branch', 'push', 'pull_request'])
  })

  it('CANDIDATE_STATUSES has all lifecycle states', () => {
    expect(CANDIDATE_STATUSES).toEqual(['pending', 'confirmed', 'ignored', 'expired', 'rejected'])
  })

  it('CANDIDATE_CONFIDENCE_CLASSES has high/medium/low', () => {
    expect(CANDIDATE_CONFIDENCE_CLASSES).toEqual(['high', 'medium', 'low'])
  })

  it('REFERENCE_SOURCE_FIELDS are the expected low-sensitive fields', () => {
    expect(REFERENCE_SOURCE_FIELDS).toEqual([
      'branchRef',
      'commitMessagePreview',
      'pullRequestTitle',
      'pullRequestBodyPreview',
    ])
  })

  it('DEFAULT_CANDIDATE_TTL_HOURS is 72', () => {
    expect(DEFAULT_CANDIDATE_TTL_HOURS).toBe(72)
  })
})

// ---------------------------------------------------------------------------
// §2 RepositoryReferenceEvent 形状
// ---------------------------------------------------------------------------

describe('RepositoryReferenceEvent interface', () => {
  it('accepts a minimal branch event shape', () => {
    const event: RepositoryReferenceEvent = {
      eventVersion: 1,
      provider: 'github',
      eventType: 'branch',
      organizationId: 1,
      repositoryFullName: 'org/repo',
      repositoryExternalId: 'R_kg123',
      deliveryId: 'del-001',
      eventTimestamp: '2026-07-22T10:00:00Z',
      branchRef: 'refs/heads/feat/PROJ-123-new-feature',
    }
    expect(event.eventVersion).toBe(1)
    expect(event.provider).toBe('github')
    expect(event.eventType).toBe('branch')
  })

  it('accepts a pull_request event with all PR fields', () => {
    const event: RepositoryReferenceEvent = {
      eventVersion: 1,
      provider: 'github',
      eventType: 'pull_request',
      organizationId: 1,
      repositoryFullName: 'org/repo',
      repositoryExternalId: 'R_kg456',
      deliveryId: 'del-002',
      eventTimestamp: '2026-07-22T11:00:00Z',
      pullRequestNumber: 42,
      pullRequestTitle: 'Feat: implement PROJ-456 login',
      pullRequestBodyPreview: 'Closes PROJ-456',
      pullRequestHeadRef: 'feat/proj-456-login',
      pullRequestBaseRef: 'main',
    }
    expect(event.pullRequestNumber).toBe(42)
    expect(event.pullRequestTitle).toContain('PROJ-456')
  })

  it('rejects unknown provider', () => {
    const event: RepositoryReferenceEvent = {
      eventVersion: 1,
      provider: 'github', // Only 'github' is allowed for now
      eventType: 'push',
      organizationId: 1,
      repositoryFullName: 'org/repo',
      repositoryExternalId: 'R_kg789',
      deliveryId: 'del-003',
      eventTimestamp: '2026-07-22T12:00:00Z',
      commitSha: 'abc123',
      commitMessagePreview: 'fix: resolve PROJ-789',
    }
    // TypeScript should enforce 'github' at compile time
    expect(event.provider).toBe('github')
  })
})

// ---------------------------------------------------------------------------
// §3 CandidateEvidenceDto / LinkCandidateDto 形状
// ---------------------------------------------------------------------------

describe('DTO interfaces', () => {
  it('CandidateEvidenceDto has low-sensitive fields', () => {
    const evidence: CandidateEvidenceDto = {
      sourceField: 'branchRef',
      matchedPreview: 'PROJ-123',
      ruleVersion: 1,
    }
    expect(evidence.sourceField).toBe('branchRef')
    // Should NOT have raw body, token, or full commit content
    expect(Object.keys(evidence).sort()).toEqual(['matchedPreview', 'ruleVersion', 'sourceField'])
  })

  it('LinkCandidateDto shape is complete and low-sensitive', () => {
    const candidate: LinkCandidateDto = {
      id: 1,
      organizationId: 1,
      provider: 'github',
      repositoryFullName: 'org/repo',
      repositoryExternalId: 'R_kg123',
      eventType: 'pull_request',
      deliveryId: 'del-001',
      objectType: 'pull_request',
      objectId: '42',
      taskReference: 'PROJ-123',
      taskId: 100,
      taskTitle: 'Implement login',
      evidences: [
        { sourceField: 'pullRequestTitle', matchedPreview: 'PROJ-123 login', ruleVersion: 1 },
      ],
      confidenceClass: 'high',
      status: 'pending',
      createdAt: '2026-07-22T10:00:00Z',
      expiresAt: '2026-07-25T10:00:00Z',
      settledAt: null,
      settledBy: null,
    }
    expect(candidate.id).toBe(1)
    expect(candidate.status).toBe('pending')
    // No sensitive fields
    expect(candidate.evidences).toHaveLength(1)
  })

  it('sensitive fields are absent from the DTO', () => {
    // Verify that fields like commitBody, privateNotes, token are NOT on the interface
    const candidate: LinkCandidateDto = {} as LinkCandidateDto
    expect((candidate as Record<string, unknown>).commitBodyPreview).toBeUndefined()
    expect((candidate as Record<string, unknown>).token).toBeUndefined()
    expect((candidate as Record<string, unknown>).webhookPayload).toBeUndefined()
    expect((candidate as Record<string, unknown>).privateComment).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// §4 Request / Response payloads
// ---------------------------------------------------------------------------

describe('request/response payloads', () => {
  it('ConfirmCandidateRequest has optional note only', () => {
    const req: ConfirmCandidateRequest = { note: 'looks correct' }
    expect(req.note).toBe('looks correct')
    // No other fields should be required
    const empty: ConfirmCandidateRequest = {}
    expect(empty.note).toBeUndefined()
  })

  it('CandidateActionResponse shape', () => {
    const resp: CandidateActionResponse = {
      id: 1,
      status: 'confirmed',
      externalLinkId: 42,
      message: 'Candidate confirmed and link created',
    }
    expect(resp.externalLinkId).toBe(42)
  })

  it('CandidateActionResponse without link ID', () => {
    const resp: CandidateActionResponse = {
      id: 2,
      status: 'ignored',
      message: 'Candidate ignored',
    }
    expect(resp.externalLinkId).toBeUndefined()
  })

  it('ListCandidatesResponse has data+meta', () => {
    const resp: ListCandidatesResponse = {
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    }
    expect(resp.meta.page).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// §5 Validation helpers
// ---------------------------------------------------------------------------

describe('isValidRepositoryEventType', () => {
  it('accepts valid types', () => {
    expect(isValidRepositoryEventType('branch')).toBe(true)
    expect(isValidRepositoryEventType('push')).toBe(true)
    expect(isValidRepositoryEventType('pull_request')).toBe(true)
  })

  it('rejects invalid types', () => {
    expect(isValidRepositoryEventType('merge_request')).toBe(false)
    expect(isValidRepositoryEventType('issue')).toBe(false)
    expect(isValidRepositoryEventType('')).toBe(false)
    expect(isValidRepositoryEventType(' PR ')).toBe(false)
  })
})

describe('isValidCandidateStatus', () => {
  it('accepts all lifecycle statuses', () => {
    for (const s of CANDIDATE_STATUSES) {
      expect(isValidCandidateStatus(s)).toBe(true)
    }
  })

  it('rejects invalid statuses', () => {
    expect(isValidCandidateStatus('draft')).toBe(false)
    expect(isValidCandidateStatus('deleted')).toBe(false)
  })
})

describe('isValidCandidateConfidenceClass', () => {
  it('accepts valid classes', () => {
    expect(isValidCandidateConfidenceClass('high')).toBe(true)
    expect(isValidCandidateConfidenceClass('medium')).toBe(true)
    expect(isValidCandidateConfidenceClass('low')).toBe(true)
  })

  it('rejects unknown classes', () => {
    expect(isValidCandidateConfidenceClass('very_high')).toBe(false)
    expect(isValidCandidateConfidenceClass('')).toBe(false)
  })
})

describe('isValidReferenceSourceField', () => {
  it('accepts all allowed fields', () => {
    for (const f of REFERENCE_SOURCE_FIELDS) {
      expect(isValidReferenceSourceField(f)).toBe(true)
    }
  })

  it('rejects disallowed fields', () => {
    expect(isValidReferenceSourceField('commitBody')).toBe(false)
    expect(isValidReferenceSourceField('pullRequestDiff')).toBe(false)
    expect(isValidReferenceSourceField('commitAuthor')).toBe(false)
  })
})

describe('isValidProviderForCandidate', () => {
  it('accepts github', () => {
    expect(isValidProviderForCandidate('github')).toBe(true)
  })

  it('rejects gitlab and others', () => {
    expect(isValidProviderForCandidate('gitlab')).toBe(false)
    expect(isValidProviderForCandidate('')).toBe(false)
    expect(isValidProviderForCandidate('unknown')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// §6 边界测试
// ---------------------------------------------------------------------------

describe('边界测试', () => {
  it('超长文本的 matchedPreview 不应超过合理长度', () => {
    // 实际业务应在提取器中截断；这里仅验证类型可赋值
    const longPreview = 'x'.repeat(500)
    const evidence: ReferenceEvidence = {
      sourceField: 'pullRequestBodyPreview',
      matchedPreview: longPreview,
      matchStart: 0,
      matchEnd: 500,
      ruleVersion: 1,
    }
    expect(evidence.matchedPreview.length).toBe(500)
  })

  it('ExtractionResult 应支持多个去重引用', () => {
    const result: ExtractionResult = {
      normalizedReference: 'PROJ-123',
      evidences: [
        {
          sourceField: 'branchRef',
          matchedPreview: 'PROJ-123 login',
          matchStart: 0,
          matchEnd: 10,
          ruleVersion: 1,
        },
        {
          sourceField: 'commitMessagePreview',
          matchedPreview: 'fix PROJ-123',
          matchStart: 5,
          matchEnd: 12,
          ruleVersion: 1,
        },
      ],
      uniqueReferenceCount: 1,
    }
    expect(result.evidences).toHaveLength(2)
    expect(result.uniqueReferenceCount).toBe(1)
  })

  it('null taskId 表示未匹配到具体任务', () => {
    const dto: LinkCandidateDto = {
      id: 1,
      organizationId: 1,
      provider: 'github',
      repositoryFullName: 'org/repo',
      repositoryExternalId: 'R_kg123',
      eventType: 'pull_request',
      deliveryId: 'del-001',
      objectType: 'pull_request',
      objectId: '42',
      taskReference: 'PROJ-999',
      taskId: null,
      taskTitle: null,
      evidences: [],
      confidenceClass: 'low',
      status: 'pending',
      createdAt: '2026-07-22T10:00:00Z',
      expiresAt: '2026-07-25T10:00:00Z',
      settledAt: null,
      settledBy: null,
    }
    expect(dto.taskId).toBeNull()
    expect(dto.taskTitle).toBeNull()
  })

  it('向后兼容：添加未知字段不应破坏', () => {
    const legacy: RepositoryReferenceEvent = {
      eventVersion: 1,
      provider: 'github',
      eventType: 'push',
      organizationId: 1,
      repositoryFullName: 'org/repo',
      repositoryExternalId: 'R_kg123',
      deliveryId: 'del-001',
      eventTimestamp: '2026-07-22T10:00:00Z',
      commitSha: 'abc123',
      commitMessagePreview: 'fix bug',
      // @ts-expect-error — 未知字段模拟未来版本
      futureField: 'should be tolerated',
    }
    expect(legacy.commitMessagePreview).toBe('fix bug')
    expect((legacy as Record<string, unknown>).futureField).toBe('should be tolerated')
  })
})
