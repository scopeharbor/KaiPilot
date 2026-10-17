import {
  ConflictException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import Organization from '#models/organization'
import User from '#models/user'
import AuditService, { AuditEvent } from '#services/audit_service'
import AuthService from '#services/auth_service'
import type { AuthContext } from '#types/auth'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'

interface ListUsersInput {
  page?: number
  perPage?: number
  search?: string
  is_active?: boolean
  auth_provider?: string
}

interface CreateUserInput {
  fullName?: string | null
  email: string
  password: string
  isActive?: boolean
}

interface UpdateUserInput {
  fullName?: string | null
  email?: string
  password?: string
  isActive?: boolean
  allowSelfAiConfig?: boolean
}

@inject()
export default class UserService {
  constructor(
    private authService: AuthService,
    private audit: AuditService,
  ) {}

  async list(input: ListUsersInput) {
    const page = input.page ?? 1
    const perPage = input.perPage ?? 20
    const query = User.withOrganizations()

    if (input.search) {
      const search = `%${input.search.toLowerCase()}%`
      query.where((builder) => {
        builder
          .whereRaw('LOWER(email) LIKE ?', [search])
          .orWhereRaw('LOWER(full_name) LIKE ?', [search])
      })
    }
    if (input.is_active !== undefined) {
      query.where('is_active', input.is_active)
    }
    if (input.auth_provider !== undefined) {
      query.where('auth_provider', input.auth_provider)
    }

    return query.orderBy('created_at', 'desc').paginate(page, perPage)
  }

  async getById(id: number): Promise<User> {
    const user = await User.withOrganizations().where('id', id).first()
    if (!user) throw new ResourceNotFoundException('用户不存在')
    return user
  }

  async create(input: CreateUserInput, actorUserId: number, ctx: AuthContext = {}): Promise<User> {
    if (await User.findBy('email', input.email)) {
      throw new ValidationException('邮箱已被使用')
    }

    const user = await User.create({
      fullName: input.fullName ?? null,
      email: input.email,
      password: input.password,
      authProvider: 'local',
      isActive: input.isActive ?? true,
      isSuperAdmin: false,
      roleVersion: 0,
    })
    await user.load('organizationMembers', (query) => query.preload('organization'))

    await this.audit.log({
      event: AuditEvent.USER_CREATED,
      userId: actorUserId,
      entityType: 'user',
      entityId: user.id,
      requestId: ctx.requestId ?? null,
    })
    return user
  }

  async update(
    id: number,
    input: UpdateUserInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<User> {
    const user = await this.getById(id)

    if (input.email && input.email !== user.email) {
      const duplicate = await User.query().where('email', input.email).whereNot('id', id).first()
      if (duplicate) throw new ValidationException('邮箱已被使用')
      user.email = input.email
    }
    if (input.fullName !== undefined) user.fullName = input.fullName
    if (input.password !== undefined) user.password = input.password

    const activityChanged = input.isActive !== undefined && input.isActive !== user.isActive
    const wasActive = user.isActive
    if (input.isActive !== undefined) user.isActive = input.isActive
    // 个人版「自行配置 AI 连接」开关：改变 ai:connection:manage 的签发结果，须让旧令牌失效。
    const aiSelfConfigChanged =
      input.allowSelfAiConfig !== undefined &&
      input.allowSelfAiConfig !== Boolean(user.allowSelfAiConfig)
    if (input.allowSelfAiConfig !== undefined) user.allowSelfAiConfig = input.allowSelfAiConfig
    await user.save()

    if (activityChanged || aiSelfConfigChanged) {
      await this.authService.bumpRoleVersion(user.id, ctx)
      await user.refresh()
    }

    await this.audit.log({
      event: activityChanged
        ? wasActive
          ? AuditEvent.USER_DISABLED
          : AuditEvent.USER_ENABLED
        : AuditEvent.USER_UPDATED,
      userId: actorUserId,
      entityType: 'user',
      entityId: user.id,
      requestId: ctx.requestId ?? null,
      metadata: aiSelfConfigChanged ? { allowSelfAiConfig: user.allowSelfAiConfig } : undefined,
    })

    await user.load('organizationMembers', (query) => query.preload('organization'))
    return user
  }

  async softDelete(id: number, actorUserId: number, ctx: AuthContext = {}): Promise<void> {
    const user = await this.getById(id)
    const ownedOrganization = await Organization.query().where('owner_id', user.id).first()
    if (ownedOrganization) {
      throw new ConflictException('该用户仍拥有组织，请先转交组织所有权')
    }

    user.isActive = false
    user.roleVersion += 1
    user.deletedAt = DateTime.now()
    await user.save()

    await this.audit.log({
      event: AuditEvent.USER_DELETED,
      userId: actorUserId,
      entityType: 'user',
      entityId: user.id,
      requestId: ctx.requestId ?? null,
    })
  }
}
