// @aiproj/types —— Strategy Execution Cockpit fixtures（前后端共享）。
// v3-strategy-execution-cockpit §2.11：normal/empty/degraded/forbidden/stale/large 夹具。
//
// 夹具只构造低敏内部事实（CockpitObjectiveFact / KeyResultFact / MappingFact 等），
// 不包含 prompt/model output/evidence 全文/Authorization/token/apiKey。

import {
  COCKPIT_MAPPING_KINDS,
  type CockpitMappingFact,
  type CockpitObjectiveFact,
} from './strategy-execution-cockpit.js'

const ORG = 10

export function buildCockpitObjectiveFact(
  overrides: Partial<CockpitObjectiveFact> = {},
): CockpitObjectiveFact {
  return {
    id: 1,
    organizationId: ORG,
    cycleId: 1,
    projectId: null,
    scope: 'team',
    title: '提升项目交付健康度',
    status: 'active',
    progress: 40,
    confidence: 'medium',
    priorityBand: 'high',
    updatedAt: '2026-07-29T00:00:00.000Z',
    ...overrides,
  }
}

export function buildCockpitMappingFact(
  overrides: Partial<CockpitMappingFact> = {},
): CockpitMappingFact {
  return {
    id: 1,
    organizationId: ORG,
    objectiveId: 1,
    keyResultId: null,
    projectId: 100,
    kind: COCKPIT_MAPPING_KINDS.DIRECT_PROJECT_CONTRIBUTION,
    weight: 1,
    contributionPercent: 20,
    active: true,
    deletedAt: null,
    sourceVersion: 'okr-mapping.v1',
    targetVisible: true,
    ...overrides,
  }
}

export interface CockpitFixtureInput {
  objectives: CockpitObjectiveFact[]
  mappings: CockpitMappingFact[]
  visibleProjectIds: Set<number>
}

export function buildCockpitNormalFixture(): CockpitFixtureInput {
  return {
    objectives: [
      buildCockpitObjectiveFact({ id: 1, title: '战略目标 A', progress: 60 }),
      buildCockpitObjectiveFact({ id: 2, title: '战略目标 B', progress: 30, priorityBand: 'high' }),
    ],
    mappings: [
      buildCockpitMappingFact({ id: 1, objectiveId: 1, projectId: 100 }),
      buildCockpitMappingFact({ id: 2, objectiveId: 2, projectId: 101, weight: 0.5 }),
    ],
    visibleProjectIds: new Set([100, 101]),
  }
}

export function buildCockpitEmptyFixture(): CockpitFixtureInput {
  return { objectives: [], mappings: [], visibleProjectIds: new Set() }
}

export function buildCockpitDegradedFixture(): CockpitFixtureInput {
  return {
    objectives: [buildCockpitObjectiveFact({ id: 1, progress: 10 })],
    mappings: [buildCockpitMappingFact({ id: 1, objectiveId: 1, projectId: 100, active: false })],
    visibleProjectIds: new Set([100]),
  }
}

export function buildCockpitForbiddenFixture(): CockpitFixtureInput {
  return {
    objectives: [buildCockpitObjectiveFact({ id: 1 })],
    mappings: [
      buildCockpitMappingFact({ id: 1, objectiveId: 1, projectId: 999, targetVisible: false }),
    ],
    visibleProjectIds: new Set([100]),
  }
}

export function buildCockpitStaleFixture(): CockpitFixtureInput {
  return {
    objectives: [buildCockpitObjectiveFact({ id: 1, updatedAt: '2020-01-01T00:00:00.000Z' })],
    mappings: [buildCockpitMappingFact({ id: 1, objectiveId: 1, projectId: 100 })],
    visibleProjectIds: new Set([100]),
  }
}

export function buildCockpitLargeFixture(count = 1000): CockpitFixtureInput {
  const objectives: CockpitObjectiveFact[] = []
  const mappings: CockpitMappingFact[] = []
  const visibleProjectIds = new Set<number>()
  for (let index = 0; index < count; index += 1) {
    const id = index + 1
    objectives.push(buildCockpitObjectiveFact({ id, title: `目标 ${id}`, progress: index % 100 }))
    const projectId = 1000 + index
    visibleProjectIds.add(projectId)
    mappings.push(buildCockpitMappingFact({ id, objectiveId: id, projectId }))
  }
  return { objectives, mappings, visibleProjectIds }
}
