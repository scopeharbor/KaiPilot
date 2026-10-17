/**
 * v3-knowledge-memory-operating-layer —— 共享契约测试。
 *
 * 覆盖：封闭枚举 / fail-closed / tagged union / attention 派生 / sort tuple /
 * 多 lane merge / 分页 / URL state / surface / 低敏扫描 / 2500 对象 fixture。
 *
 * 设计纪律：vitest 风格 describe/it/expect 与既有 packages/types 测试一致。
 */

import { describe, expect, it } from 'vitest'

import {
  KNOWLEDGE_MEMORY_OPERATING_AUTHORITY_OWNERS,
  KNOWLEDGE_MEMORY_OPERATING_KINDS,
  KNOWLEDGE_MEMORY_OPERATING_PRIORITIES,
  KNOWLEDGE_MEMORY_OPERATING_SCOPES,
  KNOWLEDGE_MEMORY_OPERATING_SURFACE_DISABLE_REASONS,
  KNOWLEDGE_MEMORY_OPERATING_SURFACES,
  KNOWLEDGE_MEMORY_OPERATING_VISIBILITIES,
  OPERATING_LIST_DEFAULT_PER_PAGE,
  OPERATING_LIST_MAX_PAGE,
  OPERATING_LIST_MAX_PER_PAGE,
  OPERATING_URL_QUERY_KEYS,
  applyOperatingListFilter,
  authorityOwnerForSurface,
  buildOperatingListEnvelope,
  buildOwningSurfaceDescriptor,
  computeOperatingSortKey,
  compareOperatingSortKeys,
  computeSurfaceEnabled,
  defaultSurfaceForKind,
  deriveCopilotMemoryAttention,
  deriveKnowledgeItemAttention,
  deriveRetrievalSignalAttention,
  deriveSkillKnowledgeDraftAttention,
  isKnowledgeMemoryOperatingKind,
  isKnowledgeMemoryOperatingScope,
  isKnowledgeMemoryOperatingStatus,
  isKnowledgeMemoryOperatingSurface,
  isKnowledgeMemoryOperatingVisibility,
  isKnowledgeMemoryScopedRef,
  isOperatingPageInBounds,
  isValidScopedRefRef,
  makeScopedRef,
  parseOperatingUrlState,
  priorityForStatus,
  scanOperatingLowSensitive,
  serializeOperatingUrlState,
  sortOperatingItems,
} from './knowledge-memory-operating-layer.js'
import {
  buildCopilotMemoryFixture,
  buildKnowledgeItemFixture,
  buildOperatingBaitSuite,
  buildOperatingFixtureSuite,
  buildOwningSurfaceFixtures,
  buildRetrievalSignalFixture,
  buildSkillKnowledgeDraftFixture,
  kindLabel,
} from './knowledge-memory-operating-layer-fixtures.js'

// ── 1. 封闭词表与 fail-closed ──────────────────────────────────────

describe('closed vocabularies', () => {
  it('kinds 封闭 4 kind', () => {
    expect(new Set(KNOWLEDGE_MEMORY_OPERATING_KINDS)).toEqual(
      new Set(['knowledge_item', 'copilot_memory', 'skill_knowledge_draft', 'retrieval_signal']),
    )
  })
  it('surfaces 封闭 4 surface', () => {
    expect(new Set(KNOWLEDGE_MEMORY_OPERATING_SURFACES)).toEqual(
      new Set([
        'knowledge_review',
        'copilot_memory_governance',
        'skill_knowledge_authoring',
        'retrieval_observation_detail',
      ]),
    )
  })
  it('authority owners 与 surface 1-1 映射', () => {
    expect(new Set(KNOWLEDGE_MEMORY_OPERATING_AUTHORITY_OWNERS).size).toBe(4)
  })
  it('priorities 4 档互不替代', () => {
    expect(new Set(KNOWLEDGE_MEMORY_OPERATING_PRIORITIES).size).toBe(4)
  })
  it('scopes 5 档', () => {
    expect(new Set(KNOWLEDGE_MEMORY_OPERATING_SCOPES).size).toBe(5)
  })
  it('visibilities 4 档', () => {
    expect(new Set(KNOWLEDGE_MEMORY_OPERATING_VISIBILITIES).size).toBe(4)
  })
  it('disable reasons 9 档', () => {
    expect(new Set(KNOWLEDGE_MEMORY_OPERATING_SURFACE_DISABLE_REASONS).size).toBe(9)
  })
})

describe('isXxx validators', () => {
  it('kind 未知值返回 false', () => {
    expect(isKnowledgeMemoryOperatingKind('project_event')).toBe(false)
    expect(isKnowledgeMemoryOperatingKind('knowledge')).toBe(false)
  })
  it('scope 未知值返回 false', () => {
    expect(isKnowledgeMemoryOperatingScope('tenant')).toBe(false)
  })
  it('status 未知值返回 false', () => {
    expect(isKnowledgeMemoryOperatingStatus('expired')).toBe(false)
  })
  it('surface 未知值返回 false', () => {
    expect(isKnowledgeMemoryOperatingSurface('plugin_explorer')).toBe(false)
  })
  it('visibility 未知值返回 false', () => {
    expect(isKnowledgeMemoryOperatingVisibility('redacted')).toBe(false)
  })
})

