// @aiproj/types —— 组织资源池测试夹具（前后端共享）。
// v3-organization-resource-pool §2.4：empty / normal / restricted / stale / overloaded / skill-gap / contention / cache-degraded。
import type {
  OrganizationResourcePoolSummary,
  OrganizationResourcePoolCapacityMatrix,
  OrganizationResourcePoolSkillItem,
  OrganizationResourcePoolConflict,
  OrganizationResourcePoolDemandGap,
  OrganizationResourcePoolResourceRow,
  OrganizationResourcePoolMeta,
  OrganizationResourcePoolSourceFreshness,
} from './organization-resource-pool.js'
import {
  ORGANIZATION_RESOURCE_POOL_METRIC_KEYS,
  ORGANIZATION_RESOURCE_POOL_METRIC_VERSION,
  ORGANIZATION_RESOURCE_POOL_SOURCES,
  ORGANIZATION_RESOURCE_POOL_STATUSES,
  ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES,
  ORGANIZATION_RESOURCE_POOL_WARNING_CODES,
  ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITIES,
  makeOrganizationResourcePoolFreshness,
} from './organization-resource-pool.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function baseMeta(
  organizationId: number,
  actorId: number,
  visibleProjectCount: number,
): OrganizationResourcePoolMeta {
  return {
    calculatedAt: new Date().toISOString(),
    metricVersion: ORGANIZATION_RESOURCE_POOL_METRIC_VERSION,
    organizationId,
    actorId,
    visibleProjectCount,
    querySignatureHash: 'test-hash',
  }
}

function baseFreshness(): OrganizationResourcePoolSourceFreshness[] {
  return [
    makeOrganizationResourcePoolFreshness({
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      lastUpdatedAt: new Date().toISOString(),
      staleThresholdMinutes: 60,
    }),
    makeOrganizationResourcePoolFreshness({
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
      lastUpdatedAt: new Date().toISOString(),
      staleThresholdMinutes: 60,
    }),
  ]
}

// ─── Empty Pool ──────────────────────────────────────────────────────────────

export const emptyOrganizationResourcePool: OrganizationResourcePoolSummary = {
  meta: baseMeta(1, 1, 0),
  metrics: [
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_RESOURCES,
      value: 0,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.EMPTY,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.ACTIVE_RESOURCES,
      value: 0,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.EMPTY,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.LINKED_USER_COUNT,
      value: null,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.MEMBERSHIP,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.FORBIDDEN,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.VISIBLE_PROJECT_COUNT,
      value: 0,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.PROJECT,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.EMPTY,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_CAPACITY_HOURS,
      value: 0,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.EMPTY,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.ALLOCATED_CAPACITY_HOURS,
      value: 0,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.EMPTY,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.REMAINING_CAPACITY_HOURS,
      value: 0,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.EMPTY,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.AVERAGE_UTILIZATION_PERCENT,
      value: 0,
      unit: 'percent',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.EMPTY,
    },
  ],
  warnings: [
    {
      code: ORGANIZATION_RESOURCE_POOL_WARNING_CODES.EMPTY_ORGANIZATION_RESOURCE_POOL,
      message: '当前组织没有可见项目或资源',
    },
  ],
  sourceFreshness: baseFreshness(),
  resourceCount: 0,
  linkedUserCount: null,
  capacity: { totalHours: 0, allocatedHours: 0, remainingHours: 0, averageUtilizationPercent: 0 },
  loadDistribution: { idle: 0, normal: 0, high: 0, overloaded: 0, unavailable: 0 },
  skillCoverage: [],
  demandGapCount: 0,
  conflictCount: 0,
}

// ─── Normal Organization ─────────────────────────────────────────────────────

