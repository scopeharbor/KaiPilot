import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import type { MultiProjectEndpointType } from '@aiproj/types'
import ProjectPolicy from '#policies/project_policy'
import TaskPolicy from '#policies/task_policy'
import RbacService from '#services/rbac_service'
import { inject } from '@adonisjs/core'

/**
 * 跨项目依赖权限策略。
 * 遵循 design D5：组织隔离 + 端点重授权 + 维度权限。
 * - 所有操作需组织成员资格
 * - 读取需组织级依赖查看权限
 * - 写入需组织级依赖管理权限 + consumer 管理权限 + provider 查看权限
 * - 下钻需二次授权
 */
@inject()
export default class MultiProjectDependencyPolicy {
  constructor(
    private projects: ProjectPolicy,
    private tasks: TaskPolicy,
    private rbac: RbacService,
  ) {}

  // -----------------------------------------------------------------------
  // 组织级权限检查
  // -----------------------------------------------------------------------

  /**
   * 组织成员资格（最基础隔离）。
   *
   * users 表没有 organization_id 列，成员关系只能查 organization_members
   * （owner 无成员行，由 RbacService 内部按 ownerId 放行）。
   */
  async requireOrganizationMember(user: User, organizationId: number): Promise<void> {
    if (user.isSuperAdmin) return

    const permissions = await this.rbac.resolveOrganizationPermissions(user, organizationId)
    if (permissions.size === 0) {
      throw new PermissionDeniedException('无权访问该组织资源')
    }
  }

  /** 组织级依赖查看权限 */
  async authorizeView(user: User, organizationId: number): Promise<void> {
    await this.requireOrganizationMember(user, organizationId)
    // 组织成员默认可以查看依赖（需配合项目可见性过滤）
  }

  /** 组织级依赖管理权限（PMO 或项目经理级别） */
  async authorizeManage(user: User, organizationId: number): Promise<void> {
    await this.requireOrganizationMember(user, organizationId)
    // 只有超管与组织管理员（owner/admin，规范角色 ORG_ADMIN）可以管理跨项目依赖
    if (user.isSuperAdmin) return
    if (!(await this.rbac.isOrgAdmin(user, organizationId))) {
      throw new PermissionDeniedException('无权管理跨项目依赖')
    }
  }

  // -----------------------------------------------------------------------
  // 端点级权限检查
  // -----------------------------------------------------------------------

  /** 检查对某个端点的查看权限 */
  async authorizeEndpointView(
    user: User,
    organizationId: number,
    endpointType: MultiProjectEndpointType,
    projectId: number | null,
  ): Promise<{ authorized: boolean; redacted: boolean }> {
    await this.requireOrganizationMember(user, organizationId)

    if (endpointType === 'external') {
      // 外部引用：组织成员均可查看
      return { authorized: true, redacted: false }
    }

    if (!projectId) {
      return { authorized: false, redacted: true }
    }

    try {
      // 检查项目可见性
      const canView = await this.projects.view(user, organizationId, projectId)
      return { authorized: canView, redacted: !canView }
    } catch {
      return { authorized: false, redacted: true }
    }
  }

  /** 检查对 consumer 端点的管理权限（写入需要） */
  async authorizeConsumerManage(
    user: User,
    organizationId: number,
    endpointType: MultiProjectEndpointType,
    projectId: number | null,
    taskId: number | null,
  ): Promise<void> {
    await this.requireOrganizationMember(user, organizationId)

    if (endpointType === 'external') {
      // 外部引用：需要依赖管理权限
      await this.authorizeManage(user, organizationId)
      return
    }

    if (!projectId) {
      throw new PermissionDeniedException('consumer 端点项目不存在')
    }

    // 需要对该项目有写权限
    const project = await this.getProject(organizationId, projectId)
    if (!project) {
      throw new PermissionDeniedException('consumer 项目不存在或无权访问')
    }

    if (endpointType === 'task' && taskId) {
      try {
        const task = await this.getTask(organizationId, projectId, taskId)
        if (task) {
          await this.tasks.authorizeUpdate(user, organizationId, projectId, task as any)
          return
        }
      } catch {
        // fall through to project check
      }
    }

    // 退回到项目级权限检查
    try {
      await this.tasks.authorizeUpdate(user, organizationId, projectId, { projectId } as any)
    } catch {
      throw new PermissionDeniedException('无权管理 consumer 端点')
    }
  }

  /** 检查对 provider 端点的查看权限（写入需要至少能查看） */
  async authorizeProviderView(
    user: User,
    organizationId: number,
    endpointType: MultiProjectEndpointType,
    projectId: number | null,
  ): Promise<void> {
    if (endpointType === 'external') {
      return // 外部引用无需项目权限
    }

    if (!projectId) {
      throw new PermissionDeniedException('provider 端点项目不存在')
    }

    const canView = await this.projects.view(user, organizationId, projectId)
    if (!canView) {
      throw new PermissionDeniedException('无权查看 provider 端点')
    }
  }

  // -----------------------------------------------------------------------
  // 下钻二次授权
  // -----------------------------------------------------------------------

  /** 下钻操作需二次授权 */
  async authorizeDrillDown(
    user: User,
    organizationId: number,
    refType: string,
    targetId: number,
  ): Promise<boolean> {
    await this.requireOrganizationMember(user, organizationId)

    switch (refType) {
      case 'dependency':
        return true // 依赖详情：已验证组织成员资格
      case 'project':
        return this.projects.view(user, organizationId, targetId)
      case 'task': {
        // 需要获取 task 的 projectId 后再检查
        try {
          const task = await this.getTask(organizationId, null, targetId)
          if (task) {
            const pid = (task as any).projectId
            return this.projects.view(user, organizationId, Number(pid))
          }
        } catch {
          return false
        }
        return false
      }
      case 'milestone': {
        try {
          const milestone = await this.getMilestone(organizationId, null, targetId)
          if (milestone) {
            const pid = (milestone as any).projectId
            return this.projects.view(user, organizationId, Number(pid))
          }
        } catch {
          return false
        }
        return false
      }
      case 'evidence':
        return true // 证据已脱敏
      default:
        return false
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private async getProject(organizationId: number, projectId: number): Promise<any> {
    const { default: Project } = await import('#models/project')
    return Project.query().where('id', projectId).where('organization_id', organizationId).first()
  }

  private async getTask(
    _organizationId: number,
    projectId: number | null,
    taskId: number,
  ): Promise<any> {
    const { default: Task } = await import('#models/task')
    const query = Task.query().where('id', taskId).whereNull('deleted_at')
    if (projectId) query.where('project_id', projectId)
    return query.first()
  }

  private async getMilestone(
    _organizationId: number,
    projectId: number | null,
    milestoneId: number,
  ): Promise<any> {
    const { default: Milestone } = await import('#models/milestone')
    const query = Milestone.query().where('id', milestoneId)
    if (projectId) query.where('project_id', projectId)
    return query.first()
  }
}
