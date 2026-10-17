/**
 * pmo-priority-scoring-model fixtures
 *
 * 提供正常、高紧急度、权限脱敏、过期源、空组合、
 * 战略关注不可用、大组合等场景的 fixture 构建器。
 */

import type {
  PriorityScoreItem,
  PriorityScoringSummary,
  PriorityGroupSlice,
  PriorityWarning,
  PrioritySourceFreshness,
  ScoreDimensionContribution,
  PriorityTieBreaker,
  PriorityInputSignature,
  PriorityWeightVersion,
  PriorityScoreDetail,
  PriorityLevel,
  ScoreVersion,
  ScoreDimensionKey,
  SupportedPriorityGroupKey,
} from './pmo-priority-scoring-model.js'
import {
  DEFAULT_SCORE_VERSION,
  SCORE_WEIGHT_CATALOGUE,
  PRIORITY_LEVEL_SCORE_RANGE,
} from './pmo-priority-scoring-model.js'

// ─── 构建器辅助 ───────────────────────────────────────────────

export function makeTieBreaker(
  level: PriorityLevel,
  trafficLightSeverity: number,
  dueUrgency: number,
  projectId: number,
): PriorityTieBreaker {
  return { level, trafficLightSeverity, dueUrgency, projectId }
}

export function makeInputSignature(orgId: number): PriorityInputSignature {
  return {
    version: DEFAULT_SCORE_VERSION,
    organizationHash: `org-${orgId}-hash`,
    inputsHash: 'fixture-hash-abcdef01',
    computedAt: new Date().toISOString(),
  }
}

export function makeSourceFreshness(source: string, stale = false): PrioritySourceFreshness {
  return {
    source,
    refreshedAt: stale
      ? new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
      : new Date().toISOString(),
    stale,
    staleThresholdMs: 24 * 60 * 60 * 1000,
  }
}

export function makeDimensionContribution(
  dimension: ScoreDimensionKey,
  overrides: Partial<ScoreDimensionContribution> = {},
): ScoreDimensionContribution {
  const dw = SCORE_WEIGHT_CATALOGUE[DEFAULT_SCORE_VERSION].find((d) => d.key === dimension)!
  return {
    dimension,
    rawValue: 70,
    normalizedValue: 70,
    weight: dw?.weight ?? 0.1,
    weightedContribution: 7,
    availability: 'available',
    evidenceRefs: [
      { ref: `ev-${dimension}-1`, kind: 'metric', lowSensitiveLabel: `${dimension} 摘要` },
    ],
    ...overrides,
  }
}

export function makeWarning(
  code: string,
  overrides: Partial<PriorityWarning> = {},
): PriorityWarning {
  return {
    code: code as PriorityWarning['code'],
    message: `${code} 描述`,
    ...overrides,
  }
}

// ─── 正常项目评分 fixture ─────────────────────────────────────

export function makeNormalPriorityItem(
  projectId: number,
  projectName: string,
  overrides: Partial<PriorityScoreItem> = {},
): PriorityScoreItem {
  const dimensions = SCORE_WEIGHT_CATALOGUE[DEFAULT_SCORE_VERSION].map((dw) =>
    makeDimensionContribution(dw.key, {
      rawValue: 65 + Math.floor(Math.random() * 20),
      normalizedValue: 65 + Math.floor(Math.random() * 20),
      weightedContribution: 6.5,
    }),
  )
  return {
    projectId,
    projectName,
    priorityScore: 72,
    priorityLevel: 'high',
    rank: projectId,
    scoreVersion: DEFAULT_SCORE_VERSION,
    calculatedAt: new Date().toISOString(),
    inputSignature: makeInputSignature(1),
    sourceFreshness: [
      makeSourceFreshness('project', false),
      makeSourceFreshness('dashboard', false),
      makeSourceFreshness('traffic_light', false),
    ],
    dimensions,
    topReasons: dimensions.slice(0, 3),
    warnings: [],
    allowedActions: [
      { action: 'view_detail', label: '查看详情', enabled: true },
      { action: 'open_project', label: '打开项目', enabled: true },
    ],
    tieBreaker: makeTieBreaker('high', 60, 70, projectId),
    ...overrides,
  }
}

// ─── 高紧急度项目 fixture ─────────────────────────────────────

