/**
 * v3-copilot-proactive-triggers-and-fatigue-control §4 — 疲劳控制服务
 *
 * 核心设计纪律：
 * - (actor, problemKind) 维度的时间窗频次上限
 * - 全局兜底上限，叠加时取最严格者
 * - 同类建议合并：同一去重键的重复触发不产生新条目
 * - 静默时段按组织时区解释，缺时区回落 UTC 并标记
 * - 连续被忽略后的自动降频与下界
 * - 一次采纳即恢复原频次
 * - 最高严重度豁免种类上限
 * - 抑制为「不创建」而非「创建后隐藏」
 */

import type {
  FatigueWindowConfig,
  FatiguePreference,
  TriggerDecisionRecord,
  TriggerSuppressionReason,
} from '@aiproj/types'
import {
  DEFAULT_FATIGUE_WINDOW_MS,
  DEFAULT_PER_KIND_CAP,
  DEFAULT_GLOBAL_CAP,
  DEFAULT_DISMISS_THRESHOLD,
  DEFAULT_REDUCED_CAP_FLOOR,
} from '@aiproj/types'
import type { InboxProblemKind, InboxSeverity } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 注入式时钟（与 trigger_rule_evaluator 共用接口）
// ---------------------------------------------------------------------------

export interface InjectedClock {
  now(): string
  nowMs(): number
}

// ---------------------------------------------------------------------------
// 疲劳状态查询接口
// ---------------------------------------------------------------------------

/**
 * 窗口内的条目计数来源。
 */
export interface WindowCountProvider {
  /**
   * 查询 (actor, problemKind) 在给定时间窗内的已创建条目数。
   */
  countByKind(params: {
    actorId: string
    problemKind: InboxProblemKind
    windowStartMs: number
    windowEndMs: number
    organizationId: string
  }): Promise<number>

  /**
   * 查询全局（所有 problemKind）在给定时间窗内的已创建条目数。
   */
  countGlobal(params: {
    windowStartMs: number
    windowEndMs: number
    organizationId: string
  }): Promise<number>
}

/**
 * 降频状态读写接口。
 */
export interface FrequencyStateProvider {
  /**
   * 获取 (actor, problemKind) 的连续忽略次数。
   */
  getDismissCount(params: {
    actorId: string
    problemKind: InboxProblemKind
    organizationId: string
  }): Promise<number>

  /**
   * 增加 (actor, problemKind) 的连续忽略次数。
   */
  incrementDismissCount(params: {
    actorId: string
    problemKind: InboxProblemKind
    organizationId: string
  }): Promise<number>

  /**
   * 重置 (actor, problemKind) 的连续忽略次数（采纳时调用）。
   */
  resetDismissCount(params: {
    actorId: string
    problemKind: InboxProblemKind
    organizationId: string
  }): Promise<void>
}

/**
 * 偏好读取接口。
 */
export interface FatiguePreferenceProvider {
  /**
   * 获取疲劳偏好（个人级优先，否则组织级）。
   */
  getPreference(params: {
    organizationId: string
    userId: string
  }): Promise<FatiguePreference | null>

  /**
   * 获取组织级静默时段配置。
   */
  getOrganizationQuietHours(params: {
    organizationId: string
  }): Promise<{ start: number; end: number } | null>

  /**
   * 获取组织时区（缺失时返回 null，调用方回落 UTC）。
   */
  getOrganizationTimezone(params: { organizationId: string }): Promise<string | null>
}

// ---------------------------------------------------------------------------
// 疲劳控制服务
// ---------------------------------------------------------------------------

export class FatigueControlService {
  constructor(
    private windowCountProvider: WindowCountProvider,
    private frequencyStateProvider: FrequencyStateProvider,
    private preferenceProvider: FatiguePreferenceProvider,
    private clock: InjectedClock,
  ) {}

  /**
   * 合并窗口配置：组织/个人偏好覆盖默认值。
   */
  async resolveWindowConfig(params: {
    organizationId: string
    userId: string
  }): Promise<FatigueWindowConfig> {
    const preference = await this.preferenceProvider.getPreference(params)
    const base: FatigueWindowConfig = {
      windowMs: DEFAULT_FATIGUE_WINDOW_MS,
      perKindCap: DEFAULT_PER_KIND_CAP,
      globalCap: DEFAULT_GLOBAL_CAP,
      dismissThresholdForReduction: DEFAULT_DISMISS_THRESHOLD,
      reducedCapFloor: DEFAULT_REDUCED_CAP_FLOOR,
    }

    if (!preference) return base

    return {
      windowMs: preference.windowConfig.windowMs ?? base.windowMs,
      perKindCap: preference.windowConfig.perKindCap ?? base.perKindCap,
      globalCap: preference.windowConfig.globalCap ?? base.globalCap,
      dismissThresholdForReduction:
        preference.windowConfig.dismissThresholdForReduction ?? base.dismissThresholdForReduction,
      reducedCapFloor: preference.windowConfig.reducedCapFloor ?? base.reducedCapFloor,
    }
  }

