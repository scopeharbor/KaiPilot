import UserService from '#services/user_service'
import User from '#models/user'
import { userDto } from '#types/dto'
import { createUserValidator, listUsersValidator, updateUserValidator } from '#validators/user'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class UsersController {
  constructor(private users: UserService) {}

  private auditContext({ request }: HttpContext) {
    return {
      requestId: request.id() ?? null,
      ip: request.ip(),
      userAgent: request.header('user-agent') ?? '',
    }
  }

  async index(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(listUsersValidator)
    const paginator = await this.users.list(input)
    const meta = paginator.getMeta()
    return ctx.response.ok({
      data: paginator.all().map(userDto),
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
      },
    })
  }

  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createUserValidator)
    const user = await this.users.create(
      input,
      (ctx.auth.getUserOrFail() as User).id,
      this.auditContext(ctx),
    )
    return ctx.response.created({ data: userDto(user) })
  }

  async show(ctx: HttpContext) {
    const user = await this.users.getById(Number(ctx.params.id))
    return ctx.response.ok({ data: userDto(user) })
  }

  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateUserValidator)
    const user = await this.users.update(
      Number(ctx.params.id),
      input,
      (ctx.auth.getUserOrFail() as User).id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: userDto(user) })
  }

  async destroy(ctx: HttpContext) {
    await this.users.softDelete(
      Number(ctx.params.id),
      (ctx.auth.getUserOrFail() as User).id,
      this.auditContext(ctx),
    )
    return ctx.response.noContent()
  }
}
