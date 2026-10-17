/**
 * v3-copilot-proactive-triggers-and-fatigue-control §6 — 疲劳偏好服务
 *
 * 核心设计纪律：
 * - 组织级与个人级两层偏好，个人级优先
 * - 偏好读写端点与 RBAC 校验
 * - 偏好面板可重置降频状态
 *
 * 存储策略：当前使用内存 Map（无专用 DB 表），
 * 设计上可迁移到 organization.settings 或独立表。
 */

import type { FatigueWindowConfig, FatiguePreference, InboxProblemKind } from '@aiproj/types'
import type { FatiguePreferenceProvider } from './fatigue_control_service.js'

// ---------------------------------------------------------------------------
// RBAC 校验接口
// ---------------------------------------------------------------------------

/**
 * 角色判定接口。
 * 生产环境中由 RBAC 系统提供实现。
 */
export interface RoleChecker {
  /**
   * 判断用户在指定组织中是否具有管理员角色。
   */
  isAdmin(params: { organizationId: string; userId: string }): Promise<boolean>
}

// ---------------------------------------------------------------------------
// 降频状态接口（由调用方提供实现）
// ---------------------------------------------------------------------------

/**
 * 降频状态重置接口。
 * 与 FrequencyStateProvider 共享同源实现，仅暴露重置能力。
 */
export interface FrequencyStateResetProvider {
  /**
   * 重置 (actor, problemKind) 的连续忽略次数。
   */
  resetDismissCount(params: {
    actorId: string
    problemKind: InboxProblemKind
    organizationId: string
  }): Promise<void>

  /**
   * 重置 (actor, problemKind) 的连续忽略次数——全种类。
   */
  resetAllDismissCounts?(params: { actorId: string; organizationId: string }): Promise<void>
}

// ---------------------------------------------------------------------------
// 无效静默时段异常
// ---------------------------------------------------------------------------

export class InvalidQuietHoursError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidQuietHoursError'
  }
}

// ---------------------------------------------------------------------------
// 偏好存储键
// ---------------------------------------------------------------------------

type PreferenceLevel = 'organization' | 'personal'

function makePreferenceKey(
  level: PreferenceLevel,
  organizationId: string,
  userId?: string,
): string {
  if (level === 'personal' && userId) {
    return `org:${organizationId}:user:${userId}`
  }
  return `org:${organizationId}`
}

// ---------------------------------------------------------------------------
// 疲劳偏好服务
// ---------------------------------------------------------------------------

/**
 * 疲劳偏好服务。
 *
 * 实现 FatiguePreferenceProvider 接口，供 FatigueControlService 注入使用。
 * 提供组织级与个人级两层偏好存储，个人级优先。
 *
 * @example
 * ```ts
 * const service = new TriggerPreferenceService(roleChecker, frequencyResetProvider)
 * const preference = await service.getPreference({
 *   organizationId: 'org-1',
 *   userId: 'user-1',
 * })
 * ```
 */
export class TriggerPreferenceService implements FatiguePreferenceProvider {
  /**
   * 偏好存储（内存 Map，可迁移至 DB）。
   * key: makePreferenceKey(...)
   */
  private preferences = new Map<string, FatiguePreference>()

  constructor(
    private roleChecker: RoleChecker,
    private frequencyResetProvider: FrequencyStateResetProvider,
  ) {}

  // ---------------------------------------------------------------------------
  // FatiguePreferenceProvider 接口实现
  // ---------------------------------------------------------------------------

  /**
   * 获取疲劳偏好（个人级优先，否则组织级）。
   * 合并逻辑：默认值 → 组织级覆盖 → 个人级覆盖。
   */
  async getPreference(params: {
    organizationId: string
    userId: string
  }): Promise<FatiguePreference | null> {
    const { organizationId, userId } = params

    const orgKey = makePreferenceKey('organization', organizationId)
    const personalKey = makePreferenceKey('personal', organizationId, userId)

    const orgPref = this.preferences.get(orgKey) ?? null
    const personalPref = this.preferences.get(personalKey) ?? null

    if (!orgPref && !personalPref) return null

    // 个人级优先：合并组织级 + 个人级
    if (personalPref) {
      return {
        organizationId,
        userId,
        windowConfig: {
          ...(orgPref?.windowConfig ?? {}),
          ...(personalPref.windowConfig ?? {}),
        },
        quietHours: personalPref.quietHours ?? orgPref?.quietHours ?? null,
      }
    }

    return orgPref!
  }

  /**
   * 获取组织级静默时段配置。
   */
  async getOrganizationQuietHours(params: {
    organizationId: string
  }): Promise<{ start: number; end: number } | null> {
    const key = makePreferenceKey('organization', params.organizationId)
    const pref = this.preferences.get(key)
    return pref?.quietHours ?? null
  }

  /**
   * 获取组织时区（当前实现返回 null，由调用方回落 UTC）。
   * TODO-DEBT: 接入组织时区设置（organization.timezone）。
   */
  async getOrganizationTimezone(_params: { organizationId: string }): Promise<string | null> {
    // TODO-DEBT: 从 organization.settings 读取时区
    return null
  }

  // ---------------------------------------------------------------------------
  // 偏好读写（§6.5, §6.6）
  // ---------------------------------------------------------------------------

