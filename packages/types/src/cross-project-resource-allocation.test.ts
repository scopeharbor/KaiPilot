// @aiproj/types —— 跨项目资源分配共享契约单元测试。
// 验证零运行时依赖、封闭枚举、稳定 hash、非法状态迁移和边界查询。

import { describe, it, expect } from 'vitest'
import {
  CROSS_PROJECT_ALLOCATION_DRAFT_STATUS_VALUES,
  CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_VALUES,
  CROSS_PROJECT_ALLOCATION_WARNING_CODE_VALUES,
  CROSS_PROJECT_ALLOCATION_ITEM_TYPE_VALUES,
  CROSS_PROJECT_ALLOCATION_CANDIDATE_SOURCE_VALUES,
  CROSS_PROJECT_ALLOCATION_REDACTION_STATE_VALUES,
  CROSS_PROJECT_ALLOCATION_MAX_DATE_WINDOW_DAYS,
  CROSS_PROJECT_ALLOCATION_MAX_PER_PAGE,
  CROSS_PROJECT_ALLOCATION_MAX_PROJECT_SCOPE,
  CROSS_PROJECT_ALLOCATION_MAX_TOP_N,
  CROSS_PROJECT_ALLOCATION_MAX_SEARCH_LENGTH,
} from './cross-project-resource-allocation.js'
import {
  normalizeCrossProjectAllocationQuery,
  canTransitionDraftStatus,
  allowedDraftTransitions,
  isValidWarningCode,
  sortConflictsBySeverity,
  maxConflictSeverity,
  computePreviewFingerprint,
  computeIdempotencyHash,
  computeAllocationEvidenceHash,
  computeQueryShapeHash,
} from './cross-project-resource-allocation-pure.js'

// ─── 封闭枚举 ────────────────────────────────────────────────────────────────

describe('封闭枚举', () => {
  it('draft statuses 为封闭值', () => {
    expect(CROSS_PROJECT_ALLOCATION_DRAFT_STATUS_VALUES.length).toBeGreaterThanOrEqual(7)
    expect(new Set(CROSS_PROJECT_ALLOCATION_DRAFT_STATUS_VALUES).size).toBe(
      CROSS_PROJECT_ALLOCATION_DRAFT_STATUS_VALUES.length,
    )
  })

  it('conflict severities 为封闭值', () => {
    expect(CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_VALUES).toContain('info')
    expect(CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_VALUES).toContain('critical')
    expect(new Set(CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_VALUES).size).toBe(
      CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_VALUES.length,
    )
  })

  it('warning codes 为封闭值', () => {
    expect(CROSS_PROJECT_ALLOCATION_WARNING_CODE_VALUES).toContain('PERMISSION_REDACTED')
    expect(CROSS_PROJECT_ALLOCATION_WARNING_CODE_VALUES).toContain('SOURCE_STALE')
    expect(new Set(CROSS_PROJECT_ALLOCATION_WARNING_CODE_VALUES).size).toBe(
      CROSS_PROJECT_ALLOCATION_WARNING_CODE_VALUES.length,
    )
  })

  it('item types 为封闭值', () => {
    expect(CROSS_PROJECT_ALLOCATION_ITEM_TYPE_VALUES).toContain('allocate')
    expect(CROSS_PROJECT_ALLOCATION_ITEM_TYPE_VALUES).toContain('map_resource')
    expect(new Set(CROSS_PROJECT_ALLOCATION_ITEM_TYPE_VALUES).size).toBe(
      CROSS_PROJECT_ALLOCATION_ITEM_TYPE_VALUES.length,
    )
  })

  it('candidate sources 为封闭值', () => {
    expect(CROSS_PROJECT_ALLOCATION_CANDIDATE_SOURCE_VALUES).toContain('rule')
    expect(CROSS_PROJECT_ALLOCATION_CANDIDATE_SOURCE_VALUES).toContain('ai')
    expect(new Set(CROSS_PROJECT_ALLOCATION_CANDIDATE_SOURCE_VALUES).size).toBe(
      CROSS_PROJECT_ALLOCATION_CANDIDATE_SOURCE_VALUES.length,
    )
  })

  it('redaction states 为封闭值', () => {
    expect(CROSS_PROJECT_ALLOCATION_REDACTION_STATE_VALUES).toContain('visible')
    expect(CROSS_PROJECT_ALLOCATION_REDACTION_STATE_VALUES).toContain('redacted')
    expect(CROSS_PROJECT_ALLOCATION_REDACTION_STATE_VALUES).toContain('forbidden')
    expect(new Set(CROSS_PROJECT_ALLOCATION_REDACTION_STATE_VALUES).size).toBe(
      CROSS_PROJECT_ALLOCATION_REDACTION_STATE_VALUES.length,
    )
  })
})