// ── 2. ScopedRef / opaque ───────────────────────────────────────────

describe('scoped ref', () => {
  it('合法 ref 通过 validator', () => {
    expect(isValidScopedRefRef('k-1234')).toBe(true)
    expect(isValidScopedRefRef('m_abcd.efg-0')).toBe(true)
  })
  it('非法字符拒绝', () => {
    expect(isValidScopedRefRef('k 1234')).toBe(false)
    expect(isValidScopedRefRef('k/1234')).toBe(false)
    expect(isValidScopedRefRef('../etc/passwd')).toBe(false)
  })
  it('过长 ref 拒绝', () => {
    expect(isValidScopedRefRef('a'.repeat(129))).toBe(false)
  })
  it('makeScopedRef 拒绝非法 ref', () => {
    expect(() => makeScopedRef('knowledge_item', 'a b')).toThrow()
  })
  it('isKnowledgeMemoryScopedRef 拒绝非对象', () => {
    expect(isKnowledgeMemoryScopedRef(null)).toBe(false)
    expect(isKnowledgeMemoryScopedRef('k-1')).toBe(false)
    expect(isKnowledgeMemoryScopedRef({ kind: 'knowledge_item' })).toBe(false)
    expect(isKnowledgeMemoryScopedRef({ kind: 'unknown', ref: 'a' })).toBe(false)
  })
  it('isKnowledgeMemoryScopedRef 接受合法对象', () => {
    expect(isKnowledgeMemoryScopedRef({ kind: 'knowledge_item', ref: 'k-1' })).toBe(true)
  })
})

// ── 3. Attention 派生纯函数 ─────────────────────────────────────────

describe('derive knowledge_item attention', () => {
  it('L3 → synthetic_eval_only 优先于 lifecycle', () => {
    expect(
      deriveKnowledgeItemAttention({
        layer: 'L3',
        lifecycle: 'active',
        hasProvenance: true,
        isL3EvalOnly: true,
      }),
    ).toBe('synthetic_eval_only')
  })
  it('pending/draft → needs_review', () => {
    expect(
      deriveKnowledgeItemAttention({
        layer: 'L1',
        lifecycle: 'pending',
        hasProvenance: true,
        isL3EvalOnly: false,
      }),
    ).toBe('needs_review')
  })
  it('outdated → stale_or_unconfirmed', () => {
    expect(
      deriveKnowledgeItemAttention({
        layer: 'L2',
        lifecycle: 'outdated',
        hasProvenance: true,
        isL3EvalOnly: false,
      }),
    ).toBe('stale_or_unconfirmed')
  })
  it('无 provenance → provenance_gap', () => {
    expect(
      deriveKnowledgeItemAttention({
        layer: 'L1',
        lifecycle: 'active',
        hasProvenance: false,
        isL3EvalOnly: false,
      }),
    ).toBe('provenance_gap')
  })
  it('active + 有 provenance → ready', () => {
    expect(
      deriveKnowledgeItemAttention({
        layer: 'L4',
        lifecycle: 'active',
        hasProvenance: true,
        isL3EvalOnly: false,
      }),
    ).toBe('ready')
  })
})

describe('derive copilot_memory attention (恒 inference)', () => {
  it('invalidated → stale_or_unconfirmed', () => {
    expect(
      deriveCopilotMemoryAttention({
        statusDetail: 'invalidated',
        hasLiveFactConflict: false,
        longUnconfirmed: false,
      }),
    ).toBe('stale_or_unconfirmed')
  })
  it('live fact conflict 优先 → conflict', () => {
    expect(
      deriveCopilotMemoryAttention({
        statusDetail: 'confirmed',
        hasLiveFactConflict: true,
        longUnconfirmed: false,
      }),
    ).toBe('conflict')
  })
  it('candidate → needs_review', () => {
    expect(
      deriveCopilotMemoryAttention({
        statusDetail: 'candidate',
        hasLiveFactConflict: false,
        longUnconfirmed: false,
      }),
    ).toBe('needs_review')
  })
  it('long_unconfirmed → stale_or_unconfirmed', () => {
    expect(
      deriveCopilotMemoryAttention({
        statusDetail: 'edited',
        hasLiveFactConflict: false,
        longUnconfirmed: true,
      }),
    ).toBe('stale_or_unconfirmed')
  })
  it('确认 + 无冲突 + 不 long → ready', () => {
    expect(
      deriveCopilotMemoryAttention({
        statusDetail: 'confirmed',
        hasLiveFactConflict: false,
        longUnconfirmed: false,
      }),
    ).toBe('ready')
  })
})

