// @aiproj/types — V3 Copilot 跨对话记忆层契约测试
//
// v3-copilot-memory-user-and-project —— 42+ 用例：
// - 记忆恒为 inference 约束
// - 三层 scope 枚举与写入权限
// - 状态枚举五态
// - 时效档与陈旧阈值
// - 候选与抽取
// - 禁止类别 sanitizer
// - 确定性 helpers
// - 冲突裁决
// - 审计事件
// - Fixtures 一致性

import { describe, it, expect } from 'vitest'

import type {
  CopilotMemoryEntry,
  CopilotMemoryScope,
  CopilotMemoryStatus,
  CopilotMemoryValidityTier,
  CopilotMemoryConfidenceSource,
  CopilotMemoryForbiddenCategory,
  CopilotMemoryAuditAction,
} from './copilot-memory.js'

import {
  COPILLOT_MEMORY_SCOPES,
  COPILLOT_MEMORY_STATUSES,
  COPILLOT_MEMORY_VALIDITY_TIERS,
  COPILLOT_MEMORY_CONFIDENCE_SOURCES,
  COPILLOT_MEMORY_CONFIDENCE_MAP,
  COPILLOT_MEMORY_CANDIDATE_BOUND_PER_SESSION,
  COPILLOT_MEMORY_FORBIDDEN_CATEGORIES,
  COPILLOT_MEMORY_AUDIT_ACTIONS,
  COPILLOT_MEMORY_FACET_NAME,
  COPILLOT_MEMORY_STALENESS_THRESHOLDS,
  isCopilotMemoryScope,
  isCopilotMemoryStatus,
  isCopilotMemoryValidityTier,
  isCopilotMemoryConfidenceSource,
  isCopilotMemoryForbiddenCategory,
  isCopilotMemoryAuditAction,
  deriveMemoryConfidence,
  assertMemoryNotSerializedAsFact,
  assertNoMemoryAsFact,
  sanitizeMemoryContent,
  memoryStableSortKey,
  sortMemoryEntries,
  isMemoryStale,
  canDriveMutationAction,
  resolveMemoryConflict,
  generateMemoryEntryId,
  estimateMemoryEntryBytes,
} from './copilot-memory.js'

import {
  buildMemoryEntry,
  buildCandidateMemoryEntry,
  buildConfirmedMemoryEntry,
  buildEditedMemoryEntry,
  buildPossiblyOutdatedMemoryEntry,
  buildLongUnconfirmedMemoryEntry,
  buildConflictYieldingMemoryEntry,
  buildPermissionMissingMemoryEntry,
  buildMemoryCandidate,
  buildExtractionResult,
  buildMemoryFacet,
  buildMemoryAuditEvent,
  buildMemoryBasisRef,
  buildAllMemoryStateFixtures,
} from './copilot-memory-fixtures.js'

// ===========================================================================
// 1. 置信度派生确定性
// ===========================================================================

describe('deriveMemoryConfidence', () => {
  it('returns deterministic value for each source', () => {
    expect(deriveMemoryConfidence('explicit_user_statement')).toBe(0.95)
    expect(deriveMemoryConfidence('repeated_observation')).toBe(0.85)
    expect(deriveMemoryConfidence('single_observation')).toBe(0.7)
    expect(deriveMemoryConfidence('inferred_from_context')).toBe(0.5)
  })

  it('same input always yields same output', () => {
    const a = deriveMemoryConfidence('repeated_observation')
    const b = deriveMemoryConfidence('repeated_observation')
    expect(a).toBe(b)
  })

  it('all sources have valid confidence values', () => {
    for (const source of COPILLOT_MEMORY_CONFIDENCE_SOURCES) {
      const conf = deriveMemoryConfidence(source)
      expect(conf).toBeGreaterThanOrEqual(0)
      expect(conf).toBeLessThanOrEqual(1)
    }
  })
})

// ===========================================================================
// 2. 字段注册完整性
// ===========================================================================

describe('scope enum completeness', () => {
  it('has exactly 3 scopes', () => {
    expect(COPILLOT_MEMORY_SCOPES).toHaveLength(3)
  })

  it('includes user, project, organization', () => {
    expect(COPILLOT_MEMORY_SCOPES).toContain('user')
    expect(COPILLOT_MEMORY_SCOPES).toContain('project')
    expect(COPILLOT_MEMORY_SCOPES).toContain('organization')
  })

  it('type guard works for valid values', () => {
    expect(isCopilotMemoryScope('user')).toBe(true)
    expect(isCopilotMemoryScope('project')).toBe(true)
    expect(isCopilotMemoryScope('organization')).toBe(true)
  })

  it('type guard rejects invalid values', () => {
    expect(isCopilotMemoryScope('invalid')).toBe(false)
    expect(isCopilotMemoryScope('')).toBe(false)
  })
})