// ─── 非法 warning code 被拒 ─────────────────────────────────────────────────

describe('warning code 校验', () => {
  it('合法 code 通过', () => {
    expect(isValidWarningCode('PERMISSION_REDACTED')).toBe(true)
    expect(isValidWarningCode('SOURCE_STALE')).toBe(true)
    expect(isValidWarningCode('AI_UNAVAILABLE')).toBe(true)
  })

  it('非法 code 失败', () => {
    expect(isValidWarningCode('MADE_UP_CODE')).toBe(false)
    expect(isValidWarningCode('')).toBe(false)
    expect(isValidWarningCode('UNKNOWN')).toBe(false)
  })
})

// ─── 状态迁移 ─────────────────────────────────────────────────────────────────

describe('状态迁移', () => {
  it('合法迁移', () => {
    expect(canTransitionDraftStatus('draft', 'previewed')).toBe(true)
    expect(canTransitionDraftStatus('draft', 'cancelled')).toBe(true)
    expect(canTransitionDraftStatus('previewed', 'confirmed')).toBe(true)
    expect(canTransitionDraftStatus('confirmed', 'applied')).toBe(true)
    expect(canTransitionDraftStatus('previewed', 'draft')).toBe(true)
    expect(canTransitionDraftStatus('previewed', 'cancelled')).toBe(true)
  })

  it('非法迁移', () => {
    expect(canTransitionDraftStatus('draft', 'applied')).toBe(false)
    expect(canTransitionDraftStatus('applied', 'draft')).toBe(false)
    expect(canTransitionDraftStatus('cancelled', 'draft')).toBe(false)
    expect(canTransitionDraftStatus('failed', 'draft')).toBe(false)
    expect(canTransitionDraftStatus('expired', 'confirmed')).toBe(false)
  })

  it('确定性: 重复得到相同结果', () => {
    for (let i = 0; i < 10; i++) {
      expect(canTransitionDraftStatus('previewed', 'confirmed')).toBe(true)
      expect(canTransitionDraftStatus('draft', 'applied')).toBe(false)
    }
  })

  it('allowedDraftTransitions 返回目标集', () => {
    const got = allowedDraftTransitions('draft')
    expect(got).toContain('previewed')
    expect(got).toContain('cancelled')
    expect(got).not.toContain('applied')
  })

  it('终态无出边', () => {
    expect(allowedDraftTransitions('applied')).toEqual([])
    expect(allowedDraftTransitions('cancelled')).toEqual([])
    expect(allowedDraftTransitions('expired')).toEqual([])
    expect(allowedDraftTransitions('failed')).toEqual([])
  })
})

// ─── Conflict 排序与分类 ─────────────────────────────────────────────────────

