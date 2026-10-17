/**
 * PMO 组合交通灯性能测试夹具（v3-pmo-portfolio-traffic-light §4.8 P1）。
 *
 * 本文件是从 @aiproj/types 包中的 pmo-portfolio-traffic-light-fixtures.ts 的
 * 简化副本，避免 backend 测试的 rootDir 约束问题。
 */
import { scoreTrafficLight, TRAFFIC_LIGHT_RULE_VERSION } from '@aiproj/types'
import type {
  TrafficLightScoringInput,
  TrafficLightStatus,
  PortfolioTrafficLightItem,
} from '@aiproj/types'

// ─── 批量场景 Builder ─────────────────────────────────────────────────────────

export interface GeneratedTrafficLightItem {
  item: PortfolioTrafficLightItem
  input: TrafficLightScoringInput
}

/**
 * 生成 N 个项目的交通灯摘要（混合分布）。
 */
export function generateLargePortfolio(count: number): GeneratedTrafficLightItem[] {
  const redCount = Math.floor(count * 0.3)
  const yellowCount = Math.floor(count * 0.3)
  const greenCount = Math.floor(count * 0.3)
  const grayCount = count - redCount - yellowCount - greenCount

  const results: GeneratedTrafficLightItem[] = []
  let idx = 0

  for (let i = 0; i < redCount; i++) {
    const input = makeRedInput(i)
    const scoring = scoreTrafficLight(input)
    results.push({ item: makeItem(idx++, scoring.status, scoring, `红灯项目-${i + 1}`), input })
  }
  for (let i = 0; i < yellowCount; i++) {
    const input = makeYellowInput(i)
    const scoring = scoreTrafficLight(input)
    results.push({ item: makeItem(idx++, scoring.status, scoring, `黄灯项目-${i + 1}`), input })
  }
  for (let i = 0; i < greenCount; i++) {
    const input = makeGreenInput()
    const scoring = scoreTrafficLight(input)
    results.push({ item: makeItem(idx++, scoring.status, scoring, `绿灯项目-${i + 1}`), input })
  }
  for (let i = 0; i < grayCount; i++) {
    const input = makeGrayInput()
    const scoring = scoreTrafficLight(input)
    results.push({ item: makeItem(idx++, scoring.status, scoring, `灰灯项目-${i + 1}`), input })
  }

  return results
}

export function generateStaleSourcePortfolio(count: number): GeneratedTrafficLightItem[] {
  const results: GeneratedTrafficLightItem[] = []
  const staleTime = new Date(Date.now() - 120 * 60 * 1000).toISOString()
  for (let i = 0; i < count; i++) {
    const input = makeGreenInput()
    input.healthDiagnosis.updatedAt = staleTime
    input.prediction.updatedAt = staleTime
    input.sources = [
      {
        type: 'project_dashboard',
        available: true,
        forbidden: false,
        stale: true,
        updatedAt: staleTime,
      },
      {
        type: 'health_diagnosis',
        available: true,
        forbidden: false,
        stale: true,
        updatedAt: staleTime,
      },
      { type: 'prediction', available: true, forbidden: false, stale: true, updatedAt: staleTime },
      {
        type: 'task',
        available: true,
        forbidden: false,
        stale: false,
        updatedAt: new Date().toISOString(),
      },
    ]
    const scoring = scoreTrafficLight(input)
    results.push({ item: makeItem(i, scoring.status, scoring, `数据过期项目-${i + 1}`), input })
  }
  return results
}

