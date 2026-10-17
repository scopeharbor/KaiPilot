/**
 * v3-ai-offline-eval-datasets §7 — Authorization Gate & Organization Isolation。
 *
 * D7 真实模型大规模评测属授权门，默认 fixture provider。
 *
 * 核心约束：
 * - 组织级 feature flag 控制（organization_settings 表）
 * - RBAC 校验（admin role required）
 * - 默认 OFF（fixture provider only，零真实调用）
 * - 所有查询强制 organizationId 过滤
 * - 跨组织数据不可见
 *
 * @aiproj/backend services — 零真实 provider 调用（默认 fixture judge）
 */

import type { OfflineEvalProviderKind } from '@aiproj/types'
import { resolveEvalProvider } from '@aiproj/types'

// ═══════════════════════════════════════════════════════════════════════════════
// §7.1 Authorization Gate — 组织级授权开关与 RBAC 校验
// ═══════════════════════════════════════════════════════════════════════════════

/** 授权判定结果。 */
export interface OfflineEvalAuthDecision {
  /** 是否允许使用真实模型。 */
  authorized: boolean
  /** 应使用的 provider 类型。 */
  providerKind: OfflineEvalProviderKind
  /** 拒绝原因（未授权时）。 */
  denialReason?: string
  /** RBAC 权限是否满足。 */
  rbacSatisfied: boolean
  /** 组织 feature flag 是否开启。 */
  orgFlagEnabled: boolean
}

/** RBAC 角色常量。 */
const ADMIN_ROLES = ['super_admin', 'admin'] as const

/**
 * 检查角色是否为 admin 级别。
 */
function isAdminRole(role: string | undefined): boolean {
  if (!role) return false
  return (ADMIN_ROLES as readonly string[]).includes(role)
}

/**
 * 授权门守卫：判定当前 actor 是否有权使用真实模型评测。
 *
 * 判定逻辑：
 * 1. 组织 feature flag 必须开启
 * 2. actor 必须具有 admin 角色
 * 3. 两者缺一 → 拒绝，返回 fixture provider
 *
 * @param orgFlagEnabled - 组织级 offline_eval_real_model_enabled 设置
 * @param actorRole - 当前 actor 的 RBAC 角色
 * @returns 授权判定结果
 */
export function adjudicateOfflineEvalAuth(
  orgFlagEnabled: boolean,
  actorRole: string | undefined,
): OfflineEvalAuthDecision {
  const rbacSatisfied = isAdminRole(actorRole)

  // 两个条件都必须满足
  const authorized = orgFlagEnabled && rbacSatisfied

  const providerKind = resolveEvalProvider(authorized ? 'authorized' : 'not_authorized')

  let denialReason: string | undefined
  if (!authorized) {
    if (!orgFlagEnabled && !rbacSatisfied) {
      denialReason = '组织未启用真实模型评测且 actor 无 admin 权限'
    } else if (!orgFlagEnabled) {
      denialReason = '组织未启用真实模型评测'
    } else {
      denialReason = 'actor 无 admin 权限，无法使用真实模型评测'
    }
  }

  return {
    authorized,
    providerKind,
    denialReason,
    rbacSatisfied,
    orgFlagEnabled,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §7.2 默认 Fixture Provider — 零真实模型调用
// ═══════════════════════════════════════════════════════════════════════════════

/** Fixture provider 调用记录（用于测试断言）。 */
export interface FixtureProviderCall {
  readonly sampleId: string
  readonly dimension: string
  readonly calledAt: string
}

/**
 * Fixture 评测提供者：零真实模型调用，零公网请求。
 * 用于测试和未授权场景。
 */
export class OfflineEvalFixtureProvider {
  private calls: FixtureProviderCall[] = []

  /**
   * 对单个样本执行 fixture 评测（返回 pass）。
   * 不发起任何真实模型调用或网络请求。
   */
  evaluate(
    sampleId: string,
    dimension: string,
  ): {
    scoreValue: number
    scoreLabel: 'pass' | 'fail' | 'not-evaluated'
    explanation: string
  } {
    const call: FixtureProviderCall = {
      sampleId,
      dimension,
      calledAt: new Date().toISOString(),
    }
    this.calls.push(call)

    return {
      scoreValue: 1,
      scoreLabel: 'pass',
      explanation: `Fixture provider: ${dimension} for ${sampleId} evaluated (zero real model calls)`,
    }
  }

  /** 获取所有调用记录（供测试断言）。 */
  getCalls(): FixtureProviderCall[] {
    return [...this.calls]
  }

  /** 清空调用记录。 */
  clearCalls(): void {
    this.calls = []
  }

  /** 获取调用次数。 */
  getCallCount(): number {
    return this.calls.length
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §7.4 Organization Isolation — 组织隔离查询助手
// ═══════════════════════════════════════════════════════════════════════════════

/** 组织隔离查询参数。 */
export interface OrgScopedQueryParams {
  readonly organizationId: number
}

/** 离线评测资源类型。 */
export const OFFLINE_EVAL_RESOURCE_TYPES = [
  'offline_eval_dataset',
  'offline_eval_run',
  'offline_eval_report',
] as const

export type OfflineEvalResourceType = (typeof OFFLINE_EVAL_RESOURCE_TYPES)[number]

/**
 * 校验资源是否属于指定组织。
 * 跨组织访问返回 false（不泄露存在性）。
 */
export function isResourceInOrganization(
  resourceOrganizationId: number,
  queryOrganizationId: number,
): boolean {
  return resourceOrganizationId === queryOrganizationId
}

/**
 * 构建组织隔离的查询条件。
 * 所有离线评测查询必须附加此条件。
 */
export function buildOrgScopeFilter(organizationId: number): {
  organization_id: number
} {
  return { organization_id: organizationId }
}

/**
 * 校验一组资源全部属于同一组织。
 * 任一跨租户 → 返回 false。
 */
export function assertAllInOrganization(
  resources: Array<{ organizationId: number }>,
  queryOrganizationId: number,
): boolean {
  return resources.every((r) => r.organizationId === queryOrganizationId)
}
