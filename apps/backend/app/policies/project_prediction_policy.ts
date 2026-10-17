import PermissionDeniedException from '#exceptions/api_exception'
import type User from '#models/user'
import type Project from '#models/project'
import RbacService from '#services/rbac_service'
import {
  PREDICTION_VIEW,
  PREDICTION_GENERATE,
  PREDICTION_CONFIRM,
  PREDICTION_TRIGGER_AI,
  RISK_VIEW,
  RESOURCE_VIEW,
  CHANGE_IMPACT_VIEW,
  type Permission,
} from '#start/rbac/permissions'
import { inject } from '@adonisjs/core'

/**
 * ProjectPredictionPolicy —— 预测快照权限守卫。
 *
 * 四层权限：view / generate / confirm / trigger_ai。
 *
 * v2-ai-risk-progress-prediction / design D11
 */
@inject()
export default class ProjectPredictionPolicy {
  constructor(private rbac: RbacService) {}

  /** 用户可否查看预测 */
  async canView(project: Project, user: User): Promise<boolean> {
    return this.allows(user, PREDICTION_VIEW, project)
  }

  /** 用户可否生成预测 */
  async canGenerate(project: Project, user: User): Promise<boolean> {
    return this.allows(user, PREDICTION_GENERATE, project)
  }

  /** 用户可否确认/忽略预测 */
  async canConfirm(project: Project, user: User): Promise<boolean> {
    return this.allows(user, PREDICTION_CONFIRM, project)
  }

  /** 用户可否触发 AI 解释 */
  async canTriggerAi(project: Project, user: User): Promise<boolean> {
    return this.allows(user, PREDICTION_TRIGGER_AI, project)
  }

  async canViewRisk(project: Project, user: User): Promise<boolean> {
    return this.allows(user, RISK_VIEW, project)
  }

  async canViewResource(project: Project, user: User): Promise<boolean> {
    return this.allows(user, RESOURCE_VIEW, project)
  }

  async canViewChangeImpact(project: Project, user: User): Promise<boolean> {
    return this.allows(user, CHANGE_IMPACT_VIEW, project)
  }

  /** 带异常抛出的查看守卫 */
  async authorizeView(project: Project, user: User): Promise<void> {
    if (!(await this.canView(project, user))) {
      throw new PermissionDeniedException('无查看预测权限', {
        code: 'PREDICTION_PERMISSION_DENIED',
      })
    }
  }

  /** 带异常抛出的生成守卫 */
  async authorizeGenerate(project: Project, user: User): Promise<void> {
    if (!(await this.canGenerate(project, user))) {
      throw new PermissionDeniedException('无生成预测权限', {
        code: 'PREDICTION_PERMISSION_DENIED',
      })
    }
  }

  /** 带异常抛出的确认守卫 */
  async authorizeConfirm(project: Project, user: User): Promise<void> {
    if (!(await this.canConfirm(project, user))) {
      throw new PermissionDeniedException('无确认预测权限', {
        code: 'PREDICTION_PERMISSION_DENIED',
      })
    }
  }

  /** 带异常抛出的 AI 触发守卫 */
  async authorizeTriggerAi(project: Project, user: User): Promise<void> {
    if (!(await this.canTriggerAi(project, user))) {
      throw new PermissionDeniedException('无触发 AI 解释权限', {
        code: 'PREDICTION_PERMISSION_DENIED',
      })
    }
  }

  /** 统一权限检查 */
  private async allows(user: User, permission: Permission, project: Project): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(
      user,
      permission,
      Number(project.organizationId),
      Number(project.id),
    )
    return result.allowed
  }
}
