import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { PROJECT_HEALTH_VIEW, PROJECT_HEALTH_GENERATE, PROJECT_HEALTH_CONFIRM } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * 项目健康诊断 Policy（v2-ai-project-health-diagnosis §5.2）。
 *
 * 权限分层：
 *   - view（仅查看）
 *   - generate（查看 + 生成/刷新/AI 草稿）
 *   - confirm（查看 + 生成 + 确认/驳回）
 *
 * 跨组织访问统一返回 `RESOURCE_NOT_FOUND`（Controller 层处理），
 * 同组织无项目权限返回 `PERMISSION_DENIED`。
 */
@inject()
export default class ProjectHealthDiagnosisPolicy {
  constructor(private readonly rbac: RbacService) {}

  async view(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, PROJECT_HEALTH_VIEW, organizationId)
    return result.allowed
  }

  async generate(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, PROJECT_HEALTH_GENERATE, organizationId)
    return result.allowed
  }

  async confirm(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, PROJECT_HEALTH_CONFIRM, organizationId)
    return result.allowed
  }
}