describe('derive skill draft attention', () => {
  it('discarded → stale_or_unconfirmed', () => {
    expect(
      deriveSkillKnowledgeDraftAttention({
        draftStatus: 'discarded',
        baseStale: false,
        pluginDisabled: false,
      }),
    ).toBe('stale_or_unconfirmed')
  })
  it('baseStale → stale_or_unconfirmed', () => {
    expect(
      deriveSkillKnowledgeDraftAttention({
        draftStatus: 'pending',
        baseStale: true,
        pluginDisabled: false,
      }),
    ).toBe('stale_or_unconfirmed')
  })
  it('pending + plugin disabled → provenance_gap', () => {
    expect(
      deriveSkillKnowledgeDraftAttention({
        draftStatus: 'pending',
        baseStale: false,
        pluginDisabled: true,
      }),
    ).toBe('provenance_gap')
  })
  it('pending + 健康 → needs_review', () => {
    expect(
      deriveSkillKnowledgeDraftAttention({
        draftStatus: 'pending',
        baseStale: false,
        pluginDisabled: false,
      }),
    ).toBe('needs_review')
  })
  it('committed + 健康 → ready', () => {
    expect(
      deriveSkillKnowledgeDraftAttention({
        draftStatus: 'committed',
        baseStale: false,
        pluginDisabled: false,
      }),
    ).toBe('ready')
  })
})

describe('derive retrieval signal attention', () => {
  it('degraded → degraded', () => {
    expect(
      deriveRetrievalSignalAttention({
        degraded: true,
        noObservation: false,
        zeroResultRate: 0,
        truncated: false,
        uncertaintyHigh: false,
        permissionExcludedCount: 0,
      }),
    ).toBe('degraded')
  })
  it('noObservation → retrieval_gap', () => {
    expect(
      deriveRetrievalSignalAttention({
        degraded: false,
        noObservation: true,
        zeroResultRate: 0,
        truncated: false,
        uncertaintyHigh: false,
        permissionExcludedCount: 0,
      }),
    ).toBe('retrieval_gap')
  })
  it('zeroResultRate >= 0.5 → retrieval_gap', () => {
    expect(
      deriveRetrievalSignalAttention({
        degraded: false,
        noObservation: false,
        zeroResultRate: 0.6,
        truncated: false,
        uncertaintyHigh: false,
        permissionExcludedCount: 0,
      }),
    ).toBe('retrieval_gap')
  })
  it('uncertaintyHigh → retrieval_gap', () => {
    expect(
      deriveRetrievalSignalAttention({
        degraded: false,
        noObservation: false,
        zeroResultRate: 0.1,
        truncated: false,
        uncertaintyHigh: true,
        permissionExcludedCount: 0,
      }),
    ).toBe('retrieval_gap')
  })
  it('permission + truncated → retrieval_gap', () => {
    expect(
      deriveRetrievalSignalAttention({
        degraded: false,
        noObservation: false,
        zeroResultRate: 0,
        truncated: true,
        uncertaintyHigh: false,
        permissionExcludedCount: 1,
      }),
    ).toBe('retrieval_gap')
  })
  it('健康 → ready', () => {
    expect(
      deriveRetrievalSignalAttention({
        degraded: false,
        noObservation: false,
        zeroResultRate: 0.1,
        truncated: false,
        uncertaintyHigh: false,
        permissionExcludedCount: 0,
      }),
    ).toBe('ready')
  })
})

describe('priorityForStatus 互不替代', () => {
  it('conflict / synthetic_eval_only / degraded → p0', () => {
    expect(priorityForStatus('conflict')).toBe('p0')
    expect(priorityForStatus('synthetic_eval_only')).toBe('p0')
    expect(priorityForStatus('degraded')).toBe('p0')
  })
  it('needs_review / stale_or_unconfirmed → p1', () => {
    expect(priorityForStatus('needs_review')).toBe('p1')
    expect(priorityForStatus('stale_or_unconfirmed')).toBe('p1')
  })
  it('provenance_gap / retention_attention / retrieval_gap → p2', () => {
    expect(priorityForStatus('provenance_gap')).toBe('p2')
    expect(priorityForStatus('retention_attention')).toBe('p2')
    expect(priorityForStatus('retrieval_gap')).toBe('p2')
  })
  it('ready → p3', () => {
    expect(priorityForStatus('ready')).toBe('p3')
  })
})

// ── 4. Sort tuple & k-way merge ────────────────────────────────────

