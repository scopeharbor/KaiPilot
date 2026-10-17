// @aiproj/types — V3 TRIZ 矛盾矩阵审查 UI 共享契约测试
// v3-triz-contradiction-matrix-ui / design D1 §2.4

import { describe, expect, it } from 'vitest'
import {
  computeMatrixCellKey,
  computeTensionKey,
  compareParameterKeys,
  compareSeverity,
  sortMatrixSourceRefs,
  aggregateWarnings,
  isCellFullyStale,
  resolveCellState,
  computeAggregateSeverity,
  resolveAvailableActions,
  normalizeIdempotencyKey,
  computeMatrixHandoffIdempotencyKey,
  validateMatrixFilters,
  validateMatrixHandoffInput,
  isMatrixCellState,
  isMatrixAvailableAction,
  isMatrixSortField,
} from './triz-contradiction-matrix.js'
import type {
  MatrixSourceRef,
  MatrixCellState,
  MatrixAvailableAction,
  MatrixHandoffInput,
} from './triz-contradiction-matrix.js'

import {
  buildAuthorizedContradictionRef,
  buildAuthorizedAnalysisRef,
  buildStaleSourceRef,
  buildNormalCell,
  buildEmptyCell,
  buildHiddenCell,
  buildStaleCell,
  buildMatrixDTO,
  buildMatrixHandoffInput,
} from './triz-contradiction-matrix-fixtures.js'

describe('stable cell keys', () => {
  it('same params + same catalog → same key', () => {
    const key1 = computeMatrixCellKey({
      improvingParameterKey: 'duration',
      worseningParameterKey: 'cost',
      catalogVersion: '1.0.0',
    })
    const key2 = computeMatrixCellKey({
      improvingParameterKey: 'duration',
      worseningParameterKey: 'cost',
      catalogVersion: '1.0.0',
    })
    expect(key1).toBe(key2)
  })

  it('different params → different key', () => {
    const key1 = computeMatrixCellKey({
      improvingParameterKey: 'duration',
      worseningParameterKey: 'cost',
      catalogVersion: '1.0.0',
    })
    const key2 = computeMatrixCellKey({
      improvingParameterKey: 'cost',
      worseningParameterKey: 'duration',
      catalogVersion: '1.0.0',
    })
    expect(key1).not.toBe(key2)
  })

  it('different catalog version → different key', () => {
    const key1 = computeMatrixCellKey({
      improvingParameterKey: 'duration',
      worseningParameterKey: 'cost',
      catalogVersion: '1.0.0',
    })
    const key2 = computeMatrixCellKey({
      improvingParameterKey: 'duration',
      worseningParameterKey: 'cost',
      catalogVersion: '2.0.0',
    })
    expect(key1).not.toBe(key2)
  })

  it('cell keys are stable across repeated calls', () => {
    const keys = Array.from({ length: 10 }, () =>
      computeMatrixCellKey({
        improvingParameterKey: 'scope',
        worseningParameterKey: 'quality',
        catalogVersion: '1.0.0',
      }),
    )
    const first = keys[0]
    expect(keys.every((k) => k === first)).toBe(true)
  })

  it('tension keys are stable', () => {
    const k1 = computeTensionKey({ parameterKey: 'scope', catalogVersion: '1.0.0' })
    const k2 = computeTensionKey({ parameterKey: 'scope', catalogVersion: '1.0.0' })
    expect(k1).toBe(k2)
  })

  it('tension keys differ by parameter', () => {
    const k1 = computeTensionKey({ parameterKey: 'scope', catalogVersion: '1.0.0' })
    const k2 = computeTensionKey({ parameterKey: 'cost', catalogVersion: '1.0.0' })
    expect(k1).not.toBe(k2)
  })
})

describe('parameter sorting', () => {
  it('duration < cost in default order', () => {
    const result = compareParameterKeys('duration', 'cost')
    expect(result).toBeLessThan(0)
  })

  it('cost < throughput', () => {
    const result = compareParameterKeys('cost', 'throughput')
    expect(result).toBeLessThan(0)
  })

  it('throughput > duration', () => {
    const result = compareParameterKeys('throughput', 'duration')
    expect(result).toBeGreaterThan(0)
  })
})

describe('severity sorting', () => {
  it('critical < high (critical is worse)', () => {
    expect(compareSeverity('critical', 'high')).toBeLessThan(0)
  })

  it('low > critical', () => {
    expect(compareSeverity('low', 'critical')).toBeGreaterThan(0)
  })
})