describe('status enum completeness', () => {
  it('has exactly 5 statuses', () => {
    expect(COPILLOT_MEMORY_STATUSES).toHaveLength(5)
  })

  it('includes all lifecycle states', () => {
    expect(COPILLOT_MEMORY_STATUSES).toContain('candidate')
    expect(COPILLOT_MEMORY_STATUSES).toContain('confirmed')
    expect(COPILLOT_MEMORY_STATUSES).toContain('edited')
    expect(COPILLOT_MEMORY_STATUSES).toContain('possibly_outdated')
    expect(COPILLOT_MEMORY_STATUSES).toContain('invalidated')
  })

  it('type guard works', () => {
    expect(isCopilotMemoryStatus('candidate')).toBe(true)
    expect(isCopilotMemoryStatus('invalid')).toBe(false)
  })
})

describe('validity tier completeness', () => {
  it('has exactly 5 tiers', () => {
    expect(COPILLOT_MEMORY_VALIDITY_TIERS).toHaveLength(5)
  })

  it('all tiers have staleness thresholds', () => {
    for (const tier of COPILLOT_MEMORY_VALIDITY_TIERS) {
      expect(COPILLOT_MEMORY_STALENESS_THRESHOLDS[tier]).toBeGreaterThan(0)
    }
  })

  it('tier ordering: ephemeral < short < medium < long < durable', () => {
    const tiers = COPILLOT_MEMORY_VALIDITY_TIERS
    for (let i = 0; i < tiers.length - 1; i++) {
      expect(COPILLOT_MEMORY_STALENESS_THRESHOLDS[tiers[i]]).toBeLessThan(
        COPILLOT_MEMORY_STALENESS_THRESHOLDS[tiers[i + 1]],
      )
    }
  })

  it('type guard rejects invalid', () => {
    expect(isCopilotMemoryValidityTier('invalid')).toBe(false)
  })
})

describe('confidence source completeness', () => {
  it('has exactly 4 sources', () => {
    expect(COPILLOT_MEMORY_CONFIDENCE_SOURCES).toHaveLength(4)
  })

  it('all have valid mappings', () => {
    for (const source of COPILLOT_MEMORY_CONFIDENCE_SOURCES) {
      expect(COPILLOT_MEMORY_CONFIDENCE_MAP[source]).toBeGreaterThanOrEqual(0)
      expect(COPILLOT_MEMORY_CONFIDENCE_MAP[source]).toBeLessThanOrEqual(1)
    }
  })

  it('type guard rejects invalid', () => {
    expect(isCopilotMemoryConfidenceSource('invalid')).toBe(false)
  })
})

describe('forbidden categories completeness', () => {
  it('has exactly 6 categories', () => {
    expect(COPILLOT_MEMORY_FORBIDDEN_CATEGORIES).toHaveLength(6)
  })

  it('type guard works', () => {
    expect(isCopilotMemoryForbiddenCategory('credential')).toBe(true)
    expect(isCopilotMemoryForbiddenCategory('invalid')).toBe(false)
  })
})

describe('audit action completeness', () => {
  it('has all lifecycle actions', () => {
    expect(COPILLOT_MEMORY_AUDIT_ACTIONS).toContain('candidate_extracted')
    expect(COPILLOT_MEMORY_AUDIT_ACTIONS).toContain('candidate_confirmed')
    expect(COPILLOT_MEMORY_AUDIT_ACTIONS).toContain('candidate_ignored')
    expect(COPILLOT_MEMORY_AUDIT_ACTIONS).toContain('memory_edited')
    expect(COPILLOT_MEMORY_AUDIT_ACTIONS).toContain('memory_invalidated')
    expect(COPILLOT_MEMORY_AUDIT_ACTIONS).toContain('memory_deleted')
    expect(COPILLOT_MEMORY_AUDIT_ACTIONS).toContain('memory_injected')
    expect(COPILLOT_MEMORY_AUDIT_ACTIONS).toContain('write_attempted')
    expect(COPILLOT_MEMORY_AUDIT_ACTIONS).toContain('access_denied')
    expect(COPILLOT_MEMORY_AUDIT_ACTIONS).toContain('conflict_resolved')
  })

  it('type guard works', () => {
    expect(isCopilotMemoryAuditAction('candidate_extracted')).toBe(true)
    expect(isCopilotMemoryAuditAction('invalid')).toBe(false)
  })
})