describe('computeOperatingSortKey + compareOperatingSortKeys', () => {
  it('priorityRank 越小越靠前', () => {
    const a = computeOperatingSortKey({
      kind: 'knowledge_item',
      scopedRef: makeScopedRef('knowledge_item', 'k-a'),
      scope: 'organization',
      visibility: 'visible',
      status: 'conflict',
      priority: 'p0',
      freshnessState: 'fresh',
      title: 'a',
      layer: 'L1',
      lifecycle: 'active',
      provenance: [],
      reviewCount: 0,
      attentionBasis: { reasonCode: 'r', basisRefs: [] },
      safeLabels: [],
      updatedAt: '2026-08-25T00:00:00.000Z',
    })
    const b = computeOperatingSortKey({
      kind: 'knowledge_item',
      scopedRef: makeScopedRef('knowledge_item', 'k-b'),
      scope: 'organization',
      visibility: 'visible',
      status: 'ready',
      priority: 'p3',
      freshnessState: 'fresh',
      title: 'b',
      layer: 'L1',
      lifecycle: 'active',
      provenance: [],
      reviewCount: 0,
      attentionBasis: { reasonCode: 'r', basisRefs: [] },
      safeLabels: [],
      updatedAt: '2026-08-25T00:00:00.000Z',
    })
    expect(compareOperatingSortKeys(a, b)).toBeLessThan(0)
  })
  it('同 priority 看 attentionAt DESC', () => {
    const a = computeOperatingSortKey({
      kind: 'knowledge_item',
      scopedRef: makeScopedRef('knowledge_item', 'k-a'),
      scope: 'organization',
      visibility: 'visible',
      status: 'needs_review',
      priority: 'p1',
      freshnessState: 'fresh',
      title: 'a',
      layer: 'L1',
      lifecycle: 'pending',
      provenance: [],
      reviewCount: 0,
      attentionBasis: { reasonCode: 'r', basisRefs: [] },
      safeLabels: [],
      updatedAt: '2026-08-25T00:00:00.000Z',
    })
    const b = computeOperatingSortKey({
      kind: 'knowledge_item',
      scopedRef: makeScopedRef('knowledge_item', 'k-b'),
      scope: 'organization',
      visibility: 'visible',
      status: 'needs_review',
      priority: 'p1',
      freshnessState: 'fresh',
      title: 'b',
      layer: 'L1',
      lifecycle: 'pending',
      provenance: [],
      reviewCount: 0,
      attentionBasis: { reasonCode: 'r', basisRefs: [] },
      safeLabels: [],
      updatedAt: '2025-01-01T00:00:00.000Z',
    })
    expect(compareOperatingSortKeys(a, b)).toBeLessThan(0)
  })
  it('同 priority + 同 attentionAt 看 kind ASC', () => {
    const a = computeOperatingSortKey({
      kind: 'knowledge_item',
      scopedRef: makeScopedRef('knowledge_item', 'k-a'),
      scope: 'organization',
      visibility: 'visible',
      status: 'needs_review',
      priority: 'p1',
      freshnessState: 'fresh',
      title: 'a',
      layer: 'L1',
      lifecycle: 'pending',
      provenance: [],
      reviewCount: 0,
      attentionBasis: { reasonCode: 'r', basisRefs: [] },
      safeLabels: [],
      updatedAt: '2026-08-25T00:00:00.000Z',
    })
    const b = computeOperatingSortKey({
      kind: 'retrieval_signal',
      scopedRef: makeScopedRef('retrieval_signal', 'r-b'),
      scope: 'organization',
      visibility: 'visible',
      status: 'needs_review',
      priority: 'p1',
      freshnessState: 'fresh',
      retrievalKind: 'knowledge',
      queryCategory: 'definition',
      windowStart: '2026-08-24T00:00:00.000Z',
      windowEnd: '2026-08-25T00:00:00.000Z',
      sampleCount: 10,
      zeroResultRate: 0.1,
      degraded: false,
      truncated: false,
      permissionExcludedCount: 0,
      attentionBasis: { reasonCode: 'r', basisRefs: [] },
      safeLabels: [],
      updatedAt: '2026-08-25T00:00:00.000Z',
    })
    expect(compareOperatingSortKeys(a, b)).toBeLessThan(0)
  })
  it('完全相同 → 0', () => {
    const a = computeOperatingSortKey({
      kind: 'knowledge_item',
      scopedRef: makeScopedRef('knowledge_item', 'k-a'),
      scope: 'organization',
      visibility: 'visible',
      status: 'needs_review',
      priority: 'p1',
      freshnessState: 'fresh',
      title: 'a',
      layer: 'L1',
      lifecycle: 'pending',
      provenance: [],
      reviewCount: 0,
      attentionBasis: { reasonCode: 'r', basisRefs: [] },
      safeLabels: [],
      updatedAt: '2026-08-25T00:00:00.000Z',
    })
    const b = computeOperatingSortKey({
      kind: 'knowledge_item',
      scopedRef: makeScopedRef('knowledge_item', 'k-a'),
      scope: 'organization',
      visibility: 'visible',
      status: 'needs_review',
      priority: 'p1',
      freshnessState: 'fresh',
      title: 'a',
      layer: 'L1',
      lifecycle: 'pending',
      provenance: [],
      reviewCount: 0,
      attentionBasis: { reasonCode: 'r', basisRefs: [] },
      safeLabels: [],
      updatedAt: '2026-08-25T00:00:00.000Z',
    })
    expect(compareOperatingSortKeys(a, b)).toBe(0)
  })
})

// ── 5. Page bounds & filter allowlist ──────────────────────────────

