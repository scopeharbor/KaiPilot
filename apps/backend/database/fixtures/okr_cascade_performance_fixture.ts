// OKR 级联与对齐 性能 Fixture 辅助
// v3-okr-cascade-and-alignment §2.5 (P1)
//
// 放在 database/fixtures 而非 database/seeders：本文件只导出构造函数、没有 default
// 导出的 Seeder 类，而 AdonisJS 的 seeder 发现机制会扫描整个 database/seeders 目录，
// 扫到它就报 Missing default export ... schema file 并让 db:seed 整体失败。

import {
  makeOkrCycle,
  makeOkrObjective,
  makeOkrKeyResult,
  makeOkrAlignment,
  makeOkrObjectiveRelation,
} from '@aiproj/types'

/**
 * 生成 1000+ objectives + 密集采样关系的性能测试 fixture。
 * 不依赖外部服务，可本地 SQLite 使用。
 */
export function makePerformanceCascadeFixture(organizationId = 1, objectiveCount = 1000) {
  const cycle = makeOkrCycle({ id: 1, organizationId, title: '2026 Q3 Performance Test' })
  const objectives: ReturnType<typeof makeOkrObjective>[] = []
  const keyResults: ReturnType<typeof makeOkrKeyResult>[] = []
  const alignments: ReturnType<typeof makeOkrAlignment>[] = []
  const relations: ReturnType<typeof makeOkrObjectiveRelation>[] = []

  for (let i = 1; i <= objectiveCount; i++) {
    const parentId = i > 1 ? i - 1 : null
    const scope =
      i % 4 === 0 ? 'project' : i % 4 === 1 ? 'team' : i % 4 === 2 ? 'organization' : 'team'

    objectives.push(
      makeOkrObjective({
        id: i,
        organizationId,
        cycleId: 1,
        title: `目标 ${i} (${scope})`,
        scope: scope as any,
        progress: Math.round((i / objectiveCount) * 100),
      }),
    )

    // 每目标 1-2 个 KR
    keyResults.push(
      makeOkrKeyResult({
        id: i * 2 - 1,
        organizationId,
        objectiveId: i,
        title: `KR ${i}A`,
        currentValue: Math.round(Math.random() * 100),
        targetValue: 100,
        weight: 50 + (i % 51),
      }),
    )
    if (i % 3 !== 0) {
      keyResults.push(
        makeOkrKeyResult({
          id: i * 2,
          organizationId,
          objectiveId: i,
          title: `KR ${i}B`,
          currentValue: Math.round(Math.random() * 100),
          targetValue: 100,
          weight: 50 - (i % 51),
        }),
      )
    }

    // 父子 hierarchy
    if (parentId && i % 5 !== 0) {
      alignments.push(
        makeOkrAlignment({
          id: i,
          organizationId,
          childObjectiveId: i,
          parentObjectiveId: parentId,
        }),
      )
    }

    // 横向关系：每 10 个目标间插入采样关系
    if (i > 10 && i % 10 === 0) {
      relations.push(
        makeOkrObjectiveRelation({
          id: i / 10,
          organizationId,
          sourceObjectiveId: i - 5,
          targetObjectiveId: i,
          relationType: i % 20 === 0 ? 'conflicts_with' : 'supports',
          status: 'active',
        }),
      )
      relations.push(
        makeOkrObjectiveRelation({
          id: i / 10 + objectiveCount,
          organizationId,
          sourceObjectiveId: i - 7,
          targetObjectiveId: i - 1,
          relationType: 'contributes_to',
          status: 'active',
        }),
      )
    }
  }

  return { cycle, objectives, keyResults, alignments, relations, totalRelations: relations.length }
}
