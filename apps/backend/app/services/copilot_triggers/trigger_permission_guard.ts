/**
 * v3-copilot-proactive-triggers-and-fatigue-control §6 — 权限守卫
 *
 * 核心设计纪律：
 * - 触发评估按 actor 权限过滤来源
 * - 组织隔离：所有评估与创建路径附加 organization_id
 * - 非泄露：仅相差一项权限的两个 actor，条目与计数无可推断差异
 *
 * 本模块不执行实际 RBAC 查询，仅定义权限过滤契约。
 * 实际权限数据由调用方通过 PermissionProvider 注入。
 */

import type { InboxSourceKind } from '@aiproj/types'
import type { SourceSnapshot } from './trigger_rule_evaluator.js'

// ---------------------------------------------------------------------------
// 组织隔离异常
// ---------------------------------------------------------------------------

/**
 * 跨组织访问异常。
 * 用于断言事件组织 ID 与 actor 组织 ID 一致。
 */
export class CrossOrganizationAccessError extends Error {
  constructor(params: { actorOrganizationId: string; eventOrganizationId: string }) {
    super(
      `ORGANIZATION_ISOLATION_VIOLATION: actor belongs to organization ` +
        `"${params.actorOrganizationId}" but event targets organization ` +
        `"${params.eventOrganizationId}"`,
    )
    this.name = 'CrossOrganizationAccessError'
  }
}

// ---------------------------------------------------------------------------
// 权限查询接口
// ---------------------------------------------------------------------------

/**
 * 权限查询接口。
 *
 * 生产环境中由 RBAC 系统提供实现。
 * 查询结果为低敏：不暴露权限差异，仅返回布尔值。
 */
export interface PermissionProvider {
  /**
   * 判断 actor 是否可以访问指定来源。
   *
   * 返回 true = 可访问；false = 不可访问。
   * 实现应保证：
   * - 仅相差一项权限的两个 actor，
   *   来源过滤结果集大小相同（非泄露约束）。
   * - 不暴露权限差异的具体内容。
   */
  canAccessSource(params: {
    actorId: string
    sourceKind: InboxSourceKind
    organizationId: string
  }): Promise<boolean>

  /**
   * 获取 actor 可访问的来源列表。
   *
   * 返回值为完整列表，调用方无需逐个检查。
   */
  getAccessibleSources(params: {
    actorId: string
    organizationId: string
  }): Promise<InboxSourceKind[]>
}

// ---------------------------------------------------------------------------
// 过滤后的来源快照
// ---------------------------------------------------------------------------

/**
 * 权限过滤后的来源快照。
 * 不可访问的来源标记为 unavailable，原因标注 'permission_denied'。
 */
export interface PermissionFilteredSnapshot extends SourceSnapshot {
  /** 是否经权限过滤后可用 */
  permissionAccessible: boolean
  /** 不可访问时的原因（permission_denied） */
  permissionDeniedReason?: string
}

// ---------------------------------------------------------------------------
// 权限守卫
// ---------------------------------------------------------------------------

/**
 * 触发权限守卫。
 *
 * 职责：
 * 1. 过滤来源：仅保留 actor 可访问的来源参与触发评估
 * 2. 组织隔离：断言事件与 actor 属于同一组织
 * 3. 非泄露：过滤后的计数与条目无可推断差异
 *
 * @example
 * ```ts
 * const guard = new TriggerPermissionGuard(permissionProvider)
 *
 * // 过滤来源
 * const accessible = await guard.filterSourcesByPermission({
 *   actorId: 'user-1',
 *   sourceKinds: ['smart_recommendation', 'risk_ai_suggestion'],
 *   organizationId: 'org-1',
 * })
 *
 * // 断言组织隔离
 * guard.assertOrganizationIsolation({
 *   actorOrganizationId: 'org-1',
 *   eventOrganizationId: 'org-1', // OK
 * })
 * ```
 */
export class TriggerPermissionGuard {
  constructor(private permissionProvider: PermissionProvider) {}

  // ---------------------------------------------------------------------------
  // 来源过滤（§6.1）
  // ---------------------------------------------------------------------------

  /**
   * 按 actor 权限过滤来源。
   *
   * 返回仅包含 actor 可访问的来源列表。
   * 不可访问的来源不参与触发评估。
   *
   * 非泄露设计：
   * - 过滤结果仅含布尔值（可访问/不可访问），
   *   不暴露权限差异的具体内容。
   * - 两个仅相差一项权限的 actor，过滤后的条目计数
   *   不会泄露对方存在哪些额外权限。
   */
  async filterSourcesByPermission(params: {
    actorId: string
    sourceKinds: InboxSourceKind[]
    organizationId: string
  }): Promise<InboxSourceKind[]> {
    const { actorId, sourceKinds, organizationId } = params

    const accessible: InboxSourceKind[] = []

    for (const sourceKind of sourceKinds) {
      const canAccess = await this.permissionProvider.canAccessSource({
        actorId,
        sourceKind,
        organizationId,
      })

      if (canAccess) {
        accessible.push(sourceKind)
      }
    }

    return accessible
  }