describe('isOperatingPageInBounds', () => {
  it('合法 page/perPage', () => {
    expect(isOperatingPageInBounds(1, 20)).toBe(true)
    expect(isOperatingPageInBounds(OPERATING_LIST_MAX_PAGE, OPERATING_LIST_MAX_PER_PAGE)).toBe(true)
  })
  it('负数 / 0 / 非整数拒绝', () => {
    expect(isOperatingPageInBounds(0, 20)).toBe(false)
    expect(isOperatingPageInBounds(-1, 20)).toBe(false)
    expect(isOperatingPageInBounds(1.5, 20)).toBe(false)
    expect(isOperatingPageInBounds(1, 0)).toBe(false)
  })
  it('越界 page/perPage 拒绝', () => {
    expect(isOperatingPageInBounds(OPERATING_LIST_MAX_PAGE + 1, 20)).toBe(false)
    expect(isOperatingPageInBounds(1, OPERATING_LIST_MAX_PER_PAGE + 1)).toBe(false)
  })
  it('default perPage 与 max 边界', () => {
    expect(OPERATING_LIST_DEFAULT_PER_PAGE).toBe(20)
    expect(OPERATING_LIST_MAX_PER_PAGE).toBe(100)
  })
})

describe('applyOperatingListFilter', () => {
  const suite = buildOperatingFixtureSuite()
  it('空 filter 接受所有（filter 不做 page 截断，由 envelope 负责）', () => {
    const out = applyOperatingListFilter(suite.all, { page: 1, perPage: 5 })
    expect(out.length).toBe(suite.all.length)
  })
  it('kinds 过滤', () => {
    const out = applyOperatingListFilter(suite.all, {
      kinds: ['knowledge_item'],
      page: 1,
      perPage: 100,
    })
    expect(out.every((it) => it.kind === 'knowledge_item')).toBe(true)
  })
  it('statuses 过滤', () => {
    const out = applyOperatingListFilter(suite.all, {
      statuses: ['conflict'],
      page: 1,
      perPage: 100,
    })
    expect(out.every((it) => it.status === 'conflict')).toBe(true)
  })
  it('label keywords 过滤', () => {
    const out = applyOperatingListFilter(suite.all, {
      labelKeywords: ['inference'],
      page: 1,
      perPage: 100,
    })
    expect(out.every((it) => it.safeLabels.includes('inference'))).toBe(true)
  })
  it('page 越界返回 []', () => {
    const out = applyOperatingListFilter(suite.all, {
      page: OPERATING_LIST_MAX_PAGE + 1,
      perPage: 20,
    })
    expect(out).toEqual([])
  })
})

// ── 6. buildOperatingListEnvelope ─────────────────────────────────

describe('buildOperatingListEnvelope', () => {
  const suite = buildOperatingFixtureSuite()
  it('同输入 → 同输出（确定性）', () => {
    const a = buildOperatingListEnvelope(
      {
        knowledge_item: suite.knowledge,
        copilot_memory: suite.memory,
        skill_knowledge_draft: suite.skillDrafts,
        retrieval_signal: suite.retrievalSignals,
      },
      { page: 1, perPage: 20 },
    )
    const b = buildOperatingListEnvelope(
      {
        knowledge_item: suite.knowledge,
        copilot_memory: suite.memory,
        skill_knowledge_draft: suite.skillDrafts,
        retrieval_signal: suite.retrievalSignals,
      },
      { page: 1, perPage: 20 },
    )
    expect(a.data.map((it) => it.scopedRef.ref)).toEqual(b.data.map((it) => it.scopedRef.ref))
  })
  it('相邻页无重复遗漏', () => {
    const lanes = {
      knowledge_item: suite.knowledge,
      copilot_memory: suite.memory,
      skill_knowledge_draft: suite.skillDrafts,
      retrieval_signal: suite.retrievalSignals,
    } as const
    const p1 = buildOperatingListEnvelope(lanes, { page: 1, perPage: 50 })
    const p2 = buildOperatingListEnvelope(lanes, { page: 2, perPage: 50 })
    const ids1 = new Set(p1.data.map((it) => it.scopedRef.ref))
    const ids2 = new Set(p2.data.map((it) => it.scopedRef.ref))
    for (const id of ids2) expect(ids1.has(id)).toBe(false)
    expect(p1.meta.total).toBe(suite.all.length)
    expect(p1.meta.totalPages).toBe(Math.ceil(suite.all.length / 50))
  })
  it('degradedLanes 显式返回', () => {
    const env = buildOperatingListEnvelope(
      {
        knowledge_item: suite.knowledge,
        copilot_memory: [],
        skill_knowledge_draft: [],
        retrieval_signal: [],
      },
      { page: 1, perPage: 20 },
      ['copilot_memory', 'skill_knowledge_draft'],
    )
    expect(env.meta.degradedLanes).toEqual(['copilot_memory', 'skill_knowledge_draft'])
  })
  it('非法 page → empty envelope 但 deterministic 仍为 true', () => {
    const env = buildOperatingListEnvelope(
      {
        knowledge_item: suite.knowledge,
        copilot_memory: [],
        skill_knowledge_draft: [],
        retrieval_signal: [],
      },
      { page: 0, perPage: 20 },
    )
    expect(env.data).toEqual([])
    expect(env.meta.deterministic).toBe(true)
  })
})

// ── 7. URL state parse/serialize ──────────────────────────────────