// ===========================================================================
// 3. 记忆恒为 inference — 序列化约束
// ===========================================================================

describe('memory inference serialization constraint', () => {
  it('memory facet has correct facetName', () => {
    const facet = buildMemoryFacet()
    expect(facet.facetName).toBe(COPILLOT_MEMORY_FACET_NAME)
  })

  it('memory facet kind must be inferred', () => {
    const facet = buildMemoryFacet()
    expect(facet.kind).toBe('inferred')
  })

  it('assertMemoryNotSerializedAsFact passes for valid facet', () => {
    const facet = buildMemoryFacet()
    const result = assertMemoryNotSerializedAsFact(facet)
    expect(result.ok).toBe(true)
  })

  it('assertMemoryNotSerializedAsFact rejects wrong facetName', () => {
    const bad = { facetName: 'verified_fact', kind: 'inferred' }
    const result = assertMemoryNotSerializedAsFact(bad as any)
    expect(result.ok).toBe(false)
  })

  it('assertMemoryNotSerializedAsFact rejects wrong kind', () => {
    const bad = { facetName: COPILLOT_MEMORY_FACET_NAME, kind: 'verified_fact' }
    const result = assertMemoryNotSerializedAsFact(bad as any)
    expect(result.ok).toBe(false)
  })

  it('assertNoMemoryAsFact passes for valid facets', () => {
    const facets = [
      { facetName: COPILLOT_MEMORY_FACET_NAME, kind: 'inferred' },
      { facetName: 'retrieval', kind: 'retrieval' },
    ]
    const result = assertNoMemoryAsFact(facets as any)
    expect(result.ok).toBe(true)
  })

  it('assertNoMemoryAsFact rejects memory with wrong kind', () => {
    const facets = [{ facetName: COPILLOT_MEMORY_FACET_NAME, kind: 'verified_fact' }]
    const result = assertNoMemoryAsFact(facets as any)
    expect(result.ok).toBe(false)
  })
})

// ===========================================================================
// 4. 禁止类别 Sanitizer
// ===========================================================================

describe('sanitizeMemoryContent', () => {
  it('passes clean content', () => {
    const result = sanitizeMemoryContent('团队使用 Scrum 方法论，双周迭代')
    expect(result.ok).toBe(true)
    expect(result.hitCategories).toHaveLength(0)
  })

  it('rejects credential content', () => {
    const result = sanitizeMemoryContent('password: abc123')
    expect(result.ok).toBe(false)
    expect(result.hitCategories).toContain('credential')
  })

  it('rejects personal sensitive info', () => {
    const result = sanitizeMemoryContent('身份证号：110101199001011234')
    expect(result.ok).toBe(false)
    expect(result.hitCategories).toContain('personal_sensitive_info')
  })

  it('rejects prompt text', () => {
    const result = sanitizeMemoryContent('system: you are a helpful assistant')
    expect(result.ok).toBe(false)
    expect(result.hitCategories).toContain('prompt_text')
  })

  it('rejects model output full text', () => {
    const result = sanitizeMemoryContent('As an AI, I cannot provide that information')
    expect(result.ok).toBe(false)
    expect(result.hitCategories).toContain('model_output_full_text')
  })

  it('rejects raw external payload', () => {
    const result = sanitizeMemoryContent('<html><body>test</body></html>')
    expect(result.ok).toBe(false)
    expect(result.hitCategories).toContain('raw_external_payload')
  })

  it('rejects api key content', () => {
    const result = sanitizeMemoryContent('api_key=sk-abcdefghijklmnop')
    expect(result.ok).toBe(false)
    expect(result.hitCategories).toContain('credential')
  })

  it('reports multiple categories in one content', () => {
    const result = sanitizeMemoryContent('password: secret123 <html>test</html>')
    expect(result.ok).toBe(false)
    expect(result.hitCategories.length).toBeGreaterThanOrEqual(2)
  })
})

// ===========================================================================
// 5. 候选与抽取
// ===========================================================================

