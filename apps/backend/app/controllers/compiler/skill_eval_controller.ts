/**
 * v3-skill-eval-system —— SkillEvalController（D10）。
 *
 * REST API 子资源端点：POST /quality、POST /benchmark、GET /reports、GET /reports/:id、
 * GET /effect-metrics、POST /ai-assist。
 */
import type { HttpContext } from '@adonisjs/core/http'
import SkillEvalService from '#services/compiler/skills/skill_eval_service'
import SkillEvalPolicy from '#policies/skill_eval_policy'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import CompilerSkill from '#models/compiler_skill'

@inject()
export default class SkillEvalController {
  readonly #policy = new SkillEvalPolicy()

  constructor(private readonly service: SkillEvalService) {}

  /**
   * 统一 RBAC 断言：复用 SkillEvalPolicy（判定链 = RbacService）。
   */
  async #assertEval(ctx: HttpContext) {
    const allowed = await this.#policy.eval(ctx)
    if (!allowed) {
      throw new PermissionDeniedException('无权执行技能评估')
    }
  }

  /**
   * POST /api/v1/ai/compiler/skills/:skillId/eval/quality
   */
  async runQuality(ctx: HttpContext) {
    const { params, auth, request, response } = ctx
    await this.#assertEval(ctx)

    const organizationId = ctx.tenant!.organizationId
    const skillId = Number(params.skillId)
    const { referenceTime } = request.body()

    const report = await this.service.runQualityAssessment(organizationId, skillId, auth.user!.id, {
      referenceTime,
    })

    return response.ok({ data: report })
  }

  /**
   * POST /api/v1/ai/compiler/skills/:skillId/eval/benchmark
   */
  async runBenchmark(ctx: HttpContext) {
    const { params, auth, request, response } = ctx
    await this.#assertEval(ctx)

    const organizationId = ctx.tenant!.organizationId
    const skillId = Number(params.skillId)
    const { referenceTime, benchmarkSource } = request.body()

    const report = await this.service.runBenchmark(organizationId, skillId, auth.user!.id, {
      referenceTime,
      benchmarkSource,
    })

    return response.ok({ data: report })
  }

  /**
   * GET /api/v1/ai/compiler/skills/:skillId/eval/reports
   */
  async listReports(ctx: HttpContext) {
    const { params, request, response } = ctx
    await this.#assertEval(ctx)

    const organizationId = ctx.tenant!.organizationId
    const skillId = Number(params.skillId)

    // 验证 skill 存在且属于当前组织
    const skill = await CompilerSkill.query()
      .where('id', skillId)
      .where('organization_id', organizationId)
      .first()
    if (!skill) {
      throw new ResourceNotFoundException('Skill not found')
    }

    const page = Number(request.input('page', 1))
    const perPage = Number(request.input('perPage', 50))

    const result = await this.service.listReports(organizationId, skillId, page, perPage)

    return response.ok(result)
  }

  /**
   * GET /api/v1/ai/compiler/skills/:skillId/eval/reports/:id
   */
  async getReport(ctx: HttpContext) {
    const { params, response } = ctx
    await this.#assertEval(ctx)

    const organizationId = ctx.tenant!.organizationId
    const reportId = Number(params.id)

    const report = await this.service.getReport(organizationId, reportId)

    return response.ok({ data: report })
  }

  /**
   * GET /api/v1/ai/compiler/skills/:skillId/eval/effect-metrics
   */
  async getEffectMetrics(ctx: HttpContext) {
    const { params, response } = ctx
    await this.#assertEval(ctx)

    const organizationId = ctx.tenant!.organizationId
    const skillId = Number(params.skillId)

    // 查询 skill 获取其 skillKey
    const skill = await CompilerSkill.query()
      .where('id', skillId)
      .where('organization_id', organizationId)
      .first()
    if (!skill) {
      throw new ResourceNotFoundException('Skill not found')
    }

    const metrics = await this.service.getEffectMetrics(organizationId, skill.skillKey)

    return response.ok({ data: metrics })
  }

  /**
   * POST /api/v1/ai/compiler/skills/:skillId/eval/ai-assist
   */
  async aiAssist(ctx: HttpContext) {
    const { params, auth, response } = ctx
    await this.#assertEval(ctx)

    const organizationId = ctx.tenant!.organizationId
    const skillId = Number(params.skillId)

    const advisory = await this.service.aiAssist(organizationId, skillId, auth.user!.id)

    return response.ok({ data: advisory })
  }
}