describe('source ref sorting', () => {
  it('stale refs sort to end', () => {
    const normal = buildAuthorizedContradictionRef({ stale: false, title: 'A' })
    const stale = buildStaleSourceRef({ title: 'B' })
    const sorted = sortMatrixSourceRefs([stale, normal])
    expect(sorted[0].stale).toBe(false)
    expect(sorted[1].stale).toBe(true)
  })

  it('same staleness → severity ordering', () => {
    const high = buildAuthorizedContradictionRef({ severity: 'high', title: 'H' })
    const low = buildAuthorizedContradictionRef({ severity: 'low', title: 'L' })
    const sorted = sortMatrixSourceRefs([low, high])
    expect(sorted[0].severity).toBe('high')
    expect(sorted[1].severity).toBe('low')
  })

  it('same severity → type ordering', () => {
    const a = buildAuthorizedContradictionRef({ title: 'A' })
    const b = buildAuthorizedAnalysisRef({ title: 'B' })
    const sorted = sortMatrixSourceRefs([b, a])
    expect(sorted[0].sourceType).toBe('contradiction')
    expect(sorted[1].sourceType).toBe('triz_analysis')
  })
})

describe('warning aggregation', () => {
  it('empty refs → zero warnings', () => {
    const summary = aggregateWarnings([])
    expect(summary.total).toBe(0)
    expect(summary.blocking).toBe(0)
    expect(summary.warning).toBe(0)
    expect(summary.info).toBe(0)
    expect(summary.codes).toHaveLength(0)
  })

  it('multiple refs with distinct warning codes', () => {
    const refs = [
      buildAuthorizedContradictionRef({
        warningCodes: ['STALE_SOURCE_CONTRADICTION', 'NEEDS_HUMAN_REVIEW'],
      }),
      buildAuthorizedAnalysisRef({ warningCodes: ['EMPTY_EVIDENCE_CHAIN'] }),
    ]
    const summary = aggregateWarnings(refs)
    expect(summary.total).toBe(3)
    expect(summary.codes).toHaveLength(3)
  })

  it('duplicate codes deduplicated', () => {
    const refs = [
      buildAuthorizedContradictionRef({ warningCodes: ['STALE_SOURCE_CONTRADICTION'] }),
      buildAuthorizedContradictionRef({ warningCodes: ['STALE_SOURCE_CONTRADICTION'] }),
    ]
    const summary = aggregateWarnings(refs)
    expect(summary.codes).toHaveLength(1)
  })

  it('codes are sorted alphabetically', () => {
    const refs = [buildAuthorizedContradictionRef({ warningCodes: ['Z_CODE', 'A_CODE'] })]
    const summary = aggregateWarnings(refs)
    expect(summary.codes).toEqual(['A_CODE', 'Z_CODE'])
  })
})

describe('stale detection', () => {
  it('all stale → true', () => {
    const refs = [buildStaleSourceRef(), buildStaleSourceRef()]
    expect(isCellFullyStale(refs)).toBe(true)
  })

  it('mixed stale → false', () => {
    const refs = [buildStaleSourceRef(), buildAuthorizedContradictionRef()]
    expect(isCellFullyStale(refs)).toBe(false)
  })

  it('empty → false', () => {
    expect(isCellFullyStale([])).toBe(false)
  })
})

describe('cell state resolution', () => {
  it('has visible sources → has_sources', () => {
    expect(
      resolveCellState({
        visibleSourceCount: 2,
        hasHiddenSources: false,
        isStale: false,
        isUnavailable: false,
      }),
    ).toBe('has_sources')
  })

  it('zero visible + has hidden → hidden', () => {
    expect(
      resolveCellState({
        visibleSourceCount: 0,
        hasHiddenSources: true,
        isStale: false,
        isUnavailable: false,
      }),
    ).toBe('hidden')
  })

  it('zero visible + no hidden → empty', () => {
    expect(
      resolveCellState({
        visibleSourceCount: 0,
        hasHiddenSources: false,
        isStale: false,
        isUnavailable: false,
      }),
    ).toBe('empty')
  })

  it('all stale → stale', () => {
    expect(
      resolveCellState({
        visibleSourceCount: 2,
        hasHiddenSources: false,
        isStale: true,
        isUnavailable: false,
      }),
    ).toBe('stale')
  })

  it('unavailable → unavailable', () => {
    expect(
      resolveCellState({
        visibleSourceCount: 0,
        hasHiddenSources: false,
        isStale: false,
        isUnavailable: true,
      }),
    ).toBe('unavailable')
  })
})

