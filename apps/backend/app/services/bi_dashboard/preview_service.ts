// v3-bi-dashboard-builder §5 — BI Dashboard Preview Service。
// 无副作用预览：串联 registry、validator、policy、widget adapters、
// freshness、warnings、definitionHash 和 snapshotHash。

import type User from '#models/user'
import {
  normalizeBiDashboardDefinition,
  computeBiDashboardSnapshotHash,
  aggregateBiDashboardFreshness,
  isBiDashboardSaveable,
  BI_DASHBOARD_WARNING_CODES,
  type BiDashboardPreviewResult,
  type BiDashboardPreviewPayload,
  type BiDashboardWidgetPreview,
  type BiDashboardWarning,
  type BiDashboardWidgetKey,
} from '@aiproj/types'
import { getAuthorizedRegistry } from './widget_registry.js'
import { validateWidgetsAgainstRegistry } from '#validators/bi_dashboard'
import type BiDashboardPolicy from '#policies/bi_dashboard_policy'

/**
 * Preview Service — 预览候选 BI Dashboard 定义，不产生副作用。
 *
 * 职责：
 *   - 验证 widgets 是否在 registry 白名单中
 *   - 检查权限标签（permissionTags）
 *   - 为每个 widget 生成 fixture 预览（真实 adapter 在 P0 后续接入）
 *   - 计算 definitionHash、snapshotHash、freshnessAggregate
 *   - 返回 saveable 状态与 warning 集合
 */
export default class BiDashboardPreviewService {
  constructor(private readonly policy: BiDashboardPolicy) {}

  async preview(
    user: User,
    organizationId: number,
    payload: BiDashboardPreviewPayload,
  ): Promise<BiDashboardPreviewResult> {
    const globalWarnings: BiDashboardWarning[] = []
    const widgetPreviews: BiDashboardWidgetPreview[] = []

    // 1. 获取用户授权可见的 registry
    const authorizedTags = await this.resolveAuthorizedTags(user, organizationId)
    const registry = getAuthorizedRegistry(authorizedTags)

    // 2. 验证 widgets
    const availableKeys = new Set(Object.keys(registry))
    const validation = validateWidgetsAgainstRegistry(
      payload.widgets as unknown as Record<string, unknown>[],
      availableKeys,
    )
    if (!validation.valid) {
      globalWarnings.push({
        code: BI_DASHBOARD_WARNING_CODES.BLOCKING_MISSING_DEPENDENCY,
        message: validation.errors.join('; '),
        blocking: true,
      })
      return this.buildEmptyResult(payload, globalWarnings, [])
    }

    // 3. 为每个 widget 生成预览
    for (const widget of payload.widgets) {
      const key = widget.widgetKey as BiDashboardWidgetKey
      const entry = registry[key]

      if (!entry) {
        widgetPreviews.push(this.buildUnavailableWidget(key))
        continue
      }

      if (entry.availability === 'unavailable' || entry.availability === 'disabled') {
        widgetPreviews.push(this.buildUnavailableWidget(key))
        continue
      }

      // 检查 permission tags
      const tagOk = entry.permissionTags.every((t) => authorizedTags.has(t))
      if (!tagOk) {
        widgetPreviews.push(this.buildForbiddenWidget(key))
        continue
      }

      // 生成 fixture 预览（后续接入真实 adapters）
      widgetPreviews.push(this.buildFixturePreview(key, entry.displayKey))
    }

    // 4. 计算 hash 和 freshness
    const definitionHash = normalizeBiDashboardDefinition({
      name: 'preview',
      scope: 'personal',
      // 预览不落库，归属人按当前调用者计入 hash 输入，避免与已保存定义的 hash 口径漂移
      ownerActorId: Number(user.id),
      layout: payload.layout,
      widgets: payload.widgets,
      globalFilters: payload.globalFilters ?? [],
      timeWindow: payload.timeWindow ?? { mode: 'last_n_days', days: 30 },
      freshnessPolicy: { maxAgeSeconds: 3600, staleBehavior: 'warning' },
      isDefault: false,
      isArchived: false,
      warningSummary: [],
    })

    const snapshotHash = computeBiDashboardSnapshotHash(
      definitionHash,
      widgetPreviews.map((wp) => ({ sourceHash: wp.sourceHash, status: wp.status })),
      globalWarnings.map((w) => ({ code: w.code })),
    )

    const freshnessAggregate = aggregateBiDashboardFreshness(
      widgetPreviews.map((wp) => ({ freshness: wp.freshness, status: wp.status })),
    )

    const saveable = isBiDashboardSaveable(
      widgetPreviews.map((wp) => ({ status: wp.status, warnings: wp.warnings })),
      globalWarnings,
    )

    return {
      definitionHash,
      snapshotHash,
      widgets: widgetPreviews,
      globalWarnings,
      saveable,
      freshnessAggregate,
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async resolveAuthorizedTags(user: User, organizationId: number): Promise<Set<string>> {
    const tags = new Set<string>()
    try {
      if (await this.policy.authorizeCreateShared(user, organizationId)) {
        tags.add('pmo')
        tags.add('bi_dashboard_manage')
      }
    } catch {
      // 无 pmo 权限，忽略
    }
    // 所有成员都至少有基础查看权限
    tags.add('risk_view')
    return tags
  }

  private buildEmptyResult(
    _payload: BiDashboardPreviewPayload,
    globalWarnings: BiDashboardWarning[],
    widgets: BiDashboardWidgetPreview[],
  ): BiDashboardPreviewResult {
    return {
      definitionHash: '',
      snapshotHash: '',
      widgets,
      globalWarnings,
      saveable: false,
      freshnessAggregate: { status: 'unavailable', oldestGeneratedAt: '' },
    }
  }

  private buildFixturePreview(
    key: BiDashboardWidgetKey,
    displayKey: string,
  ): BiDashboardWidgetPreview {
    return {
      widgetKey: key,
      size: 'medium',
      status: 'available',
      data: { _fixture: true, label: displayKey },
      warnings: [],
      freshness: {
        status: 'fresh',
        generatedAt: new Date().toISOString(),
        maxAgeSeconds: 3600,
      },
      sourceRefs: [
        { sourceKey: key, sourceHash: 'fixture', generatedAt: new Date().toISOString() },
      ],
      sourceHash: 'fixture',
    }
  }

  private buildUnavailableWidget(key: BiDashboardWidgetKey): BiDashboardWidgetPreview {
    return {
      widgetKey: key,
      size: 'medium',
      status: 'unavailable',
      warnings: [
        {
          code: BI_DASHBOARD_WARNING_CODES.WIDGET_UNAVAILABLE,
          widgetKey: key,
          message: `Widget ${key} is unavailable`,
          blocking: false,
        },
      ],
      freshness: { status: 'unavailable', generatedAt: '', maxAgeSeconds: 0 },
      sourceRefs: [],
      sourceHash: '',
    }
  }

  private buildForbiddenWidget(key: BiDashboardWidgetKey): BiDashboardWidgetPreview {
    return {
      widgetKey: key,
      size: 'medium',
      status: 'forbidden',
      warnings: [
        {
          code: BI_DASHBOARD_WARNING_CODES.WIDGET_FORBIDDEN,
          widgetKey: key,
          message: `Widget ${key} requires permissions you do not have`,
          blocking: false,
        },
      ],
      freshness: { status: 'unavailable', generatedAt: '', maxAgeSeconds: 0 },
      sourceRefs: [],
      sourceHash: '',
    }
  }
}