  /**
   * 设置组织级疲劳偏好（§6.6 — 需管理员角色）。
   *
   * @throws {Error} 非管理员调用时抛出 PERMISSION_DENIED
   * @throws {InvalidQuietHoursError} 静默时段参数非法时抛出
   */
  async setOrganizationPreference(params: {
    organizationId: string
    preference: Partial<FatigueWindowConfig>
    quietHours: { start: number; end: number } | null
  }): Promise<FatiguePreference> {
    const { organizationId, preference, quietHours } = params

    // RBAC 校验：仅管理员可设置组织级偏好
    const isAdmin = await this.roleChecker.isAdmin({
      organizationId,
      userId: '', // 组织级操作不绑定特定用户
    })
    if (!isAdmin) {
      throw new Error(`PERMISSION_DENIED: admin required for organization ${organizationId}`)
    }

    this.validateQuietHours(quietHours)

    const key = makePreferenceKey('organization', organizationId)
    const existing = this.preferences.get(key)

    const merged: FatiguePreference = {
      organizationId,
      userId: null,
      windowConfig: {
        ...(existing?.windowConfig ?? {}),
        ...preference,
      },
      quietHours: quietHours ?? existing?.quietHours ?? null,
    }

    this.preferences.set(key, merged)
    return merged
  }

  /**
   * 设置组织级疲劳偏好（内部方法，由 controller 层传入认证 userId）。
   *
   * @throws {Error} 非管理员调用时抛出 PERMISSION_DENIED
   * @throws {InvalidQuietHoursError} 静默时段参数非法时抛出
   */
  async setOrganizationPreferenceAs(params: {
    organizationId: string
    userId: string
    preference: Partial<FatigueWindowConfig>
    quietHours: { start: number; end: number } | null
  }): Promise<FatiguePreference> {
    const { organizationId, userId, preference, quietHours } = params

    // RBAC 校验
    const isAdmin = await this.roleChecker.isAdmin({ organizationId, userId })
    if (!isAdmin) {
      throw new Error(
        `PERMISSION_DENIED: user ${userId} is not admin in organization ${organizationId}`,
      )
    }

    this.validateQuietHours(quietHours)

    const key = makePreferenceKey('organization', organizationId)
    const existing = this.preferences.get(key)

    const merged: FatiguePreference = {
      organizationId,
      userId: null,
      windowConfig: {
        ...(existing?.windowConfig ?? {}),
        ...preference,
      },
      quietHours: quietHours ?? existing?.quietHours ?? null,
    }

    this.preferences.set(key, merged)
    return merged
  }

  /**
   * 设置个人级疲劳偏好（§6.5 — 任何用户可为自己设置）。
   *
   * @throws {InvalidQuietHoursError} 静默时段参数非法时抛出
   */
  async setPersonalPreference(params: {
    organizationId: string
    userId: string
    preference: Partial<FatigueWindowConfig>
    quietHours: { start: number; end: number } | null
  }): Promise<FatiguePreference> {
    const { organizationId, userId, preference, quietHours } = params

    this.validateQuietHours(quietHours)

    const key = makePreferenceKey('personal', organizationId, userId)
    const existing = this.preferences.get(key)

    const merged: FatiguePreference = {
      organizationId,
      userId,
      windowConfig: {
        ...(existing?.windowConfig ?? {}),
        ...preference,
      },
      quietHours: quietHours ?? existing?.quietHours ?? null,
    }

    this.preferences.set(key, merged)
    return merged
  }

  // ---------------------------------------------------------------------------
  // 降频状态重置（§6.8）
  // ---------------------------------------------------------------------------

  /**
   * 重置降频状态（偏好面板可重置）。
   *
   * @param params.problemKind — 指定问题种类时仅重置该种类的忽略计数；
   *        未指定时重置该 actor 的全部忽略计数。
   */
  async resetFrequencyState(params: {
    organizationId: string
    userId: string
    problemKind?: InboxProblemKind
  }): Promise<void> {
    const { organizationId, userId, problemKind } = params

    if (problemKind) {
      await this.frequencyResetProvider.resetDismissCount({
        actorId: userId,
        problemKind,
        organizationId,
      })
    } else if (this.frequencyResetProvider.resetAllDismissCounts) {
      await this.frequencyResetProvider.resetAllDismissCounts({
        actorId: userId,
        organizationId,
      })
    }
    // 若 resetAllDismissCounts 未实现且未指定 problemKind，
    // 则无操作（调用方应指定 problemKind）。
  }

  // ---------------------------------------------------------------------------
  // 删除偏好（恢复默认）
  // ---------------------------------------------------------------------------

  /**
   * 删除个人级偏好（恢复为使用组织级/默认值）。
   */
  async clearPersonalPreference(params: { organizationId: string; userId: string }): Promise<void> {
    const key = makePreferenceKey('personal', params.organizationId, params.userId)
    this.preferences.delete(key)
  }

  /**
   * 删除组织级偏好（恢复为使用默认值）。
   */
  async clearOrganizationPreference(params: { organizationId: string }): Promise<void> {
    const key = makePreferenceKey('organization', params.organizationId)
    this.preferences.delete(key)
  }

  // ---------------------------------------------------------------------------
  // 内部辅助
  // ---------------------------------------------------------------------------

  /**
   * 校验静默时段参数合法性。
   */
  private validateQuietHours(quietHours: { start: number; end: number } | null): void {
    if (!quietHours) return

    const { start, end } = quietHours
    if (start < 0 || start > 23 || end < 0 || end > 23) {
      throw new InvalidQuietHoursError(
        `quietHours hours must be 0-23, got start=${start}, end=${end}`,
      )
    }
  }

  // ---------------------------------------------------------------------------
  // 测试辅助（非公开接口）
  // ---------------------------------------------------------------------------

  /**
   * 获取当前存储的偏好快照（测试用）。
   * @internal
   */
  _snapshot(): Map<string, FatiguePreference> {
    return new Map(this.preferences)
  }

  /**
   * 清空所有偏好（测试用）。
   * @internal
   */
  _clear(): void {
    this.preferences.clear()
  }
}
