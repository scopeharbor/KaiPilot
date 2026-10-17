import {
  AlreadyMemberException,
  ConflictException,
  PermissionDeniedException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import Organization from '#models/organization'
import OrganizationMember from '#models/organization_member'
import User from '#models/user'
import AuditService, { AuditEvent } from '#services/audit_service'
import AuthService from '#services/auth_service'
import TenantScope from '#services/tenant_scope'
import type { AuthContext } from '#types/auth'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'

type OrganizationRole = 'owner' | 'admin' | 'member' | 'viewer'

@inject()
export default class OrganizationMemberService {
  constructor(
    private authService: AuthService,
    private audit: AuditService,
  ) {}

  async list(organizationId: number): Promise<OrganizationMember[]> {
    await this.organizationOrFail(organizationId)
    return TenantScope.forOrganization(OrganizationMember.query(), organizationId)
      .preload('user')
      .orderBy('created_at', 'asc')
  }

  /** 创建只属于目标组织的本地账号，不创建额外个人组织，也不修改已有身份。 */
  async createAccount(
    organizationId: number,
    input: {
      fullName: string
      email: string
      password: string
      role: 'admin' | 'member' | 'viewer'
    },
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<OrganizationMember> {
    const actor = await User.findOrFail(actorUserId)
    const membership = await OrganizationMember.query()
      .where('organization_id', organizationId)
      .where('user_id', actorUserId)
      .first()
    if (!actor.isSuperAdmin && !['owner', 'admin'].includes(membership?.role ?? '')) {
      throw new PermissionDeniedException('仅本组织所有者或管理员可建立成员账号')
    }
    return db.transaction(async (trx) => {
      const org = await Organization.query({ client: trx })
        .where('id', organizationId)
        .forUpdate()
        .first()
      if (!org) throw new ResourceNotFoundException('组织不存在')
      if (await User.query({ client: trx }).where('email', input.email).first())
        throw new ValidationException('该邮箱已有账号，请使用邀请成员，不会覆盖已有账号或密码')
      const count = await OrganizationMember.query({ client: trx })
        .where('organization_id', organizationId)
        .count('* as total')
        .first()
      if (Number(org.maxMembers) > 0 && Number(count?.$extras.total ?? 0) >= Number(org.maxMembers))
        throw new ValidationException('组织成员已达人数上限')
      const user = await User.create(
        {
          fullName: input.fullName,
          email: input.email,
          password: input.password,
          authProvider: 'local',
          isActive: true,
          isSuperAdmin: false,
          allowSelfAiConfig: false,
          roleVersion: 0,
        },
        { client: trx },
      )
      const member = await OrganizationMember.create(
        { organizationId, userId: user.id, role: input.role, invitedBy: actorUserId },
        { client: trx },
      )
      for (const event of [AuditEvent.USER_CREATED, AuditEvent.MEMBER_INVITED]) {
        await this.audit.log({
          event,
          userId: actorUserId,
          organizationId,
          entityType: 'organization_member',
          entityId: member.id,
          requestId: ctx.requestId ?? null,
          metadata: { memberUserId: user.id, role: input.role, source: 'organization_account' },
          client: trx,
          strict: true,
        })
      }
      await member.load('user')
      return member
    })
  }

  async invite(
    organizationId: number,
    input: { email: string; role?: Exclude<OrganizationRole, 'owner'> },
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<OrganizationMember> {
    const organization = await this.organizationOrFail(organizationId)
    const user = await User.findBy('email', input.email)
    if (!user) throw new ValidationException('该邮箱尚未注册，请先邀请对方完成注册')

    // 人数上限（organizations.max_members）：此前只展示、从未校验
    const limit = Number(organization.maxMembers ?? 0)
    if (limit > 0) {
      const [{ $extras }] = await TenantScope.forOrganization(
        OrganizationMember.query(),
        organizationId,
      ).count('* as total')
      if (Number($extras.total ?? 0) >= limit) {
        throw new ValidationException(
          `组织成员已达上限 ${limit} 人，请联系组织所有者提高上限后再邀请`,
          { details: { maxMembers: limit } },
        )
      }
    }

    const duplicate = await TenantScope.forOrganization(OrganizationMember.query(), organizationId)
      .where('user_id', user.id)
      .first()
    if (duplicate) throw new AlreadyMemberException('该用户已是组织成员')

    const member = await OrganizationMember.create({
      organizationId,
      userId: user.id,
      role: input.role ?? 'member',
      invitedBy: actorUserId,
    })
    await member.load('user')
    await this.authService.bumpRoleVersion(user.id, ctx)

    await this.audit.log({
      event: AuditEvent.MEMBER_INVITED,
      userId: actorUserId,
      organizationId,
      entityType: 'organization_member',
      entityId: member.id,
      requestId: ctx.requestId ?? null,
      metadata: { memberUserId: user.id, role: member.role },
    })
    return member
  }

  async updateRole(
    organizationId: number,
    memberId: number,
    role: OrganizationRole,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<OrganizationMember> {
    const organization = await this.organizationOrFail(organizationId)
    const member = await this.memberOrFail(organizationId, memberId)
    const oldRole = member.role

    if (member.role === 'owner' && role !== 'owner') {
      throw new ConflictException('请先将组织所有权转交给另一成员，再调整原 owner 角色')
    }

    const affectedUserIds = new Set<number>([Number(member.userId)])
    if (role === 'owner' && Number(organization.ownerId) !== Number(member.userId)) {
      await db.transaction(async (trx) => {
        organization.useTransaction(trx)
        member.useTransaction(trx)

        const oldOwner = await OrganizationMember.query({ client: trx })
          .where('organization_id', organizationId)
          .where('user_id', Number(organization.ownerId))
          .first()
        if (oldOwner) {
          oldOwner.role = 'admin'
          await oldOwner.save()
          affectedUserIds.add(Number(oldOwner.userId))
        }

        member.role = 'owner'
        organization.ownerId = member.userId
        await member.save()
        await organization.save()
      })
    } else {
      member.role = role
      await member.save()
    }

    for (const userId of affectedUserIds) {
      await this.authService.bumpRoleVersion(userId, ctx)
    }
    await member.load('user')

    await this.audit.log({
      event: AuditEvent.ROLE_CHANGED,
      userId: actorUserId,
      organizationId,
      entityType: 'organization_member',
      entityId: member.id,
      requestId: ctx.requestId ?? null,
      changes: { before: { role: oldRole }, after: { role: member.role } },
      metadata: { memberUserId: Number(member.userId), role },
    })
    return member
  }

  /**
   * 转交组织所有权（显式端点）：仅当前 owner 可发起；事务内原 owner 降 admin、
   * 目标升 owner、organization.owner_id 转移；双方 role_version 递增（旧 token
   * 即时失效）；记 ORG_OWNER_TRANSFERRED 专用审计。与 updateRole 的隐式转交并存
   * （显式端点为主入口）。
   */
  async transferOwner(
    organizationId: number,
    targetMemberId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<{ organization: Organization; previousOwnerId: number; newOwnerId: number }> {
    const organization = await this.organizationOrFail(organizationId)
    const member = await this.memberOrFail(organizationId, targetMemberId)

    if (Number(actorUserId) !== Number(organization.ownerId)) {
      throw new PermissionDeniedException('仅组织所有者可转交所有权')
    }
    if (member.role === 'owner' || Number(organization.ownerId) === Number(member.userId)) {
      throw new ConflictException('目标已是组织所有者')
    }

    const previousOwnerId = Number(organization.ownerId)
    const newOwnerId = Number(member.userId)

    await db.transaction(async (trx) => {
      organization.useTransaction(trx)
      member.useTransaction(trx)

      const oldOwner = await OrganizationMember.query({ client: trx })
        .where('organization_id', organizationId)
        .where('user_id', previousOwnerId)
        .first()
      if (oldOwner) {
        oldOwner.role = 'admin'
        await oldOwner.save()
      }

      member.role = 'owner'
      organization.ownerId = newOwnerId
      await member.save()
      await organization.save()
    })

    await this.authService.bumpRoleVersion(previousOwnerId, ctx)
    await this.authService.bumpRoleVersion(newOwnerId, ctx)
    await member.load('user')

    await this.audit.log({
      event: AuditEvent.ORG_OWNER_TRANSFERRED,
      userId: actorUserId,
      organizationId,
      entityType: 'organization',
      entityId: organization.id,
      requestId: ctx.requestId ?? null,
      metadata: { previousOwnerId, newOwnerId },
    })

    return { organization, previousOwnerId, newOwnerId }
  }

  async remove(
    organizationId: number,
    memberId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<void> {
    const organization = await this.organizationOrFail(organizationId)
    const member = await this.memberOrFail(organizationId, memberId)
    if (member.role === 'owner' || Number(organization.ownerId) === Number(member.userId)) {
      throw new ConflictException('不能移除组织 owner，请先转交组织所有权')
    }

    const memberUserId = Number(member.userId)
    await member.delete()
    await this.authService.bumpRoleVersion(memberUserId, ctx)
    await this.audit.log({
      event: AuditEvent.MEMBER_REMOVED,
      userId: actorUserId,
      organizationId,
      entityType: 'organization_member',
      entityId: member.id,
      requestId: ctx.requestId ?? null,
      metadata: { memberUserId },
    })
  }

  private async organizationOrFail(id: number): Promise<Organization> {
    const organization = await Organization.find(id)
    if (!organization) throw new ResourceNotFoundException('组织不存在')
    return organization
  }

  private async memberOrFail(organizationId: number, memberId: number) {
    const member = await TenantScope.forOrganization(OrganizationMember.query(), organizationId)
      .where('id', memberId)
      .first()
    if (!member) throw new ResourceNotFoundException('组织成员不存在')
    return member
  }
}
