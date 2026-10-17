/**
 * v3-triz-copilot-followups 任务 4.1 —— 组织级信号只读 API 控制器。
 *
 * 端点：`GET /api/v1/organizations/:organizationId/signals`
 * - 聚合当前组织下所有项目的信号列表（统一 `{ data, meta }` 信封）；
 * - 组织租户隔离（非成员 / 跨组织统一 404，不泄露存在性）；
 * - 复用领域权限裁剪纯函数按组织级领域权限脱敏 evidence；
 * - 严格只读，零数据库写操作。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import ProjectSignalPolicy from '#policies/project_signal_policy'
import ProjectSignalService from '#services/project_signal/project_signal_service'
import { organizationSignalsValidator } from '#validators/project_signal'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'

@inject()
export default class OrganizationSignalsController {
  constructor(
    private readonly policy: ProjectSignalPolicy,
    private readonly signals: ProjectSignalService,
  ) {}

  /**
   * 组织级信号只读列表（供角色首页建议队列单次全量拉取）。
   */
  async index(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = Number(ctx.params.organizationId)

    if (!organizationId || Number.isNaN(organizationId)) {
      throw new ResourceNotFoundException('组织不存在')
    }

    if (ctx.tenant?.organizationId && Number(ctx.tenant.organizationId) !== organizationId) {
      throw new ResourceNotFoundException('组织不存在')
    }

    const query = await ctx.request.validateUsing(organizationSignalsValidator)

    const decision = await this.policy.authorizeOrganizationView(user, organizationId)

    const result = await this.signals.listForOrganization({
      organizationId,
      user,
      status: query.status,
      confidenceTier: query.confidenceTier,
      signalType: query.signalType,
      signalId: query.signalId,
      page: query.page,
      perPage: query.perPage,
      domainAccess: decision.domainAccess,
    })

    return ctx.response.ok({ data: result.data, meta: result.meta })
  }
}