describe('URL state parse/serialize', () => {
  it('serialize 包含 view=operations', () => {
    const out = serializeOperatingUrlState({ view: 'operations' })
    expect(out.get('view')).toBe('operations')
  })
  it('round-trip 合法值', () => {
    const params = serializeOperatingUrlState({
      view: 'operations',
      attention: 'needs_review',
      kind: 'knowledge_item',
      sort: 'attentionPriority',
      order: 'desc',
      page: 2,
      perPage: 50,
      selected: makeScopedRef('knowledge_item', 'k-1'),
      surface: 'knowledge_review',
    })
    const parsed = parseOperatingUrlState(params)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.attention).toBe('needs_review')
      expect(parsed.value.kind).toBe('knowledge_item')
      expect(parsed.value.sort).toBe('attentionPriority')
      expect(parsed.value.page).toBe(2)
      expect(parsed.value.perPage).toBe(50)
      expect(parsed.value.selected?.ref).toBe('k-1')
    }
  })
  it('未知 view 拒绝', () => {
    const params = new URLSearchParams('view=legacy')
    const out = parseOperatingUrlState(params)
    expect(out.ok).toBe(false)
  })
  it('未知字段拒绝', () => {
    const params = new URLSearchParams('view=operations&evil=1')
    const out = parseOperatingUrlState(params)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('unknown_query_key:evil')
  })
  it('非法 kind 拒绝', () => {
    const params = new URLSearchParams('view=operations&kind=project_event')
    const out = parseOperatingUrlState(params)
    expect(out.ok).toBe(false)
  })
  it('过长 ref 拒绝', () => {
    const params = new URLSearchParams(`view=operations&selected=knowledge_item:${'a'.repeat(200)}`)
    const out = parseOperatingUrlState(params)
    expect(out.ok).toBe(false)
  })
  it('page/perPage 越界拒绝', () => {
    const params = new URLSearchParams(`view=operations&page=${OPERATING_LIST_MAX_PAGE + 1}`)
    const out = parseOperatingUrlState(params)
    expect(out.ok).toBe(false)
  })
  it('query keys 封闭集合', () => {
    expect(new Set(OPERATING_URL_QUERY_KEYS).size).toBe(11)
  })
})

// ── 8. Owning surface / defaultSurfaceForKind / authorityOwnerForSurface ──

describe('surface & authority mapping', () => {
  it('kind → default surface 一一对应', () => {
    expect(defaultSurfaceForKind('knowledge_item')).toBe('knowledge_review')
    expect(defaultSurfaceForKind('copilot_memory')).toBe('copilot_memory_governance')
    expect(defaultSurfaceForKind('skill_knowledge_draft')).toBe('skill_knowledge_authoring')
    expect(defaultSurfaceForKind('retrieval_signal')).toBe('retrieval_observation_detail')
  })
  it('surface → authority owner 一一对应', () => {
    expect(authorityOwnerForSurface('knowledge_review')).toBe('knowledge_service')
    expect(authorityOwnerForSurface('copilot_memory_governance')).toBe('copilot_memory_service')
    expect(authorityOwnerForSurface('skill_knowledge_authoring')).toBe(
      'skill_knowledge_authoring_service',
    )
    expect(authorityOwnerForSurface('retrieval_observation_detail')).toBe(
      'copilot_context_observation_service',
    )
  })
  it('computeSurfaceEnabled plugin_uninstalled 优先', () => {
    expect(
      computeSurfaceEnabled({
        surface: 'knowledge_review',
        pluginDisabled: false,
        pluginUninstalled: true,
        baseStale: false,
        layer: 'L1',
        isMemoryScope: false,
      }),
    ).toEqual({ enabled: false, disableReason: 'plugin_uninstalled' })
  })
  it('computeSurfaceEnabled L3 → eval_only', () => {
    expect(
      computeSurfaceEnabled({
        surface: 'knowledge_review',
        pluginDisabled: false,
        pluginUninstalled: false,
        baseStale: false,
        layer: 'L3',
        isMemoryScope: false,
      }),
    ).toEqual({ enabled: false, disableReason: 'eval_only' })
  })
  it('computeSurfaceEnabled baseStale → stale_base_version', () => {
    expect(
      computeSurfaceEnabled({
        surface: 'knowledge_review',
        pluginDisabled: false,
        pluginUninstalled: false,
        baseStale: true,
        layer: 'L1',
        isMemoryScope: false,
      }),
    ).toEqual({ enabled: false, disableReason: 'stale_base_version' })
  })
  it('computeSurfaceEnabled 健康 → enabled', () => {
    expect(
      computeSurfaceEnabled({
        surface: 'knowledge_review',
        pluginDisabled: false,
        pluginUninstalled: false,
        baseStale: false,
        layer: 'L1',
        isMemoryScope: false,
      }),
    ).toEqual({ enabled: true })
  })
})