export const normalOrganizationResourcePool: OrganizationResourcePoolSummary = {
  meta: baseMeta(1, 1, 5),
  metrics: [
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_RESOURCES,
      value: 12,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.ACTIVE_RESOURCES,
      value: 10,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.LINKED_USER_COUNT,
      value: 8,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.MEMBERSHIP,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.VISIBLE_PROJECT_COUNT,
      value: 5,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.PROJECT,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_CAPACITY_HOURS,
      value: 960,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.ALLOCATED_CAPACITY_HOURS,
      value: 640,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.REMAINING_CAPACITY_HOURS,
      value: 320,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.AVERAGE_UTILIZATION_PERCENT,
      value: 66.7,
      unit: 'percent',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.IDLE_RESOURCE_COUNT,
      value: 1,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.NORMAL_LOAD_RESOURCE_COUNT,
      value: 6,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.HIGH_LOAD_RESOURCE_COUNT,
      value: 2,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.OVERLOADED_RESOURCE_COUNT,
      value: 1,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.SKILL_COVERAGE_COUNT,
      value: 4,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.DEMAND_GAP_COUNT,
      value: 2,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REQUIREMENT,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.CONFLICT_COUNT,
      value: 1,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
  ],
  warnings: [],
  sourceFreshness: baseFreshness(),
  resourceCount: 12,
  linkedUserCount: 8,
  capacity: {
    totalHours: 960,
    allocatedHours: 640,
    remainingHours: 320,
    averageUtilizationPercent: 66.7,
  },
  loadDistribution: { idle: 1, normal: 6, high: 2, overloaded: 1, unavailable: 2 },
  skillCoverage: [
    {
      skill: '前端开发',
      resourceCount: 3,
      capacityHours: 240,
      allocatedHours: 200,
      remainingHours: 40,
      demandCount: 0,
      gap: false,
      redacted: false,
    },
    {
      skill: '后端开发',
      resourceCount: 4,
      capacityHours: 320,
      allocatedHours: 220,
      remainingHours: 100,
      demandCount: 1,
      gap: false,
      redacted: false,
    },
    {
      skill: 'UI设计',
      resourceCount: 2,
      capacityHours: 160,
      allocatedHours: 160,
      remainingHours: 0,
      demandCount: 1,
      gap: true,
      redacted: false,
    },
  ],
  demandGapCount: 2,
  conflictCount: 1,
}

// ─── Restricted Dimensions ───────────────────────────────────────────────────

export const restrictedOrganizationResourcePool: OrganizationResourcePoolSummary = {
  meta: baseMeta(2, 5, 3),
  metrics: [
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_RESOURCES,
      value: 8,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.LINKED_USER_COUNT,
      value: null,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.MEMBERSHIP,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.FORBIDDEN,
      warnings: [
        {
          code: ORGANIZATION_RESOURCE_POOL_WARNING_CODES.PERMISSION_REDACTED,
          message: '用户维度权限不足已脱敏',
          source: ORGANIZATION_RESOURCE_POOL_SOURCES.MEMBERSHIP,
        },
      ],
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.VISIBLE_PROJECT_COUNT,
      value: 3,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.PROJECT,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_CAPACITY_HOURS,
      value: 640,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.ALLOCATED_CAPACITY_HOURS,
      value: 400,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.REMAINING_CAPACITY_HOURS,
      value: 240,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.AVERAGE_UTILIZATION_PERCENT,
      value: 62.5,
      unit: 'percent',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.IDLE_RESOURCE_COUNT,
      value: null,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.FORBIDDEN,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.SKILL_COVERAGE_COUNT,
      value: null,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.FORBIDDEN,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.DEMAND_GAP_COUNT,
      value: null,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REQUIREMENT,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.FORBIDDEN,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.CONFLICT_COUNT,
      value: null,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.FORBIDDEN,
    },
  ],
  warnings: [
    {
      code: ORGANIZATION_RESOURCE_POOL_WARNING_CODES.PERMISSION_REDACTED,
      message: '用户维度权限不足已脱敏',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.MEMBERSHIP,
    },
    {
      code: ORGANIZATION_RESOURCE_POOL_WARNING_CODES.PERMISSION_REDACTED,
      message: '资源详情权限不足已脱敏',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
    },
  ],
  sourceFreshness: [
    makeOrganizationResourcePoolFreshness({
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      lastUpdatedAt: new Date().toISOString(),
      staleThresholdMinutes: 60,
      forbidden: true,
    }),
  ],
  resourceCount: 8,
  linkedUserCount: null,
  capacity: {
    totalHours: 640,
    allocatedHours: 400,
    remainingHours: 240,
    averageUtilizationPercent: 62.5,
  },
  loadDistribution: { idle: 0, normal: 0, high: 0, overloaded: 0, unavailable: 0 },
  skillCoverage: [],
  demandGapCount: 0,
  conflictCount: 0,
}

