import { inject } from '@adonisjs/core'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { AI_TRIGGER, PROJECT_VIEW, type Permission } from '#rbac'

/**
 * v3-triz-contradiction-copilot 任务 2.2 —— 矛盾求解对话流的 RBAC 策略。
 *
 * 判定口径（spec「对话求解的 RBAC 与组织隔离」第 1/3 条）：
 * - 项目作用域：`project:view`（含项目归属断言）。`RbacService.check` 对跨组织项目返回
 *   `cross_org_denied` —— 调用方**必须**据此回 404 `RESOURCE_NOT_FOUND`，不得回 403
 *   （RL-05：禁止泄露目标资源在其他组织中的存在性）；
 * - 求解 / 改判门禁：`ai:trigger`（组织级会话权限）；
 * - **领域权限**（`task:view` / `risk:view` / `resource:view` / `milestone:view` /
 *   `change_request:create`）按读取范围**逐项**校验 —— 该判定由
 *   `TrizContextPackService.assemble` 执行：无该域权限 ⇒ 该域整体缺席且不发起该域读取
 *   （本策略不重复校验，避免把「只看得到部分域」降级成整体 403）。
 *
 * 本策略返回判定结果而不直接抛异常：Controller 据结果选择 403/404 并在拒绝时留痕
 * （spec「反幻觉与低敏审计边界」第 4 条：越权与失败同样要审计）。
 */
export interface TrizCopilotPolicyDecision {
  allowed: boolean
  /** 判定服务给出的原因（`cross_org_denied` / `permission_not_granted` / …） */
  reason: string | null
  missingPermission: Permission | null
}

const ALLOWED: TrizCopilotPolicyDecision = {
  allowed: true,
  reason: null,
  missingPermission: null,
}

@inject()
export default class TrizCopilotPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 求解（受理并映射）：`project:view` + `ai:trigger`。 */
  async authorizeSolve(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<TrizCopilotPolicyDecision> {
    return this.#authorizeWithTrigger(user, organizationId, projectId)
  }

  /** 改判并重算：与求解同一门禁（改判会重新读取项目事实并重算方案）。 */
  async authorizeOverride(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<TrizCopilotPolicyDecision> {
    return this.#authorizeWithTrigger(user, organizationId, projectId)
  }

  /** 读取既有分析记录（列表 / 详情）：只要求 `project:view`（不触发任何模型调用）。 */
  async authorizeView(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<TrizCopilotPolicyDecision> {
    return this.#authorizeProjectScope(user, organizationId, projectId)
  }

  async #authorizeWithTrigger(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<TrizCopilotPolicyDecision> {
    const projectScope = await this.#authorizeProjectScope(user, organizationId, projectId)
    if (!projectScope.allowed) return projectScope
    return this.#authorizeTrigger(user, organizationId)
  }

  /** 项目作用域判定：项目存在性 + 组织归属 + `project:view`。 */
  async #authorizeProjectScope(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<TrizCopilotPolicyDecision> {
    const result = await this.rbac.check(user, PROJECT_VIEW, organizationId, projectId)
    if (result.allowed) return ALLOWED
    return {
      allowed: false,
      reason: result.reason ?? 'permission_not_granted',
      missingPermission: PROJECT_VIEW,
    }
  }

  async #authorizeTrigger(user: User, organizationId: number): Promise<TrizCopilotPolicyDecision> {
    const result = await this.rbac.check(user, AI_TRIGGER, organizationId)
    if (result.allowed) return ALLOWED
    return {
      allowed: false,
      reason: result.reason ?? 'permission_not_granted',
      missingPermission: AI_TRIGGER,
    }
  }
}
