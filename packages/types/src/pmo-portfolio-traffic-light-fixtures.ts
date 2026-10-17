/**
 * PMO 组合交通灯测试夹具 Builder（v3-pmo-portfolio-traffic-light §2.4 P1）。
 *
 * 用于大组织场景、权限受限维度、stale 来源摘要、混合交通灯分布等测试。
 */
import type {
  TrafficLightScoringInput,
  TrafficLightStatus,
  TrafficLightSeverity,
  PortfolioTrafficLightItem,
} from '@aiproj/types'
import { TRAFFIC_LIGHT_RULE_VERSION, scoreTrafficLight } from '@aiproj/types'

// ─── 基础信号工厂 ─────────────────────────────────────────────────────────────────

export interface MakeSignalOptions {
  /** 是否来源可用（默认 true） */
  available?: boolean
  /** 是否权限禁止（默认 false） */
  forbidden?: boolean
}

export function makeHealthSignal(
  opts?: {
    overallLabel?: 'healthy' | 'attention' | 'warning' | 'critical' | null
    overallScore?: number | null
    updatedAt?: string | null
  } & MakeSignalOptions,
) {
  return {
    available: opts?.available ?? true,
    forbidden: opts?.forbidden ?? false,
    overallLabel: opts?.overallLabel ?? 'healthy',
    overallScore: opts?.overallScore ?? 90,
    updatedAt: opts?.updatedAt ?? new Date().toISOString(),
  }
}

export function makePredictionSignal(
  opts?: {
    highestSeverity?: TrafficLightSeverity | null
    updatedAt?: string | null
  } & MakeSignalOptions,
) {
  return {
    available: opts?.available ?? true,
    forbidden: opts?.forbidden ?? false,
    highestSeverity: opts?.highestSeverity ?? 'low',
    updatedAt: opts?.updatedAt ?? new Date().toISOString(),
  }
}

export function makeRiskSignal(
  opts?: {
    highRiskCount?: number
    criticalRiskCount?: number
    updatedAt?: string | null
  } & MakeSignalOptions,
) {
  return {
    available: opts?.available ?? true,
    forbidden: opts?.forbidden ?? false,
    highRiskCount: opts?.highRiskCount ?? 0,
    criticalRiskCount: opts?.criticalRiskCount ?? 0,
    updatedAt: opts?.updatedAt ?? new Date().toISOString(),
  }
}

export function makeResourceSignal(
  opts?: {
    overloadCount?: number
    maxUtilization?: number | null
    updatedAt?: string | null
  } & MakeSignalOptions,
) {
  return {
    available: opts?.available ?? true,
    forbidden: opts?.forbidden ?? false,
    overloadCount: opts?.overloadCount ?? 0,
    maxUtilization: opts?.maxUtilization ?? 80,
    updatedAt: opts?.updatedAt ?? new Date().toISOString(),
  }
}

export function makeTaskSignal(
  opts?: {
    overdueCount?: number
    soonDueCount?: number
    totalCount?: number
    updatedAt?: string | null
  } & MakeSignalOptions,
) {
  return {
    available: opts?.available ?? true,
    forbidden: opts?.forbidden ?? false,
    overdueCount: opts?.overdueCount ?? 0,
    soonDueCount: opts?.soonDueCount ?? 0,
    totalCount: opts?.totalCount ?? 10,
    updatedAt: opts?.updatedAt ?? new Date().toISOString(),
  }
}

export function makeMilestoneSignal(
  opts?: {
    atRiskCount?: number
    missedCount?: number
    updatedAt?: string | null
  } & MakeSignalOptions,
) {
  return {
    available: opts?.available ?? true,
    forbidden: opts?.forbidden ?? false,
    atRiskCount: opts?.atRiskCount ?? 0,
    missedCount: opts?.missedCount ?? 0,
    updatedAt: opts?.updatedAt ?? new Date().toISOString(),
  }
}

