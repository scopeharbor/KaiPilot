import type { HttpContext } from '@adonisjs/core/http'
import RbacService from '#services/rbac_service'
import { CODEGEN_CANDIDATE_RUN_RUN, CODEGEN_CANDIDATE_RUN_VIEW } from '#rbac'
import { AuthRequiredException, PermissionDeniedException } from '#exceptions/api_exception'

/**
 * 34 阶段代码生成候选运行 Policy（v3-codegen-34-stage-candidate-runtime-execution）。
 *
 * 权限模型（窄权限，不回落到通用 project:view / project:update）：
 * - view：读取 run / stage 记录 / review packet ——`codegen_candidate_run:view`
 * - run ：创建并执行候选运行 ——`codegen_candidate_run:run`
 *
 * `run` 刻意无任何回落权限：能读项目不等于能触发 34 阶段执行。
 * 判定链复用 RbacService（与 rbac_middleware 同一条），本层是控制器侧的
 * 纵深防御；跨组织隔离由 Controller 的 organization_id 过滤 + 404 保证。
 */
export default class CodegenCandidateRunPolicy {
  #ctx: HttpContext
  #rbac: RbacService

  constructor(ctx: HttpContext, rbac: RbacService = new RbacService()) {
    this.#ctx = ctx
    this.#rbac = rbac
  }

  async view(): Promise<boolean> {
    return this.#allows(CODEGEN_CANDIDATE_RUN_VIEW)
  }

  async run(): Promise<boolean> {
    return this.#allows(CODEGEN_CANDIDATE_RUN_RUN)
  }

  async assertView(): Promise<void> {
    if (!(await this.view())) {
      throw new PermissionDeniedException('缺少代码生成候选运行查看权限')
    }
  }

  async assertRun(): Promise<void> {
    if (!(await this.run())) {
      throw new PermissionDeniedException('缺少代码生成候选运行执行权限')
    }
  }

  async #allows(permission: typeof CODEGEN_CANDIDATE_RUN_VIEW): Promise<boolean> {
    const user = (this.#ctx as any).authUser
    if (!user) throw new AuthRequiredException('需要认证')
    if (user.isSuperAdmin) return true

    const tenant = (this.#ctx as any).tenant
    if (!tenant) return false

    const projectIdParam = this.#ctx.request.param('projectId')
    const result = await this.#rbac.check(
      user,
      permission,
      tenant.organizationId,
      projectIdParam ? Number(projectIdParam) : undefined,
    )
    return result.allowed
  }
}