describe('buildOwningSurfaceDescriptor', () => {
  it('封装 scoped refs / authority / routeKey / safeReturnContext', () => {
    const d = buildOwningSurfaceDescriptor({
      surface: 'knowledge_review',
      scopedRef: makeScopedRef('knowledge_item', 'k-1'),
      enabled: true,
      routeKey: '/knowledge?layer=all&status=pending',
      safeReturnContext: '知识审查',
    })
    expect(d.surface).toBe('knowledge_review')
    expect(d.authorityOwner).toBe('knowledge_service')
    expect(d.scopedRefs).toEqual(['k-1'])
    expect(d.safeReturnContext).toBe('知识审查')
    expect(d.routeKey).toBe('/knowledge?layer=all&status=pending')
  })
  it('safeReturnContext 截断至 200 字符', () => {
    const d = buildOwningSurfaceDescriptor({
      surface: 'knowledge_review',
      scopedRef: makeScopedRef('knowledge_item', 'k-1'),
      enabled: true,
      routeKey: '/k',
      safeReturnContext: 'x'.repeat(500),
    })
    expect(d.safeReturnContext.length).toBe(200)
  })
  it('不带 callback / handle / token（只允许封字段）', () => {
    const d = buildOwningSurfaceDescriptor({
      surface: 'copilot_memory_governance',
      scopedRef: makeScopedRef('copilot_memory', 'm-1'),
      enabled: true,
      routeKey: '/copilot/memory',
      safeReturnContext: 'ctx',
    })
    const obj = d as unknown as Record<string, unknown>
    expect(obj.callback).toBeUndefined()
    expect(obj.handle).toBeUndefined()
    expect(obj.token).toBeUndefined()
    expect(obj.previewHandle).toBeUndefined()
    expect(obj.confirmHandle).toBeUndefined()
    expect(obj.href).toBeUndefined()
    expect(obj.body).toBeUndefined()
  })
})

// ── 9. Low-sensitive allowlist scan ─────────────────────────────────

describe('scanOperatingLowSensitive', () => {
  it('干净 DTO → safe', () => {
    const r = scanOperatingLowSensitive({ kind: 'knowledge_item', ref: 'k-1' })
    expect(r.safe).toBe(true)
    expect(r.hits).toEqual([])
  })
  it('命中 SAMPLE_SECRET_BODY → unsafe', () => {
    const r = scanOperatingLowSensitive({ note: 'SAMPLE_SECRET_BODY-injected' })
    expect(r.safe).toBe(false)
    expect(r.hits.length).toBeGreaterThan(0)
  })
  it('命中 Bearer SAMPLE-TOKEN → unsafe', () => {
    const r = scanOperatingLowSensitive({ auth: 'Bearer SAMPLE-TOKEN' })
    expect(r.safe).toBe(false)
  })
  it('命中绝对路径 → unsafe', () => {
    const r = scanOperatingLowSensitive({ path: 'C:\\SAMPLE\\ABSOLUTE\\PATH' })
    expect(r.safe).toBe(false)
  })
  it('命中 prompt 子串 → unsafe', () => {
    const r = scanOperatingLowSensitive({ body: 'SAMPLE_PROMPT_BODY' })
    expect(r.safe).toBe(false)
  })
  it('嵌套对象扫描', () => {
    const r = scanOperatingLowSensitive({
      layer: { nested: 'SAMPLE_RETRIEVAL_QUERY' },
    })
    expect(r.safe).toBe(false)
  })
  it('数组扫描', () => {
    const r = scanOperatingLowSensitive(['a', 'b', 'SAMPLE_TOOL_ARG'])
    expect(r.safe).toBe(false)
  })
})

// ── 10. Fixtures 2500 对象 + 诱饵 ──────────────────────────────────

describe('fixture suite', () => {
  it('默认 fixture 包含 1000+1000+500+100 (retrieval) = 2600 对象', () => {
    const suite = buildOperatingFixtureSuite()
    expect(suite.knowledge.length).toBe(1000)
    expect(suite.memory.length).toBe(1000)
    expect(suite.skillDrafts.length).toBe(500)
    expect(suite.retrievalSignals.length).toBe(100)
    expect(suite.all.length).toBe(2600)
  })
  it('crossTenantBait 跨租 hidden 注入', () => {
    const suite = buildOperatingFixtureSuite({ crossTenantBait: true })
    expect(suite.knowledge.length).toBe(2000)
    const crossTenant = suite.knowledge.filter((it) => it.visibility === 'hidden')
    expect(crossTenant.length).toBeGreaterThanOrEqual(1000)
  })
  it('sensitiveBait 注入 SAMPLE_SECRET_BODY', () => {
    const suite = buildOperatingFixtureSuite({ sensitiveBait: true })
    const hits = suite.all.filter((it) =>
      (it.attentionBasis.note ?? '').includes('SAMPLE_SECRET_BODY'),
    )
    expect(hits.length).toBeGreaterThan(0)
    const scan = scanOperatingLowSensitive(suite.all)
    expect(scan.safe).toBe(false)
  })
  it('hiddenBait 注入 hidden 对象', () => {
    const suite = buildOperatingFixtureSuite({ hiddenBait: true })
    const hidden = suite.all.filter((it) => it.visibility === 'hidden')
    expect(hidden.length).toBeGreaterThan(0)
  })
  it('buildOperatingBaitSuite 跨租/隐藏/empty/unavailable', () => {
    const bait = buildOperatingBaitSuite(1)
    expect(bait.hidden.length).toBe(5)
    expect(bait.empty.length).toBe(3)
    expect(bait.unavailable.length).toBe(3)
    expect(bait.crossTenantHidden.length).toBe(5)
    expect(bait.total).toBe(16)
  })
  it('fixture 内对象 status 与 priority 一致', () => {
    const suite = buildOperatingFixtureSuite()
    for (const it of suite.all) {
      expect(priorityForStatus(it.status)).toBe(it.priority)
    }
  })
  it('fixture 内 L3 知识项永为 synthetic_eval_only', () => {
    const suite = buildOperatingFixtureSuite()
    const l3 = suite.knowledge.filter((it) => it.layer === 'L3')
    expect(l3.length).toBeGreaterThan(0)
    for (const it of l3) {
      expect(it.status).toBe('synthetic_eval_only')
    }
  })
  it('fixture 内 memory 全部标 inference 标签', () => {
    const suite = buildOperatingFixtureSuite()
    for (const it of suite.memory) {
      expect(it.safeLabels).toContain('inference')
    }
  })
})

