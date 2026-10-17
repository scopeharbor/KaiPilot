/**
 * Draft Layer Hash 工具函数单元测试。
 *
 * 测试 @aiproj/types 中导出的 hash 工具函数：
 * - computePreviewHash
 * - computeSelectionHash
 * - computeApplyPlanHash
 * - buildApplyIdempotencyKey
 *
 * 所有函数都是纯函数，不依赖 AdonisJS 容器。
 */

import { describe, expect, it } from 'vitest'
import {
  computePreviewHash,
  computeSelectionHash,
  computeApplyPlanHash,
  buildApplyIdempotencyKey,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// computePreviewHash
// ---------------------------------------------------------------------------

describe('computePreviewHash', () => {
  it('同一输入产出同一输出（确定性）', () => {
    const baseline = { name: '测试项目', status: 'planning', priority: 'high' }
    const current = { name: '测试项目', status: 'planning', priority: 'high' }
    const entityHashes = ['ent1_hash', 'ent2_hash', 'ent3_hash']

    const hash1 = computePreviewHash(baseline, current, entityHashes)
    const hash2 = computePreviewHash(baseline, current, entityHashes)
    expect(hash1).toBe(hash2)
  })

  it('不同 baseline 产出不同 hash', () => {
    const entityHashes = ['e1']
    const hash1 = computePreviewHash({ name: '项目 A' }, null, entityHashes)
    const hash2 = computePreviewHash({ name: '项目 B' }, null, entityHashes)
    expect(hash1).not.toBe(hash2)
  })

  it('不同 currentSummary 产出不同 hash', () => {
    const baseline = { name: '基线' }
    const entityHashes = ['e1']
    const hash1 = computePreviewHash(baseline, { status: 'changed' }, entityHashes)
    const hash2 = computePreviewHash(baseline, { status: 'unchanged' }, entityHashes)
    expect(hash1).not.toBe(hash2)
  })

  it('不同 entityHashes 产出不同 hash', () => {
    const baseline = { name: '项目' }
    const current = { name: '项目' }
    const hash1 = computePreviewHash(baseline, current, ['e1', 'e2'])
    const hash2 = computePreviewHash(baseline, current, ['e1', 'e3'])
    expect(hash1).not.toBe(hash2)
  })

  it('entityHashes 顺序无关', () => {
    const baseline = { name: '项目' }
    const current = { name: '项目' }
    const hash1 = computePreviewHash(baseline, current, ['e1', 'e2', 'e3'])
    const hash2 = computePreviewHash(baseline, current, ['e3', 'e1', 'e2'])
    expect(hash1).toBe(hash2)
  })

  it('baselineSummary 为 null 时不会崩溃', () => {
    const hash = computePreviewHash(null, { status: 'current' }, [])
    expect(hash).toBeTruthy()
    expect(typeof hash).toBe('string')
  })

  it('currentSummary 为 null 时不会崩溃', () => {
    const hash = computePreviewHash({ status: 'baseline' }, null, [])
    expect(hash).toBeTruthy()
    expect(typeof hash).toBe('string')
  })

  it('entityHashes 为空数组时产出有效 hash', () => {
    const hash = computePreviewHash({ project: 'test' }, { project: 'test' }, [])
    expect(hash).toBeTruthy()
    expect(typeof hash).toBe('string')
  })

  it('深度嵌套对象不影响确定性', () => {
    const baseline = { deep: { nested: { value: 42, arr: [1, 2, 3] } } }
    const current = { deep: { nested: { value: 42, arr: [1, 2, 3] } } }
    const entities = ['hash_abc', 'hash_def']

    const hash1 = computePreviewHash(baseline, current, entities)
    const hash2 = computePreviewHash(baseline, current, entities)
    expect(hash1).toBe(hash2)
  })
})

// ---------------------------------------------------------------------------
// computeSelectionHash
// ---------------------------------------------------------------------------

describe('computeSelectionHash', () => {
  it('同一输入产出同一输出（确定性）', () => {
    const decisions = [
      { changeId: 1, reviewStatus: 'accepted', userModifiedValue: null },
      { changeId: 2, reviewStatus: 'rejected', userModifiedValue: null },
    ]

    const hash1 = computeSelectionHash(decisions)
    const hash2 = computeSelectionHash(decisions)
    expect(hash1).toBe(hash2)
  })

  it('changeId 顺序无关（排序独立性）', () => {
    const decisions1 = [
      { changeId: 2, reviewStatus: 'accepted', userModifiedValue: null },
      { changeId: 1, reviewStatus: 'accepted', userModifiedValue: null },
      { changeId: 3, reviewStatus: 'skipped', userModifiedValue: '手动修改' },
    ]
    const decisions2 = [
      { changeId: 1, reviewStatus: 'accepted', userModifiedValue: null },
      { changeId: 2, reviewStatus: 'accepted', userModifiedValue: null },
      { changeId: 3, reviewStatus: 'skipped', userModifiedValue: '手动修改' },
    ]

    expect(computeSelectionHash(decisions1)).toBe(computeSelectionHash(decisions2))
  })

  it('不同 reviewStatus 产出不同 hash', () => {
    const accepted = [{ changeId: 1, reviewStatus: 'accepted', userModifiedValue: null }]
    const rejected = [{ changeId: 1, reviewStatus: 'rejected', userModifiedValue: null }]

    expect(computeSelectionHash(accepted)).not.toBe(computeSelectionHash(rejected))
  })

  it('不同 userModifiedValue 产出不同 hash', () => {
    const modified1 = [{ changeId: 1, reviewStatus: 'modified', userModifiedValue: '值 A' }]
    const modified2 = [{ changeId: 1, reviewStatus: 'modified', userModifiedValue: '值 B' }]

    expect(computeSelectionHash(modified1)).not.toBe(computeSelectionHash(modified2))
  })

  it('部分相同、部分不同的决策集产出不同 hash', () => {
    const set1 = [
      { changeId: 1, reviewStatus: 'accepted', userModifiedValue: null },
      { changeId: 2, reviewStatus: 'rejected', userModifiedValue: null },
    ]
    const set2 = [
      { changeId: 1, reviewStatus: 'accepted', userModifiedValue: null },
      { changeId: 2, reviewStatus: 'accepted', userModifiedValue: null },
    ]

    expect(computeSelectionHash(set1)).not.toBe(computeSelectionHash(set2))
  })

  it('空决策数组产出有效 hash', () => {
    const hash = computeSelectionHash([])
    expect(hash).toBeTruthy()
    expect(typeof hash).toBe('string')
  })

  it('userModifiedValue 可以为复杂对象', () => {
    const decisions = [
      {
        changeId: 1,
        reviewStatus: 'modified',
        userModifiedValue: { field: 'name', value: '新名称' },
      },
    ]

    const hash1 = computeSelectionHash(decisions)
    const hash2 = computeSelectionHash(decisions)
    expect(hash1).toBe(hash2)
  })

  it('多个 change 只有 userModifiedValue 不同时 hash 不同', () => {
    const baseDecisions = [
      { changeId: 1, reviewStatus: 'accepted', userModifiedValue: null },
      { changeId: 2, reviewStatus: 'pending', userModifiedValue: null },
      { changeId: 3, reviewStatus: 'skipped', userModifiedValue: null },
    ]
    const modifiedDecisions = [
      { changeId: 1, reviewStatus: 'accepted', userModifiedValue: null },
      { changeId: 2, reviewStatus: 'pending', userModifiedValue: null },
      { changeId: 3, reviewStatus: 'skipped', userModifiedValue: '用户备注' },
    ]

    expect(computeSelectionHash(baseDecisions)).not.toBe(computeSelectionHash(modifiedDecisions))
  })
})

// ---------------------------------------------------------------------------
// computeApplyPlanHash
// ---------------------------------------------------------------------------

describe('computeApplyPlanHash', () => {
  it('同一输入产出同一输出（确定性）', () => {
    const hash1 = computeApplyPlanHash('sel_hash_1', 'prev_hash_1', 'ops_digest_1')
    const hash2 = computeApplyPlanHash('sel_hash_1', 'prev_hash_1', 'ops_digest_1')
    expect(hash1).toBe(hash2)
  })

  it('不同 selectionHash 产出不同 hash', () => {
    const hash1 = computeApplyPlanHash('sel_a', 'prev_same', 'ops_same')
    const hash2 = computeApplyPlanHash('sel_b', 'prev_same', 'ops_same')
    expect(hash1).not.toBe(hash2)
  })

  it('不同 previewHash 产出不同 hash', () => {
    const hash1 = computeApplyPlanHash('sel_same', 'prev_a', 'ops_same')
    const hash2 = computeApplyPlanHash('sel_same', 'prev_b', 'ops_same')
    expect(hash1).not.toBe(hash2)
  })

  it('不同 operationsDigest 产出不同 hash', () => {
    const hash1 = computeApplyPlanHash('sel_same', 'prev_same', 'ops_a')
    const hash2 = computeApplyPlanHash('sel_same', 'prev_same', 'ops_b')
    expect(hash1).not.toBe(hash2)
  })

  it('空字符串作为参数时产出有效 hash', () => {
    const hash = computeApplyPlanHash('', '', '')
    expect(hash).toBeTruthy()
    expect(typeof hash).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// buildApplyIdempotencyKey
// ---------------------------------------------------------------------------

describe('buildApplyIdempotencyKey', () => {
  const baseParams = {
    sessionId: 1,
    version: 1,
    selectionHash: 'sel_hash_abc',
    previewHash: 'prev_hash_def',
    applyPlanHash: 'plan_hash_ghi',
    actorUserId: 42,
  }

  it('同一参数产出同一 key（确定性）', () => {
    const key1 = buildApplyIdempotencyKey(baseParams)
    const key2 = buildApplyIdempotencyKey(baseParams)
    expect(key1).toBe(key2)
    expect(key1).toBeTruthy()
  })

  it('不同 sessionId 产出不同 key', () => {
    const key1 = buildApplyIdempotencyKey(baseParams)
    const key2 = buildApplyIdempotencyKey({ ...baseParams, sessionId: 2 })
    expect(key1).not.toBe(key2)
  })

  it('不同 version 产出不同 key', () => {
    const key1 = buildApplyIdempotencyKey(baseParams)
    const key2 = buildApplyIdempotencyKey({ ...baseParams, version: 2 })
    expect(key1).not.toBe(key2)
  })

  it('不同 selectionHash 产出不同 key', () => {
    const key1 = buildApplyIdempotencyKey(baseParams)
    const key2 = buildApplyIdempotencyKey({ ...baseParams, selectionHash: 'other_sel' })
    expect(key1).not.toBe(key2)
  })

  it('不同 previewHash 产出不同 key', () => {
    const key1 = buildApplyIdempotencyKey(baseParams)
    const key2 = buildApplyIdempotencyKey({ ...baseParams, previewHash: 'other_prev' })
    expect(key1).not.toBe(key2)
  })

  it('不同 applyPlanHash 产出不同 key', () => {
    const key1 = buildApplyIdempotencyKey(baseParams)
    const key2 = buildApplyIdempotencyKey({ ...baseParams, applyPlanHash: 'other_plan' })
    expect(key1).not.toBe(key2)
  })

  it('不同 actorUserId 产出不同 key', () => {
    const key1 = buildApplyIdempotencyKey(baseParams)
    const key2 = buildApplyIdempotencyKey({ ...baseParams, actorUserId: 99 })
    expect(key1).not.toBe(key2)
  })

  it('覆盖所有六个必填参数：sessionId/version/selectionHash/previewHash/applyPlanHash/actorUserId', () => {
    // 逐一验证每个参数变化都导致 key 不同
    const paramsList = [
      { ...baseParams, sessionId: 999 },
      { ...baseParams, version: 999 },
      { ...baseParams, selectionHash: 'X' },
      { ...baseParams, previewHash: 'Y' },
      { ...baseParams, applyPlanHash: 'Z' },
      { ...baseParams, actorUserId: 999 },
    ]

    const baseKey = buildApplyIdempotencyKey(baseParams)
    for (const params of paramsList) {
      const key = buildApplyIdempotencyKey(params)
      expect(key).not.toBe(baseKey)
    }
  })
})