export function makeChangeSignal(
  opts?: {
    openCount?: number
    highImpactCount?: number
    updatedAt?: string | null
  } & MakeSignalOptions,
) {
  return {
    available: opts?.available ?? true,
    forbidden: opts?.forbidden ?? false,
    openCount: opts?.openCount ?? 0,
    highImpactCount: opts?.highImpactCount ?? 0,
    updatedAt: opts?.updatedAt ?? new Date().toISOString(),
  }
}

// ─── Scoring Input Builder ──────────────────────────────────────────────────────

export function makeScoringInput(
  overrides?: Partial<TrafficLightScoringInput>,
): TrafficLightScoringInput {
  const now = new Date().toISOString()
  return {
    healthDiagnosis: makeHealthSignal(),
    prediction: makePredictionSignal(),
    risk: makeRiskSignal(),
    resource: makeResourceSignal(),
    task: makeTaskSignal(),
    milestone: makeMilestoneSignal(),
    changeImpact: makeChangeSignal(),
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
    ...overrides,
  }
}

// ─── 批量场景 Builder ─────────────────────────────────────────────────────────

export interface GeneratedTrafficLightItem {
  item: PortfolioTrafficLightItem
  input: TrafficLightScoringInput
}

/**
 * 生成 N 个项目的交通灯摘要（混合分布）。
 *
 * @param count 项目数量
 * @param distribution 交通灯分布（默认：30% red, 30% yellow, 30% green, 10% gray）
 */
export function generateLargePortfolio(
  count: number,
  distribution?: Partial<Record<TrafficLightStatus, number>>,
): GeneratedTrafficLightItem[] {
  const dist: Record<TrafficLightStatus, number> = {
    red: distribution?.red ?? 0.3,
    yellow: distribution?.yellow ?? 0.3,
    green: distribution?.green ?? 0.3,
    gray: distribution?.gray ?? 0.1,
  }

  // 按比例分配到每种灯色
  const redCount = Math.floor(count * dist.red)
  const yellowCount = Math.floor(count * dist.yellow)
  const greenCount = Math.floor(count * dist.green)
  const grayCount = count - redCount - yellowCount - greenCount

  const results: GeneratedTrafficLightItem[] = []
  let idx = 0

  // 红灯：critical health + critical risks
  for (let i = 0; i < redCount; i++) {
    const input = makeScoringInput({
      healthDiagnosis: makeHealthSignal({ overallLabel: 'critical', overallScore: 10 + (i % 30) }),
      risk: makeRiskSignal({ criticalRiskCount: 1 + (i % 3), highRiskCount: 2 }),
    })
    const scoring = scoreTrafficLight(input)
    results.push({
      item: makePortfolioItem(idx++, scoring.status, scoring, `红灯项目-${i + 1}`),
      input,
    })
  }

  // 黄灯：warning health + 部分逾期
  for (let i = 0; i < yellowCount; i++) {
    const input = makeScoringInput({
      healthDiagnosis: makeHealthSignal({ overallLabel: 'warning', overallScore: 50 + (i % 20) }),
      task: makeTaskSignal({ overdueCount: 2, totalCount: 10 }),
    })
    const scoring = scoreTrafficLight(input)
    results.push({
      item: makePortfolioItem(idx++, scoring.status, scoring, `黄灯项目-${i + 1}`),
      input,
    })
  }

  // 绿灯：干净数据
  for (let i = 0; i < greenCount; i++) {
    const input = makeScoringInput()
    const scoring = scoreTrafficLight(input)
    results.push({
      item: makePortfolioItem(idx++, scoring.status, scoring, `绿灯项目-${i + 1}`),
      input,
    })
  }

  // 灰灯：数据不可用
  for (let i = 0; i < grayCount; i++) {
    const input = makeScoringInput({
      healthDiagnosis: makeHealthSignal({ available: false }),
      prediction: makePredictionSignal({ available: false }),
      risk: makeRiskSignal({ available: false }),
      resource: makeResourceSignal({ available: false }),
      task: makeTaskSignal({ available: false, totalCount: 0 }),
      milestone: makeMilestoneSignal({ available: false }),
      changeImpact: makeChangeSignal({ available: false }),
      sources: [],
    })
    const scoring = scoreTrafficLight(input)
    results.push({
      item: makePortfolioItem(idx++, scoring.status, scoring, `灰灯项目-${i + 1}`),
      input,
    })
  }

  return results
}

