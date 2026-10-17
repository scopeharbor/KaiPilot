// @aiproj/types — V3 Copilot 跨对话记忆层 Fixtures（copilot-memory-fixtures）
//
// v3-copilot-memory-user-and-project / §2.13 —— 覆盖候选、已确认、已编辑、
// 可能过期、久未确认、冲突让位、权限缺失七态。

import type {
  CopilotMemoryEntry,
  CopilotMemoryBasisRef,
  CopilotMemoryCandidate,
  CopilotMemoryExtractionResult,
  CopilotMemoryFacet,
  CopilotMemoryAuditEvent,
  CopilotMemoryAuditAction,
} from './copilot-memory.js'
import { COPILLOT_MEMORY_FACET_NAME } from './copilot-memory.js'

// ===========================================================================
// Basis 引用构建器
// ===========================================================================

export function buildMemoryBasisRef(
  overrides?: Partial<CopilotMemoryBasisRef>,
): CopilotMemoryBasisRef {
  return {
    sessionId: 'run_fixture_001',
    messageId: 'msg_fixture_001',
    summary: '用户在对话中提到团队规模为 5 人',
    role: 'user',
    ...overrides,
  }
}

// ===========================================================================
// 记忆条目构建器
// ===========================================================================

export function buildMemoryEntry(overrides?: Partial<CopilotMemoryEntry>): CopilotMemoryEntry {
  return {
    id: 'mem_fixture_001',
    organizationId: 1,
    projectId: 100,
    actorId: 10,
    scope: 'user',
    summary: '团队规模为 5 人，编制锁死不扩招',
    tags: ['team_size', 'constraint'],
    confidence: 0.85,
    confidenceSource: 'repeated_observation',
    basis: [buildMemoryBasisRef()],
    observedAt: '2026-08-01T10:00:00.000Z',
    lastConfirmedAt: '2026-08-15T10:00:00.000Z',
    status: 'confirmed',
    validityTier: 'durable',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-15T10:00:00.000Z',
    ...overrides,
  }
}

// ===========================================================================
// 七态 Fixtures
// ===========================================================================

/** 态 1：候选（未确认）。 */
export function buildCandidateMemoryEntry(): CopilotMemoryEntry {
  return buildMemoryEntry({
    id: 'mem_candidate_001',
    status: 'candidate',
    lastConfirmedAt: undefined,
    summary: '项目使用 Scrum 方法论，双周迭代',
    tags: ['methodology', 'iteration'],
    confidence: 0.7,
    confidenceSource: 'single_observation',
  })
}

/** 态 2：已确认。 */
export function buildConfirmedMemoryEntry(): CopilotMemoryEntry {
  return buildMemoryEntry({
    id: 'mem_confirmed_001',
    status: 'confirmed',
    summary: '团队规模为 5 人，编制锁死不扩招',
    tags: ['team_size', 'constraint'],
    confidence: 0.85,
    confidenceSource: 'repeated_observation',
    validityTier: 'durable',
  })
}

/** 态 3：已编辑。 */
export function buildEditedMemoryEntry(): CopilotMemoryEntry {
  return buildMemoryEntry({
    id: 'mem_edited_001',
    status: 'edited',
    summary: '验收标准需走负责人签字（已更新）',
    tags: ['acceptance', 'process'],
    confidence: 0.95,
    confidenceSource: 'explicit_user_statement',
    validityTier: 'long',
  })
}

/** 态 4：可能过期。 */
export function buildPossiblyOutdatedMemoryEntry(): CopilotMemoryEntry {
  return buildMemoryEntry({
    id: 'mem_outdated_001',
    status: 'possibly_outdated',
    summary: '后端框架使用 AdonisJS 5.x',
    tags: ['tech_stack', 'backend'],
    confidence: 0.7,
    confidenceSource: 'single_observation',
    observedAt: '2026-05-01T10:00:00.000Z',
    lastConfirmedAt: '2026-05-01T10:00:00.000Z',
    validityTier: 'medium',
  })
}