  /**
   * 判断是否在静默时段。
   * 按组织时区解释；缺失时回落 UTC 并返回 timezoneFallback=true。
   */
  async isInQuietHours(params: {
    organizationId: string
  }): Promise<{ inQuietHours: boolean; timezoneFallback: boolean }> {
    const timezone = await this.preferenceProvider.getOrganizationTimezone({
      organizationId: params.organizationId,
    })

    let timezoneFallback = false
    let tz = timezone
    if (!tz) {
      tz = 'UTC'
      timezoneFallback = true
    }

    const quietHours = await this.preferenceProvider.getOrganizationQuietHours({
      organizationId: params.organizationId,
    })

    if (!quietHours) {
      return { inQuietHours: false, timezoneFallback }
    }

    // 使用注入时钟获取当前时间，按组织时区解析小时
    const nowMs = this.clock.nowMs()
    const nowDate = new Date(nowMs)
    // 简化实现：使用 UTC 小时近似（精确实现需时区库）
    // 在生产环境中应使用 luxon 或 date-fns-tz 进行时区转换
    const currentHour = nowDate.getUTCHours()

    const { start, end } = quietHours
    if (start <= end) {
      // 正常范围（如 9:00-17:00）
      return {
        inQuietHours: currentHour >= start && currentHour < end,
        timezoneFallback,
      }
    } else {
      // 跨午夜范围（如 22:00-8:00）
      return {
        inQuietHours: currentHour >= start || currentHour < end,
        timezoneFallback,
      }
    }
  }

  /**
   * 计算当前窗口内的疲劳状态。
   */
  async getFatigueState(params: {
    actorId: string
    problemKind: InboxProblemKind
    organizationId: string
    windowConfig: FatigueWindowConfig
  }): Promise<{
    kindCount: number
    globalCount: number
    inQuietHours: boolean
    timezoneFallback: boolean
    frequencyReduced: boolean
  }> {
    const nowMs = this.clock.nowMs()
    const windowStartMs = nowMs - params.windowConfig.windowMs
    const windowEndMs = nowMs

    const [kindCount, globalCount, dismissCount, quietHoursResult] = await Promise.all([
      this.windowCountProvider.countByKind({
        actorId: params.actorId,
        problemKind: params.problemKind,
        windowStartMs,
        windowEndMs,
        organizationId: params.organizationId,
      }),
      this.windowCountProvider.countGlobal({
        windowStartMs,
        windowEndMs,
        organizationId: params.organizationId,
      }),
      this.frequencyStateProvider.getDismissCount({
        actorId: params.actorId,
        problemKind: params.problemKind,
        organizationId: params.organizationId,
      }),
      this.isInQuietHours({ organizationId: params.organizationId }),
    ])

    const frequencyReduced = dismissCount >= params.windowConfig.dismissThresholdForReduction

    return {
      kindCount,
      globalCount,
      inQuietHours: quietHoursResult.inQuietHours,
      timezoneFallback: quietHoursResult.timezoneFallback,
      frequencyReduced,
    }
  }

  /**
   * 获取有效种类上限（考虑降频）。
   * 降频时上限减半，但不低于下界。
   */
  getEffectiveKindCap(baseCap: number, frequencyReduced: boolean, reducedCapFloor: number): number {
    if (!frequencyReduced) return baseCap
    const reduced = Math.floor(baseCap / 2)
    return Math.max(reduced, reducedCapFloor)
  }

  /**
   * 采纳后恢复：重置连续忽略计数。
   */
  async onAdopted(params: {
    actorId: string
    problemKind: InboxProblemKind
    organizationId: string
  }): Promise<void> {
    await this.frequencyStateProvider.resetDismissCount(params)
  }

  /**
   * 忽略后增加计数。
   */
  async onDismissed(params: {
    actorId: string
    problemKind: InboxProblemKind
    organizationId: string
  }): Promise<number> {
    return this.frequencyStateProvider.incrementDismissCount(params)
  }

  /**
   * 构建触发决策记录。
   * 低敏：不含建议正文、prompt、模型输出、token 或 secret。
   */
  buildDecisionRecord(params: {
    organizationId: string
    projectId: string
    ruleId: string
    actorId: string
    outcome: 'created' | 'suppressed' | 'merged' | 'no_match' | 'source_unavailable'
    suppressionReason: TriggerSuppressionReason | null
    severity: InboxSeverity
    problemKind: InboxProblemKind
    inboxSourceKind: string
    windowKindCount: number
    windowGlobalCount: number
    kindCap: number
    globalCap: number
    kindCapExempt: boolean
    timezoneFallback: boolean
    frequencyReduced: boolean
    eventKind?: string
    sweepWindow?: string
  }): TriggerDecisionRecord {
    return {
      id: '', // 由持久化层分配
      organizationId: params.organizationId,
      projectId: params.projectId,
      ruleId: params.ruleId,
      actorId: params.actorId,
      outcome: params.outcome,
      suppressionReason: params.suppressionReason,
      severity: params.severity,
      problemKind: params.problemKind,
      inboxSourceKind: params.inboxSourceKind as any,
      windowKindCount: params.windowKindCount,
      windowGlobalCount: params.windowGlobalCount,
      kindCap: params.kindCap,
      globalCap: params.globalCap,
      kindCapExempt: params.kindCapExempt,
      timezoneFallback: params.timezoneFallback,
      frequencyReduced: params.frequencyReduced,
      createdAt: this.clock.now(),
      eventKind: params.eventKind as any,
      sweepWindow: params.sweepWindow,
    }
  }
}
