// @aiproj/types — PMO Portfolio Dashboard 共享契约测试（§2.4）。
import { describe, test, expect } from 'vitest'
import {
  PORTFOLIO_DASHBOARD_METRIC_KEYS,
  PORTFOLIO_DASHBOARD_WARNING_CODES,
  PORTFOLIO_DASHBOARD_SOURCES,
  PORTFOLIO_DASHBOARD_METRIC_STATUSES,
  PORTFOLIO_GROUP_KEYS,
  PORTFOLIO_SORT_KEYS,
  PORTFOLIO_TREND_WINDOWS,
  PORTFOLIO_DASHBOARD_METRIC_VERSION,
  PORTFOLIO_DASHBOARD_MAX_PER_PAGE,
  PORTFOLIO_DASHBOARD_STALE_THRESHOLD_MINUTES,
  isSourceStale,
  projectUnsupportedFinancialWarning,
  projectTrafficLightUnavailableWarning,
  projectTrafficLightForbiddenWarning,
  projectPermissionRedactedWarning,
  projectRedactedMetric,
} from './pmo-portfolio-dashboard.js'

// ─── DTO Shape ─────────────────────────────────────────────────────────────────

describe('PORTFOLIO_DASHBOARD_METRIC_KEYS', () => {
  test('包含所有组合 KPI keys', () => {
    expect(PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS).toBe('total_projects')
    expect(PORTFOLIO_DASHBOARD_METRIC_KEYS.ACTIVE_PROJECTS).toBe('active_projects')
    expect(PORTFOLIO_DASHBOARD_METRIC_KEYS.AT_RISK_PROJECTS).toBe('at_risk_projects')
    expect(PORTFOLIO_DASHBOARD_METRIC_KEYS.BLOCKED_PROJECTS).toBe('blocked_projects')
  })

  test('包含交付指标 keys', () => {
    expect(PORTFOLIO_DASHBOARD_METRIC_KEYS.DELIVERY_ON_TRACK_PERCENT).toBe(
      'delivery_on_track_percent',
    )
    expect(PORTFOLIO_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG).toBe('overall_progress_avg')
    expect(PORTFOLIO_DASHBOARD_METRIC_KEYS.OVERDUE_PROJECT_PERCENT).toBe('overdue_project_percent')
  })

  test('包含健康/风险/资源/预测压力 keys', () => {
    expect(PORTFOLIO_DASHBOARD_METRIC_KEYS.HEALTH_RED_PERCENT).toBe('health_red_percent')
    expect(PORTFOLIO_DASHBOARD_METRIC_KEYS.RISK_HIGH_PERCENT).toBe('risk_high_percent')
    expect(PORTFOLIO_DASHBOARD_METRIC_KEYS.RESOURCE_OVERLOAD_PERCENT).toBe(
      'resource_overload_percent',
    )
    expect(PORTFOLIO_DASHBOARD_METRIC_KEYS.PREDICTION_HIGH_SEVERITY_PERCENT).toBe(
      'prediction_high_severity_percent',
    )
  })

  test('包含交通灯 keys', () => {
    expect(PORTFOLIO_DASHBOARD_METRIC_KEYS.TRAFFIC_LIGHT_RED_COUNT).toBe('traffic_light_red_count')
    expect(PORTFOLIO_DASHBOARD_METRIC_KEYS.TRAFFIC_LIGHT_YELLOW_COUNT).toBe(
      'traffic_light_yellow_count',
    )
    expect(PORTFOLIO_DASHBOARD_METRIC_KEYS.TRAFFIC_LIGHT_GREEN_COUNT).toBe(
      'traffic_light_green_count',
    )
    expect(PORTFOLIO_DASHBOARD_METRIC_KEYS.TRAFFIC_LIGHT_GRAY_COUNT).toBe(
      'traffic_light_gray_count',
    )
  })
})

// ─── Metric Key Stability ──────────────────────────────────────────────────────

describe('metric key stability', () => {
  test('metric keys values are stable strings', () => {
    const keys = Object.values(PORTFOLIO_DASHBOARD_METRIC_KEYS)
    expect(keys.length).toBeGreaterThanOrEqual(19)
    // 所有值必须为 snake_case
    for (const k of keys) {
      expect(k).toMatch(/^[a-z_]+$/)
    }
  })

  test('warning codes values are stable strings', () => {
    const codes = Object.values(PORTFOLIO_DASHBOARD_WARNING_CODES)
    expect(codes.length).toBeGreaterThanOrEqual(8)
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z_]+$/)
    }
  })

  test('group keys 稳定', () => {
    expect(PORTFOLIO_GROUP_KEYS.STATUS).toBe('status')
    expect(PORTFOLIO_GROUP_KEYS.HEALTH).toBe('health')
    expect(PORTFOLIO_GROUP_KEYS.CATEGORY).toBe('category')
  })

  test('sort keys 稳定', () => {
    expect(PORTFOLIO_SORT_KEYS.NAME).toBe('name')
    expect(PORTFOLIO_SORT_KEYS.PROGRESS).toBe('progress')
    expect(PORTFOLIO_SORT_KEYS.HEALTH).toBe('health')
    expect(PORTFOLIO_SORT_KEYS.OVERDUE).toBe('overdue')
  })

  test('metric version 稳定', () => {
    expect(PORTFOLIO_DASHBOARD_METRIC_VERSION).toBe('portfolio-dashboard.v1')
  })
})

// ─── Stale Detection ───────────────────────────────────────────────────────────