// ─── Stale Sources ───────────────────────────────────────────────────────────

export const staleOrganizationResourcePool: OrganizationResourcePoolSummary = {
  meta: baseMeta(3, 1, 4),
  metrics: [
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_RESOURCES,
      value: 6,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.VISIBLE_PROJECT_COUNT,
      value: 4,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.PROJECT,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_CAPACITY_HOURS,
      value: 480,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.ALLOCATED_CAPACITY_HOURS,
      value: 300,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.REMAINING_CAPACITY_HOURS,
      value: 180,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.AVERAGE_UTILIZATION_PERCENT,
      value: 62.5,
      unit: 'percent',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.CONFLICT_COUNT,
      value: 0,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
  ],
  warnings: [
    {
      code: ORGANIZATION_RESOURCE_POOL_WARNING_CODES.SOURCE_STALE,
      message: '来源 resource_allocation 数据已超过新鲜度阈值',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
    },
  ],
  sourceFreshness: [
    makeOrganizationResourcePoolFreshness({
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      lastUpdatedAt: new Date().toISOString(),
      staleThresholdMinutes: 60,
    }),
    makeOrganizationResourcePoolFreshness({
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
      lastUpdatedAt: '2020-01-01T00:00:00.000Z',
      staleThresholdMinutes: 60,
    }),
  ],
  resourceCount: 6,
  linkedUserCount: 3,
  capacity: {
    totalHours: 480,
    allocatedHours: 300,
    remainingHours: 180,
    averageUtilizationPercent: 62.5,
  },
  loadDistribution: { idle: 1, normal: 3, high: 1, overloaded: 0, unavailable: 1 },
  skillCoverage: [],
  demandGapCount: 0,
  conflictCount: 0,
}

// ─── Overloaded Resources ────────────────────────────────────────────────────

export const overloadedOrganizationResourcePool: OrganizationResourcePoolSummary = {
  meta: baseMeta(4, 1, 3),
  metrics: [
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_RESOURCES,
      value: 5,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.ACTIVE_RESOURCES,
      value: 5,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.VISIBLE_PROJECT_COUNT,
      value: 3,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.PROJECT,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_CAPACITY_HOURS,
      value: 400,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.ALLOCATED_CAPACITY_HOURS,
      value: 480,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.REMAINING_CAPACITY_HOURS,
      value: -80,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.AVERAGE_UTILIZATION_PERCENT,
      value: 120,
      unit: 'percent',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.OVERLOADED_RESOURCE_COUNT,
      value: 3,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.CONFLICT_COUNT,
      value: 2,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
  ],
  warnings: [],
  sourceFreshness: baseFreshness(),
  resourceCount: 5,
  linkedUserCount: 4,
  capacity: {
    totalHours: 400,
    allocatedHours: 480,
    remainingHours: -80,
    averageUtilizationPercent: 120,
  },
  loadDistribution: { idle: 0, normal: 1, high: 1, overloaded: 3, unavailable: 0 },
  skillCoverage: [],
  demandGapCount: 0,
  conflictCount: 2,
}

// ─── Skill Gaps ──────────────────────────────────────────────────────────────

export const skillGapOrganizationResourcePool: OrganizationResourcePoolSummary = {
  meta: baseMeta(5, 1, 4),
  metrics: [
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_RESOURCES,
      value: 10,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.VISIBLE_PROJECT_COUNT,
      value: 4,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.PROJECT,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_CAPACITY_HOURS,
      value: 800,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.ALLOCATED_CAPACITY_HOURS,
      value: 500,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.REMAINING_CAPACITY_HOURS,
      value: 300,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.AVERAGE_UTILIZATION_PERCENT,
      value: 62.5,
      unit: 'percent',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.SKILL_COVERAGE_COUNT,
      value: 5,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.DEMAND_GAP_COUNT,
      value: 3,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REQUIREMENT,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
  ],
  warnings: [],
  sourceFreshness: baseFreshness(),
  resourceCount: 10,
  linkedUserCount: 7,
  capacity: {
    totalHours: 800,
    allocatedHours: 500,
    remainingHours: 300,
    averageUtilizationPercent: 62.5,
  },
  loadDistribution: { idle: 2, normal: 5, high: 2, overloaded: 0, unavailable: 1 },
  skillCoverage: [
    {
      skill: '前端开发',
      resourceCount: 3,
      capacityHours: 240,
      allocatedHours: 200,
      remainingHours: 40,
      demandCount: 0,
      gap: false,
      redacted: false,
    },
    {
      skill: '后端开发',
      resourceCount: 4,
      capacityHours: 320,
      allocatedHours: 220,
      remainingHours: 100,
      demandCount: 1,
      gap: false,
      redacted: false,
    },
    {
      skill: '数据科学',
      resourceCount: 0,
      capacityHours: 0,
      allocatedHours: 0,
      remainingHours: 0,
      demandCount: 2,
      gap: true,
      redacted: false,
    },
    {
      skill: 'DevOps',
      resourceCount: 1,
      capacityHours: 80,
      allocatedHours: 80,
      remainingHours: 0,
      demandCount: 1,
      gap: true,
      redacted: false,
    },
  ],
  demandGapCount: 3,
  conflictCount: 0,
}