describe('conflict severity 排序', () => {
  const info = {
    severity: 'info' as const,
    code: 'SKILL_GAP' as const,
    message: 'a',
    affectedDates: [],
    affectedProjectIds: [],
    redaction: 'visible' as const,
  }
  const warn = {
    severity: 'warning' as const,
    code: 'OVERLOADED_CANDIDATE' as const,
    message: 'b',
    affectedDates: [],
    affectedProjectIds: [],
    redaction: 'visible' as const,
  }
  const err = {
    severity: 'error' as const,
    code: 'CONFLICT_OVERLAP' as const,
    message: 'c',
    affectedDates: [],
    affectedProjectIds: [],
    redaction: 'visible' as const,
  }
  const crit = {
    severity: 'critical' as const,
    code: 'TARGET_PERMISSION_REVOKED' as const,
    message: 'd',
    affectedDates: [],
    affectedProjectIds: [],
    redaction: 'visible' as const,
  }

  it('按严重度降序', () => {
    const sorted = sortConflictsBySeverity([info, crit, warn, err])
    expect(sorted[0].severity).toBe('critical')
    expect(sorted[1].severity).toBe('error')
    expect(sorted[2].severity).toBe('warning')
    expect(sorted[3].severity).toBe('info')
  })

  it('空列表原样返回', () => {
    expect(sortConflictsBySeverity([])).toEqual([])
  })

  it('单元素', () => {
    expect(sortConflictsBySeverity([info])).toEqual([info])
  })

  it('maxConflictSeverity 返回最高等级', () => {
    expect(maxConflictSeverity([info, crit, warn])).toBe('critical')
    expect(maxConflictSeverity([warn, info])).toBe('warning')
    expect(maxConflictSeverity([])).toBeNull()
  })
})

// ─── 稳定 Hash ───────────────────────────────────────────────────────────────

describe('稳定 hash', () => {
  it('computePreviewFingerprint 确定性地返回 hex', () => {
    const a = computePreviewFingerprint(['a', 'b', 'c'])
    const b = computePreviewFingerprint(['a', 'b', 'c'])
    const c = computePreviewFingerprint(['a', 'b'])
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    // hex format
    expect(a).toMatch(/^[0-9a-f]+$/)
  })

  it('computeIdempotencyHash 确定性地返回 hex', () => {
    const a = computeIdempotencyHash('my-key-123')
    const b = computeIdempotencyHash('my-key-123')
    const c = computeIdempotencyHash('my-key-456')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]+$/)
  })

  it('computeIdempotencyHash 拒绝空字符串', () => {
    expect(computeIdempotencyHash('')).toBe('')
    expect(computeIdempotencyHash('  ')).toBe('')
  })

  it('computeAllocationEvidenceHash 基于签名键稳定排序', () => {
    const a = computeAllocationEvidenceHash({ b: '1', a: '2', c: '3' })
    const b = computeAllocationEvidenceHash({ a: '2', b: '1', c: '3' })
    const c = computeAllocationEvidenceHash({ a: '3', b: '1', c: '3' })
    expect(a).toBe(b) // 键排序一致
    expect(a).not.toBe(c) // 值不同
    expect(a).toMatch(/^[0-9a-f]+$/)
  })

  it('computeQueryShapeHash 稳定且对边界输入无异常', () => {
    const q = normalizeCrossProjectAllocationQuery({ organizationId: 1, projectIds: [10, 20] })
    const a = computeQueryShapeHash(q)
    const b = computeQueryShapeHash(q)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]+$/)
  })
})

// ─── 查询规范化 ──────────────────────────────────────────────────────────────

