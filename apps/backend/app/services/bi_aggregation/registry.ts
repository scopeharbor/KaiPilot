// apps/backend/app/services/bi_aggregation/registry.ts
// v3-bi-data-aggregation-service §3.2：server-defined metric/dimension/source registry。
//
// 声明每个 metric、dimension 和 source 的 key、权限标签、支持窗口/粒度、聚合策略、
// 脱敏策略、freshness 策略和降级行为。

import type {
  BiAggregationMetricKey,
  BiAggregationDimensionKey,
  BiAggregationSourceKey,
  BiAggregationWindow,
  BiAggregationGrain,
  BiAggregationScope,
} from '@aiproj/types'
import {
  BI_AGGREGATION_METRIC_KEYS,
  BI_AGGREGATION_DIMENSION_KEYS,
  BI_AGGREGATION_SOURCE_KEYS,
  BI_AGGREGATION_SCOPES,
  BI_AGGREGATION_GRAINS,
  BI_AGGREGATION_WINDOWS,
} from '@aiproj/types'
import type { BiAggregationSourceAdapter } from './source_adapter.js'
import {
  BiTrendMetricsAdapter,
  BiDashboardSummaryAdapter,
  ReportV2DatasourceAdapter,
  createFallbackAdapters,
  FallbackBiAggregationAdapter,
} from './adapters/index.js'

// ─── Metric Definition ─────────────────────────────────────────────────

export interface BiAggregationMetricDef {
  key: BiAggregationMetricKey
  displayKey: string
  scope: BiAggregationScope[]
  sourceKey: BiAggregationSourceKey
  allowedGrains: BiAggregationGrain[]
  allowedWindows: BiAggregationWindow[]
  allowedDimensions: BiAggregationDimensionKey[]
  aggregationStrategy: 'sum' | 'avg' | 'count' | 'latest' | 'weighted_avg'
  permissionTags: string[]
  freshnessThresholdSeconds: number
  unsupportedFallback: 'unavailable' | 'omit'
}

// ─── Dimension Definition ──────────────────────────────────────────────

export interface BiAggregationDimensionDef {
  key: BiAggregationDimensionKey
  displayKey: string
  scope: BiAggregationScope[]
  drillDownTargetPolicy: 'none' | 'project' | 'task' | 'risk' | 'okr' | 'resource'
  redactionStrategy: 'hide_full' | 'hide_count' | 'allow'
}

// ─── Source Definition ─────────────────────────────────────────────────

export interface BiAggregationSourceDef {
  key: BiAggregationSourceKey
  displayKey: string
  scope: BiAggregationScope[]
  adapterRef: string
  permissionTags: string[]
  fallbackBehavior: 'unavailable' | 'omit' | 'degraded'
  freshnessPolicy: 'on_demand' | 'cache_with_ttl' | 'snapshot'
  freshnessTtlSeconds: number
}

// ─── Registry ──────────────────────────────────────────────────────────

export const BI_AGGREGATION_REGISTRY_VERSION = 'bi-aggregation-registry-v1'

/**
 * 服务端 BI aggregation registry。
 * 客户端只能提交白名单 key；非法参数在 validator 和 registry 双重校验后拒绝。
 */
export class BiAggregationRegistry {
  private metrics = new Map<BiAggregationMetricKey, BiAggregationMetricDef>()
  private dimensions = new Map<BiAggregationDimensionKey, BiAggregationDimensionDef>()
  private sources = new Map<BiAggregationSourceKey, BiAggregationSourceDef>()
  private sourceAdapters = new Map<BiAggregationSourceKey, BiAggregationSourceAdapter>()

  // ─── Metric Registration ────────────────────────────────────────────

  registerMetric(def: BiAggregationMetricDef): this {
    this.metrics.set(def.key, def)
    return this
  }

  getMetric(key: BiAggregationMetricKey): BiAggregationMetricDef | undefined {
    return this.metrics.get(key)
  }

  listMetricKeys(): BiAggregationMetricKey[] {
    return [...this.metrics.keys()]
  }

  hasMetric(key: BiAggregationMetricKey): boolean {
    return this.metrics.has(key)
  }

  // ─── Dimension Registration ─────────────────────────────────────────

  registerDimension(def: BiAggregationDimensionDef): this {
    this.dimensions.set(def.key, def)
    return this
  }