/**
 * 生成权限受限场景：某些维度标记为 forbidden。
 */
export function generatePermissionRestrictedPortfolio(count: number): GeneratedTrafficLightItem[] {
  const results: GeneratedTrafficLightItem[] = []

  for (let i = 0; i < count; i++) {
    // 随机禁止 1-3 个维度
    const forbiddenDims = new Set(
      ['risk', 'resource', 'prediction'].filter(() => Math.random() > 0.5),
    )

    const input = makeScoringInput({
      risk: makeRiskSignal({
        forbidden: forbiddenDims.has('risk'),
        available: !forbiddenDims.has('risk'),
        updatedAt: forbiddenDims.has('risk') ? null : new Date().toISOString(),
      }),
      resource: makeResourceSignal({
        forbidden: forbiddenDims.has('resource'),
        available: !forbiddenDims.has('resource'),
        updatedAt: forbiddenDims.has('resource') ? null : new Date().toISOString(),
      }),
      prediction: makePredictionSignal({
        forbidden: forbiddenDims.has('prediction'),
        available: !forbiddenDims.has('prediction'),
        updatedAt: forbiddenDims.has('prediction') ? null : new Date().toISOString(),
      }),
      sources: [
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
          available: !forbiddenDims.has('risk'),
          forbidden: forbiddenDims.has('risk'),
          stale: false,
          updatedAt: forbiddenDims.has('risk') ? null : new Date().toISOString(),
        },
        {
          type: 'resource',
          available: !forbiddenDims.has('resource'),
          forbidden: forbiddenDims.has('resource'),
          stale: false,
          updatedAt: forbiddenDims.has('resource') ? null : new Date().toISOString(),
        },
        {
          type: 'prediction',
          available: !forbiddenDims.has('prediction'),
          forbidden: forbiddenDims.has('prediction'),
          stale: false,
          updatedAt: forbiddenDims.has('prediction') ? null : new Date().toISOString(),
        },
      ],
    })
    const scoring = scoreTrafficLight(input)
    results.push({
      item: makePortfolioItem(i, scoring.status, scoring, `权限受限项目-${i + 1}`),
      input,
    })
  }

  return results
}

/**
 * 生成 stale 来源场景：所有项目的某些来源数据已过期。
 */
export function generateStaleSourcePortfolio(count: number): GeneratedTrafficLightItem[] {
  const results: GeneratedTrafficLightItem[] = []
  const staleTime = new Date(Date.now() - 120 * 60 * 1000).toISOString() // 2 小时前

  for (let i = 0; i < count; i++) {
    const input = makeScoringInput({
      healthDiagnosis: makeHealthSignal({ updatedAt: staleTime }),
      prediction: makePredictionSignal({ updatedAt: staleTime }),
      sources: [
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
        {
          type: 'prediction',
          available: true,
          forbidden: false,
          stale: true,
          updatedAt: staleTime,
        },
        {
          type: 'task',
          available: true,
          forbidden: false,
          stale: false,
          updatedAt: new Date().toISOString(),
        },
      ],
    })
    const scoring = scoreTrafficLight(input)
    results.push({
      item: makePortfolioItem(i, scoring.status, scoring, `数据过期项目-${i + 1}`),
      input,
    })
  }

  return results
}

// ─── Helper ────────────────────────────────────────────────────────────────────

function makePortfolioItem(
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
    reviewState: {
      reviewState: 'acknowledged',
      reviewedAt: null,
      reviewedBy: null,
      stale: false,
    },
    ruleVersion: TRAFFIC_LIGHT_RULE_VERSION,
    calculatedAt: new Date().toISOString(),
    allowedActions: { canReview: true, canViewDetail: true },
  }
}
