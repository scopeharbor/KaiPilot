import { describe, expectTypeOf, test } from 'vitest'
import type {
  DashboardMetric,
  DashboardMetricKey,
  DashboardMetricStatus,
  DashboardMetricUnit,
  DashboardSource,
  DashboardWarning,
  DashboardWarningCode,
} from './dashboard-metrics.js'
import {
  DASHBOARD_METRIC_KEYS,
  DASHBOARD_METRIC_VERSION_V1,
  DASHBOARD_SOURCES,
  DASHBOARD_STATUSES,
  DASHBOARD_WARNING_CODES,
} from './dashboard-metrics.js'

describe('Dashboard metrics contract', () => {
  test('metricVersion constant is stable', () => {
    expectTypeOf(DASHBOARD_METRIC_VERSION_V1).toEqualTypeOf<string>()
    expect(DASHBOARD_METRIC_VERSION_V1).toBe('project-dashboard.v1')
  })

  test('all required metric keys exist', () => {
    const requiredKeys = [
      'progress_percent',
      'health_status',
      'task_status_distribution',
      'task_total',
      'overdue_task_count',
      'soon_due_task_count',
      'member_count',
      'milestone_status_distribution',
      'milestone_total',
      'remaining_days',
      'recent_activity_summary',
    ] as const

    for (const key of requiredKeys) {
      expect(Object.values(DASHBOARD_METRIC_KEYS)).toContain(key)
    }
  })

  test('DashboardMetric type has correct structure', () => {
    expectTypeOf<DashboardMetric['key']>().toEqualTypeOf<DashboardMetricKey>()
    expectTypeOf<DashboardMetric['unit']>().toEqualTypeOf<DashboardMetricUnit>()
    expectTypeOf<DashboardMetric['source']>().toEqualTypeOf<DashboardSource>()
    expectTypeOf<DashboardMetric['status']>().toEqualTypeOf<DashboardMetricStatus>()
  })

  test('DashboardWarning has code and message', () => {
    expectTypeOf<DashboardWarning['code']>().toEqualTypeOf<DashboardWarningCode>()
    expectTypeOf<DashboardWarning['message']>().toEqualTypeOf<string>()
  })

  test('all warning codes are defined', () => {
    const codes = Object.values(DASHBOARD_WARNING_CODES)
    expect(codes).toContain('PROJECT_DATE_MISSING')
    expect(codes).toContain('TASK_METRIC_EMPTY')
    expect(codes).toContain('MILESTONE_METRIC_EMPTY')
    expect(codes).toContain('AUDIT_LOG_UNAVAILABLE')
    expect(codes).toContain('METRIC_RECONCILIATION_MISMATCH')
  })

  test('all source types are defined', () => {
    const sources = Object.values(DASHBOARD_SOURCES)
    expect(sources).toContain('project_field')
    expect(sources).toContain('task_aggregation')
    expect(sources).toContain('member_aggregation')
    expect(sources).toContain('milestone_aggregation')
    expect(sources).toContain('audit_log_aggregation')
  })

  test('all status types are defined', () => {
    const statuses = Object.values(DASHBOARD_STATUSES)
    expect(statuses).toContain('ok')
    expect(statuses).toContain('empty')
    expect(statuses).toContain('unavailable')
    expect(statuses).toContain('mismatch')
  })
})