export function generatePermissionRestrictedPortfolio(count: number): GeneratedTrafficLightItem[] {
  const results: GeneratedTrafficLightItem[] = []
  for (let i = 0; i < count; i++) {
    const forbidRisk = i % 3 === 0
    const forbidResource = i % 3 === 1
    const input = makeGreenInput()
    input.risk = {
      available: !forbidRisk,
      forbidden: forbidRisk,
      highRiskCount: 0,
      criticalRiskCount: 0,
      updatedAt: forbidRisk ? null : new Date().toISOString(),
    }
    input.resource = {
      available: !forbidResource,
      forbidden: forbidResource,
      overloadCount: 0,
      maxUtilization: 80,
      updatedAt: forbidResource ? null : new Date().toISOString(),
    }
    input.sources = [
      {
        type: 'project_dashboard',
        available: true,
        forbidden: false,
        stale: false,
        updatedAt: new Date().toISOString(),
      },
      {
        type: 'task',
        available: true,
        forbidden: false,
        stale: false,
        updatedAt: new Date().toISOString(),
      },
      {
        type: 'risk',
        available: !forbidRisk,
        forbidden: forbidRisk,
        stale: false,
        updatedAt: forbidRisk ? null : new Date().toISOString(),
      },
      {
        type: 'resource',
        available: !forbidResource,
        forbidden: forbidResource,
        stale: false,
        updatedAt: forbidResource ? null : new Date().toISOString(),
      },
    ]
    const scoring = scoreTrafficLight(input)
    results.push({ item: makeItem(i, scoring.status, scoring, `权限受限项目-${i + 1}`), input })
  }
  return results
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

function makeGreenInput(): TrafficLightScoringInput {
  const now = new Date().toISOString()
  return {
    healthDiagnosis: {
      available: true,
      forbidden: false,
      overallLabel: 'healthy',
      overallScore: 90,
      updatedAt: now,
    },
    prediction: { available: true, forbidden: false, highestSeverity: 'low', updatedAt: now },
    risk: {
      available: true,
      forbidden: false,
      highRiskCount: 0,
      criticalRiskCount: 0,
      updatedAt: now,
    },
    resource: {
      available: true,
      forbidden: false,
      overloadCount: 0,
      maxUtilization: 80,
      updatedAt: now,
    },
    task: {
      available: true,
      forbidden: false,
      overdueCount: 0,
      soonDueCount: 0,
      totalCount: 10,
      updatedAt: now,
    },
    milestone: {
      available: true,
      forbidden: false,
      atRiskCount: 0,
      missedCount: 0,
      updatedAt: now,
    },
    changeImpact: {
      available: true,
      forbidden: false,
      openCount: 0,
      highImpactCount: 0,
      updatedAt: now,
    },
    sources: [
      {
        type: 'project_dashboard',
        available: true,
        forbidden: false,
        stale: false,
        updatedAt: now,
      },
      { type: 'health_diagnosis', available: true, forbidden: false, stale: false, updatedAt: now },
      { type: 'prediction', available: true, forbidden: false, stale: false, updatedAt: now },
      { type: 'risk', available: true, forbidden: false, stale: false, updatedAt: now },
      { type: 'resource', available: true, forbidden: false, stale: false, updatedAt: now },
      { type: 'task', available: true, forbidden: false, stale: false, updatedAt: now },
      { type: 'milestone', available: true, forbidden: false, stale: false, updatedAt: now },
      { type: 'change_impact', available: true, forbidden: false, stale: false, updatedAt: now },
    ],
  }
}

function makeRedInput(i: number): TrafficLightScoringInput {
  const input = makeGreenInput()
  input.healthDiagnosis = {
    available: true,
    forbidden: false,
    overallLabel: 'critical',
    overallScore: 10 + (i % 30),
    updatedAt: new Date().toISOString(),
  }
  input.risk = {
    available: true,
    forbidden: false,
    highRiskCount: 2,
    criticalRiskCount: 1 + (i % 3),
    updatedAt: new Date().toISOString(),
  }
  return input
}

function makeYellowInput(i: number): TrafficLightScoringInput {
  const input = makeGreenInput()
  input.healthDiagnosis = {
    available: true,
    forbidden: false,
    overallLabel: 'warning',
    overallScore: 50 + (i % 20),
    updatedAt: new Date().toISOString(),
  }
  input.task = {
    available: true,
    forbidden: false,
    overdueCount: 2,
    soonDueCount: 1,
    totalCount: 10,
    updatedAt: new Date().toISOString(),
  }
  return input
}

function makeGrayInput(): TrafficLightScoringInput {
  return {
    healthDiagnosis: {
      available: false,
      forbidden: false,
      overallLabel: null,
      overallScore: null,
      updatedAt: null,
    },
    prediction: { available: false, forbidden: false, highestSeverity: null, updatedAt: null },
    risk: {
      available: false,
      forbidden: false,
      highRiskCount: 0,
      criticalRiskCount: 0,
      updatedAt: null,
    },
    resource: {
      available: false,
      forbidden: false,
      overloadCount: 0,
      maxUtilization: null,
      updatedAt: null,
    },
    task: {
      available: false,
      forbidden: false,
      overdueCount: 0,
      soonDueCount: 0,
      totalCount: 0,
      updatedAt: null,
    },
    milestone: {
      available: false,
      forbidden: false,
      atRiskCount: 0,
      missedCount: 0,
      updatedAt: null,
    },
    changeImpact: {
      available: false,
      forbidden: false,
      openCount: 0,
      highImpactCount: 0,
      updatedAt: null,
    },
    sources: [],
  }
}

function makeItem(
  id: number,
  status: TrafficLightStatus,
  scoring: ReturnType<typeof scoreTrafficLight>,
  name: string,
): PortfolioTrafficLightItem {
  return {
    projectId: 1000 + id,
    projectName: name,
    projectStatus: 'active',
    trafficLight: status,
    severityCounts: scoring.severities,
    sourceFreshness: {
      overallStale: false,
      staleSources: [],
      lastUpdatedAt: new Date().toISOString(),
    },
    evidence: scoring.evidence,
    warnings: scoring.warnings,
    reviewState: { reviewState: 'acknowledged', reviewedAt: null, reviewedBy: null, stale: false },
    ruleVersion: TRAFFIC_LIGHT_RULE_VERSION,
    calculatedAt: new Date().toISOString(),
    allowedActions: { canReview: true, canViewDetail: true },
  }
}