export function makeHighUrgencyPriorityItem(projectId: number): PriorityScoreItem {
  return makeNormalPriorityItem(projectId, `紧急项目-${projectId}`, {
    priorityScore: 92,
    priorityLevel: 'critical',
    dimensions: SCORE_WEIGHT_CATALOGUE[DEFAULT_SCORE_VERSION].map((dw) =>
      makeDimensionContribution(dw.key, {
        rawValue: dw.key === 'delivery_urgency' ? 98 : 80,
        normalizedValue: dw.key === 'delivery_urgency' ? 98 : 80,
      }),
    ),
    topReasons: [
      makeDimensionContribution('delivery_urgency', {
        normalizedValue: 98,
        weightedContribution: 24.5,
      }),
      makeDimensionContribution('traffic_light_severity', {
        normalizedValue: 85,
        weightedContribution: 17,
      }),
      makeDimensionContribution('risk_pressure', {
        normalizedValue: 80,
        weightedContribution: 9.6,
      }),
    ],
    tieBreaker: makeTieBreaker('critical', 90, 95, projectId),
  })
}

// ─── 权限脱敏项目 fixture ─────────────────────────────────────

export function makePermissionRestrictedPriorityItem(projectId: number): PriorityScoreItem {
  const dimensions = SCORE_WEIGHT_CATALOGUE[DEFAULT_SCORE_VERSION].map((dw) => {
    if (dw.key === 'risk_pressure' || dw.key === 'resource_pressure') {
      return makeDimensionContribution(dw.key, {
        rawValue: 0,
        normalizedValue: 0,
        weightedContribution: 0,
        availability: 'forbidden' as const,
        warning: 'DIMENSION_FORBIDDEN',
        evidenceRefs: [],
      })
    }
    return makeDimensionContribution(dw.key)
  })
  return {
    projectId,
    projectName: `脱敏项目-${projectId}`,
    priorityScore: 65,
    priorityLevel: 'high',
    rank: projectId,
    scoreVersion: DEFAULT_SCORE_VERSION,
    calculatedAt: new Date().toISOString(),
    inputSignature: makeInputSignature(1),
    sourceFreshness: [makeSourceFreshness('project', false)],
    dimensions,
    topReasons: dimensions.filter((d) => d.availability === 'available').slice(0, 3),
    warnings: [
      makeWarning('DIMENSION_FORBIDDEN', { dimension: 'risk_pressure' }),
      makeWarning('DIMENSION_FORBIDDEN', { dimension: 'resource_pressure' }),
    ],
    allowedActions: [{ action: 'view_detail', label: '查看详情', enabled: true }],
    tieBreaker: makeTieBreaker('high', 50, 50, projectId),
  }
}

// ─── 过期源项目 fixture ───────────────────────────────────────

export function makeStaleSourcePriorityItem(projectId: number): PriorityScoreItem {
  return makeNormalPriorityItem(projectId, `过期源项目-${projectId}`, {
    priorityScore: 48,
    priorityLevel: 'medium',
    sourceFreshness: [
      makeSourceFreshness('project', true),
      makeSourceFreshness('dashboard', true),
      makeSourceFreshness('traffic_light', false),
    ],
    dimensions: SCORE_WEIGHT_CATALOGUE[DEFAULT_SCORE_VERSION].map((dw) =>
      makeDimensionContribution(dw.key, {
        availability: dw.key === 'freshness' ? 'stale' : 'available',
        normalizedValue: dw.key === 'freshness' ? 30 : 55,
      }),
    ),
    warnings: [
      makeWarning('SOURCE_STALE', { source: 'project' }),
      makeWarning('SOURCE_STALE', { source: 'dashboard' }),
    ],
  })
}

// ─── 空组合 fixture ───────────────────────────────────────────

export function makeEmptyPortfolioSummary(): PriorityScoringSummary {
  return {
    totalProjects: 0,
    scoredProjects: 0,
    unscoredProjects: 0,
    levelCounts: { critical: 0, high: 0, medium: 0, low: 0, unranked: 0 },
    scoreVersion: DEFAULT_SCORE_VERSION,
    weightVersion: DEFAULT_SCORE_VERSION,
    sourceFreshness: [],
    warnings: [makeWarning('EMPTY_PORTFOLIO')],
    calculatedAt: new Date().toISOString(),
  }
}

// ─── 战略关注不可用 fixture ───────────────────────────────────

export function makeUnavailableStrategicAttentionItem(projectId: number): PriorityScoreItem {
  const dimensions = SCORE_WEIGHT_CATALOGUE[DEFAULT_SCORE_VERSION].map((dw) => {
    if (dw.key === 'management_attention') {
      return makeDimensionContribution(dw.key, {
        rawValue: 0,
        normalizedValue: 0,
        weightedContribution: 0,
        availability: 'unavailable' as const,
        warning: 'DIMENSION_UNAVAILABLE',
        evidenceRefs: [],
      })
    }
    return makeDimensionContribution(dw.key)
  })
  return makeNormalPriorityItem(projectId, `缺战略关注-${projectId}`, {
    dimensions,
    topReasons: dimensions.filter((d) => d.dimension !== 'management_attention').slice(0, 3),
    warnings: [
      makeWarning('DIMENSION_UNAVAILABLE', {
        dimension: 'management_attention',
      }),
    ],
  })
}