describe('isSourceStale', () => {
  test('null lastUpdatedAt 视为 stale', () => {
    expect(isSourceStale(null)).toBe(true)
  })

  test('近期更新不视为 stale', () => {
    const now = new Date().toISOString()
    expect(isSourceStale(now)).toBe(false)
  })

  test('超过阈值视为 stale', () => {
    const old = new Date(
      Date.now() - (PORTFOLIO_DASHBOARD_STALE_THRESHOLD_MINUTES + 10) * 60 * 1000,
    ).toISOString()
    expect(isSourceStale(old)).toBe(true)
  })

  test('自定义阈值生效', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    expect(isSourceStale(fiveMinAgo, 3)).toBe(true)
    expect(isSourceStale(fiveMinAgo, 10)).toBe(false)
  })
})

// ─── Warning Projections ───────────────────────────────────────────────────────

describe('projectUnsupportedFinancialWarning', () => {
  test('返回 FINANCIAL_UNSUPPORTED warning', () => {
    const w = projectUnsupportedFinancialWarning(PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS)
    expect(w.code).toBe(PORTFOLIO_DASHBOARD_WARNING_CODES.FINANCIAL_UNSUPPORTED)
    expect(w.message).toContain('财务')
  })
})

describe('projectTrafficLightUnavailableWarning', () => {
  test('返回 TRAFFIC_LIGHT_UNAVAILABLE warning', () => {
    const w = projectTrafficLightUnavailableWarning()
    expect(w.code).toBe(PORTFOLIO_DASHBOARD_WARNING_CODES.TRAFFIC_LIGHT_UNAVAILABLE)
  })
})

describe('projectTrafficLightForbiddenWarning', () => {
  test('返回 TRAFFIC_LIGHT_FORBIDDEN warning', () => {
    const w = projectTrafficLightForbiddenWarning()
    expect(w.code).toBe(PORTFOLIO_DASHBOARD_WARNING_CODES.TRAFFIC_LIGHT_FORBIDDEN)
    expect(w.message).toContain('无')
  })
})

describe('projectPermissionRedactedWarning', () => {
  test('返回 PERMISSION_REDACTED warning 含 metric key', () => {
    const w = projectPermissionRedactedWarning(PORTFOLIO_DASHBOARD_METRIC_KEYS.RISK_HIGH_PERCENT)
    expect(w.code).toBe(PORTFOLIO_DASHBOARD_WARNING_CODES.PERMISSION_REDACTED)
    expect(w.metricKey).toBe(PORTFOLIO_DASHBOARD_METRIC_KEYS.RISK_HIGH_PERCENT)
    expect(w.message).toContain('脱敏')
  })
})

// ─── Redacted Metric ───────────────────────────────────────────────────────────

describe('projectRedactedMetric', () => {
  test('返回 FORBIDDEN 状态指标', () => {
    const m = projectRedactedMetric(PORTFOLIO_DASHBOARD_METRIC_KEYS.HEALTH_RED_PERCENT)
    expect(m.key).toBe('health_red_percent')
    expect(m.value).toBeNull()
    expect(m.status).toBe(PORTFOLIO_DASHBOARD_METRIC_STATUSES.FORBIDDEN)
    expect(m.warnings).toHaveLength(1)
    expect(m.warnings![0].code).toBe(PORTFOLIO_DASHBOARD_WARNING_CODES.PERMISSION_REDACTED)
  })
})

// ─── Invalid Key Rejection ─────────────────────────────────────────────────────

describe('invalid key rejection', () => {
  test('PORTFOLIO_DASHBOARD_METRIC_KEYS 不含财务 key', () => {
    const keys = Object.values(PORTFOLIO_DASHBOARD_METRIC_KEYS)
    expect(keys).not.toContain('budget')
    expect(keys).not.toContain('roi')
    expect(keys).not.toContain('cost')
    expect(keys).not.toContain('financial')
  })
})

// ─── Source Constants ──────────────────────────────────────────────────────────

describe('PORTFOLIO_DASHBOARD_SOURCES', () => {
  test('包含所有数据来源', () => {
    expect(PORTFOLIO_DASHBOARD_SOURCES.PROJECT_DASHBOARD).toBe('project_dashboard')
    expect(PORTFOLIO_DASHBOARD_SOURCES.HEALTH_DIAGNOSIS).toBe('health_diagnosis')
    expect(PORTFOLIO_DASHBOARD_SOURCES.PREDICTION).toBe('prediction')
    expect(PORTFOLIO_DASHBOARD_SOURCES.RISK_SUMMARY).toBe('risk_summary')
    expect(PORTFOLIO_DASHBOARD_SOURCES.RESOURCE_SUMMARY).toBe('resource_summary')
    expect(PORTFOLIO_DASHBOARD_SOURCES.TRAFFIC_LIGHT).toBe('traffic_light')
  })
})

// ─── Constants ─────────────────────────────────────────────────────────────────

describe('constants', () => {
  test('MAX_PER_PAGE', () => {
    expect(PORTFOLIO_DASHBOARD_MAX_PER_PAGE).toBe(100)
  })

  test('STALE_THRESHOLD_MINUTES', () => {
    expect(PORTFOLIO_DASHBOARD_STALE_THRESHOLD_MINUTES).toBe(60)
  })

  test('TREND_WINDOWS 含 30/90 天', () => {
    expect(PORTFOLIO_TREND_WINDOWS.LAST_30_DAYS).toBe('last_30_days')
    expect(PORTFOLIO_TREND_WINDOWS.LAST_90_DAYS).toBe('last_90_days')
  })
})