// ─── Cross-Project Contention ────────────────────────────────────────────────

export const contentionOrganizationResourcePool: OrganizationResourcePoolSummary = {
  meta: baseMeta(6, 1, 4),
  metrics: [
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_RESOURCES,
      value: 8,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.VISIBLE_PROJECT_COUNT,
      value: 4,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.PROJECT,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_CAPACITY_HOURS,
      value: 640,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.ALLOCATED_CAPACITY_HOURS,
      value: 600,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.REMAINING_CAPACITY_HOURS,
      value: 40,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.AVERAGE_UTILIZATION_PERCENT,
      value: 93.8,
      unit: 'percent',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.OVERLOADED_RESOURCE_COUNT,
      value: 2,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.CONFLICT_COUNT,
      value: 3,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
  ],
  warnings: [],
  sourceFreshness: baseFreshness(),
  resourceCount: 8,
  linkedUserCount: 6,
  capacity: {
    totalHours: 640,
    allocatedHours: 600,
    remainingHours: 40,
    averageUtilizationPercent: 93.8,
  },
  loadDistribution: { idle: 0, normal: 3, high: 3, overloaded: 2, unavailable: 0 },
  skillCoverage: [],
  demandGapCount: 1,
  conflictCount: 3,
}

// ─── Cache Degraded ──────────────────────────────────────────────────────────

export const cacheDegradedOrganizationResourcePool: OrganizationResourcePoolSummary = {
  meta: baseMeta(7, 1, 4),
  metrics: [
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_RESOURCES,
      value: 10,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.VISIBLE_PROJECT_COUNT,
      value: 4,
      unit: 'count',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.PROJECT,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_CAPACITY_HOURS,
      value: 800,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.ALLOCATED_CAPACITY_HOURS,
      value: 500,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.REMAINING_CAPACITY_HOURS,
      value: 300,
      unit: 'hours',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
    {
      key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.AVERAGE_UTILIZATION_PERCENT,
      value: 62.5,
      unit: 'percent',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
    },
  ],
  warnings: [
    {
      code: ORGANIZATION_RESOURCE_POOL_WARNING_CODES.CACHE_DEGRADED,
      message: '可选资源池缓存不可用，已直接读取有界授权数据',
    },
  ],
  sourceFreshness: baseFreshness(),
  resourceCount: 10,
  linkedUserCount: 5,
  capacity: {
    totalHours: 800,
    allocatedHours: 500,
    remainingHours: 300,
    averageUtilizationPercent: 62.5,
  },
  loadDistribution: { idle: 1, normal: 6, high: 2, overloaded: 0, unavailable: 1 },
  skillCoverage: [],
  demandGapCount: 0,
  conflictCount: 0,
}

// ─── Resource Rows (for resource list fixture) ───────────────────────────────

