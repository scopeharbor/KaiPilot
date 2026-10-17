/**
 * compatibility-matrix.test —— 兼容矩阵单元测试（§5.1、§5.2、§5.3 P0）。
 */
import { describe, expect, it } from 'vitest'
import { runCompatibilityMatrix } from './compatibility-matrix.js'
import { CONTRACT_CATALOG } from './contract-versioning.js'

describe('compatibility matrix', () => {
  it('passes all entries', () => {
    const result = runCompatibilityMatrix()
    if (!result.passed) {
      const failed = result.entries.filter((e) => !e.passed)
      console.error('Failed entries:', JSON.stringify(failed, null, 2))
    }
    expect(result.passed).toBe(true)
  })

  it('produces non-empty entries', () => {
    const result = runCompatibilityMatrix()
    expect(result.entries.length).toBeGreaterThan(0)
  })

  it('all entries have contractId matching catalog', () => {
    const result = runCompatibilityMatrix()
    const catalogIds = Object.keys(CONTRACT_CATALOG)
    for (const entry of result.entries) {
      expect(catalogIds).toContain(entry.contractId)
    }
  })

  it('no drift warnings for currentVersion', () => {
    const result = runCompatibilityMatrix()
    // driftWarnings 可能包含信息性备注，但不应有错误
    const errors = result.driftWarnings.filter(
      (w) => w.includes('not a valid') || w.includes('redundant'),
    )
    expect(errors.length).toBe(0)
  })
})
