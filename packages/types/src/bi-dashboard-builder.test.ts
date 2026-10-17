// @aiproj/types — BI Dashboard Builder 共享契约测试
// v3-bi-dashboard-builder §2.5

import { describe, expect, it } from 'vitest'
import {
  BI_DASHBOARD_SCOPES,
  BI_DASHBOARD_WIDGET_KEYS,
  BI_DASHBOARD_WIDGET_KEY_VALUES,
  BI_DASHBOARD_MAX_WIDGETS,
  BI_DASHBOARD_MAX_BREAKPOINTS,
  BI_DASHBOARD_WINDOW_MAX_DAYS,
  BI_DASHBOARD_SYSTEM_DEFAULT,
  BI_DASHBOARD_FRESHNESS_STATUSES,
  BI_DASHBOARD_WARNING_CODES,
  computeBiDashboardSnapshotHash,
  normalizeBiDashboardDefinition,
  aggregateBiDashboardFreshness,
  isBiDashboardSaveable,
  isAllowedBiDashboardWidgetKey,
  isAllowedBiDashboardScope,
} from './bi-dashboard-builder'

describe('bi-dashboard-builder shared contract', () => {
  describe('scope constants', () => {
    it('defines personal and organization_shared scopes', () => {
      expect(BI_DASHBOARD_SCOPES.PERSONAL).toBe('personal')
      expect(BI_DASHBOARD_SCOPES.ORGANIZATION_SHARED).toBe('organization_shared')
    })
  })

  describe('widget key allowlist', () => {
    it('defines all P0 widget keys', () => {
      expect(BI_DASHBOARD_WIDGET_KEYS.BI_TREND).toBe('bi_trend')
      expect(BI_DASHBOARD_WIDGET_KEYS.BI_RISK_HEATMAP).toBe('bi_risk_heatmap')
      expect(BI_DASHBOARD_WIDGET_KEYS.BI_CUSTOM_REPORT_SUMMARY).toBe('bi_custom_report_summary')
      expect(BI_DASHBOARD_WIDGET_KEYS.PMO_HEALTH).toBe('pmo_health')
      expect(BI_DASHBOARD_WIDGET_KEYS.RESOURCE_SUMMARY).toBe('resource_summary')
      expect(BI_DASHBOARD_WIDGET_KEYS.OKR_SUMMARY).toBe('okr_summary')
      expect(BI_DASHBOARD_WIDGET_KEYS.ORGANIZATION_DASHBOARD_SUMMARY).toBe(
        'organization_dashboard_summary',
      )
    })

    it('isAllowedBiDashboardWidgetKey validates keys', () => {
      expect(isAllowedBiDashboardWidgetKey('bi_trend')).toBe(true)
      expect(isAllowedBiDashboardWidgetKey('risk_heatmap')).toBe(false)
      expect(isAllowedBiDashboardWidgetKey('')).toBe(false)
      expect(isAllowedBiDashboardWidgetKey(undefined)).toBe(false)
      expect(isAllowedBiDashboardWidgetKey(null)).toBe(false)
      expect(isAllowedBiDashboardWidgetKey('bi_trend<script>')).toBe(false)
    })
  })

  describe('scope validation', () => {
    it('isAllowedBiDashboardScope validates scopes', () => {
      expect(isAllowedBiDashboardScope('personal')).toBe(true)
      expect(isAllowedBiDashboardScope('organization_shared')).toBe(true)
      expect(isAllowedBiDashboardScope('admin')).toBe(false)
      expect(isAllowedBiDashboardScope('')).toBe(false)
      expect(isAllowedBiDashboardScope(undefined)).toBe(false)
    })
  })

  describe('definition normalization', () => {
    it('produces stable definitionHash for the same input', () => {
      const def = {
        name: 'Test Dashboard',
        scope: BI_DASHBOARD_SCOPES.PERSONAL as const,
        layout: { columns: 2, density: 'comfortable' as const },
        widgets: [
          {
            widgetKey: BI_DASHBOARD_WIDGET_KEYS.BI_TREND,
            size: 'medium' as const,
            position: { x: 0, y: 0, w: 1, h: 1 },
            settings: {},
          },
        ],
        globalFilters: [],
        timeWindow: { mode: 'last_n_days' as const, days: 30 },
        freshnessPolicy: { maxAgeSeconds: 3600, staleBehavior: 'warning' as const },
        isDefault: false,
        isArchived: false,
        warningSummary: [],
      }
      const h1 = normalizeBiDashboardDefinition(def)
      const h2 = normalizeBiDashboardDefinition(def)
      expect(h1).toBeTruthy()
      expect(h1).toBe(h2)
    })

    it('produces different definitionHash for different inputs', () => {
      const def1 = {
        name: 'A',
        scope: BI_DASHBOARD_SCOPES.PERSONAL as const,
        layout: { columns: 2, density: 'comfortable' as const },
        widgets: [],
        globalFilters: [],
        timeWindow: { mode: 'last_n_days' as const, days: 30 },
        freshnessPolicy: { maxAgeSeconds: 3600, staleBehavior: 'warning' as const },
        isDefault: false,
        isArchived: false,
      }
      const def2 = {
        name: 'B',
        scope: BI_DASHBOARD_SCOPES.PERSONAL as const,
        layout: { columns: 2, density: 'comfortable' as const },
        widgets: [],
        globalFilters: [],
        timeWindow: { mode: 'last_n_days' as const, days: 30 },
        freshnessPolicy: { maxAgeSeconds: 3600, staleBehavior: 'warning' as const },
        isDefault: false,
        isArchived: false,
      }
      expect(normalizeBiDashboardDefinition(def1)).not.toBe(normalizeBiDashboardDefinition(def2))
    })
  })

  describe('snapshot hash aggregation', () => {
    it('produces stable snapshotHash', () => {
      const h1 = computeBiDashboardSnapshotHash('defHash1', [], [])
      const h2 = computeBiDashboardSnapshotHash('defHash1', [], [])
      expect(h1).toBeTruthy()
      expect(h1).toBe(h2)
    })

    it('changes when widget sourceHash changes', () => {
      const h1 = computeBiDashboardSnapshotHash(
        'defHash1',
        [{ sourceHash: 'aaa', status: 'available' }],
        [],
      )
      const h2 = computeBiDashboardSnapshotHash(
        'defHash1',
        [{ sourceHash: 'bbb', status: 'available' }],
        [],
      )
      expect(h1).not.toBe(h2)
    })
  })

  describe('freshness aggregation', () => {
    it('returns unavailable when no available widgets', () => {
      const result = aggregateBiDashboardFreshness([
        {
          freshness: { status: 'unavailable', generatedAt: '', maxAgeSeconds: 0 },
          status: 'unavailable',
        },
      ])
      expect(result.status).toBe('unavailable')
    })

    it('returns fresh when all widgets fresh', () => {
      const result = aggregateBiDashboardFreshness([
        {
          freshness: { status: 'fresh', generatedAt: '2026-01-01T00:00:00Z', maxAgeSeconds: 3600 },
          status: 'available',
        },
        {
          freshness: { status: 'fresh', generatedAt: '2026-01-02T00:00:00Z', maxAgeSeconds: 3600 },
          status: 'available',
        },
      ])
      expect(result.status).toBe('fresh')
      expect(result.oldestGeneratedAt).toBe('2026-01-01T00:00:00Z')
    })
  })

  describe('saveable check', () => {
    it('allows save when no blocking conditions', () => {
      expect(isBiDashboardSaveable([{ status: 'available', warnings: [] }], [])).toBe(true)
    })

    it('blocks save when widget status is blocking', () => {
      expect(isBiDashboardSaveable([{ status: 'blocking', warnings: [] }], [])).toBe(false)
    })

    it('blocks save when globalWarning is blocking', () => {
      expect(
        isBiDashboardSaveable(
          [{ status: 'available', warnings: [] }],
          [{ code: 'BI_DASHBOARD_BLOCKING_PERMISSION', message: 'blocked', blocking: true }],
        ),
      ).toBe(false)
    })
  })

  describe('constants', () => {
    it('bounded widget count', () => {
      expect(BI_DASHBOARD_MAX_WIDGETS).toBe(12)
    })

    it('bounded breakpoints', () => {
      expect(BI_DASHBOARD_MAX_BREAKPOINTS).toBe(6)
    })

    it('bounded time window', () => {
      expect(BI_DASHBOARD_WINDOW_MAX_DAYS).toBe(730)
    })

    it('warning codes are defined', () => {
      expect(BI_DASHBOARD_WARNING_CODES.WIDGET_UNAVAILABLE).toBeTruthy()
      expect(BI_DASHBOARD_WARNING_CODES.WIDGET_FORBIDDEN).toBeTruthy()
      expect(BI_DASHBOARD_WARNING_CODES.BLOCKING_MISSING_DEPENDENCY).toBeTruthy()
      expect(BI_DASHBOARD_WARNING_CODES.BLOCKING_PERMISSION).toBeTruthy()
    })

    it('freshness statuses are defined', () => {
      expect(BI_DASHBOARD_FRESHNESS_STATUSES.FRESH).toBe('fresh')
      expect(BI_DASHBOARD_FRESHNESS_STATUSES.STALE).toBe('stale')
      expect(BI_DASHBOARD_FRESHNESS_STATUSES.UNAVAILABLE).toBe('unavailable')
    })
  })

  describe('system default', () => {
    it('provides an immutable system default', () => {
      expect(BI_DASHBOARD_SYSTEM_DEFAULT.name).toBe('系统默认 BI 看板')
      expect(BI_DASHBOARD_SYSTEM_DEFAULT.scope).toBe('organization_shared')
      expect(BI_DASHBOARD_SYSTEM_DEFAULT.isDefault).toBe(true)
      expect(BI_DASHBOARD_SYSTEM_DEFAULT.widgets).toEqual([])
    })
  })
})