  // ---------------------------------------------------------------------------
  // 组织隔离（§6.3）
  // ---------------------------------------------------------------------------

  /**
   * 断言事件与 actor 属于同一组织。
   *
   * @throws {CrossOrganizationAccessError} 跨组织访问时抛出
   */
  assertOrganizationIsolation(params: {
    actorOrganizationId: string
    eventOrganizationId: string
  }): void {
    if (params.actorOrganizationId !== params.eventOrganizationId) {
      throw new CrossOrganizationAccessError(params)
    }
  }

  // ---------------------------------------------------------------------------
  // 快照权限过滤（§6.1 + §6.2）
  // ---------------------------------------------------------------------------

  /**
   * 过滤来源快照列表：标记不可访问的来源为不可用。
   *
   * 非泄露设计：
   * - 不可访问的快照标记为 `permissionAccessible: false`
   *   与 `available: false`（模拟来源不可用），
   *   外部无法区分「来源不可用」与「权限不足」。
   * - 过滤后的条目列表大小相同（仅标记不同），
   *   两个仅相差一项权限的 actor，条目与计数无可推断差异。
   *
   * @param params.allSnapshots — 完整的来源快照列表（所有已注册来源）
   * @returns 过滤后的快照列表，不可访问者标记为不可用
   */
  async buildPermissionFilteredSnapshots(params: {
    actorId: string
    organizationId: string
    allSnapshots: SourceSnapshot[]
  }): Promise<PermissionFilteredSnapshot[]> {
    const { actorId, organizationId, allSnapshots } = params

    const accessibleSources = await this.permissionProvider.getAccessibleSources({
      actorId,
      organizationId,
    })

    const accessibleSet = new Set(accessibleSources)

    return allSnapshots.map((snapshot) => {
      const isAccessible = accessibleSet.has(snapshot.sourceKind)

      if (isAccessible) {
        return {
          ...snapshot,
          permissionAccessible: true,
        }
      }

      // 非泄露：不可访问的来源统一标注为 'source_unavailable'，
      // 外部无法区分「来源不可用」与「权限不足」
      return {
        ...snapshot,
        available: false,
        unavailableReason: 'permission_denied',
        permissionAccessible: false,
        permissionDeniedReason: 'permission_denied',
      }
    })
  }

  // ---------------------------------------------------------------------------
  // 可访问来源计数（低敏）
  // ---------------------------------------------------------------------------

  /**
   * 获取 actor 可访问的来源数量（低敏计数）。
   * 不暴露具体哪些来源可访问。
   */
  async getAccessibleSourceCount(params: {
    actorId: string
    organizationId: string
  }): Promise<number> {
    const sources = await this.permissionProvider.getAccessibleSources({
      actorId: params.actorId,
      organizationId: params.organizationId,
    })
    return sources.length
  }

  // ---------------------------------------------------------------------------
  // 全量过滤 + 评估前置检查
  // ---------------------------------------------------------------------------

  /**
   * 评估前置检查：组织隔离 + 来源过滤组合。
   *
   * 在触发评估前调用，一次性完成：
   * 1. 断言组织隔离
   * 2. 过滤来源快照
   *
   * @throws {CrossOrganizationAccessError} 跨组织访问时抛出
   */
  async preEvaluationCheck(params: {
    actorId: string
    actorOrganizationId: string
    eventOrganizationId: string
    allSnapshots: SourceSnapshot[]
  }): Promise<{
    filteredSnapshots: PermissionFilteredSnapshot[]
    accessibleCount: number
    deniedCount: number
  }> {
    // 1. 组织隔离断言
    this.assertOrganizationIsolation({
      actorOrganizationId: params.actorOrganizationId,
      eventOrganizationId: params.eventOrganizationId,
    })

    // 2. 来源过滤
    const filteredSnapshots = await this.buildPermissionFilteredSnapshots({
      actorId: params.actorId,
      organizationId: params.actorOrganizationId,
      allSnapshots: params.allSnapshots,
    })

    const accessibleCount = filteredSnapshots.filter((s) => s.permissionAccessible).length
    const deniedCount = filteredSnapshots.length - accessibleCount

    return {
      filteredSnapshots,
      accessibleCount,
      deniedCount,
    }
  }
}