export const normalResourceRows: OrganizationResourcePoolResourceRow[] = [
  {
    resourceId: 1,
    resourceName: '张三',
    resourceType: 'human',
    role: '前端开发',
    status: 'active',
    skillTags: ['React', 'TypeScript'],
    department: '产品研发',
    linkedUserId: 1,
    projectCount: 2,
    totalCapacityHours: 80,
    totalAllocatedHours: 60,
    totalRemainingHours: 20,
    utilizationPercent: 75,
    loadStatus: ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.NORMAL,
    conflictFlags: [],
    freshness: null,
    target: { kind: 'resource', href: '/resources/1', authorized: true },
    redacted: false,
  },
  {
    resourceId: 2,
    resourceName: '李四',
    resourceType: 'human',
    role: '后端开发',
    status: 'active',
    skillTags: ['Node.js', 'PostgreSQL'],
    department: '产品研发',
    linkedUserId: 2,
    projectCount: 3,
    totalCapacityHours: 80,
    totalAllocatedHours: 100,
    totalRemainingHours: -20,
    utilizationPercent: 125,
    loadStatus: ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.OVERLOADED,
    conflictFlags: [ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITIES.ERROR],
    freshness: null,
    target: { kind: 'resource', href: '/resources/2', authorized: true },
    redacted: false,
  },
]

// ─── Capacity Matrix ─────────────────────────────────────────────────────────

export const normalCapacityMatrix: OrganizationResourcePoolCapacityMatrix = {
  from: '2026-07-01',
  to: '2026-07-05',
  rows: [
    {
      resourceId: 1,
      resourceName: '张三',
      role: '前端开发',
      loadStatus: ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.NORMAL,
      totalCapacityHours: 40,
      totalAllocatedHours: 30,
      totalRemainingHours: 10,
      utilizationPercent: 75,
      redacted: false,
      cells: [
        {
          date: '2026-07-01',
          capacityHours: 8,
          allocatedHours: 6,
          remainingHours: 2,
          utilizationPercent: 75,
          loadStatus: ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.NORMAL,
          conflictFlags: [],
        },
        {
          date: '2026-07-02',
          capacityHours: 8,
          allocatedHours: 8,
          remainingHours: 0,
          utilizationPercent: 100,
          loadStatus: ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.HIGH,
          conflictFlags: [],
        },
        {
          date: '2026-07-03',
          capacityHours: 8,
          allocatedHours: 4,
          remainingHours: 4,
          utilizationPercent: 50,
          loadStatus: ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.NORMAL,
          conflictFlags: [],
        },
        {
          date: '2026-07-04',
          capacityHours: 8,
          allocatedHours: 6,
          remainingHours: 2,
          utilizationPercent: 75,
          loadStatus: ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.NORMAL,
          conflictFlags: [],
        },
        {
          date: '2026-07-05',
          capacityHours: 8,
          allocatedHours: 6,
          remainingHours: 2,
          utilizationPercent: 75,
          loadStatus: ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.NORMAL,
          conflictFlags: [],
        },
      ],
    },
  ],
}

// ─── Skill Items ─────────────────────────────────────────────────────────────

export const normalSkillCoverage: OrganizationResourcePoolSkillItem[] = [
  {
    skill: '前端开发',
    resourceCount: 3,
    capacityHours: 240,
    allocatedHours: 200,
    remainingHours: 40,
    demandCount: 0,
    gap: false,
    redacted: false,
  },
  {
    skill: '后端开发',
    resourceCount: 4,
    capacityHours: 320,
    allocatedHours: 220,
    remainingHours: 100,
    demandCount: 1,
    gap: false,
    redacted: false,
  },
]

// ─── Conflicts ───────────────────────────────────────────────────────────────

export const normalConflicts: OrganizationResourcePoolConflict[] = [
  {
    conflictId: 'conflict-hash-1',
    severity: ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITIES.ERROR,
    resourceId: 2,
    resourceName: '李四',
    projectIds: [1, 2],
    projectNames: ['项目A', '项目B'],
    description: '资源李四跨项目分配超过 100%：项目A 60% + 项目B 65%',
    date: '2026-07-03',
    remediationHint: '建议调整项目A或项目B的分配百分比',
    target: { kind: 'resource', href: '/resources/2', authorized: true },
    redacted: false,
  },
]

// ─── Demand Gaps ─────────────────────────────────────────────────────────────

export const normalDemandGaps: OrganizationResourcePoolDemandGap[] = [
  {
    gapId: 'gap-hash-1',
    skill: '数据科学',
    role: '数据工程师',
    projectId: 1,
    projectName: '项目A',
    taskId: 5,
    dateWindow: { from: '2026-07-01', to: '2026-08-01' },
    priority: 'high',
    target: { kind: 'project', href: '/projects/1', authorized: true },
    redacted: false,
  },
]