describe('aggregate severity', () => {
  it('critical + low → critical', () => {
    const refs = [
      buildAuthorizedContradictionRef({ severity: 'critical' }),
      buildAuthorizedContradictionRef({ severity: 'low' }),
    ]
    expect(computeAggregateSeverity(refs)).toBe('critical')
  })

  it('empty → null', () => {
    expect(computeAggregateSeverity([])).toBeNull()
  })

  it('null severities only → null', () => {
    const refs = [buildAuthorizedContradictionRef({ severity: null })]
    expect(computeAggregateSeverity(refs)).toBeNull()
  })
})

describe('available actions', () => {
  it('has_sources with all permissions → full actions', () => {
    const actions = resolveAvailableActions({
      state: 'has_sources',
      canAccessWorkbench: true,
      canAccessRationale: true,
      hasSourceRefs: true,
    })
    expect(actions).toContain('view_rationale')
    expect(actions).toContain('add_to_workbench')
    expect(actions).toContain('open_draft_review')
    expect(actions).toContain('copy_ref')
  })

  it('empty state → no actions', () => {
    const actions = resolveAvailableActions({
      state: 'empty',
      canAccessWorkbench: true,
      canAccessRationale: true,
      hasSourceRefs: false,
    })
    expect(actions).toHaveLength(0)
  })

  it('hidden state → no actions', () => {
    const actions = resolveAvailableActions({
      state: 'hidden',
      canAccessWorkbench: true,
      canAccessRationale: true,
      hasSourceRefs: false,
    })
    expect(actions).toHaveLength(0)
  })

  it('stale state → no open_draft_review', () => {
    const actions = resolveAvailableActions({
      state: 'stale',
      canAccessWorkbench: true,
      canAccessRationale: true,
      hasSourceRefs: true,
    })
    expect(actions).toContain('view_rationale')
    expect(actions).toContain('add_to_workbench')
    expect(actions).not.toContain('open_draft_review')
    expect(actions).toContain('copy_ref')
  })

  it('no workbench permission → no workbench/draft actions', () => {
    const actions = resolveAvailableActions({
      state: 'has_sources',
      canAccessWorkbench: false,
      canAccessRationale: true,
      hasSourceRefs: true,
    })
    expect(actions).toContain('view_rationale')
    expect(actions).toContain('copy_ref')
    expect(actions).not.toContain('add_to_workbench')
    expect(actions).not.toContain('open_draft_review')
  })
})

describe('idempotency key', () => {
  it('normalize trims whitespace', () => {
    expect(normalizeIdempotencyKey('  key  ')).toBe('key')
  })

  it('normalize truncates > 256 chars', () => {
    const long = 'x'.repeat(300)
    expect(normalizeIdempotencyKey(long)).toHaveLength(256)
  })

  it('computeMatrixHandoffIdempotencyKey is deterministic', () => {
    const args = {
      projectId: 100,
      selectedCells: ['cell-a', 'cell-b'],
      selectedTensions: ['tension-x'],
      sourceHashes: ['abc', 'def'],
    }
    const k1 = computeMatrixHandoffIdempotencyKey(args)
    const k2 = computeMatrixHandoffIdempotencyKey(args)
    expect(k1).toBe(k2)
  })

  it('computeMatrixHandoffIdempotencyKey differs by projectId', () => {
    const k1 = computeMatrixHandoffIdempotencyKey({
      projectId: 100,
      selectedCells: [],
      selectedTensions: [],
      sourceHashes: [],
    })
    const k2 = computeMatrixHandoffIdempotencyKey({
      projectId: 200,
      selectedCells: [],
      selectedTensions: [],
      sourceHashes: [],
    })
    expect(k1).not.toBe(k2)
  })
})

describe('type guards', () => {
  it('isMatrixCellState', () => {
    expect(isMatrixCellState('has_sources')).toBe(true)
    expect(isMatrixCellState('empty')).toBe(true)
    expect(isMatrixCellState('hidden')).toBe(true)
    expect(isMatrixCellState('unavailable')).toBe(true)
    expect(isMatrixCellState('stale')).toBe(true)
    expect(isMatrixCellState('invalid')).toBe(false)
  })

  it('isMatrixAvailableAction', () => {
    expect(isMatrixAvailableAction('view_rationale')).toBe(true)
    expect(isMatrixAvailableAction('add_to_workbench')).toBe(true)
    expect(isMatrixAvailableAction('open_draft_review')).toBe(true)
    expect(isMatrixAvailableAction('copy_ref')).toBe(true)
    expect(isMatrixAvailableAction('auto_solve')).toBe(false)
  })

  it('isMatrixSortField', () => {
    expect(isMatrixSortField('parameter_key')).toBe(true)
    expect(isMatrixSortField('severity')).toBe(true)
    expect(isMatrixSortField('auto_apply')).toBe(false)
  })
})

