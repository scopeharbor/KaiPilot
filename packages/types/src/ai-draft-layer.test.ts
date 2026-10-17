/**
 * v2-ai-draft-layer-preview-diff-apply —— Draft Layer 类型与 hash 工具测试。
 *
 * 覆盖：
 * - 枚举常量完备性
 * - 类型接口可用性
 * - hash 稳定性（同一输入 → 同一输出）
 * - 幂等键构造与解析
 */

import { describe, it, expect } from 'vitest'
import {
  DRAFT_LAYER_SOURCE_TYPES,
  DRAFT_LAYER_SESSION_STATUSES,
  DRAFT_LAYER_CHANGE_OPERATIONS,
  DRAFT_LAYER_REVIEW_STATUSES,
  DRAFT_LAYER_CONFLICT_SEVERITIES,
  DRAFT_LAYER_APPLY_STATUSES,
  DRAFT_LAYER_ENTITY_TYPES,
  DRAFT_LAYER_DIFF_OPERATIONS,
  computePreviewHash,
  computeSelectionHash,
  computeApplyPlanHash,
  buildApplyIdempotencyKey,
  type DraftLayerSession,
  type DraftLayerChange,
  type DraftLayerPreview,
  type DraftLayerDiffResult,
  type DraftLayerDecision,
  type DraftLayerDryRunResult,
  type DraftLayerApplyResult,
  type DraftLayerPdmHandoff,
} from './ai-draft-layer.js'

describe('Draft Layer 枚举常量', () => {
  it('来源类型含 v2_compiler_pdm', () => {
    expect(DRAFT_LAYER_SOURCE_TYPES).toContain('v2_compiler_pdm')
  })

  it('会话状态完备', () => {
    const expected = [
      'active',
      'previewing',
      'reviewing',
      'applying',
      'applied',
      'discarded',
      'expired',
    ]
    for (const s of expected) expect(DRAFT_LAYER_SESSION_STATUSES).toContain(s)
  })

  it('变更操作完备', () => {
    expect(DRAFT_LAYER_CHANGE_OPERATIONS).toEqual(['create', 'update', 'delete'])
  })

  it('审查状态完备', () => {
    const expected = ['pending', 'accepted', 'rejected', 'modified', 'skipped']
    for (const s of expected) expect(DRAFT_LAYER_REVIEW_STATUSES).toContain(s)
  })

  it('冲突严重级别完备', () => {
    expect(DRAFT_LAYER_CONFLICT_SEVERITIES).toEqual(['none', 'soft', 'hard'])
  })

  it('应用状态完备', () => {
    const expected = ['pending', 'dry_run_passed', 'applied', 'failed', 'rolled_back']
    for (const s of expected) expect(DRAFT_LAYER_APPLY_STATUSES).toContain(s)
  })

  it('实体类型完备', () => {
    const expected = [
      'project',
      'wbs_node',
      'task',
      'dependency',
      'milestone',
      'acceptance_criterion',
      'risk',
      'resource',
    ]
    for (const t of expected) expect(DRAFT_LAYER_ENTITY_TYPES).toContain(t)
  })

  it('Diff 操作完备', () => {
    expect(DRAFT_LAYER_DIFF_OPERATIONS).toEqual([
      'add',
      'modify',
      'remove',
      'unchanged',
      'conflict',
    ])
  })
})

describe('类型接口完整性', () => {
  it('DraftLayerSession 结构可用', () => {
    const session: DraftLayerSession = {
      id: 1,
      organizationId: 1,
      createdByUserId: 1,
      sourceType: 'v2_compiler_pdm',
      compilerRunId: 100,
      pdmArtifactId: 'pdm:v1',
      pdmHash: 'abc123',
      status: 'active',
      version: 1,
      expiresAt: null,
      summary: null,
      metadata: null,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: null,
    }
    expect(session.id).toBe(1)
    expect(session.sourceType).toBe('v2_compiler_pdm')
    expect(session.status).toBe('active')
  })

  it('DraftLayerChange 结构可用', () => {
    const change: DraftLayerChange = {
      id: 1,
      sessionId: 1,
      target: { entityType: 'task', entityId: 'task_1', fieldPath: 'name' },
      operation: 'create',
      path: '/tasks/task_1/name',
      value: '设计数据库',
      oldValue: null,
      reviewStatus: 'pending',
      userModifiedValue: null,
      userNote: null,
      sequence: 1,
      dependsOn: [],
      confidence: 0.85,
      validationSummary: null,
    }
    expect(change.target.entityType).toBe('task')
    expect(change.operation).toBe('create')
  })

  it('DraftLayerPdmHandoff 结构可用', () => {
    const handoff: DraftLayerPdmHandoff = {
      compilerRunId: 100,
      pdmArtifactId: 'pdm:v1',
      pdmHash: 'def456',
      ledgerSummary: {
        totalEntities: 10,
        completedEntities: 10,
        needsHumanReview: false,
        blockingItems: [],
        hasBlockingHumanReview: false,
      },
      status: 'ready_to_handoff',
    }
    expect(handoff.status).toBe('ready_to_handoff')
    expect(handoff.ledgerSummary.hasBlockingHumanReview).toBe(false)
  })

  it('DraftLayerDiffResult 结构可用', () => {
    const diff: DraftLayerDiffResult = {
      sessionId: 1,
      previewHash: 'hash123',
      baselineVersion: null,
      currentVersion: null,
      entities: [],
      entitySummaries: [],
      patchOperations: [],
    }
    expect(diff.previewHash).toBe('hash123')
  })

  it('DraftLayerApplyResult 结构可用', () => {
    const result: DraftLayerApplyResult = {
      id: 1,
      sessionId: 1,
      applyPlanHash: 'plan_hash',
      selectionHash: 'sel_hash',
      status: 'applied',
      projectId: 42,
      entityCounts: null,
      errorSummary: null,
      idempotencyKey: 'ik_001',
      appliedAt: '2026-07-11T00:00:00.000Z',
    }
    expect(result.status).toBe('applied')
    expect(result.projectId).toBe(42)
  })
})