// ─── 大组合 fixture ───────────────────────────────────────────

export function makeLargePortfolioItems(count: number): PriorityScoreItem[] {
  const items: PriorityScoreItem[] = []
  for (let i = 0; i < count; i++) {
    // 确定性分配等级，分数严格递减以保证排序稳定性
    const level: PriorityLevel =
      i < count * 0.1 ? 'critical' : i < count * 0.35 ? 'high' : i < count * 0.7 ? 'medium' : 'low'
    const baseScore =
      level === 'critical'
        ? 99 - i
        : level === 'high'
          ? 79 - Math.floor((i - count * 0.1) * 0.08)
          : level === 'medium'
            ? 59 - Math.floor((i - count * 0.35) * 0.05)
            : 39 - Math.floor((i - count * 0.7) * 0.1)
    const score = Math.max(1, baseScore)
    items.push(
      makeNormalPriorityItem(i + 1, `项目-${String(i + 1).padStart(4, '0')}`, {
        priorityScore: score,
        priorityLevel: level,
        rank: i + 1,
        tieBreaker: makeTieBreaker(level, score - 10, score - 5, i + 1),
      }),
    )
  }
  return items
}

export function makeLargePortfolioSummary(count: number): PriorityScoringSummary {
  const criticalCount = Math.floor(count * 0.1)
  const highCount = Math.floor(count * 0.25)
  const mediumCount = Math.floor(count * 0.35)
  const lowCount = count - criticalCount - highCount - mediumCount
  return {
    totalProjects: count,
    scoredProjects: count,
    unscoredProjects: 0,
    levelCounts: {
      critical: criticalCount,
      high: highCount,
      medium: mediumCount,
      low: lowCount,
      unranked: 0,
    },
    scoreVersion: DEFAULT_SCORE_VERSION,
    weightVersion: DEFAULT_SCORE_VERSION,
    sourceFreshness: [
      makeSourceFreshness('project', false),
      makeSourceFreshness('dashboard', false),
    ],
    warnings: [],
    calculatedAt: new Date().toISOString(),
  }
}

// ─── 分组切片 fixture ─────────────────────────────────────────

export function makeGroupSlice(
  groupKey: SupportedPriorityGroupKey,
  groupValue: string,
  count: number,
  avgScore: number,
): PriorityGroupSlice {
  return {
    groupKey,
    groupValue,
    count,
    averageScore: avgScore,
    levelCounts: {
      critical: Math.floor(count * 0.1),
      high: Math.floor(count * 0.3),
      medium: Math.floor(count * 0.4),
      low: count - Math.floor(count * 0.1) - Math.floor(count * 0.3) - Math.floor(count * 0.4),
      unranked: 0,
    },
  }
}

// ─── 权重版本说明 ─────────────────────────────────────────────

export function makeWeightVersionDetail(
  version: ScoreVersion = DEFAULT_SCORE_VERSION,
): PriorityWeightVersion {
  return {
    version,
    dimensions: SCORE_WEIGHT_CATALOGUE[version],
    thresholds: PRIORITY_LEVEL_SCORE_RANGE,
    description: version === 'pmo-priority-v1' ? '首期 PMO 优先级评分模型 v1' : '',
  }
}

// ─── 项目详情评分 ─────────────────────────────────────────────

export function makePriorityDetail(projectId: number, projectName: string): PriorityScoreDetail {
  const item = makeNormalPriorityItem(projectId, projectName)
  return {
    ...item,
    groupSlices: [
      makeGroupSlice('priority_level', 'high', 25, 72.5),
      makeGroupSlice('traffic_light', 'yellow', 15, 68.3),
    ],
  }
}

// ─── 未得分项目 ───────────────────────────────────────────────

export function makeUnrankedPriorityItem(projectId: number): PriorityScoreItem {
  const dimensions = SCORE_WEIGHT_CATALOGUE[DEFAULT_SCORE_VERSION].map((dw) =>
    makeDimensionContribution(dw.key, {
      rawValue: 0,
      normalizedValue: 0,
      weightedContribution: 0,
      availability: 'unavailable' as const,
      evidenceRefs: [],
    }),
  )
  return {
    projectId,
    projectName: `未评分项目-${projectId}`,
    priorityScore: -1,
    priorityLevel: 'unranked',
    rank: -1,
    scoreVersion: DEFAULT_SCORE_VERSION,
    calculatedAt: new Date().toISOString(),
    inputSignature: makeInputSignature(1),
    sourceFreshness: [],
    dimensions,
    topReasons: [],
    warnings: [makeWarning('SOURCE_UNAVAILABLE', { source: 'project' })],
    allowedActions: [],
    tieBreaker: makeTieBreaker('unranked', -1, -1, projectId),
  }
}
