import { inject } from '@adonisjs/core'
import ProjectHealthRiskCommandCenterPolicy from '#policies/project_health_risk_command_center_policy'
import ProjectHealthRiskCommandCenterService from '#services/project_health_risk_command_center_service'
import {
  commandCenterParamsValidator,
  commandCenterQueryValidator,
  parseCommandCenterIncludeParam,
} from '#validators/project_health_risk_command_center'
import { ValidationException } from '#exceptions/api_exception'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import { normalizeCommandCenterQuery } from '@aiproj/types'

/** 查询键白名单：出现任何其它键即拒绝（严格模式，防未知筛选）。 */
const ALLOWED_QUERY_KEYS = new Set(['attentionLimit', 'include', 'freshnessWindowDays'])

/**
 * 项目健康风险指挥中心 Controller（§4.3）。
 *
 * 职责严格限定：认证 → 参数解析与校验 → Policy → Service → `{ data, meta }` 格式化。
 * 路由：GET /api/v1/projects/:id/health-risk-command-center
 * 无任何业务逻辑、无直接数据访问、无写路径。
 */
@inject()
export default class ProjectHealthRiskCommandCenterController {
  constructor(
    private readonly commandCenter: ProjectHealthRiskCommandCenterService,
    private readonly policy: ProjectHealthRiskCommandCenterPolicy,
  ) {}

  async show(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId

    const params = await commandCenterParamsValidator.validate({
      id: ctx.params.id,
    })

    // 未知查询键 → 统一 VALIDATION_ERROR（vine 默认剥离，这里显式拒绝）。
    const rawQs = ctx.request.qs() as Record<string, unknown>
    const unknownKeys = Object.keys(rawQs).filter((k) => !ALLOWED_QUERY_KEYS.has(k))
    if (unknownKeys.length > 0) {
      throw new ValidationException('查询参数校验失败', {
        details: {
          errors: unknownKeys.map((k) => ({
            field: k,
            rule: 'unknown',
            message: `未知查询参数：${k}`,
          })),
        },
      })
    }

    const validated = await commandCenterQueryValidator.validate({
      attentionLimit: rawQs.attentionLimit !== undefined ? Number(rawQs.attentionLimit) : undefined,
      include: parseCommandCenterIncludeParam(rawQs.include),
      freshnessWindowDays:
        rawQs.freshnessWindowDays !== undefined ? Number(rawQs.freshnessWindowDays) : undefined,
    })

    // 共享纯函数二次规范化：重复 include / 越界值在此给出确定性 issue。
    const normalized = normalizeCommandCenterQuery(validated)
    if (!normalized.ok) {
      throw new ValidationException('查询参数校验失败', {
        details: { errors: normalized.issues },
      })
    }

    // 项目门先行：跨租/不可见项目以非泄露 RESOURCE_NOT_FOUND 收束。
    await this.policy.assertProjectVisible(user, organizationId, params.id)
    const access = await this.policy.resolveAccess(user, organizationId, params.id)

    const result = await this.commandCenter.getSummary(
      user,
      organizationId,
      params.id,
      normalized.query,
      access,
    )
    return ctx.response.ok(result)
  }
}
