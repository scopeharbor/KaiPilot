import {
  AlreadyMemberException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import User from '#models/user'
import AuditService, { AuditEvent } from '#services/audit_service'
import TenantScope from '#services/tenant_scope'
import type { AuthContext } from '#types/auth'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'

export interface AddProjectMemberInput {
  userId: number
  projectRoleId: number
}

export interface ChangeRoleInput {
  projectRoleId: number
}

export interface TransferOwnerInput {
  userId: number
}

export interface InviteProjectMemberInput {
  email: string
  projectRoleId: number
}

@inject()
export default class ProjectMemberService {
  constructor(private audit: AuditService) {}

  /**
   * 列出项目成员（含 user/role，去除 password）。
   */
  async list(organizationId: number, projectId: number): Promise<ProjectMember[]> {
    await this.projectOrFail(organizationId, projectId)
    const members = await ProjectMember.query()
      .where('project_id', projectId)
      .where('is_active', true)
      .preload('user')
      .preload('projectRole')
      .orderBy('created_at', 'asc')
    await this.attachWorkload(projectId, members)
    return members
  }

  /**
   * 附上每位成员在本项目的负载与主要岗位（$extras）：未完成 / 进行中任务数，
   * 以及其任务中最常见的 AI 建议岗位——指派下拉据此显示「王浩然 · 后端开发 · 5 项未完成」。
   */
  private async attachWorkload(projectId: number, members: ProjectMember[]): Promise<void> {
    if (!members.length) return
    const hintExpr =
      db.connection().dialect.name === 'postgres'
        ? "(ai_metadata::jsonb ->> 'assigneeHint')"
        : "json_extract(ai_metadata, '$.assigneeHint')"
    const rows = (await db
      .from('tasks')
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .whereNotNull('assignee_id')
      .select('assignee_id', 'status', db.raw(`${hintExpr} as hint`))) as Array<{
      assignee_id: number | string
      status: string
      hint: string | null
    }>
    const stats = new Map<number, { open: number; active: number; hints: Map<string, number> }>()
    for (const row of rows) {
      const id = Number(row.assignee_id)
      const entry = stats.get(id) ?? { open: 0, active: 0, hints: new Map<string, number>() }
      if (row.status !== 'completed' && row.status !== 'cancelled') entry.open += 1
      if (row.status === 'in_progress') entry.active += 1
      const hint = String(row.hint ?? '')
        .split(/[、,，/]/)[0]
        ?.trim()
      if (hint) entry.hints.set(hint, (entry.hints.get(hint) ?? 0) + 1)
      stats.set(id, entry)
    }
    for (const member of members) {
      const entry = stats.get(Number(member.userId))
      const topHint = entry
        ? ([...entry.hints.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null)
        : null
      member.$extras.openTaskCount = entry?.open ?? 0
      member.$extras.inProgressTaskCount = entry?.active ?? 0
      member.$extras.primaryRoleHint = topHint
    }
  }

  /**
   * 列出项目角色。
   */
  async listRoles(organizationId: number, projectId: number): Promise<ProjectRole[]> {
    await this.projectOrFail(organizationId, projectId)
    return ProjectRole.query().where('project_id', projectId).orderBy('created_at', 'asc')
  }

  /**
   * 添加成员。
   */
  async add(
    organizationId: number,
    projectId: number,
    input: AddProjectMemberInput,
    actorUserId: number,
    ctx: AuthContext = {},
    auditMetadata: Record<string, unknown> = {},
  ): Promise<ProjectMember> {
    const project = await this.projectOrFail(organizationId, projectId)

    const user = await User.find(input.userId)
    if (!user || !user.isActive) {
      throw new ValidationException('用户不存在或已禁用')
    }

    const orgMember = await TenantScope.forOrganization(
      db.from('organization_members'),
      organizationId,
    )
      .where('user_id', input.userId)
      .first()
    const isOwner = project.createdBy === input.userId
    if (!orgMember && !isOwner) {
      throw new ValidationException('该用户不属于当前组织')
    }

    const duplicate = await ProjectMember.query()
      .where('project_id', projectId)
      .where('user_id', input.userId)
      .first()
    if (duplicate) {
      throw new AlreadyMemberException('该用户已是项目成员')
    }

    const role = await ProjectRole.query()
      .where('id', input.projectRoleId)
      .where('project_id', projectId)
      .first()
    if (!role) {
      throw new ValidationException('项目角色不存在')
    }

    const member = await ProjectMember.create({
      projectId,
      userId: input.userId,
      projectRoleId: role.id,
      isActive: true,
    })
    await member.load('user')
    await member.load('projectRole')

    await this.audit.log({
      event: AuditEvent.PROJECT_MEMBER_ADDED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'project_member',
      entityId: member.id,
      requestId: ctx.requestId ?? null,
      metadata: {
        addedUserId: input.userId,
        roleId: role.id,
        roleName: role.name,
        ...auditMetadata,
      },
    })

    return member
  }

  /**
   * 按邮箱邀请项目成员：解析邮箱为已注册、启用用户后委托 add，复用组织成员校验 /
   * 重复(2006) / 角色校验 / PROJECT_MEMBER_ADDED 审计；审计 metadata 追加
   * invitedByEmail 以标识邮箱入口。
   */
  async invite(
    organizationId: number,
    projectId: number,
    input: InviteProjectMemberInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<ProjectMember> {
    const user = await User.findBy('email', input.email)
    if (!user || !user.isActive) {
      throw new ValidationException('用户不存在或已禁用')
    }
    return this.add(
      organizationId,
      projectId,
      { userId: user.id, projectRoleId: input.projectRoleId },
      actorUserId,
      ctx,
      { invitedByEmail: true, email: input.email },
    )
  }

  /**
   * 变更成员角色。
   */
  async changeRole(
    organizationId: number,
    projectId: number,
    targetUserId: number,
    input: ChangeRoleInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<ProjectMember> {
    await this.projectOrFail(organizationId, projectId)

    const member = await ProjectMember.query()
      .where('project_id', projectId)
      .where('user_id', targetUserId)
      .where('is_active', true)
      .preload('projectRole')
      .first()
    if (!member) {
      throw new ResourceNotFoundException('项目成员不存在')
    }

    const oldRoleName = member.projectRole?.name ?? null
    if (member.projectRole?.name === 'Project Owner') {
      throw new ValidationException('不能直接变更 Project Owner 角色，请先转交所有权')
    }

    const role = await ProjectRole.query()
      .where('id', input.projectRoleId)
      .where('project_id', projectId)
      .first()
    if (!role) {
      throw new ValidationException('项目角色不存在')
    }

    member.projectRoleId = role.id
    await member.save()
    await member.load('projectRole')

    await this.audit.log({
      event: AuditEvent.PROJECT_MEMBER_ROLE_CHANGED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'project_member',
      entityId: member.id,
      requestId: ctx.requestId ?? null,
      changes: { before: { roleName: oldRoleName }, after: { roleName: role.name } },
      metadata: { targetUserId, newRoleId: role.id, newRoleName: role.name },
    })

    return member
  }

  /**
   * 移除成员。
   */
  async remove(
    organizationId: number,
    projectId: number,
    targetUserId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<void> {
    await this.projectOrFail(organizationId, projectId)

    const member = await ProjectMember.query()
      .where('project_id', projectId)
      .where('user_id', targetUserId)
      .where('is_active', true)
      .preload('projectRole')
      .first()
    if (!member) {
      throw new ResourceNotFoundException('项目成员不存在')
    }

    if (member.projectRole?.name === 'Project Owner') {
      throw new ValidationException('不能移除 Project Owner，请先转交所有权')
    }

    await member.delete()

    await this.audit.log({
      event: AuditEvent.PROJECT_MEMBER_REMOVED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'project_member',
      entityId: member.id,
      requestId: ctx.requestId ?? null,
      metadata: { removedUserId: targetUserId },
    })
  }

  /**
   * 转交项目所有权。
   */
  async transferOwner(
    organizationId: number,
    projectId: number,
    input: TransferOwnerInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<{ project: Project; previousOwnerId: number; newOwnerId: number }> {
    const project = await this.projectOrFail(organizationId, projectId)

    const targetMember = await ProjectMember.query()
      .where('project_id', projectId)
      .where('user_id', input.userId)
      .where('is_active', true)
      .preload('projectRole')
      .first()
    if (!targetMember) {
      throw new ValidationException('转交目标必须是当前项目成员')
    }

    const roles = await ProjectRole.query().where('project_id', projectId)
    const ownerRole = roles.find((r) => r.name === 'Project Owner')
    const managerRole = roles.find((r) => r.name === 'Project Manager')
    if (!ownerRole || !managerRole) {
      throw new ResourceNotFoundException('项目角色配置缺失')
    }

    const previousOwnerMembership = await ProjectMember.query()
      .where('project_id', projectId)
      .whereHas('projectRole', (query) => {
        query.where('name', 'Project Owner')
      })
      .preload('projectRole')
      .first()

    const previousOwnerId = previousOwnerMembership?.userId
      ? Number(previousOwnerMembership.userId)
      : Number(project.createdBy)

    await db.transaction(async (trx) => {
      targetMember.useTransaction(trx)
      if (previousOwnerMembership) {
        previousOwnerMembership.useTransaction(trx)
        previousOwnerMembership.projectRoleId = managerRole.id
        await previousOwnerMembership.save()
      }
      targetMember.projectRoleId = ownerRole.id
      await targetMember.save()
    })

    await targetMember.load('projectRole')

    await this.audit.log({
      event: AuditEvent.PROJECT_OWNER_TRANSFERRED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'project',
      entityId: projectId,
      requestId: ctx.requestId ?? null,
      metadata: { previousOwnerId, newOwnerId: input.userId },
    })

    return { project, previousOwnerId, newOwnerId: input.userId }
  }

  private async projectOrFail(organizationId: number, projectId: number): Promise<Project> {
    const project = await TenantScope.forOrganization(Project.query(), organizationId)
      .where('id', projectId)
      .first()
    if (!project) {
      throw new ResourceNotFoundException('项目不存在')
    }
    return project
  }
}
