/**
 * v2-5-code-repository-auto-linking —— 链接候选 Controller。
 *
 * 职责：
 * - 候选列表（GET /api/v1/projects/:projectId/tasks/:taskId/link-candidates）
 * - 确认候选（POST /api/v1/projects/:projectId/tasks/:taskId/link-candidates/:candidateId/confirm）
 * - 忽略候选（POST /api/v1/projects/:projectId/tasks/:taskId/link-candidates/:candidateId/ignore）
 *
 * 设计 D1: Controller 只解析 HTTP，无业务逻辑。
 * 确认事务复用 TaskExternalLinkService.create 创建正式外链后标记候选已确认。
 */

import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import User from '#models/user'
import Task from '#models/task'
import LinkCandidateService from '#services/candidates/candidate_service'
import LinkCandidatePolicy from '#policies/link_candidate_policy'
import TaskExternalLinkService from '#services/task_external_link_service'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import { LinkValidationError, LinkDuplicateError } from '#services/task_external_link_service'

@inject()
export default class LinkCandidatesController {
  constructor(
    private candidateService: LinkCandidateService,
    private policy: LinkCandidatePolicy,
    private linkService: TaskExternalLinkService,
  ) {}

  // ---------------------------------------------------------------------------
  // 辅助方法
  // ---------------------------------------------------------------------------

  private orgIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  private projectIdFrom(ctx: HttpContext): number {
    return Number(ctx.params.projectId)
  }

  private taskIdFrom(ctx: HttpContext): number {
    return Number(ctx.params.taskId)
  }

  private candidateIdFrom(ctx: HttpContext): number {
    return Number(ctx.params.candidateId)
  }

  private async guardTaskAccess(ctx: HttpContext) {
    const projectId = this.projectIdFrom(ctx)
    const taskId = this.taskIdFrom(ctx)

    // 验证任务存在于该项目且组织下
    const task = await Task.query().where('id', taskId).where('project_id', projectId).first()
    if (!task) {
      throw new ResourceNotFoundException('任务未找到')
    }
  }

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  /**
   * GET /api/v1/projects/:projectId/tasks/:taskId/link-candidates
   *
   * 列出指定任务的候选链接列表（分页）。
   * 需要 task:view 权限。
   */
  async index(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const taskId = this.taskIdFrom(ctx)

    // 权限校验
    if (!(await this.policy.canView(user, orgId, projectId))) {
      throw new PermissionDeniedException('无权查看候选链接')
    }

    await this.guardTaskAccess(ctx)

    const page = Number(ctx.request.input('page', 1))
    const perPage = Number(ctx.request.input('perPage', 20))
    const status = ctx.request.input('status')

    const result = await this.candidateService.listByTaskPaginated(orgId, taskId, {
      status,
      page,
      perPage,
    })

    return ctx.response.ok({
      data: result.data.map((c) => this.candidateService.toDto(c)),
      meta: {
        total: result.total,
        page: result.page,
        perPage: result.perPage,
        totalPages: Math.ceil(result.total / result.perPage),
      },
    })
  }

  /**
   * POST /api/v1/projects/:projectId/tasks/:taskId/link-candidates/:candidateId/confirm
   *
   * 确认候选：创建正式外链并标记候选已确认。
   * 需要 task:update 权限。
   */
  async confirm(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const taskId = this.taskIdFrom(ctx)
    const candidateId = this.candidateIdFrom(ctx)

    // 权限校验
    if (!(await this.policy.canMutate(user, orgId, projectId))) {
      throw new PermissionDeniedException('无权确认候选链接')
    }

    await this.guardTaskAccess(ctx)

    // 获取候选
    const candidate = await this.candidateService.getById(candidateId, orgId)
    if (!candidate) {
      throw new ResourceNotFoundException('候选未找到')
    }

    // 检查候选状态
    if (candidate.status !== 'pending') {
      return ctx.response.conflict({
        error: {
          code: 'CANDIDATE_NOT_PENDING',
          message: `候选状态为 ${candidate.status}，无法确认`,
        },
      })
    }

    // 检查候选是否过期
    if (candidate.isExpired) {
      try {
        await this.candidateService.markExpired(candidate)
      } catch {
        /* ignore */
      }
      return ctx.response.conflict({
        error: {
          code: 'CANDIDATE_EXPIRED',
          message: '候选已过期，请重新生成',
        },
      })
    }

    // 构建 locator URL 并调用既有外链服务
    const externalUrl = `https://github.com/${candidate.repositoryFullName}/${candidate.objectType === 'pull_request' ? 'pull' : 'issues'}/${candidate.objectId}`
    const linkType = candidate.objectType === 'pull_request' ? 'pull_request' : 'issue'

    try {
      const link = await this.linkService.create(
        projectId,
        taskId,
        {
          provider: 'github',
          linkType: linkType as 'issue' | 'pull_request',
          repositoryOwner: candidate.repositoryFullName.split('/')[0] || '',
          repositoryName: candidate.repositoryFullName.split('/')[1] || '',
          externalNumber: Number(candidate.objectId) || 0,
          externalTitle: candidate.taskTitle ?? undefined,
          externalStatus: 'open',
          externalUrl,
        },
        { userId: Number(user.id), organizationId: orgId },
      )

      // 标记候选已确认
      await this.candidateService.confirm(candidate.id, orgId, Number(user.id))

      return ctx.response.created({
        data: {
          id: candidate.id,
          status: 'confirmed',
          externalLinkId: link.id,
          message: '候选已确认并创建外链',
        },
      })
    } catch (error) {
      if (error instanceof LinkDuplicateError) {
        // 外链已存在，标记候选为 rejected（不创建重复）
        await this.candidateService.reject(candidate.id, orgId, Number(user.id)).catch(() => {})
        return ctx.response.conflict({
          error: { code: 'DUPLICATE_LINK', message: '该任务已存在相同外链' },
        })
      }
      if (error instanceof LinkValidationError) {
        await this.candidateService.reject(candidate.id, orgId, Number(user.id)).catch(() => {})
        return ctx.response.unprocessableEntity({
          error: { code: 'INVALID_LINK', message: error.message },
        })
      }
      throw error
    }
  }

  /**
   * POST /api/v1/projects/:projectId/tasks/:taskId/link-candidates/:candidateId/ignore
   *
   * 忽略候选：标记候选已忽略，不创建外链。
   * 需要 task:update 权限。
   */
  async ignore(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const candidateId = this.candidateIdFrom(ctx)

    // 权限校验
    if (!(await this.policy.canMutate(user, orgId, projectId))) {
      throw new PermissionDeniedException('无权忽略候选链接')
    }

    await this.guardTaskAccess(ctx)

    // 获取候选
    const candidate = await this.candidateService.getById(candidateId, orgId)
    if (!candidate) {
      throw new ResourceNotFoundException('候选未找到')
    }

    // 忽略候选
    try {
      await this.candidateService.ignore(candidate.id, orgId, Number(user.id))
    } catch {
      return ctx.response.conflict({
        error: { code: 'CANDIDATE_ALREADY_SETTLED', message: '候选已被确认或忽略' },
      })
    }

    return ctx.response.ok({
      data: {
        id: candidate.id,
        status: 'ignored',
        message: '候选已忽略',
      },
    })
  }
}