describe('Hash 稳定性', () => {
  it('computePreviewHash 同一输入产出同一输出', () => {
    const baseline = { name: '测试项目', status: 'planning' }
    const current = { name: '测试项目', status: 'planning' }
    const entityHashes = ['ent1_hash', 'ent2_hash']

    const hash1 = computePreviewHash(baseline, current, entityHashes)
    const hash2 = computePreviewHash(baseline, current, entityHashes)
    expect(hash1).toBe(hash2)
  })

  it('computePreviewHash 不同输入产出不同输出', () => {
    const hash1 = computePreviewHash({ a: 1 }, null, ['h1'])
    const hash2 = computePreviewHash({ a: 2 }, null, ['h1'])
    expect(hash1).not.toBe(hash2)
  })

  it('computeSelectionHash 确定排序', () => {
    const decisions1 = [
      { changeId: 2, reviewStatus: 'accepted', userModifiedValue: null },
      { changeId: 1, reviewStatus: 'accepted', userModifiedValue: null },
    ]
    const decisions2 = [
      { changeId: 1, reviewStatus: 'accepted', userModifiedValue: null },
      { changeId: 2, reviewStatus: 'accepted', userModifiedValue: null },
    ]
    expect(computeSelectionHash(decisions1)).toBe(computeSelectionHash(decisions2))
  })

  it('computeSelectionHash 不同选择产出不同 hash', () => {
    const accepted = [
      { changeId: 1, reviewStatus: 'accepted', userModifiedValue: null },
      { changeId: 2, reviewStatus: 'rejected', userModifiedValue: null },
    ]
    const allAccepted = [
      { changeId: 1, reviewStatus: 'accepted', userModifiedValue: null },
      { changeId: 2, reviewStatus: 'accepted', userModifiedValue: null },
    ]
    expect(computeSelectionHash(accepted)).not.toBe(computeSelectionHash(allAccepted))
  })

  it('computeApplyPlanHash 确定性与唯一性', () => {
    const plan1 = computeApplyPlanHash('sel1', 'prev1', 'ops1')
    const plan2 = computeApplyPlanHash('sel1', 'prev1', 'ops1')
    const plan3 = computeApplyPlanHash('sel2', 'prev1', 'ops1')
    expect(plan1).toBe(plan2)
    expect(plan1).not.toBe(plan3)
  })
})

describe('幂等键', () => {
  it('buildApplyIdempotencyKey 同一参数产出同一 key', () => {
    const params = {
      sessionId: 1,
      version: 1,
      selectionHash: 'sel1',
      previewHash: 'prev1',
      applyPlanHash: 'plan1',
      actorUserId: 42,
    }
    const key1 = buildApplyIdempotencyKey(params)
    const key2 = buildApplyIdempotencyKey(params)
    expect(key1).toBe(key2)
    expect(key1).toBeTruthy()
  })

  it('buildApplyIdempotencyKey 不同 actor 产出不同 key', () => {
    const base = {
      sessionId: 1,
      version: 1,
      selectionHash: 'sel1',
      previewHash: 'prev1',
      applyPlanHash: 'plan1',
      actorUserId: 42,
    }
    const key1 = buildApplyIdempotencyKey(base)
    const key2 = buildApplyIdempotencyKey({ ...base, actorUserId: 43 })
    expect(key1).not.toBe(key2)
  })

  it('buildApplyIdempotencyKey 不同 version 产出不同 key', () => {
    const base = {
      sessionId: 1,
      version: 1,
      selectionHash: 'sel1',
      previewHash: 'prev1',
      applyPlanHash: 'plan1',
      actorUserId: 42,
    }
    const key1 = buildApplyIdempotencyKey(base)
    const key2 = buildApplyIdempotencyKey({ ...base, version: 2 })
    expect(key1).not.toBe(key2)
  })
})