describe('filter validation', () => {
  it('valid filters pass', () => {
    const errors = validateMatrixFilters({
      contradictionType: 'technical',
      status: 'confirmed',
      severity: 'high',
      stale: 'stale_only',
      sourceType: 'contradiction',
      sort: 'severity',
      sortDirection: 'desc',
    })
    expect(errors).toHaveLength(0)
  })

  it('empty filters pass', () => {
    expect(validateMatrixFilters({})).toHaveLength(0)
  })

  it('invalid contradictionType → error', () => {
    const errors = validateMatrixFilters({ contradictionType: 'invalid' })
    expect(errors.some((e) => e.includes('contradictionType'))).toBe(true)
  })

  it('invalid severity → error', () => {
    const errors = validateMatrixFilters({ severity: 'unknown' })
    expect(errors.some((e) => e.includes('severity'))).toBe(true)
  })

  it('invalid sort → error', () => {
    const errors = validateMatrixFilters({ sort: 'auto_apply' })
    expect(errors.some((e) => e.includes('sort'))).toBe(true)
  })
})

describe('handoff input validation', () => {
  it('valid handoff input passes', () => {
    const input = buildMatrixHandoffInput()
    const errors = validateMatrixHandoffInput(input)
    expect(errors).toHaveLength(0)
  })

  it('invalid target → error', () => {
    const input = buildMatrixHandoffInput({ target: 'auto_apply' as any })
    const errors = validateMatrixHandoffInput(input)
    expect(errors.some((e) => e.includes('target'))).toBe(true)
  })

  it('no cells or tensions → error', () => {
    const input = buildMatrixHandoffInput({ selectedCells: [], selectedTensions: [] })
    const errors = validateMatrixHandoffInput(input)
    expect(errors.some((e) => e.includes('at least one'))).toBe(true)
  })

  it('no idempotencyKey → error', () => {
    const input = buildMatrixHandoffInput({ idempotencyKey: '' })
    const errors = validateMatrixHandoffInput(input)
    expect(errors.some((e) => e.includes('idempotencyKey'))).toBe(true)
  })

  it('forbidden executable fields → error', () => {
    const input = { ...buildMatrixHandoffInput(), patch: [{ op: 'replace' }] }
    const errors = validateMatrixHandoffInput(input)
    expect(errors.some((e) => e.includes('forbidden'))).toBe(true)
  })
})

describe('fixture consistency', () => {
  it('buildNormalCell has has_sources state', () => {
    const cell = buildNormalCell()
    expect(cell.state).toBe('has_sources')
    expect(cell.sourceRefs.length).toBeGreaterThan(0)
    expect(cell.cellKey).not.toBe('')
  })

  it('buildEmptyCell has no sources', () => {
    const cell = buildEmptyCell()
    expect(cell.state).toBe('empty')
    expect(cell.sourceRefs).toHaveLength(0)
  })

  it('buildHiddenCell has hidden sources', () => {
    const cell = buildHiddenCell()
    expect(cell.state).toBe('hidden')
    expect(cell.hasHiddenSources).toBe(true)
  })

  it('buildStaleCell is stale', () => {
    const cell = buildStaleCell()
    expect(cell.state).toBe('stale')
    expect(cell.isStale).toBe(true)
  })

  it('buildMatrixDTO has consistent structure', () => {
    const dto = buildMatrixDTO()
    expect(dto.zeroModelCost).toBe(true)
    expect(dto.cells.length).toBeGreaterThan(0)
    expect(dto.physicalTensions.length).toBeGreaterThan(0)
  })

  it('buildMatrixDTO excludes sensitive fields', () => {
    const dto = buildMatrixDTO()
    const json = JSON.stringify(dto)
    expect(json).not.toContain('full_prompt')
    expect(json).not.toContain('api_key')
    expect(json).not.toContain('full_evidence')
    expect(json).not.toContain('model_output')
  })
})