// ── 11. 排序稳定性：sortOperatingItems ─────────────────────────────

describe('sortOperatingItems', () => {
  const suite = buildOperatingFixtureSuite()
  it('同输入两次排序结果相同', () => {
    const a = sortOperatingItems(suite.all)
    const b = sortOperatingItems(suite.all)
    expect(a.map((it) => it.scopedRef.ref)).toEqual(b.map((it) => it.scopedRef.ref))
  })
  it('不会丢失任何对象', () => {
    const sorted = sortOperatingItems(suite.all)
    expect(sorted.length).toBe(suite.all.length)
    const ids = new Set(sorted.map((it) => it.scopedRef.ref))
    for (const it of suite.all) {
      expect(ids.has(it.scopedRef.ref)).toBe(true)
    }
  })
  it('p0 总在 p3 之前', () => {
    const sorted = sortOperatingItems(suite.all)
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]!
      const b = sorted[i + 1]!
      const ra = priorityForStatus(a.status)
      const rb = priorityForStatus(b.status)
      if (ra !== rb) {
        const order = { p0: 0, p1: 1, p2: 2, p3: 3 }
        expect(order[ra]).toBeLessThanOrEqual(order[rb])
      }
    }
  })
})

// ── 12. Owning surface fixture ─────────────────────────────────────

describe('owning surface fixture', () => {
  it('4 surface 全覆盖', () => {
    const f = buildOwningSurfaceFixtures()
    expect(f.length).toBe(4)
    expect(new Set(f.map((it) => it.surface)).size).toBe(4)
  })
})

// ── 13. 单 builder 域测试（取样） ──────────────────────────────────

describe('buildKnowledgeItemFixture 域', () => {
  it('第 0 个 → L1', () => {
    const f = buildKnowledgeItemFixture({ orgId: 1, index: 0 })
    expect(f.layer).toBe('L1')
  })
  it('L3 → synthetic_eval_only', () => {
    const f = buildKnowledgeItemFixture({ orgId: 1, index: 0, layer: 'L3' })
    expect(f.status).toBe('synthetic_eval_only')
    expect(f.safeLabels).toContain('SYNTHETIC')
    expect(f.safeLabels).toContain('eval-only')
  })
})

describe('buildCopilotMemoryFixture 域', () => {
  it('candidate → needs_review', () => {
    const f = buildCopilotMemoryFixture({ orgId: 1, index: 0, statusDetail: 'candidate' })
    expect(f.status).toBe('needs_review')
  })
  it('live_fact_conflict → conflict', () => {
    const f = buildCopilotMemoryFixture({
      orgId: 1,
      index: 0,
      statusDetail: 'confirmed',
      hasLiveFactConflict: true,
    })
    expect(f.status).toBe('conflict')
  })
})

describe('buildSkillKnowledgeDraftFixture 域', () => {
  it('baseStale → stale_or_unconfirmed', () => {
    const f = buildSkillKnowledgeDraftFixture({ orgId: 1, index: 0, baseStale: true })
    expect(f.status).toBe('stale_or_unconfirmed')
  })
  it('plugin provenance 出现', () => {
    const f = buildSkillKnowledgeDraftFixture({ orgId: 1, index: 0 })
    if (f.pluginProvenance.kind === 'plugin') {
      expect(typeof f.pluginProvenance.pluginId).toBe('string')
    }
  })
})

describe('buildRetrievalSignalFixture 域', () => {
  it('degraded → degraded', () => {
    const f = buildRetrievalSignalFixture({ orgId: 1, index: 0, degraded: true })
    expect(f.status).toBe('degraded')
  })
  it('noObservation → retrieval_gap', () => {
    const f = buildRetrievalSignalFixture({ orgId: 1, index: 0, noObservation: true })
    expect(f.status).toBe('retrieval_gap')
    expect(f.sampleCount).toBe(0)
  })
})

// ── 14. 标签 ─────────────────────────────────────────────────────

describe('kindLabel', () => {
  it('中文标签稳定', () => {
    expect(kindLabel('knowledge_item')).toBe('知识条目')
    expect(kindLabel('copilot_memory')).toBe('推断记忆')
    expect(kindLabel('skill_knowledge_draft')).toBe('Skill 知识草稿')
    expect(kindLabel('retrieval_signal')).toBe('检索质量信号')
  })
})
