import { inject } from '@adonisjs/core'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { PROJECT_VIEW, type Permission } from '#rbac'
import {
  PROJECT_SIGNAL_DOMAIN_PERMISSIONS,
  type SignalDomainAccess,
} from '#services/project_signal/signal_permissions'
import type { ProjectSignalType } from '#services/project_signal/signal_contracts'

/**
 * v3-triz-contradiction-copilot W3 任务 3.4 —— 信号读取 / 流转的 RBAC 策略。
 *
 * 判定口径（spec「信号读取的权限隔离与审计」第 1/2 条）：
 * - 项目作用域：`project:view`（含项目归属断言）。`RbacService.check` 对跨组织项目返回
 *   `cross_org_denied` —— 调用方**必须**据此回 404 `RESOURCE_NOT_FOUND`，不得回 403（RL-05）；
 * - **领域权限裁剪**：风险/缺陷类证据额外要求 `risk:view`，资源类要求 `resource:view`，
 *   里程碑类要求 `milestone:view`，进度类要求 `task:view`。缺某一域权限时**不整体拒绝**，
 *   而是把该类型信号的证据字段裁剪掉（spec 允许「裁剪或整条不可见」，本实现取裁剪）。
 *
 * 策略只判定与解析，不碰数据：裁剪由 `ProjectSignalService.toDTO` 按 `domainAccess` 执行。
 */
export interface ProjectSignalPolicyDecision {
  allowed: boolean
  /** 判定服务给出的原因（`cross_org_denied` / `permission_not_granted` / …） */
  reason: string | null
  missingPermission: Permission | null
  /** 领域权限持有情况（fail-closed：未解析成功即空表，全部证据被裁剪） */
  domainAccess: SignalDomainAccess
}

const DENIED_DOMAINS: SignalDomainAccess = {}

@inject()
export default class ProjectSignalPolicy {
  constructor(private readonly rbac: RbacService) {}

  /**
   * 组织隔离断言：actor 必须是该组织成员或所有者（超管放行）。
   * 非成员一律 `RESOURCE_NOT_FOUND`（RL-05，不泄露组织存在性）。
   */
  async assertOrganizationVisible(user: User, organizationId: number): Promise<void> {
    if (user.isSuperAdmin) return

    const { default: OrganizationModel } = await import('#models/organization')
    const organization = await OrganizationModel.find(organizationId)
    if (!organization) throw new ResourceNotFoundException('组织不存在')

    if (Number(organization.ownerId) === Number(user.id)) return

    const { default: OrganizationMemberModel } = await import('#models/organization_member')
    const membership = await OrganizationMemberModel.query()
      .where('organization_id', organizationId)
      .where('user_id', user.id)
      .first()
    if (!membership) throw new ResourceNotFoundException('组织不存在')
  }

  /** 解析领域权限持有情况（支持项目级或组织级解析，fail-closed）。 */
  async resolveDomainAccess(
    user: User,
    organizationId: number,
    projectId?: number,
  ): Promise<SignalDomainAccess> {
    const domainAccess: SignalDomainAccess = {}
    for (const permission of new Set(Object.values(PROJECT_SIGNAL_DOMAIN_PERMISSIONS))) {
      const result = await this.rbac.check(user, permission, organizationId, projectId)
      // 跨组织在项目作用域判定已拦截；此处任何非放行都按「无该域权限」处理（fail-closed）。
      domainAccess[permission] = result.allowed === true
    }
    return domainAccess
  }

  /**
   * 组织级信号只读鉴权（v3-triz-copilot-followups 任务 4.1）：
   * 组织成员 + 复用领域权限裁剪逻辑解析 domainAccess。
   */
  async authorizeOrganizationView(
    user: User,
    organizationId: number,
  ): Promise<ProjectSignalPolicyDecision> {
    await this.assertOrganizationVisible(user, organizationId)
    const domainAccess = await this.resolveDomainAccess(user, organizationId)
    return { allowed: true, reason: null, missingPermission: null, domainAccess }
  }

  /** 读取信号列表 / 详情：`project:view` + 领域权限解析。 */
  async authorizeView(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<ProjectSignalPolicyDecision> {
    const scope = await this.rbac.check(user, PROJECT_VIEW, organizationId, projectId)
    if (!scope.allowed) {
      return {
        allowed: false,
        reason: scope.reason ?? 'permission_not_granted',
        missingPermission: PROJECT_VIEW,
        domainAccess: DENIED_DOMAINS,
      }
    }

    const domainAccess = await this.resolveDomainAccess(user, organizationId, projectId)
    return { allowed: true, reason: null, missingPermission: null, domainAccess }
  }

  /** 状态流转（忽略 / 采纳）：与读取同一项目作用域门禁（信号属雷达自有记录，非业务表写入）。 */
  async authorizeTransition(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<ProjectSignalPolicyDecision> {
    const decision = await this.authorizeView(user, organizationId, projectId)
    return decision
  }

  /**
   * 检测（生成信号）：`project:view`。检测本身零业务写入，故不额外要求写权限；
   * 领域权限仍在读取证据时单独裁剪，不在生成阶段拒绝。
   */
  async authorizeDetect(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<ProjectSignalPolicyDecision> {
    const scope = await this.rbac.check(user, PROJECT_VIEW, organizationId, projectId)
    if (scope.allowed) {
      return { allowed: true, reason: null, missingPermission: null, domainAccess: DENIED_DOMAINS }
    }
    return {
      allowed: false,
      reason: scope.reason ?? 'permission_not_granted',
      missingPermission: PROJECT_VIEW,
      domainAccess: DENIED_DOMAINS,
    }
  }

  /** 类型 → 所需领域权限（供 DTO 与前端物理阻断使用）。 */
  static requiredPermission(signalType: ProjectSignalType): Permission {
    return PROJECT_SIGNAL_DOMAIN_PERMISSIONS[signalType]
  }
}
