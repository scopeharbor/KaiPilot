// @aiproj/types — PMO 组合分组视图测试夹具（前后端共享）。
// v3-pmo-portfolio-grouping-views §2.4。

import type {
  PmoGroupingViewDefinition,
  PmoGroupingViewPreviewResponse,
  PmoGroupingViewQueryDefinition,
} from './pmo-portfolio-grouping-views.js'
import {
  PMO_GROUPING_VIEW_DEFINITION_VERSION,
  PMO_GROUPING_VIEW_SCOPES,
  PMO_GROUPING_VIEW_PRIMARY_KEYS,
  PMO_GROUPING_VIEW_COMPARE_MODES,
} from './pmo-portfolio-grouping-views.js'
import { PORTFOLIO_DASHBOARD_METRIC_KEYS } from './pmo-portfolio-dashboard.js'

/** 构建个人分组视图。 */
export function makePersonalGroupingView(
  overrides: Partial<PmoGroupingViewDefinition> = {},
): PmoGroupingViewDefinition {
  const now = new Date().toISOString()
  return {
    id: 'view-personal-001',
    scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
    organizationId: 1,
    ownerUserId: 1,
    name: '我的按状态分组',
    description: '个人保存的按项目状态分组视图',
    definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
    query: {
      primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
      displayMetricKeys: [PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS],
    },
    isDefault: false,
    capabilities: {
      canEdit: true,
      canDelete: true,
      canDuplicate: true,
      canSetDefault: true,
      canSetOrgDefault: false,
      isReadonly: false,
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/** 构建组织共享分组视图。 */
export function makeOrganizationGroupingView(
  overrides: Partial<PmoGroupingViewDefinition> = {},
): PmoGroupingViewDefinition {
  const now = new Date().toISOString()
  return {
    id: 'view-org-001',
    scope: PMO_GROUPING_VIEW_SCOPES.ORGANIZATION,
    organizationId: 1,
    ownerUserId: 2,
    name: '组织按健康度分组',
    description: '组织共享的项目健康度分组视图',
    definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
    query: {
      primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.HEALTH,
      secondaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
      displayMetricKeys: [
        PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
        PORTFOLIO_DASHBOARD_METRIC_KEYS.AT_RISK_PROJECTS,
      ],
      compareMode: PMO_GROUPING_VIEW_COMPARE_MODES.NONE,
    },
    isDefault: false,
    capabilities: {
      canEdit: true,
      canDelete: true,
      canDuplicate: true,
      canSetDefault: false,
      canSetOrgDefault: true,
      isReadonly: false,
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/** 构建受限制维度的分组视图（无 risk/resource 权限时的预览结果）。 */
export function makeRedactedDimensionPreview(): PmoGroupingViewPreviewResponse {
  return {
    groups: [
      {
        groupKey: 'health',
        groupValue: 'redacted',
        projectCount: 0,
        kpis: [
          {
            key: PORTFOLIO_DASHBOARD_METRIC_KEYS.HEALTH_RED_PERCENT,
            value: null,
            unit: 'percent',
            status: 'forbidden',
          },
        ],
        warnings: [
          {
            code: 'DIMENSION_REDACTED',
            message: '分组 health 的部分维度因权限不足已脱敏',
          },
        ],
      },
    ],
    freshness: [],
    warnings: [
      {
        code: 'DIMENSION_REDACTED',
        message: '部分分组维度因权限不足已脱敏',
      },
    ],
    meta: {
      calculatedAt: new Date().toISOString(),
      metricVersion: 'grouping-view.v1',
      organizationId: 1,
      visibleProjectCount: 0,
      primaryGroupCount: 1,
      secondaryGroupCount: 0,
      truncated: false,
    },
  }
}

/** 构建包含敏感 payload 的无效请求（用于测试敏感内容检测）。 */
export function makeInvalidSensitivePayload(): Record<string, unknown> {
  return {
    name: '恶意视图',
    query: {
      primaryGrouping: 'status',
      projectResults: [{ projectId: 1, projectName: 'secret project' }],
      evidenceText: '包含敏感证据的文本',
      prompt: 'AI 生成的提示词',
      modelOutput: '模型输出',
      apiKey: 'sk-secret-key',
    },
  }
}

/** 构建大规模组织分组输入（1000 项目）。 */
export function makeLargePortfolioGroupingInput(count: number = 1000): {
  projects: Array<{
    id: number
    name: string
    status: string
    healthStatus: string
    progressPercent: number
  }>
  query: PmoGroupingViewQueryDefinition
} {
  const statuses: string[] = ['active', 'archived', 'on_hold', 'draft']
  const healths: string[] = ['healthy', 'at_risk', 'critical', 'unknown']
  const projects = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Project ${i + 1}`,
    status: statuses[i % statuses.length]!,
    healthStatus: healths[i % healths.length]!,
    progressPercent: Math.floor(Math.random() * 100),
  }))
  return {
    projects,
    query: {
      primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
      secondaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.HEALTH,
      displayMetricKeys: [PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS],
    },
  }
}

/** 构建过期来源的分组响应。 */
export function makeStaleSourceGroupingPreview(
  overrides: Partial<PmoGroupingViewPreviewResponse> = {},
): PmoGroupingViewPreviewResponse {
  const now = new Date().toISOString()
  return {
    groups: [
      {
        groupKey: 'status',
        groupValue: 'active',
        projectCount: 5,
        kpis: [
          {
            key: PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
            value: 5,
            unit: 'count',
            status: 'ok',
          },
        ],
        warnings: [],
      },
    ],
    freshness: [
      {
        source: 'project_dashboard',
        lastUpdatedAt: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
        isStale: true,
        staleThresholdMinutes: 60,
      },
    ],
    warnings: [
      {
        code: 'SOURCE_STALE',
        message: '数据来源可能已过期',
      },
    ],
    meta: {
      calculatedAt: now,
      metricVersion: 'grouping-view.v1',
      organizationId: 1,
      visibleProjectCount: 5,
      primaryGroupCount: 1,
      secondaryGroupCount: 0,
      truncated: false,
    },
    ...overrides,
  }
}

/** 构建带二级分组的预览响应。 */
export function makeSecondaryGroupingPreview(): PmoGroupingViewPreviewResponse {
  const now = new Date().toISOString()
  return {
    groups: [
      {
        groupKey: 'status',
        groupValue: 'active',
        projectCount: 3,
        kpis: [
          {
            key: PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
            value: 3,
            unit: 'count',
            status: 'ok',
          },
        ],
        secondaryGroups: [
          {
            secondaryKey: 'health',
            secondaryValue: 'healthy',
            projectCount: 2,
            kpis: [
              {
                key: PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
                value: 2,
                unit: 'count',
                status: 'ok',
              },
            ],
            warnings: [],
          },
        ],
        warnings: [],
      },
      {
        groupKey: 'status',
        groupValue: 'archived',
        projectCount: 2,
        kpis: [
          {
            key: PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
            value: 2,
            unit: 'count',
            status: 'ok',
          },
        ],
        secondaryGroups: [
          {
            secondaryKey: 'health',
            secondaryValue: 'at_risk',
            projectCount: 1,
            kpis: [
              {
                key: PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
                value: 1,
                unit: 'count',
                status: 'ok',
              },
            ],
            warnings: [],
          },
        ],
        warnings: [],
      },
    ],
    freshness: [],
    warnings: [],
    meta: {
      calculatedAt: now,
      metricVersion: 'grouping-view.v1',
      organizationId: 1,
      visibleProjectCount: 5,
      primaryGroupCount: 2,
      secondaryGroupCount: 3,
      truncated: false,
    },
  }
}
