import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Organization from '#models/organization'
import OrganizationMember from '#models/organization_member'
import User from '#models/user'
import AuditService, { AuditEvent } from '#services/audit_service'
import type { AuthContext } from '#types/auth'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

interface OrganizationInput {
  name: string
  description?: string | null
  slug?: string
  ownerId: number
  settings?: unknown
}

interface OrganizationUpdateInput {
  name?: string
  description?: string | null
  slug?: string
  settings?: unknown
}

@inject()
export default class OrganizationService {
  constructor(private audit: AuditService) {}

  async listMine(user: User): Promise<Array<{ organization: Organization; role: string }>> {
    const memberships = await OrganizationMember.query()
      .where('user_id', user.id)
      .preload('organization')
      .orderBy('created_at', 'asc')

    return memberships
      .filter((membership) => Boolean(membership.organization))
      .map((membership) => ({
        organization: membership.organization,
        role: membership.role,
      }))
  }

  async get(id: number, user: User, currentOrganizationId?: number): Promise<Organization> {
    if (!user.isSuperAdmin && currentOrganizationId !== id) {
      throw new ResourceNotFoundException('组织不存在')
    }

    const organization = await Organization.find(id)
    if (!organization) throw new ResourceNotFoundException('组织不存在')

    if (!user.isSuperAdmin) {
      const membership = await OrganizationMember.query()
        .where('organization_id', id)
        .where('user_id', user.id)
        .first()
      if (!membership && Number(organization.ownerId) !== user.id) {
        throw new ResourceNotFoundException('组织不存在')
      }
    }
    return organization
  }

  async create(
    input: OrganizationInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Organization> {
    const owner = await User.find(input.ownerId)
    if (!owner || !owner.isActive) throw new ValidationException('指定的组织所有者不存在或已禁用')

    const organization = await db.transaction(async (trx) => {
      const slug = await this.generateUniqueSlug(input.name, input.slug, trx)
      const created = await Organization.create(
        {
          ownerId: owner.id,
          name: input.name,
          slug,
          description: input.description ?? null,
          planTier: 'free',
          settings: (input.settings as Record<string, unknown> | undefined) ?? null,
        },
        { client: trx },
      )
      await OrganizationMember.create(
        {
          organizationId: created.id,
          userId: owner.id,
          role: 'owner',
        },
        { client: trx },
      )
      return created
    })

    await this.audit.log({
      event: AuditEvent.ORG_CREATED,
      userId: actorUserId,
      organizationId: organization.id,
      entityType: 'organization',
      entityId: organization.id,
      requestId: ctx.requestId ?? null,
    })
    return organization
  }

  async update(
    id: number,
    input: OrganizationUpdateInput,
    actorUserId: number,
    currentOrganizationId: number | undefined,
    isSuperAdmin: boolean,
    ctx: AuthContext = {},
  ): Promise<Organization> {
    const actor = await User.findOrFail(actorUserId)
    const organization = await this.get(id, actor, isSuperAdmin ? id : currentOrganizationId)

    if (input.name !== undefined) organization.name = input.name
    if (input.description !== undefined) organization.description = input.description
    if (input.slug && input.slug !== organization.slug) {
      organization.slug = await this.generateUniqueSlug(input.name ?? organization.name, input.slug)
    }
    if (input.settings !== undefined) {
      // 与平台模型配置共用行锁；普通组织设置不得注入或覆盖平台路由。
      await db.transaction(async (trx) => {
        const current = await Organization.query({ client: trx })
          .where('id', id)
          .forUpdate()
          .firstOrFail()
        const reserved = current.settings?.platformAiRouting
        organization.useTransaction(trx)
        organization.settings = { ...(input.settings as Record<string, unknown>) }
        delete organization.settings.platformAiRouting
        if (reserved !== undefined) organization.settings.platformAiRouting = reserved
        await organization.save()
      })
    } else {
      await organization.save()
    }

    await this.audit.log({
      event: AuditEvent.ORG_UPDATED,
      userId: actorUserId,
      organizationId: organization.id,
      entityType: 'organization',
      entityId: organization.id,
      requestId: ctx.requestId ?? null,
    })
    return organization
  }

  async softDelete(id: number, actorUserId: number, ctx: AuthContext = {}): Promise<void> {
    const organization = await Organization.find(id)
    if (!organization) throw new ResourceNotFoundException('组织不存在')
    organization.deletedAt = DateTime.now()
    await organization.save()

    await this.audit.log({
      event: AuditEvent.ORG_DELETED,
      userId: actorUserId,
      organizationId: organization.id,
      entityType: 'organization',
      entityId: organization.id,
      requestId: ctx.requestId ?? null,
    })
  }

  async generateUniqueSlug(
    name: string,
    requestedSlug?: string,
    client: { from(table: string): any } = db,
  ): Promise<string> {
    const requested = requestedSlug?.trim().toLowerCase()
    const base =
      requested ||
      name
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') ||
      'organization'

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const suffix = attempt === 0 ? '' : `-${attempt + 1}`
      const candidate = `${base.slice(0, 120 - suffix.length)}${suffix}`
      const exists = await client.from('organizations').where('slug', candidate).first()
      if (!exists) return candidate
    }
    throw new ValidationException('无法生成唯一组织标识，请指定其他 slug')
  }
}
