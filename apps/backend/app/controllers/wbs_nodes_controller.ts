import { ValidationException } from '#exceptions/api_exception'
import type User from '#models/user'
import type WbsNode from '#models/wbs_node'
import WbsNodePolicy from '#policies/wbs_node_policy'
import WbsTreeService, { type WbsRollup } from '#services/wbs_tree_service'
import {
  createWbsNodeValidator,
  listWbsTreeValidator,
  moveWbsNodeValidator,
  updateWbsNodeValidator,
} from '#validators/wbs_node'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

function wbsNodeDto(node: WbsNode, rollup?: WbsRollup) {
  return {
    id: node.id,
    projectId: Number(node.projectId),
    parentId: node.parentId === null ? null : Number(node.parentId),
    path: node.path,
    code: node.code,
    name: node.name,
    depth: node.depth,
    isLeaf: node.isLeaf,
    collapsed: node.collapsed,
    displayOrder: node.displayOrder,
    taskId: node.taskId === null ? null : Number(node.taskId),
    ...(node.$preloaded.task
      ? {
          task: {
            id: node.task.id,
            name: node.task.name,
            status: node.task.status,
            startDate: node.task.startDate?.toISODate() ?? null,
            endDate: node.task.endDate?.toISODate() ?? null,
          },
        }
      : {}),
    ...(rollup ? { rollup } : {}),
    createdAt: node.createdAt.toISO(),
    updatedAt: node.updatedAt?.toISO() ?? null,
  }
}

@inject()
export default class WbsNodesController {
  constructor(
    private wbs: WbsTreeService,
    private policy: WbsNodePolicy,
  ) {}

  private user(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private auditContext(ctx: HttpContext) {
    return {
      requestId: ctx.request.id() ?? null,
      ip: ctx.request.ip(),
      userAgent: ctx.request.header('user-agent') ?? '',
    }
  }

  async index(ctx: HttpContext) {
    const projectId = Number(ctx.params.projectId)
    const query = await ctx.request.validateUsing(listWbsTreeValidator, {
      data: ctx.request.qs(),
    })
    await this.policy.authorizeView(this.user(ctx), ctx.tenant!.organizationId, projectId)
    const nodes = await this.wbs.getTree(
      ctx.tenant!.organizationId,
      projectId,
      query.include === 'task',
    )
    const rollups = query.include === 'task' ? await this.wbs.rollups(projectId, nodes) : new Map()
    return ctx.response.ok({
      data: nodes.map((node) => wbsNodeDto(node, rollups.get(Number(node.id)))),
    })
  }

  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createWbsNodeValidator)
    const projectId = Number(ctx.params.projectId)
    const user = this.user(ctx)
    await this.policy.authorizeCreate(user, ctx.tenant!.organizationId, projectId)
    const node = await this.wbs.createNode(
      ctx.tenant!.organizationId,
      projectId,
      input,
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.created({ data: wbsNodeDto(node) })
  }

  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateWbsNodeValidator)
    if (input.name === undefined && input.collapsed === undefined) {
      throw new ValidationException('至少提交一个可更新字段')
    }
    const projectId = Number(ctx.params.projectId)
    const user = this.user(ctx)
    if (input.name !== undefined) {
      await this.policy.authorizeUpdate(user, ctx.tenant!.organizationId, projectId)
    } else {
      await this.policy.authorizeView(user, ctx.tenant!.organizationId, projectId)
    }
    const node = await this.wbs.updateNode(
      ctx.tenant!.organizationId,
      projectId,
      Number(ctx.params.id),
      input,
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: wbsNodeDto(node) })
  }

  async move(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(moveWbsNodeValidator)
    const projectId = Number(ctx.params.projectId)
    const user = this.user(ctx)
    await this.policy.authorizeMove(user, ctx.tenant!.organizationId, projectId)
    const node = await this.wbs.moveNode(
      ctx.tenant!.organizationId,
      projectId,
      Number(ctx.params.id),
      input,
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: wbsNodeDto(node) })
  }

  async destroy(ctx: HttpContext) {
    const projectId = Number(ctx.params.projectId)
    const user = this.user(ctx)
    await this.policy.authorizeDelete(user, ctx.tenant!.organizationId, projectId)
    await this.wbs.deleteNode(
      ctx.tenant!.organizationId,
      projectId,
      Number(ctx.params.id),
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.noContent()
  }
}