/** 态 5：久未确认（超过陈旧阈值，但状态仍为 confirmed）。 */
export function buildLongUnconfirmedMemoryEntry(): CopilotMemoryEntry {
  return buildMemoryEntry({
    id: 'mem_long_unconfirmed_001',
    status: 'confirmed',
    summary: '项目截止日期为 2026-06-30',
    tags: ['deadline', 'schedule'],
    confidence: 0.85,
    confidenceSource: 'repeated_observation',
    observedAt: '2026-03-01T10:00:00.000Z',
    lastConfirmedAt: '2026-03-15T10:00:00.000Z',
    validityTier: 'medium', // 30 天阈值，已超过
  })
}

/** 态 6：冲突让位（与实时事实冲突，记忆让位）。 */
export function buildConflictYieldingMemoryEntry(): CopilotMemoryEntry {
  return buildMemoryEntry({
    id: 'mem_conflict_yield_001',
    status: 'possibly_outdated',
    summary: '项目预算为 50 万元',
    tags: ['budget', 'financial'],
    confidence: 0.95,
    confidenceSource: 'explicit_user_statement',
    validityTier: 'long',
  })
}

/** 态 7：权限缺失（跨组织访问被拒）。 */
export function buildPermissionMissingMemoryEntry(): CopilotMemoryEntry {
  return buildMemoryEntry({
    id: 'mem_perm_missing_001',
    organizationId: 999, // 不同组织
    status: 'confirmed',
    summary: '其他组织的项目约定',
    tags: ['other_org'],
    confidence: 0.85,
    confidenceSource: 'single_observation',
  })
}

// ===========================================================================
// Candidate Fixtures
// ===========================================================================

export function buildMemoryCandidate(
  overrides?: Partial<CopilotMemoryCandidate>,
): CopilotMemoryCandidate {
  const { entry: overrideEntry, ...restOverrides } = overrides ?? {}
  const fullEntry = buildMemoryEntry({
    status: 'candidate',
    lastConfirmedAt: undefined,
    id: '',
    createdAt: '',
    updatedAt: '',
    ...(overrideEntry as any),
  })
  const { id, createdAt, updatedAt, ...entryWithoutMeta } = fullEntry as any
  const result: CopilotMemoryCandidate = {
    entry: entryWithoutMeta,
    confidenceSource: 'single_observation',
    ...restOverrides,
  }
  return result
}

// ===========================================================================
// Extraction Result Fixtures
// ===========================================================================

export function buildExtractionResult(
  overrides?: Partial<CopilotMemoryExtractionResult>,
): CopilotMemoryExtractionResult {
  return {
    candidates: [buildMemoryCandidate()],
    totalProduced: 1,
    omittedCount: 0,
    sanitizerRejectedCount: 0,
    sourceSessionIds: ['run_fixture_001'],
    deterministic: true,
    ...overrides,
  }
}

// ===========================================================================
// Facet Fixture
// ===========================================================================

export function buildMemoryFacet(overrides?: Partial<CopilotMemoryFacet>): CopilotMemoryFacet {
  return {
    facetName: COPILLOT_MEMORY_FACET_NAME,
    kind: 'inferred',
    memories: [buildConfirmedMemoryEntry()],
    longUnconfirmedCount: 0,
    truncatedCount: 0,
    ...overrides,
  }
}

// ===========================================================================
// Audit Event Fixture
// ===========================================================================

export function buildMemoryAuditEvent(
  action: CopilotMemoryAuditAction = 'candidate_confirmed',
  overrides?: Partial<CopilotMemoryAuditEvent>,
): CopilotMemoryAuditEvent {
  return {
    action,
    actorId: 10,
    organizationId: 1,
    entryId: 'mem_fixture_001',
    scope: 'user',
    timestamp: '2026-08-16T12:00:00.000Z',
    ...overrides,
  }
}

// ===========================================================================
// 全七态集合（用于测试）
// ===========================================================================

export function buildAllMemoryStateFixtures(): readonly CopilotMemoryEntry[] {
  return [
    buildCandidateMemoryEntry(),
    buildConfirmedMemoryEntry(),
    buildEditedMemoryEntry(),
    buildPossiblyOutdatedMemoryEntry(),
    buildLongUnconfirmedMemoryEntry(),
    buildConflictYieldingMemoryEntry(),
    buildPermissionMissingMemoryEntry(),
  ]
}
