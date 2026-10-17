/**
 * v3-backend-type-debt-closure（任务 4.3）—— §4.2 新增/修正共享契约导出的回归测试。
 *
 * 覆盖四个在 4.2 补齐或修正的导出，锁定取值与确定性：
 * 1. `BUDGET_COST_STATUSES` / `BudgetCostStatus`（unified-ai-budget）——预算判定与
 *    调用账本共用同一组取值，漂移即不一致。
 * 2. `plugin_registry_command`（multitenant-api-boundary `ApiResourceType`）——
 *    命令端点是 API 层派生类型，surface registry 需要声明。
 * 3. `DeliveryChannelToggle` / `DeliveryChannelPreference`（copilot-notification-routing，
 *    F13）——拆分为单通道开关 + 按通道映射，fixtures 与 delivery_router 都按映射使用。
 * 4. `PluginUiCommandFinding.iconKey`（plugin-ui-command）——`icon-not-found` reason
 *    需要字段承载证据。
 *
 * `CopilotAssemblyTruncationMarker.omittedMethodologyCount` 的取值与校验已由
 * `copilot-context-assembly.test.ts`「§6.4/§6.5 截断标记 omittedMethodologyCount」
 * 用例组覆盖，本文件不重复。
 */
import { describe, expect, it } from 'vitest'
import { BUDGET_COST_STATUSES, type BudgetCostStatus } from './unified-ai-budget.js'
import {
  DELIVERY_CHANNELS,
  type DeliveryChannelPreference,
  type DeliveryChannelToggle,
} from './copilot-notification-routing.js'
import {
  makeAllChannelsEnabled,
  makeChannelPreference,
} from './copilot-notification-routing-fixtures.js'
import type { ApiResourceType } from './multitenant-api-boundary.js'
import type { PluginUiCommandFinding } from './plugin-ui-command.js'

describe('v3-backend-type-debt-closure §4.3 — 新增共享契约导出', () => {
  describe('BUDGET_COST_STATUSES / BudgetCostStatus', () => {
    it('取值集合锁定：六个状态、顺序稳定、无重复', () => {
      expect(BUDGET_COST_STATUSES).toEqual([
        'estimated',
        'fallback_estimate',
        'cost_unknown',
        'unavailable',
        'zero',
        'unknown',
      ])
      expect(new Set(BUDGET_COST_STATUSES).size).toBe(BUDGET_COST_STATUSES.length)
    })

    it('类型与常量同源：每个取值都可赋给 BudgetCostStatus', () => {
      // 类型层面的同源性由 tsc 保证；这里锁定运行时数组是 typeof 的来源
      const statuses: BudgetCostStatus[] = [...BUDGET_COST_STATUSES]
      expect(statuses).toHaveLength(6)
    })
  })

  describe('ApiResourceType.plugin_registry_command', () => {
    it('plugin_registry_command 是合法的 ApiResourceType', () => {
      // 赋值本身即类型断言：该成员被移除时 tsc 报错，测试文件无法编译
      const resourceType: ApiResourceType = 'plugin_registry_command'
      expect(resourceType).toBe('plugin_registry_command')
    })
  })

  describe('DeliveryChannelToggle / DeliveryChannelPreference（F13）', () => {
    it('DeliveryChannelPreference 是按通道映射，而非单通道对象', () => {
      const pref: DeliveryChannelPreference = makeAllChannelsEnabled(true)
      // 每个声明的通道都必须有独立开关
      for (const channel of DELIVERY_CHANNELS) {
        const toggle: DeliveryChannelToggle = pref[channel]
        expect(toggle.enabled).toBe(true)
      }
      expect(Object.keys(pref).sort()).toEqual([...DELIVERY_CHANNELS].sort())
    })

    it('makeChannelPreference 生成单通道开关且各通道独立', () => {
      const on = makeChannelPreference(true)
      const off = makeChannelPreference(false)
      expect(on).toEqual({ enabled: true })
      expect(off).toEqual({ enabled: false })
      // 修改一个通道不影响其他通道（映射语义）
      const pref: DeliveryChannelPreference = makeAllChannelsEnabled(true)
      pref.push = off
      expect(pref.badge.enabled).toBe(true)
      expect(pref.in_app_notification.enabled).toBe(true)
      expect(pref.push.enabled).toBe(false)
    })
  })

  describe('PluginUiCommandFinding.iconKey', () => {
    it('finding 可携带 iconKey 作为 icon-not-found 的证据字段', () => {
      const finding: PluginUiCommandFinding = {
        severity: 'blocking',
        reason: 'icon-not-found',
        pluginId: 'p1',
        contributionKey: 'c1',
        iconKey: 'not-a-real-icon',
      }
      expect(finding.iconKey).toBe('not-a-real-icon')
      // iconKey 可选：不带时编译通过
      const minimal: PluginUiCommandFinding = {
        severity: 'blocking',
        reason: 'unknown-action',
        pluginId: 'p1',
        contributionKey: 'c1',
      }
      expect(minimal.iconKey).toBeUndefined()
    })
  })
})
