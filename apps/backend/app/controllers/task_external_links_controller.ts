import TaskExternalLinkService from '#services/task_external_link_service'
import TaskExternalLinkPolicy from '#policies/task_external_link_policy'
import TaskPolicy from '#policies/task_policy'
import User from '#models/user'
import Task from '#models/task'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import {
  createExternalLinkValidator,
  updateExternalLinkValidator,
} from '#validators/task_external_link'
import {
  LinkNotFoundError,
  LinkValidationError,
  LinkDuplicateError,
} from '#services/task_external_link_service'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class TaskExternalLinksController {
  constructor(
    private service: TaskExternalLinkService,
    private policy: TaskExternalLinkPolicy,
    private taskPolicy: TaskPolicy,
  ) {}

  private orgIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  private async actor(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    return { userId: Number(user.id), organizationId: this.orgIdOf(ctx) }
  }

  private projectIdFrom(ctx: HttpContext): number {
    return Number(ctx.params.projectId)
  }

  private taskIdFrom(ctx: HttpContext): number {
    return Number(ctx.params.taskId)
  }

  private linkIdFrom(ctx: HttpContext): number {
    return Number(ctx.params.linkId)
  }

  /**
   * 通用权限守卫：读取需 task:view，写入需 task:update。
   */
  private async guardRead(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    if (!(await this.policy.canView(user, orgId, projectId))) {
      throw new PermissionDeniedException('无权查看任务外部链接')
    }
  }

  private async guardMutate(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    if (!(await this.policy.canMutate(user, orgId, projectId))) {
      throw new PermissionDeniedException('无权修改任务外部链接')
    }
  }

  /**
   * 验证任务存在性（任务级权限复用 taskPolicy）。
   */
  private async guardTaskAccess(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const taskId = this.taskIdFrom(ctx)
    const allowed = await this.taskPolicy.view(user, orgId, projectId)
    if (!allowed) {
      throw new ResourceNotFoundException('任务未找到')
    }
    const task = await Task.query().where('id', taskId).where('project_id', projectId).first()
    if (!task) {
      throw new ResourceNotFoundException('任务未找到')
    }
  }

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  /**
   * GET /api/v1/projects/:projectId/tasks/:taskId/external-links
   */
  async index(ctx: HttpContext) {
    await this.guardRead(ctx)
    await this.guardTaskAccess(ctx)
    const actor = await this.actor(ctx)
    const links = await this.service.listByTask(
      this.projectIdFrom(ctx),
      this.taskIdFrom(ctx),
      actor,
    )
    return ctx.response.ok({ data: links.map(this.toDto) })
  }

  /**
   * POST /api/v1/projects/:projectId/tasks/:taskId/external-links
   */
  async create(ctx: HttpContext) {
    await this.guardMutate(ctx)
    await this.guardTaskAccess(ctx)
    const actor = await this.actor(ctx)
    const input = await ctx.request.validateUsing(createExternalLinkValidator)
    try {
      const link = await this.service.create(
        this.projectIdFrom(ctx),
        this.taskIdFrom(ctx),
        input,
        actor,
      )
      return ctx.response.created({ data: this.toDto(link) })
    } catch (error) {
      if (error instanceof LinkValidationError) {
        return ctx.response.unprocessableEntity({
          error: { code: 'VALIDATION_ERROR', message: error.message },
        })
      }
      if (error instanceof LinkDuplicateError) {
        return ctx.response.conflict({
          error: { code: 'DUPLICATE_ERROR', message: error.message },
        })
      }
      throw error
    }
  }

  /**
   * PUT /api/v1/projects/:projectId/tasks/:taskId/external-links/:linkId
   */
  async update(ctx: HttpContext) {
    await this.guardMutate(ctx)
    await this.guardTaskAccess(ctx)
    const actor = await this.actor(ctx)
    const input = (await ctx.request.validateUsing(updateExternalLinkValidator)) ?? {}
    try {
      const link = await this.service.update(
        this.linkIdFrom(ctx),
        this.projectIdFrom(ctx),
        this.taskIdFrom(ctx),
        input as any,
        actor,
      )
      return ctx.response.ok({ data: this.toDto(link) })
    } catch (error) {
      if (error instanceof LinkNotFoundError) {
        throw new ResourceNotFoundException('外部链接未找到')
      }
      throw error
    }
  }

  /**
   * DELETE /api/v1/projects/:projectId/tasks/:taskId/external-links/:linkId
   */
  async destroy(ctx: HttpContext) {
    await this.guardMutate(ctx)
    await this.guardTaskAccess(ctx)
    const actor = await this.actor(ctx)
    try {
      await this.service.delete(
        this.linkIdFrom(ctx),
        this.projectIdFrom(ctx),
        this.taskIdFrom(ctx),
        actor,
      )
      return ctx.response.noContent()
    } catch (error) {
      if (error instanceof LinkNotFoundError) {
        throw new ResourceNotFoundException('外部链接未找到')
      }
      throw error
    }
  }

  /**
   * POST /api/v1/projects/:projectId/tasks/:taskId/external-links/:linkId/refresh
   */
  async refresh(ctx: HttpContext) {
    await this.guardMutate(ctx)
    await this.guardTaskAccess(ctx)
    const actor = await this.actor(ctx)
    try {
      const result = await this.service.refresh(
        this.linkIdFrom(ctx),
        this.projectIdFrom(ctx),
        this.taskIdFrom(ctx),
        actor,
      )
      return ctx.response.ok({ data: result })
    } catch (error) {
      if (error instanceof LinkNotFoundError) {
        throw new ResourceNotFoundException('外部链接未找到')
      }
      throw error
    }
  }

  // ---------------------------------------------------------------------------
  // DTO mapper
  // ---------------------------------------------------------------------------

  private toDto(link: any) {
    return {
      id: link.id,
      provider: link.provider,
      linkType: link.linkType,
      repositoryOwner: link.repositoryOwner,
      repositoryName: link.repositoryName,
      externalNumber: link.externalNumber,
      externalId: link.externalId,
      externalTitle: link.externalTitle,
      externalStatus: link.externalStatus,
      externalUrl: link.externalUrl,
      statusSource: link.statusSource,
      lastObservedAt: link.lastObservedAt?.toISO?.() ?? link.lastObservedAt ?? null,
      // 只读、低敏 CI/check 状态摘要（v2-5-code-repository-ci-status-display）；
      // 旧外链无 ciSummary 时读出 null，不影响既有字段。
      ciSummary:
        typeof link.getCiSummary === 'function' ? link.getCiSummary() : (link.ciSummary ?? null),
      note: link.note,
      createdAt: link.createdAt?.toISO?.() ?? link.createdAt,
      updatedAt: link.updatedAt?.toISO?.() ?? link.updatedAt,
      createdBy: link.createdBy,
      updatedBy: link.updatedBy,
    }
  }
}