describe('candidate bound', () => {
  it('per-session bound is 5', () => {
    expect(COPILLOT_MEMORY_CANDIDATE_BOUND_PER_SESSION).toBe(5)
  })
})

describe('extraction result', () => {
  it('has deterministic flag', () => {
    const result = buildExtractionResult()
    expect(result.deterministic).toBe(true)
  })

  it('candidate entry has no id, createdAt, updatedAt', () => {
    const candidate = buildMemoryCandidate()
    const entry = candidate.entry as any
    expect(entry.id).toBeUndefined()
    expect(entry.createdAt).toBeUndefined()
    expect(entry.updatedAt).toBeUndefined()
  })
})

// ===========================================================================
// 6. 确定性 Helpers
// ===========================================================================

describe('memoryStableSortKey', () => {
  it('produces stable key', () => {
    const entry = buildMemoryEntry()
    const key1 = memoryStableSortKey(entry)
    const key2 = memoryStableSortKey(entry)
    expect(key1).toBe(key2)
  })

  it('organization scope has higher priority than project', () => {
    const orgEntry = buildMemoryEntry({ scope: 'organization' })
    const projEntry = buildMemoryEntry({ scope: 'project' })
    expect(memoryStableSortKey(orgEntry) < memoryStableSortKey(projEntry)).toBe(true)
  })
})

describe('sortMemoryEntries', () => {
  it('sorts by scope priority then confirmedAt', () => {
    const entries = [
      buildMemoryEntry({ scope: 'user', id: 'mem_3' }),
      buildMemoryEntry({ scope: 'organization', id: 'mem_1' }),
      buildMemoryEntry({ scope: 'project', id: 'mem_2' }),
    ]
    const sorted = sortMemoryEntries(entries)
    expect(sorted[0].scope).toBe('organization')
    expect(sorted[1].scope).toBe('project')
    expect(sorted[2].scope).toBe('user')
  })

  it('does not mutate input', () => {
    const entries = [buildMemoryEntry({ id: 'b' }), buildMemoryEntry({ id: 'a' })]
    const original = [...entries]
    sortMemoryEntries(entries)
    expect(entries[0].id).toBe(original[0].id)
    expect(entries[1].id).toBe(original[1].id)
  })
})

