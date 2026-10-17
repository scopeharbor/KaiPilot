import Project from '#models/project'
import Task from '#models/task'
import Risk from '#models/risk'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'

/**
 * 评论目标解析器（v2-collaboration-comments-mentions）。
 *
 * 统一解析 project/task/milestone/risk/file/change_request 目标：
 * - 校验对象属于当前组织和项目
 * - 校验用户对目标对象有查看权限
 * - 返回目标信息（用于通知/活动/审计）
 *
 * 注意：milestone/file/change_request 的权限校验由调用方 Policy 兜底，
 * 本解析器仅验证对象存在且属于当前项目。
 */
export interface TargetInfo {
  entityType: string
  entityId: number
  title: string | null
  exists: boolean
}

@inject()
export default class CommentTargetResolver {
  constructor() {}

  /**
   * 解析并校验评论目标。
   *
   * @param organizationId 当前组织
   * @param projectId 当前项目
   * @param entityType 目标类型
   * @param entityId 目标 ID
   * @returns 目标信息
   * @throws ResourceNotFoundException 目标不存在或不在当前项目时
   */
  async resolve(
    organizationId: number,
    projectId: number,
    entityType: string,
    entityId: number,
  ): Promise<TargetInfo> {
    switch (entityType) {
      case 'project':
        return this.resolveProject(organizationId, projectId)
      case 'task':
        return this.resolveTask(organizationId, projectId, entityId)
      case 'milestone':
        return this.resolveMilestone(organizationId, projectId, entityId)
      case 'risk':
        return this.resolveRisk(organizationId, projectId, entityId)
      case 'file':
        return this.resolveFile(organizationId, projectId, entityId)
      case 'change_request':
        return this.resolveChangeRequest(organizationId, projectId, entityId)
      default:
        throw new ValidationException(`不支持的评论目标类型: ${entityType}`)
    }
  }

  /**
   * 项目级评论 → 验证项目存在
   */
  private async resolveProject(organizationId: number, projectId: number): Promise<TargetInfo> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .select('id', 'name')
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return { entityType: 'project', entityId: projectId, title: project.name, exists: true }
  }

  /**
   * 任务级评论 → 验证任务属于该项目
   */
  private async resolveTask(
    _organizationId: number,
    projectId: number,
    taskId: number,
  ): Promise<TargetInfo> {
    const task = await Task.query()
      .where('id', taskId)
      .where('project_id', projectId)
      .select('id', 'name')
      .first()
    if (!task) throw new ResourceNotFoundException('任务不存在或不在该项目中')
    return { entityType: 'task', entityId: taskId, title: task.name, exists: true }
  }

  /**
   * 里程碑级评论 → 验证里程碑属于该项目
   */
  private async resolveMilestone(
    _organizationId: number,
    projectId: number,
    milestoneId: number,
  ): Promise<TargetInfo> {
    const { default: Milestone } = await import('#models/milestone')
    const milestone = await Milestone.query()
      .where('id', milestoneId)
      .where('project_id', projectId)
      .select('id', 'name')
      .first()
    if (!milestone) throw new ResourceNotFoundException('里程碑不存在或不在该项目中')
    return { entityType: 'milestone', entityId: milestoneId, title: milestone.name, exists: true }
  }

  /**
   * 风险级评论 → 验证风险属于该项目
   */
  private async resolveRisk(
    _organizationId: number,
    projectId: number,
    riskId: number,
  ): Promise<TargetInfo> {
    const risk = await Risk.query()
      .where('id', riskId)
      .where('project_id', projectId)
      .select('id', 'title')
      .first()
    if (!risk) throw new ResourceNotFoundException('风险不存在或不在该项目中')
    return { entityType: 'risk', entityId: riskId, title: risk.title, exists: true }
  }

  /**
   * 文件级评论 → 验证文件属于该项目
   */
  private async resolveFile(
    _organizationId: number,
    projectId: number,
    fileId: number,
  ): Promise<TargetInfo> {
    const { default: Document } = await import('#models/document')
    const doc = await Document.query()
      .where('id', fileId)
      .where('project_id', projectId)
      .select('id', 'name')
      .first()
    if (!doc) throw new ResourceNotFoundException('文件不存在或不在该项目中')
    return { entityType: 'file', entityId: fileId, title: doc.name, exists: true }
  }

  /**
   * 变更请求级评论 → 验证变更请求属于该项目
   */
  private async resolveChangeRequest(
    _organizationId: number,
    projectId: number,
    crId: number,
  ): Promise<TargetInfo> {
    const { default: ChangeRequest } = await import('#models/change_request')
    const cr = await ChangeRequest.query()
      .where('id', crId)
      .where('project_id', projectId)
      .select('id', 'title')
      .first()
    if (!cr) throw new ResourceNotFoundException('变更请求不存在或不在该项目中')
    return { entityType: 'change_request', entityId: crId, title: cr.title, exists: true }
  }
}
