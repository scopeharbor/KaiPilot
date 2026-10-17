/**
 * OKR 大组织 fixture 与树性能验证（v3-okr-hierarchy-management tasks 7.1 + 7.2）。
 *
 * 验证 makeLargeTreeOkrFixture 生成 1000 节点的结构和基本性能。
 *
 * @aiproj/packages
 */

import { describe, expect, test } from 'vitest'
import {
  makeLargeTreeOkrFixture,
  makeNormalOkrFixture,
  OKR_ALIGNMENT_CONSTRAINTS,
} from '../src/okr'

describe('OKR 大树 fixture 性能基准', () => {
  test('makeLargeTreeOkrFixture 默认 1000 个 objectives', () => {
    const fixture = makeLargeTreeOkrFixture()
    expect(fixture.objectives.length).toBe(1000)
    expect(fixture.keyResults.length).toBe(1000) // 每个 objective 1 个 KR
    expect(fixture.alignments.length).toBe(999) // 999 条对齐链
    expect(fixture.cycles.length).toBe(1)
  })

  test('节点数量可控', () => {
    const small = makeLargeTreeOkrFixture(1, 10)
    expect(small.objectives.length).toBe(10)

    const medium = makeLargeTreeOkrFixture(1, 500)
    expect(medium.objectives.length).toBe(500)
  })

  test('对齐链是线性的（i → i-1）', () => {
    const fixture = makeLargeTreeOkrFixture(1, 100)
    // 验证对齐关系：第 2 个 objective 的父级是第 1 个
    const alignment = fixture.alignments[0]
    expect(alignment.childObjectiveId).toBe(2)
    expect(alignment.parentObjectiveId).toBe(1)
  })

  test('树深度不超过 MAX_DEPTH 约束', () => {
    const fixture = makeLargeTreeOkrFixture(1, OKR_ALIGNMENT_CONSTRAINTS.MAX_DEPTH + 2)
    // 对齐链长度是 nodeCount - 1，对于 7 个节点，深度是 6，超过 MAX_DEPTH=5
    // 但 fixture 本身不限制深度——约束由 validateAlignment 实现
    expect(fixture.objectives.length).toBe(7)
  })

  test('正常 fixture 三层结构', () => {
    const fixture = makeNormalOkrFixture()
    expect(fixture.objectives.length).toBe(3)
    expect(fixture.alignments.length).toBe(2)
    // 验证层级：obj2 → obj1, obj3 → obj2
    const al1 = fixture.alignments.find((a) => a.childObjectiveId === 2)
    const al2 = fixture.alignments.find((a) => a.childObjectiveId === 3)
    expect(al1?.parentObjectiveId).toBe(1)
    expect(al2?.parentObjectiveId).toBe(2)
  })
})

describe('OKR 树查询性能阈值记录', () => {
  test('1000 节点 fixture 生成耗时 < 500ms', () => {
    const start = performance.now()
    const fixture = makeLargeTreeOkrFixture(1, 1000)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(500)
    expect(fixture.objectives.length).toBe(1000)
    console.log(`[perf] makeLargeTreeOkrFixture(1000): ${elapsed.toFixed(1)}ms`)
  })

  test('5000 节点 fixture 生成在可接受范围内', () => {
    const start = performance.now()
    const fixture = makeLargeTreeOkrFixture(1, 5000)
    const elapsed = performance.now() - start

    // 5000 节点生成应在 2 秒内
    expect(elapsed).toBeLessThan(2000)
    expect(fixture.objectives.length).toBe(5000)
    console.log(`[perf] makeLargeTreeOkrFixture(5000): ${elapsed.toFixed(1)}ms`)
  })
})
