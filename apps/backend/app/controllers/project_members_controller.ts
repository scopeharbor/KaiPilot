import ProjectMemberService from '#services/project_member_service'
import RbacService from '#services/rbac_service'
import {
  addProjectMemberValidator,
  changeProjectMemberRoleValidator,
  inviteProjectMemberValidator,
  transferProjectOwnerValidator,
} from '#validators/project_member'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

@inject()
export default class ProjectMembersController {
  constructor(
    private members: ProjectMemberService,
    private rbac: RbacService,
  ) {}

  private auditContext({ request }: HttpContext) {
    return {
      requestId: request.id() ?? null,
      ip: request.ip(),
      userAgent: request.header('user-agent') ?? '',
    }
  }

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  async index(ctx: HttpContext) {
    const members = await this.members.list(ctx.tenant!.organizationId, Number(ctx.params.id))
    return ctx.response.ok({ data: members.map(projectMemberDto) })
  }

  /**
   * 当前用户在本项目内的有效权限（组织 ∩ 项目 + 项目角色下放）。前端项目页据此决定
   * 拖拽 / 编辑 / 指派等控件是否可用；组织级 JWT claims 不含项目角色，单独用会误禁项目经理。
   */
  async myPermissions(ctx: HttpContext) {
    const permissions = await this.rbac.resolveUserPermissions(
      this.currentUser(ctx),
      ctx.tenant!.organizationId,
      Number(ctx.params.id),
    )
    return ctx.response.ok({ data: { permissions } })
  }

  async roles(ctx: HttpContext) {
    const roles = await this.members.listRoles(ctx.tenant!.organizationId, Number(ctx.params.id))
    return ctx.response.ok({ data: roles.map(projectRoleDto) })
  }

  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(addProjectMemberValidator)
    const user = this.currentUser(ctx)
    const member = await this.members.add(
      ctx.tenant!.organizationId,
      Number(ctx.params.id),
      { userId: input.userId, projectRoleId: input.projectRoleId },
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.created({ data: projectMemberDto(member) })
  }

  async invite(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(inviteProjectMemberValidator)
    const user = this.currentUser(ctx)
    const member = await this.members.invite(
      ctx.tenant!.organizationId,
      Number(ctx.params.id),
      { email: input.email, projectRoleId: input.projectRoleId },
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.created({ data: projectMemberDto(member) })
  }

  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(changeProjectMemberRoleValidator)
    const user = this.currentUser(ctx)
    const member = await this.members.changeRole(
      ctx.tenant!.organizationId,
      Number(ctx.params.id),
      Number(ctx.params.userId),
      { projectRoleId: input.projectRoleId },
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: projectMemberDto(member) })
  }

  async destroy(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    await this.members.remove(
      ctx.tenant!.organizationId,
      Number(ctx.params.id),
      Number(ctx.params.userId),
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.noContent()
  }

  async transfer(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(transferProjectOwnerValidator)
    const user = this.currentUser(ctx)
    const result = await this.members.transferOwner(
      ctx.tenant!.organizationId,
      Number(ctx.params.id),
      { userId: input.userId },
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({
      data: {
        project: projectDto(result.project),
        previousOwnerId: result.previousOwnerId,
        newOwnerId: result.newOwnerId,
      },
    })
  }
}

function projectMemberDto(member: any) {
  return {
    id: member.id,
    projectId: Number(member.projectId),
    userId: Number(member.userId),
    projectRoleId: member.projectRoleId ? Number(member.projectRoleId) : null,
    isActive: member.isActive,
    user: member.user
      ? {
          id: member.user.id,
          fullName: member.user.fullName,
          email: member.user.email,
          initials: member.user.initials,
          isActive: member.user.isActive,
        }
      : undefined,
    projectRole: member.projectRole
      ? {
          id: member.projectRole.id,
          name: member.projectRole.name,
          description: member.projectRole.description,
          permissions: member.projectRole.permissions ?? [],
          isSystem: member.projectRole.isSystem,
        }
      : undefined,
    ...(member.$extras?.openTaskCount !== undefined
      ? {
          workload: {
            openTaskCount: Number(member.$extras.openTaskCount),
            inProgressTaskCount: Number(member.$extras.inProgressTaskCount ?? 0),
          },
          primaryRoleHint: member.$extras.primaryRoleHint ?? null,
        }
      : {}),
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  }
}

function projectRoleDto(role: any) {
  return {
    id: role.id,
    projectId: Number(role.projectId),
    name: role.name,
    description: role.description,
    permissions: role.permissions ?? [],
    isSystem: role.isSystem,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  }
}

function projectDto(project: any) {
  return {
    id: project.id,
    organizationId: Number(project.organizationId),
    name: project.name,
    code: project.code,
    description: project.description,
    category: project.category,
    status: project.status,
    priority: project.priority,
    startDate: project.startDate?.toISODate?.() ?? project.startDate ?? null,
    endDate: project.endDate?.toISODate?.() ?? project.endDate ?? null,
    budgetCents: project.budgetCents,
    currency: project.currency,
    progressPercent: project.progressPercent,
    healthStatus: project.healthStatus,
    settings: project.settings,
    createdBy: Number(project.createdBy),
    updatedBy: project.updatedBy ? Number(project.updatedBy) : null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}
