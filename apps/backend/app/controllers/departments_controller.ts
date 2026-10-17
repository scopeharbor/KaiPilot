import type User from '#models/user'
import DepartmentPolicy from '#policies/department_policy'
import DepartmentService from '#services/department_service'
import { createDepartmentValidator, updateDepartmentValidator } from '#validators/department'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * 部门树（OBS）控制器（v3-chart-gallery-data-foundation，design D5）。
 *
 * 组织级端点（无 project scope）：租户部门树 CRUD。
 * - path/depth 物化路径维护、循环挂载校验、code 唯一性由 DepartmentService 保证；
 * - 跨组织 department id 由服务层 departmentOrFail 返回 404（RL-05）。
 */
@inject()
export default class DepartmentsController {
  constructor(
    private departments: DepartmentService,
    private policy: DepartmentPolicy,
  ) {}

  private user(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgId(ctx: HttpContext): number {
    return ctx.tenant!.organizationId
  }

  /** GET /departments —— 租户完整部门树。 */
  async index(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    await this.policy.authorizeView(this.user(ctx), organizationId)

    const tree = await this.departments.listTree(organizationId)
    return ctx.response.ok({ data: tree })
  }

  /** POST /departments —— 新建部门节点（自动维护 path/depth）。 */
  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createDepartmentValidator)
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    await this.policy.authorizeManage(actor, organizationId)

    const department = await this.departments.create(organizationId, input, actor.id)
    return ctx.response.created({ data: department.serialize() })
  }

  /** GET /departments/:id —— 部门详情。 */
  async show(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const departmentId = Number(ctx.params.id)
    await this.policy.authorizeView(this.user(ctx), organizationId)

    const department = await this.departments.get(organizationId, departmentId)
    return ctx.response.ok({ data: department.serialize() })
  }

  /** PATCH /departments/:id —— 更新部门/调整层级（父部门必须同组织且无循环）。 */
  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateDepartmentValidator)
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const departmentId = Number(ctx.params.id)
    await this.policy.authorizeManage(actor, organizationId)

    const department = await this.departments.update(organizationId, departmentId, input, actor.id)
    return ctx.response.ok({ data: department.serialize() })
  }

  /** DELETE /departments/:id —— 删除部门（存在子部门/关联项目/成员时 422）。 */
  async destroy(ctx: HttpContext) {
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const departmentId = Number(ctx.params.id)
    await this.policy.authorizeManage(actor, organizationId)

    await this.departments.softDelete(organizationId, departmentId, actor.id)
    return ctx.response.noContent()
  }
}