describe('查询规范化', () => {
  it('最小输入回退到默认值', () => {
    const q = normalizeCrossProjectAllocationQuery({ organizationId: 1 })
    expect(q.organizationId).toBe(1)
    expect(q.page).toBe(1)
    expect(q.perPage).toBe(20)
    expect(q.topN).toBe(10)
    expect(q.sort).toBe('created_at')
    expect(q.sortDir).toBe('desc')
    expect(q.projectIds).toEqual([])
  })

  it('clamp 超大 perPage', () => {
    const q = normalizeCrossProjectAllocationQuery({ organizationId: 1, perPage: 999 })
    expect(q.perPage).toBe(CROSS_PROJECT_ALLOCATION_MAX_PER_PAGE)
  })

  it('clamp 超大 topN: 精确值', () => {
    const q = normalizeCrossProjectAllocationQuery({ organizationId: 1, topN: 999 })
    expect(q.topN).toBe(CROSS_PROJECT_ALLOCATION_MAX_TOP_N)
  })

  it('clamp 超大 project scope', () => {
    const ids = Array.from({ length: 999 }, (_, i) => i + 1)
    const q = normalizeCrossProjectAllocationQuery({ organizationId: 1, projectIds: ids })
    expect(q.projectIds.length).toBe(CROSS_PROJECT_ALLOCATION_MAX_PROJECT_SCOPE)
  })

  it('clamp 超长 search', () => {
    const q = normalizeCrossProjectAllocationQuery({ organizationId: 1, search: 'x'.repeat(999) })
    expect(q.search!.length).toBe(CROSS_PROJECT_ALLOCATION_MAX_SEARCH_LENGTH)
  })

  it('空 search 置为 null', () => {
    const q = normalizeCrossProjectAllocationQuery({ organizationId: 1, search: '' })
    expect(q.search).toBeNull()
  })

  it('过滤非法 sort key', () => {
    const q = normalizeCrossProjectAllocationQuery({
      organizationId: 1,
      sort: 'invalid_key' as any,
    })
    expect(q.sort).toBe('created_at')
  })

  it('过滤非法 conflict severity', () => {
    const q = normalizeCrossProjectAllocationQuery({
      organizationId: 1,
      conflictSeverities: ['bogus' as any],
    })
    expect(q.conflictSeverities).toEqual([])
  })

  it('合法 severity 保留', () => {
    const q = normalizeCrossProjectAllocationQuery({
      organizationId: 1,
      conflictSeverities: ['warning', 'critical'],
    })
    expect(q.conflictSeverities).toEqual(['warning', 'critical'])
  })

  it('合法 sort 保留', () => {
    const q = normalizeCrossProjectAllocationQuery({ organizationId: 1, sort: 'updated_at' })
    expect(q.sort).toBe('updated_at')
  })

  it('sortDir 只能 asc 或 desc', () => {
    expect(
      normalizeCrossProjectAllocationQuery({ organizationId: 1, sortDir: 'asc' as const }).sortDir,
    ).toBe('asc')
    expect(
      normalizeCrossProjectAllocationQuery({ organizationId: 1, sortDir: 'bogus' as any }).sortDir,
    ).toBe('desc')
  })

  it('page 不能低于 1', () => {
    expect(normalizeCrossProjectAllocationQuery({ organizationId: 1, page: -5 }).page).toBe(1)
    expect(normalizeCrossProjectAllocationQuery({ organizationId: 1, page: 0 }).page).toBe(1)
  })
})

// ─── 零运行时依赖 ────────────────────────────────────────────────────────────

describe('零运行时依赖', () => {
  it('契约文件不含外部导入', async () => {
    const src = await import('./cross-project-resource-allocation.js')
    // 验证是纯模块——所有 exports 直接定义，无外部引用
    expect(src).toBeDefined()
    expect(typeof src.CROSS_PROJECT_ALLOCATION_DRAFT_STATUSES).toBe('object')
    expect(typeof src.CROSS_PROJECT_ALLOCATION_SCHEMA_VERSION).toBe('string')
  })

  it('纯函数文件不含外部 runtime 依赖', async () => {
    const src = await import('./cross-project-resource-allocation-pure.js')
    expect(src).toBeDefined()
    expect(typeof src.normalizeCrossProjectAllocationQuery).toBe('function')
    expect(typeof src.canTransitionDraftStatus).toBe('function')
    expect(typeof src.computePreviewFingerprint).toBe('function')
    expect(typeof src.computeIdempotencyHash).toBe('function')
  })
})
