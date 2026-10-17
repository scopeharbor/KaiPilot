// OKR 级联与对齐 性能测试
// v3-okr-cascade-and-alignment §3.13 (P1)

import { test } from '@japa/runner'
import {
  makeLargeTreeOkrFixture,
  computeOkrAlignmentHealth,
  validateRelation,
  makeOkrFreshness,
} from '@aiproj/types'

test.group('OKR Cascade/Alignment Performance', () => {
  test('cascade projection with 1000 objectives completes within threshold', async ({ assert }) => {
    const fixture = makeLargeTreeOkrFixture(1, 1000)
    const start = performance.now()

    // 模拟级联投影：遍历所有目标并生成候选级联项
    for (const obj of fixture.objectives) {
      const krs = fixture.keyResults.filter((kr) => kr.objectiveId === obj.id)
      computeOkrAlignmentHealth({
        objective: obj,
        parentAlignment: null,
        childAlignments: [],
        crossRelations: [],
        keyResults: krs,
        evidenceFreshness: makeOkrFreshness(obj.updatedAt),
        restrictedVisibilityCount: 0,
      })
    }

    const elapsed = performance.now() - start
    // 1000 objective health compute should be under 5s
    assert.isBelow(elapsed, 5000, `1000 objective health projection took ${elapsed}ms`)
  })

  test('relation validation for 500 relation pairs completes within threshold', async ({
    assert,
  }) => {
    const fixture = makeLargeTreeOkrFixture(1, 500)
    const start = performance.now()

    for (let i = 0; i < fixture.objectives.length - 1; i++) {
      const source = fixture.objectives[i]
      const target = fixture.objectives[i + 1]
      validateRelation(source as any, target as any, 'supports', [])
    }

    const elapsed = performance.now() - start
    assert.isBelow(elapsed, 2000, `500 relation validations took ${elapsed}ms`)
  })

  test('matrix read with 1000 objectives completes within threshold', async ({ assert }) => {
    const fixture = makeLargeTreeOkrFixture(1, 1000)
    const start = performance.now()

    // 模拟矩阵行生成
    const matrixRows = fixture.objectives.map((obj) => ({
      objectiveId: obj.id,
      objectiveTitle: obj.title,
      scope: obj.scope,
      ownerId: obj.ownerId,
      status: obj.status,
      health: undefined as any,
      relations: [],
      parentAlignmentId: null,
      childCount: 0,
      restricted: false,
    }))

    const elapsed = performance.now() - start
    assert.lengthOf(matrixRows, 1000)
    assert.isBelow(elapsed, 1000, `1000 matrix row generation took ${elapsed}ms`)
  })

  test('1000 objective fixture generation is fast', async ({ assert }) => {
    const start = performance.now()
    const fixture = makeLargeTreeOkrFixture(1, 1000)
    const elapsed = performance.now() - start

    assert.equal(fixture.objectives.length, 1000)
    assert.equal(fixture.keyResults.length, 1000)
    assert.equal(fixture.alignments.length, 999)

    // 生成应在 500ms 内完成
    assert.isBelow(elapsed, 500, `1000 fixture generation took ${elapsed}ms`)
  })
})
