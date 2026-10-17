// @aiproj/backend — V3 TRIZ 矛盾矩阵审查 Controller
// v3-triz-contradiction-matrix-ui / design D2 §3.5 + D5 §4.2-4.3
//
// 只读 Controller：解析 HTTP 请求、校验权限、调用 MatrixService、格式化响应。
// 不写任何数据、不调用 AIGateway。
// Handoff 端点只创建候选元数据，不写正式业务数据。

import TrizContradictionMatrixService from '#services/triz_contradiction/triz_contradiction_matrix_service'
import TrizContradictionMatrixHandoffService from '#services/triz_contradiction/triz_contradiction_matrix_handoff_service'
import TrizContradictionMatrixPolicy from '#policies/triz_contradiction_matrix_policy'
import { listMatrixValidator, handoffMatrixValidator } from '#validators/triz_contradiction_matrix'
import { PermissionDeniedException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

@inject()
export default class TrizContradictionMatrixController {
  constructor(
    private matrixService: TrizContradictionMatrixService,
    private handoffService: TrizContradictionMatrixHandoffService,
    private policy: TrizContradictionMatrixPolicy,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  /**
   * GET /api/v1/projects/:projectId/triz/contradiction-matrix
   *
   * 返回权限脱敏、只读、零模型成本的矛盾矩阵 DTO。
   */
  async show(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)

    // 1. 解析 scope（权限）
    const scope = await this.policy.resolveScope(user, organizationId, projectId)

    if (!scope.hasViewPermission) {
      throw new PermissionDeniedException('无 contradiction:view 权限')
    }

    // 2. 校验筛选器
    const filters = await ctx.request.validateUsing(listMatrixValidator, {
      data: ctx.request.qs(),
    })

    // 3. 构建矩阵 DTO
    const matrix = await this.matrixService.buildMatrix({
      scope: { ...scope, organizationId, projectId },
      filters: filters as any,
    })

    // 4. 返回统一 envelope
    return ctx.response.ok({ data: matrix })
  }

  /**
   * POST /api/v1/projects/:projectId/triz/contradiction-matrix/handoff
   *
   * 将选中单元/物理矛盾作为候选输入交给 Workbench 或 Draft Layer review。
   * 不写正式业务数据，只创建候选元数据。
   */
  async handoff(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)

    // 1. 解析 scope
    const scope = await this.policy.resolveScope(user, organizationId, projectId)

    if (!scope.hasViewPermission) {
      throw new PermissionDeniedException('无 contradiction:view 权限')
    }

    // handoff 需要 Workbench 或 handoff 权限
    if (scope.canAccessWorkbench === false) {
      throw new PermissionDeniedException('无 Workbench 访问权限')
    }

    // 2. 校验 handoff 输入
    const payload = await ctx.request.validateUsing(handoffMatrixValidator, {
      data: ctx.request.body(),
    })

    // 3. 创建 handoff 候选
    const result = await this.handoffService.createHandoff({
      user,
      organizationId,
      projectId,
      input: payload as any,
      requestId: ctx.request.id(),
    })

    // 4. 返回统一 envelope
    if (result.status === 'created') {
      return ctx.response.created({ data: result })
    }
    return ctx.response.ok({ data: result })
  }
}