  getDimension(key: BiAggregationDimensionKey): BiAggregationDimensionDef | undefined {
    return this.dimensions.get(key)
  }

  listDimensionKeys(): BiAggregationDimensionKey[] {
    return [...this.dimensions.keys()]
  }

  // ─── Source Registration ────────────────────────────────────────────

  registerSource(def: BiAggregationSourceDef, adapter: BiAggregationSourceAdapter): this {
    this.sources.set(def.key, def)
    this.sourceAdapters.set(def.key, adapter)
    return this
  }

  getSource(key: BiAggregationSourceKey): BiAggregationSourceDef | undefined {
    return this.sources.get(key)
  }

  getAdapter(key: BiAggregationSourceKey): BiAggregationSourceAdapter | undefined {
    return this.sourceAdapters.get(key)
  }

  listSourceKeys(): BiAggregationSourceKey[] {
    return [...this.sources.keys()]
  }

  // ─── Composite Lookups ──────────────────────────────────────────────

  /** 根据 scope 列出所有 metric definitions。 */
  listMetricsForScope(scope: BiAggregationScope): BiAggregationMetricDef[] {
    return [...this.metrics.values()].filter((m) => m.scope.includes(scope))
  }

  /** 根据 metric key 解析其所属 source adapter。 */
  resolveAdapterForMetric(
    metricKey: BiAggregationMetricKey,
  ): BiAggregationSourceAdapter | undefined {
    const metric = this.metrics.get(metricKey)
    if (!metric) return undefined
    return this.sourceAdapters.get(metric.sourceKey)
  }

  /** 从 metric key 集合解析所有涉及的 source adapter（去重）。 */
  resolveAdaptersForMetrics(
    metricKeys: BiAggregationMetricKey[],
  ): Map<BiAggregationSourceKey, BiAggregationSourceAdapter> {
    const map = new Map<BiAggregationSourceKey, BiAggregationSourceAdapter>()
    for (const mk of metricKeys) {
      const adapter = this.resolveAdapterForMetric(mk)
      if (adapter) {
        map.set(adapter.sourceKey, adapter)
      }
    }
    return map
  }
}

// ─── Factory ───────────────────────────────────────────────────────────

/**
 * 创建并初始化首批 registry（BI trend、BI dashboard、V2 report、organization dashboard、
 * PMO dashboard、resource、OKR、risk、project health）。
 *
 * 注册所有 metric/dimension/source definition，source adapter 在 init 后由调用方绑定。
 */