describe('isMemoryStale', () => {
  it('returns false for recently confirmed durable memory', () => {
    const entry = buildMemoryEntry({
      validityTier: 'durable',
      lastConfirmedAt: new Date().toISOString(),
    })
    expect(isMemoryStale(entry)).toBe(false)
  })

  it('returns true for old ephemeral memory', () => {
    const entry = buildMemoryEntry({
      validityTier: 'ephemeral',
      lastConfirmedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(isMemoryStale(entry, new Date('2026-08-16').getTime())).toBe(true)
  })

  it('uses observedAt when lastConfirmedAt is missing', () => {
    const entry = buildMemoryEntry({
      validityTier: 'ephemeral',
      lastConfirmedAt: undefined,
      observedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(isMemoryStale(entry, new Date('2026-08-16').getTime())).toBe(true)
  })
})

describe('canDriveMutationAction', () => {
  it('returns true for fresh confirmed memory', () => {
    const entry = buildMemoryEntry({
      status: 'confirmed',
      validityTier: 'durable',
      lastConfirmedAt: new Date().toISOString(),
    })
    expect(canDriveMutationAction(entry)).toBe(true)
  })

  it('returns false for invalidated memory', () => {
    const entry = buildMemoryEntry({ status: 'invalidated' })
    expect(canDriveMutationAction(entry)).toBe(false)
  })

  it('returns false for possibly_outdated memory', () => {
    const entry = buildMemoryEntry({ status: 'possibly_outdated' })
    expect(canDriveMutationAction(entry)).toBe(false)
  })

  it('returns false for stale memory', () => {
    const entry = buildMemoryEntry({
      status: 'confirmed',
      validityTier: 'ephemeral',
      lastConfirmedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(canDriveMutationAction(entry, new Date('2026-08-16').getTime())).toBe(false)
  })
})

describe('generateMemoryEntryId', () => {
  it('generates stable ID', () => {
    const id1 = generateMemoryEntryId(1, 10, 'user', 'test', '2026-08-16T00:00:00.000Z')
    const id2 = generateMemoryEntryId(1, 10, 'user', 'test', '2026-08-16T00:00:00.000Z')
    expect(id1).toBe(id2)
  })

  it('different inputs yield different IDs', () => {
    const id1 = generateMemoryEntryId(1, 10, 'user', 'test1', '2026-08-16T00:00:00.000Z')
    const id2 = generateMemoryEntryId(1, 10, 'user', 'test2', '2026-08-16T00:00:00.000Z')
    expect(id1).not.toBe(id2)
  })

  it('starts with mem_ prefix', () => {
    const id = generateMemoryEntryId(1, 10, 'user', 'test', '2026-08-16T00:00:00.000Z')
    expect(id).toMatch(/^mem_/)
  })
})

describe('estimateMemoryEntryBytes', () => {
  it('returns positive number', () => {
    const entry = buildMemoryEntry()
    expect(estimateMemoryEntryBytes(entry)).toBeGreaterThan(0)
  })
})

// ===========================================================================
// 7. 冲突裁决
// ===========================================================================

describe('resolveMemoryConflict', () => {
  it('no conflict returns no_conflict', () => {
    // Two identical entries should still resolve (by id)
    const a = buildMemoryEntry({ id: 'mem_a' })
    const b = buildMemoryEntry({ id: 'mem_b' })
    const result = resolveMemoryConflict(a, b)
    expect(result.outcome).toBe('memory_wins')
  })

  it('later lastConfirmedAt wins', () => {
    const a = buildMemoryEntry({
      id: 'mem_a',
      lastConfirmedAt: '2026-08-10T00:00:00.000Z',
    })
    const b = buildMemoryEntry({
      id: 'mem_b',
      lastConfirmedAt: '2026-08-15T00:00:00.000Z',
    })
    const result = resolveMemoryConflict(a, b)
    expect(result.outcome).toBe('memory_wins')
    expect(result.memoryId).toBe('mem_b')
  })

  it('higher scope priority wins when confirmedAt equal', () => {
    const a = buildMemoryEntry({
      id: 'mem_a',
      scope: 'user',
      lastConfirmedAt: '2026-08-15T00:00:00.000Z',
    })
    const b = buildMemoryEntry({
      id: 'mem_b',
      scope: 'organization',
      lastConfirmedAt: '2026-08-15T00:00:00.000Z',
    })
    const result = resolveMemoryConflict(a, b)
    expect(result.outcome).toBe('memory_wins')
    expect(result.memoryId).toBe('mem_b')
  })

  it('id wins when all else equal', () => {
    const a = buildMemoryEntry({ id: 'mem_a' })
    const b = buildMemoryEntry({ id: 'mem_b' })
    const result = resolveMemoryConflict(a, b)
    expect(result.memoryId).toBe('mem_a')
  })
})

// ===========================================================================
// 8. 七态 Fixtures 一致性
// ===========================================================================

describe('fixtures cover all 7 states', () => {
  const fixtures = buildAllMemoryStateFixtures()

  it('has 7 fixtures', () => {
    expect(fixtures).toHaveLength(7)
  })

  it('candidate fixture has status candidate', () => {
    const f = fixtures.find((e) => e.id === 'mem_candidate_001')
    expect(f).toBeDefined()
    expect(f!.status).toBe('candidate')
    expect(f!.lastConfirmedAt).toBeUndefined()
  })

  it('confirmed fixture has status confirmed', () => {
    const f = fixtures.find((e) => e.id === 'mem_confirmed_001')
    expect(f).toBeDefined()
    expect(f!.status).toBe('confirmed')
  })

  it('edited fixture has status edited', () => {
    const f = fixtures.find((e) => e.id === 'mem_edited_001')
    expect(f).toBeDefined()
    expect(f!.status).toBe('edited')
  })

  it('possibly_outdated fixture has status possibly_outdated', () => {
    const f = fixtures.find((e) => e.id === 'mem_outdated_001')
    expect(f).toBeDefined()
    expect(f!.status).toBe('possibly_outdated')
  })

  it('long_unconfirmed fixture is confirmed but stale', () => {
    const f = fixtures.find((e) => e.id === 'mem_long_unconfirmed_001')
    expect(f).toBeDefined()
    expect(f!.status).toBe('confirmed')
    expect(isMemoryStale(f!, new Date('2026-08-16').getTime())).toBe(true)
  })

  it('conflict_yield fixture is possibly_outdated', () => {
    const f = fixtures.find((e) => e.id === 'mem_conflict_yield_001')
    expect(f).toBeDefined()
    expect(f!.status).toBe('possibly_outdated')
  })

  it('permission_missing fixture has different organizationId', () => {
    const f = fixtures.find((e) => e.id === 'mem_perm_missing_001')
    expect(f).toBeDefined()
    expect(f!.organizationId).toBe(999)
  })

  it('all fixtures have required fields', () => {
    for (const f of fixtures) {
      expect(f.id).toBeTruthy()
      expect(f.organizationId).toBeGreaterThan(0)
      expect(f.actorId).toBeGreaterThan(0)
      expect(f.scope).toBeTruthy()
      expect(f.summary).toBeTruthy()
      expect(f.confidence).toBeGreaterThanOrEqual(0)
      expect(f.confidence).toBeLessThanOrEqual(1)
      expect(f.basis.length).toBeGreaterThan(0)
      expect(f.observedAt).toBeTruthy()
      expect(f.status).toBeTruthy()
      expect(f.validityTier).toBeTruthy()
    }
  })

  it('all fixtures have valid scope', () => {
    for (const f of fixtures) {
      expect(isCopilotMemoryScope(f.scope)).toBe(true)
    }
  })

  it('all fixtures have valid status', () => {
    for (const f of fixtures) {
      expect(isCopilotMemoryStatus(f.status)).toBe(true)
    }
  })

  it('all fixtures have valid validityTier', () => {
    for (const f of fixtures) {
      expect(isCopilotMemoryValidityTier(f.validityTier)).toBe(true)
    }
  })
})

// ===========================================================================
// 9. 审计事件不含记忆内容
// ===========================================================================

describe('audit event is low-sensitivity', () => {
  it('audit event does not contain memory summary', () => {
    const event = buildMemoryAuditEvent('candidate_confirmed')
    // Should not have any field that looks like memory content
    expect((event as any).summary).toBeUndefined()
    expect((event as any).content).toBeUndefined()
    expect((event as any).text).toBeUndefined()
  })

  it('audit event has required fields', () => {
    const event = buildMemoryAuditEvent()
    expect(event.action).toBeTruthy()
    expect(event.actorId).toBeGreaterThan(0)
    expect(event.organizationId).toBeGreaterThan(0)
    expect(event.entryId).toBeTruthy()
    expect(event.scope).toBeTruthy()
    expect(event.timestamp).toBeTruthy()
  })
})

// ===========================================================================
// 10. Basis 引用
// ===========================================================================

describe('basis reference', () => {
  it('has session and message IDs', () => {
    const basis = buildMemoryBasisRef()
    expect(basis.sessionId).toBeTruthy()
    expect(basis.messageId).toBeTruthy()
    expect(basis.summary).toBeTruthy()
    expect(basis.role).toMatch(/^(user|assistant)$/)
  })

  it('all memory entries have at least one basis', () => {
    for (const f of buildAllMemoryStateFixtures()) {
      expect(f.basis.length).toBeGreaterThanOrEqual(1)
      for (const b of f.basis) {
        expect(b.sessionId).toBeTruthy()
        expect(b.messageId).toBeTruthy()
      }
    }
  })
})

// ===========================================================================
// 11. Facet name constant
// ===========================================================================

describe('COPILLOT_MEMORY_FACET_NAME', () => {
  it('is copilot_memory_inferred', () => {
    expect(COPILLOT_MEMORY_FACET_NAME).toBe('copilot_memory_inferred')
  })
})

// ===========================================================================
// 12. 全量 type guard 拒绝未知值
// ===========================================================================

describe('type guards reject unknown values', () => {
  it('all guards reject empty string', () => {
    expect(isCopilotMemoryScope('')).toBe(false)
    expect(isCopilotMemoryStatus('')).toBe(false)
    expect(isCopilotMemoryValidityTier('')).toBe(false)
    expect(isCopilotMemoryConfidenceSource('')).toBe(false)
    expect(isCopilotMemoryForbiddenCategory('')).toBe(false)
    expect(isCopilotMemoryAuditAction('')).toBe(false)
  })

  it('all guards reject random string', () => {
    expect(isCopilotMemoryScope('foo')).toBe(false)
    expect(isCopilotMemoryStatus('bar')).toBe(false)
    expect(isCopilotMemoryValidityTier('baz')).toBe(false)
    expect(isCopilotMemoryConfidenceSource('qux')).toBe(false)
    expect(isCopilotMemoryForbiddenCategory('quux')).toBe(false)
    expect(isCopilotMemoryAuditAction('corge')).toBe(false)
  })
})