export function createBiAggregationRegistry(): BiAggregationRegistry {
  const registry = new BiAggregationRegistry()

  // ── Dimensions ──────────────────────────────────────────────────────

  const dimensionDefs: BiAggregationDimensionDef[] = [
    {
      key: BI_AGGREGATION_DIMENSION_KEYS.PROJECT,
      displayKey: '项目',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION, BI_AGGREGATION_SCOPES.PMO],
      drillDownTargetPolicy: 'project',
      redactionStrategy: 'allow',
    },
    {
      key: BI_AGGREGATION_DIMENSION_KEYS.PORTFOLIO_GROUP,
      displayKey: '组合分组',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION, BI_AGGREGATION_SCOPES.PMO],
      drillDownTargetPolicy: 'none',
      redactionStrategy: 'allow',
    },
    {
      key: BI_AGGREGATION_DIMENSION_KEYS.DEPARTMENT,
      displayKey: '部门',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION],
      drillDownTargetPolicy: 'none',
      redactionStrategy: 'hide_full',
    },
    {
      key: BI_AGGREGATION_DIMENSION_KEYS.ASSIGNEE,
      displayKey: '负责人',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION, BI_AGGREGATION_SCOPES.PROJECT],
      drillDownTargetPolicy: 'none',
      redactionStrategy: 'hide_full',
    },
    {
      key: BI_AGGREGATION_DIMENSION_KEYS.TIME_BUCKET,
      displayKey: '时间桶',
      scope: [
        BI_AGGREGATION_SCOPES.ORGANIZATION,
        BI_AGGREGATION_SCOPES.PMO,
        BI_AGGREGATION_SCOPES.PROJECT,
      ],
      drillDownTargetPolicy: 'none',
      redactionStrategy: 'allow',
    },
    {
      key: BI_AGGREGATION_DIMENSION_KEYS.RISK_LEVEL,
      displayKey: '风险等级',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION, BI_AGGREGATION_SCOPES.PMO],
      drillDownTargetPolicy: 'risk',
      redactionStrategy: 'allow',
    },
    {
      key: BI_AGGREGATION_DIMENSION_KEYS.RISK_CATEGORY,
      displayKey: '风险类别',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION, BI_AGGREGATION_SCOPES.PMO],
      drillDownTargetPolicy: 'risk',
      redactionStrategy: 'allow',
    },
    {
      key: BI_AGGREGATION_DIMENSION_KEYS.RESOURCE_ROLE,
      displayKey: '资源角色',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION],
      drillDownTargetPolicy: 'resource',
      redactionStrategy: 'hide_count',
    },
    {
      key: BI_AGGREGATION_DIMENSION_KEYS.OKR_OBJECTIVE,
      displayKey: 'OKR 目标',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION],
      drillDownTargetPolicy: 'okr',
      redactionStrategy: 'hide_full',
    },
    {
      key: BI_AGGREGATION_DIMENSION_KEYS.PROJECT_STATUS,
      displayKey: '项目状态',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION, BI_AGGREGATION_SCOPES.PMO],
      drillDownTargetPolicy: 'project',
      redactionStrategy: 'allow',
    },
    {
      key: BI_AGGREGATION_DIMENSION_KEYS.HEALTH_STATUS,
      displayKey: '健康状态',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION, BI_AGGREGATION_SCOPES.PMO],
      drillDownTargetPolicy: 'project',
      redactionStrategy: 'allow',
    },
  ]
  for (const d of dimensionDefs) {
    registry.registerDimension(d)
  }

  // ── Sources ─────────────────────────────────────────────────────────

  const sourceDefs: BiAggregationSourceDef[] = [
    {
      key: BI_AGGREGATION_SOURCE_KEYS.BI_TREND_METRICS,
      displayKey: 'BI 趋势指标',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION],
      adapterRef: 'biTrendMetricsAdapter',
      permissionTags: ['org:view', 'portfolio:view'],
      fallbackBehavior: 'degraded',
      freshnessPolicy: 'cache_with_ttl',
      freshnessTtlSeconds: 300,
    },
    {
      key: BI_AGGREGATION_SOURCE_KEYS.BI_DASHBOARD_SUMMARY,
      displayKey: 'BI Dashboard 摘要',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION, BI_AGGREGATION_SCOPES.PMO],
      adapterRef: 'biDashboardSummaryAdapter',
      permissionTags: ['org:view'],
      fallbackBehavior: 'degraded',
      freshnessPolicy: 'cache_with_ttl',
      freshnessTtlSeconds: 300,
    },
    {
      key: BI_AGGREGATION_SOURCE_KEYS.REPORT_V2_DATASOURCE,
      displayKey: 'V2 报表数据源',
      scope: [BI_AGGREGATION_SCOPES.PROJECT, BI_AGGREGATION_SCOPES.ORGANIZATION],
      adapterRef: 'reportV2DatasourceAdapter',
      permissionTags: ['org:view'],
      fallbackBehavior: 'unavailable',
      freshnessPolicy: 'on_demand',
      freshnessTtlSeconds: 0,
    },
    {
      key: BI_AGGREGATION_SOURCE_KEYS.ORGANIZATION_DASHBOARD,
      displayKey: '组织 Dashboard',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION],
      adapterRef: 'organizationDashboardAdapter',
      permissionTags: ['org:view'],
      fallbackBehavior: 'degraded',
      freshnessPolicy: 'cache_with_ttl',
      freshnessTtlSeconds: 600,
    },
    {
      key: BI_AGGREGATION_SOURCE_KEYS.PMO_DASHBOARD,
      displayKey: 'PMO Dashboard',
      scope: [BI_AGGREGATION_SCOPES.PMO],
      adapterRef: 'pmoDashboardAdapter',
      permissionTags: ['portfolio:view'],
      fallbackBehavior: 'degraded',
      freshnessPolicy: 'cache_with_ttl',
      freshnessTtlSeconds: 600,
    },
    {
      key: BI_AGGREGATION_SOURCE_KEYS.RESOURCE_POOL,
      displayKey: '资源池',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION],
      adapterRef: 'resourcePoolAdapter',
      permissionTags: ['resource:view'],
      fallbackBehavior: 'unavailable',
      freshnessPolicy: 'cache_with_ttl',
      freshnessTtlSeconds: 600,
    },
    {
      key: BI_AGGREGATION_SOURCE_KEYS.OKR_DASHBOARD,
      displayKey: 'OKR Dashboard',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION],
      adapterRef: 'okrDashboardAdapter',
      permissionTags: ['portfolio:view'],
      fallbackBehavior: 'unavailable',
      freshnessPolicy: 'cache_with_ttl',
      freshnessTtlSeconds: 600,
    },
    {
      key: BI_AGGREGATION_SOURCE_KEYS.RISK_REGISTER,
      displayKey: '风险登记册',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION, BI_AGGREGATION_SCOPES.PMO],
      adapterRef: 'riskRegisterAdapter',
      permissionTags: ['risk:view'],
      fallbackBehavior: 'unavailable',
      freshnessPolicy: 'on_demand',
      freshnessTtlSeconds: 0,
    },
    {
      key: BI_AGGREGATION_SOURCE_KEYS.PROJECT_HEALTH_DIAGNOSIS,
      displayKey: '项目健康诊断',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION, BI_AGGREGATION_SCOPES.PROJECT],
      adapterRef: 'projectHealthDiagnosisAdapter',
      permissionTags: ['org:view'],
      fallbackBehavior: 'unavailable',
      freshnessPolicy: 'on_demand',
      freshnessTtlSeconds: 0,
    },
  ]
  // adapter 必须在这里就绑上。原先注册的是被断言成 Adapter 的 undefined，
  // 于是 resolveAdapterForMetric 永远返回 undefined——注册表看起来建好了，实际上
  // 一个 metric 也解析不出 adapter，且类型断言把这件事从编译期藏到了运行期。
  // 已实现的三个 adapter 直接绑；其余绑 fallback（fallback 不伪造数据，只回 unavailable）。
  const boundAdapters = new Map<BiAggregationSourceKey, BiAggregationSourceAdapter>()
  for (const a of [
    new BiTrendMetricsAdapter(),
    new BiDashboardSummaryAdapter(),
    new ReportV2DatasourceAdapter(),
    ...createFallbackAdapters(),
  ]) {
    boundAdapters.set(a.sourceKey, a)
  }

  for (const s of sourceDefs) {
    const adapter = boundAdapters.get(s.key)
    if (adapter) {
      registry.registerSource(s, adapter)
    } else {
      // 没有专用 adapter 也没有 fallback 的来源：绑一个 unavailable fallback，
      // 而不是塞 undefined——缺适配器要能被观察到，不能变成静默的 undefined。
      registry.registerSource(
        s,
        new FallbackBiAggregationAdapter(s.key, [], {
          reason: s.key + ' 适配器尚未实现',
          mode: 'unavailable',
        }),
      )
    }
  }

  // ── Metrics ─────────────────────────────────────────────────────────

  const metricDefs: BiAggregationMetricDef[] = [
    {
      key: BI_AGGREGATION_METRIC_KEYS.BI_TREND_PROGRESS,
      displayKey: 'BI 趋势进度',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION],
      sourceKey: BI_AGGREGATION_SOURCE_KEYS.BI_TREND_METRICS,
      allowedGrains: [
        BI_AGGREGATION_GRAINS.DAILY,
        BI_AGGREGATION_GRAINS.WEEKLY,
        BI_AGGREGATION_GRAINS.MONTHLY,
      ],
      allowedWindows: [
        BI_AGGREGATION_WINDOWS.LAST_7_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_30_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_90_DAYS,
      ],
      allowedDimensions: [
        BI_AGGREGATION_DIMENSION_KEYS.PROJECT,
        BI_AGGREGATION_DIMENSION_KEYS.TIME_BUCKET,
      ],
      aggregationStrategy: 'avg',
      permissionTags: ['org:view'],
      freshnessThresholdSeconds: 3600,
      unsupportedFallback: 'unavailable',
    },
    {
      key: BI_AGGREGATION_METRIC_KEYS.BI_TREND_DELAY,
      displayKey: 'BI 趋势延期压力',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION],
      sourceKey: BI_AGGREGATION_SOURCE_KEYS.BI_TREND_METRICS,
      allowedGrains: [
        BI_AGGREGATION_GRAINS.DAILY,
        BI_AGGREGATION_GRAINS.WEEKLY,
        BI_AGGREGATION_GRAINS.MONTHLY,
      ],
      allowedWindows: [
        BI_AGGREGATION_WINDOWS.LAST_7_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_30_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_90_DAYS,
      ],
      allowedDimensions: [
        BI_AGGREGATION_DIMENSION_KEYS.PROJECT,
        BI_AGGREGATION_DIMENSION_KEYS.TIME_BUCKET,
      ],
      aggregationStrategy: 'avg',
      permissionTags: ['org:view'],
      freshnessThresholdSeconds: 3600,
      unsupportedFallback: 'unavailable',
    },
    {
      key: BI_AGGREGATION_METRIC_KEYS.BI_TREND_RISK,
      displayKey: 'BI 趋势风险压力',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION],
      sourceKey: BI_AGGREGATION_SOURCE_KEYS.BI_TREND_METRICS,
      allowedGrains: [
        BI_AGGREGATION_GRAINS.DAILY,
        BI_AGGREGATION_GRAINS.WEEKLY,
        BI_AGGREGATION_GRAINS.MONTHLY,
      ],
      allowedWindows: [
        BI_AGGREGATION_WINDOWS.LAST_7_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_30_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_90_DAYS,
      ],
      allowedDimensions: [
        BI_AGGREGATION_DIMENSION_KEYS.PROJECT,
        BI_AGGREGATION_DIMENSION_KEYS.RISK_LEVEL,
        BI_AGGREGATION_DIMENSION_KEYS.TIME_BUCKET,
      ],
      aggregationStrategy: 'sum',
      permissionTags: ['risk:view'],
      freshnessThresholdSeconds: 3600,
      unsupportedFallback: 'unavailable',
    },
    {
      key: BI_AGGREGATION_METRIC_KEYS.BI_TREND_RESOURCE,
      displayKey: 'BI 趋势资源压力',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION],
      sourceKey: BI_AGGREGATION_SOURCE_KEYS.BI_TREND_METRICS,
      allowedGrains: [BI_AGGREGATION_GRAINS.WEEKLY, BI_AGGREGATION_GRAINS.MONTHLY],
      allowedWindows: [BI_AGGREGATION_WINDOWS.LAST_30_DAYS, BI_AGGREGATION_WINDOWS.LAST_90_DAYS],
      allowedDimensions: [
        BI_AGGREGATION_DIMENSION_KEYS.PROJECT,
        BI_AGGREGATION_DIMENSION_KEYS.RESOURCE_ROLE,
        BI_AGGREGATION_DIMENSION_KEYS.TIME_BUCKET,
      ],
      aggregationStrategy: 'avg',
      permissionTags: ['resource:view'],
      freshnessThresholdSeconds: 3600,
      unsupportedFallback: 'unavailable',
    },
    {
      key: BI_AGGREGATION_METRIC_KEYS.BI_TREND_FORECAST,
      displayKey: 'BI 趋势预测压力',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION],
      sourceKey: BI_AGGREGATION_SOURCE_KEYS.BI_TREND_METRICS,
      allowedGrains: [BI_AGGREGATION_GRAINS.WEEKLY, BI_AGGREGATION_GRAINS.MONTHLY],
      allowedWindows: [
        BI_AGGREGATION_WINDOWS.LAST_30_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_90_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_365_DAYS,
      ],
      allowedDimensions: [
        BI_AGGREGATION_DIMENSION_KEYS.PROJECT,
        BI_AGGREGATION_DIMENSION_KEYS.TIME_BUCKET,
      ],
      aggregationStrategy: 'sum',
      permissionTags: ['prediction:view'],
      freshnessThresholdSeconds: 7200,
      unsupportedFallback: 'unavailable',
    },
    {
      key: BI_AGGREGATION_METRIC_KEYS.BI_TREND_OKR,
      displayKey: 'BI 趋势 OKR 进展',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION],
      sourceKey: BI_AGGREGATION_SOURCE_KEYS.BI_TREND_METRICS,
      allowedGrains: [BI_AGGREGATION_GRAINS.WEEKLY, BI_AGGREGATION_GRAINS.MONTHLY],
      allowedWindows: [BI_AGGREGATION_WINDOWS.LAST_30_DAYS, BI_AGGREGATION_WINDOWS.LAST_90_DAYS],
      allowedDimensions: [
        BI_AGGREGATION_DIMENSION_KEYS.OKR_OBJECTIVE,
        BI_AGGREGATION_DIMENSION_KEYS.TIME_BUCKET,
      ],
      aggregationStrategy: 'avg',
      permissionTags: ['portfolio:view'],
      freshnessThresholdSeconds: 3600,
      unsupportedFallback: 'unavailable',
    },
    {
      key: BI_AGGREGATION_METRIC_KEYS.BI_DASHBOARD_SUMMARY,
      displayKey: 'BI Dashboard 摘要',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION, BI_AGGREGATION_SCOPES.PMO],
      sourceKey: BI_AGGREGATION_SOURCE_KEYS.BI_DASHBOARD_SUMMARY,
      allowedGrains: [BI_AGGREGATION_GRAINS.WEEKLY, BI_AGGREGATION_GRAINS.MONTHLY],
      allowedWindows: [
        BI_AGGREGATION_WINDOWS.LAST_7_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_30_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_90_DAYS,
      ],
      allowedDimensions: [
        BI_AGGREGATION_DIMENSION_KEYS.PROJECT,
        BI_AGGREGATION_DIMENSION_KEYS.PORTFOLIO_GROUP,
      ],
      aggregationStrategy: 'latest',
      permissionTags: ['org:view'],
      freshnessThresholdSeconds: 600,
      unsupportedFallback: 'unavailable',
    },
    {
      key: BI_AGGREGATION_METRIC_KEYS.REPORT_V2_DATASOURCE,
      displayKey: 'V2 报表数据源',
      scope: [BI_AGGREGATION_SCOPES.PROJECT, BI_AGGREGATION_SCOPES.ORGANIZATION],
      sourceKey: BI_AGGREGATION_SOURCE_KEYS.REPORT_V2_DATASOURCE,
      allowedGrains: [BI_AGGREGATION_GRAINS.WEEKLY, BI_AGGREGATION_GRAINS.MONTHLY],
      allowedWindows: [
        BI_AGGREGATION_WINDOWS.LAST_30_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_90_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_365_DAYS,
      ],
      allowedDimensions: [BI_AGGREGATION_DIMENSION_KEYS.PROJECT],
      aggregationStrategy: 'latest',
      permissionTags: ['org:view'],
      freshnessThresholdSeconds: 0,
      unsupportedFallback: 'unavailable',
    },
    {
      key: BI_AGGREGATION_METRIC_KEYS.ORGANIZATION_DASHBOARD_SUMMARY,
      displayKey: '组织 Dashboard 摘要',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION],
      sourceKey: BI_AGGREGATION_SOURCE_KEYS.ORGANIZATION_DASHBOARD,
      allowedGrains: [BI_AGGREGATION_GRAINS.WEEKLY, BI_AGGREGATION_GRAINS.MONTHLY],
      allowedWindows: [
        BI_AGGREGATION_WINDOWS.LAST_7_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_30_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_90_DAYS,
      ],
      allowedDimensions: [
        BI_AGGREGATION_DIMENSION_KEYS.PROJECT,
        BI_AGGREGATION_DIMENSION_KEYS.PORTFOLIO_GROUP,
        BI_AGGREGATION_DIMENSION_KEYS.HEALTH_STATUS,
      ],
      aggregationStrategy: 'latest',
      permissionTags: ['org:view'],
      freshnessThresholdSeconds: 600,
      unsupportedFallback: 'unavailable',
    },
    {
      key: BI_AGGREGATION_METRIC_KEYS.PMO_DASHBOARD_SUMMARY,
      displayKey: 'PMO Dashboard 摘要',
      scope: [BI_AGGREGATION_SCOPES.PMO],
      sourceKey: BI_AGGREGATION_SOURCE_KEYS.PMO_DASHBOARD,
      allowedGrains: [BI_AGGREGATION_GRAINS.WEEKLY, BI_AGGREGATION_GRAINS.MONTHLY],
      allowedWindows: [
        BI_AGGREGATION_WINDOWS.LAST_7_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_30_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_90_DAYS,
      ],
      allowedDimensions: [
        BI_AGGREGATION_DIMENSION_KEYS.PORTFOLIO_GROUP,
        BI_AGGREGATION_DIMENSION_KEYS.HEALTH_STATUS,
      ],
      aggregationStrategy: 'latest',
      permissionTags: ['portfolio:view'],
      freshnessThresholdSeconds: 600,
      unsupportedFallback: 'unavailable',
    },
    {
      key: BI_AGGREGATION_METRIC_KEYS.RESOURCE_SUMMARY,
      displayKey: '资源摘要',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION],
      sourceKey: BI_AGGREGATION_SOURCE_KEYS.RESOURCE_POOL,
      allowedGrains: [BI_AGGREGATION_GRAINS.WEEKLY, BI_AGGREGATION_GRAINS.MONTHLY],
      allowedWindows: [BI_AGGREGATION_WINDOWS.LAST_30_DAYS, BI_AGGREGATION_WINDOWS.LAST_90_DAYS],
      allowedDimensions: [
        BI_AGGREGATION_DIMENSION_KEYS.PROJECT,
        BI_AGGREGATION_DIMENSION_KEYS.RESOURCE_ROLE,
      ],
      aggregationStrategy: 'sum',
      permissionTags: ['resource:view'],
      freshnessThresholdSeconds: 600,
      unsupportedFallback: 'unavailable',
    },
    {
      key: BI_AGGREGATION_METRIC_KEYS.OKR_SUMMARY,
      displayKey: 'OKR 摘要',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION],
      sourceKey: BI_AGGREGATION_SOURCE_KEYS.OKR_DASHBOARD,
      allowedGrains: [BI_AGGREGATION_GRAINS.WEEKLY, BI_AGGREGATION_GRAINS.MONTHLY],
      allowedWindows: [BI_AGGREGATION_WINDOWS.LAST_30_DAYS, BI_AGGREGATION_WINDOWS.LAST_90_DAYS],
      allowedDimensions: [
        BI_AGGREGATION_DIMENSION_KEYS.OKR_OBJECTIVE,
        BI_AGGREGATION_DIMENSION_KEYS.TIME_BUCKET,
      ],
      aggregationStrategy: 'avg',
      permissionTags: ['portfolio:view'],
      freshnessThresholdSeconds: 600,
      unsupportedFallback: 'unavailable',
    },
    {
      key: BI_AGGREGATION_METRIC_KEYS.RISK_SUMMARY,
      displayKey: '风险摘要',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION, BI_AGGREGATION_SCOPES.PMO],
      sourceKey: BI_AGGREGATION_SOURCE_KEYS.RISK_REGISTER,
      allowedGrains: [BI_AGGREGATION_GRAINS.WEEKLY, BI_AGGREGATION_GRAINS.MONTHLY],
      allowedWindows: [BI_AGGREGATION_WINDOWS.LAST_30_DAYS, BI_AGGREGATION_WINDOWS.LAST_90_DAYS],
      allowedDimensions: [
        BI_AGGREGATION_DIMENSION_KEYS.PROJECT,
        BI_AGGREGATION_DIMENSION_KEYS.RISK_LEVEL,
        BI_AGGREGATION_DIMENSION_KEYS.RISK_CATEGORY,
      ],
      aggregationStrategy: 'count',
      permissionTags: ['risk:view'],
      freshnessThresholdSeconds: 0,
      unsupportedFallback: 'unavailable',
    },
    {
      key: BI_AGGREGATION_METRIC_KEYS.PROJECT_HEALTH_SUMMARY,
      displayKey: '项目健康摘要',
      scope: [BI_AGGREGATION_SCOPES.ORGANIZATION, BI_AGGREGATION_SCOPES.PROJECT],
      sourceKey: BI_AGGREGATION_SOURCE_KEYS.PROJECT_HEALTH_DIAGNOSIS,
      allowedGrains: [BI_AGGREGATION_GRAINS.WEEKLY, BI_AGGREGATION_GRAINS.MONTHLY],
      allowedWindows: [
        BI_AGGREGATION_WINDOWS.LAST_7_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_30_DAYS,
        BI_AGGREGATION_WINDOWS.LAST_90_DAYS,
      ],
      allowedDimensions: [
        BI_AGGREGATION_DIMENSION_KEYS.PROJECT,
        BI_AGGREGATION_DIMENSION_KEYS.HEALTH_STATUS,
      ],
      aggregationStrategy: 'latest',
      permissionTags: ['org:view'],
      freshnessThresholdSeconds: 0,
      unsupportedFallback: 'unavailable',
    },
  ]
  for (const m of metricDefs) {
    registry.registerMetric(m)
  }

  return registry
}
