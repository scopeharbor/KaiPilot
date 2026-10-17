import type User from '#models/user'
import ProjectMetricsPolicy from '#policies/project_metrics_policy'
import BurndownAggregationService from '#services/burndown_aggregation_service'
import DepartmentService from '#services/department_service'
import ParetoAggregationService from '#services/pareto_aggregation_service'
import ProjectEvmService from '#services/project_evm_service'
import ProjectMetricsService from '#services/project_metrics_service'
import SpcMetricService from '#services/spc_metric_service'
import {
  burndownQueryValidator,
  evmQueryValidator,
  paretoQueryValidator,
  spcQueryValidator,
} from '#validators/chart_gallery_metrics'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * 项目度量与计算引擎控制器（v3-chart-gallery-data-foundation，design D5）。
 *
 * 全部为只读幂等 GET 聚合端点（RL-06，零写库）；EVM/燃尽/SPC/帕累托/RACI/
 * LOB/OBS 算法与跨租户 404 由各计算服务保证。无业务 HTTP 写操作。
 */
@inject()
export default class ProjectMetricsController {
  constructor(
    private evmService: ProjectEvmService,
    private burndownService: BurndownAggregationService,
    private spcService: SpcMetricService,
    private paretoService: ParetoAggregationService,
    private metricsService: ProjectMetricsService,
    private departmentService: DepartmentService,
    private policy: ProjectMetricsPolicy,
  ) {}

  private user(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgId(ctx: HttpContext): number {
    return ctx.tenant!.organizationId
  }

  /** GET /projects/:projectId/raci-matrix —— RACI 责任分配矩阵（R/A/C/I 交叉映射）。 */
  async raciMatrix(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeRaci(this.user(ctx), organizationId, projectId)

    const matrix = await this.metricsService.getRaciMatrix(organizationId, projectId)
    return ctx.response.ok({ data: matrix })
  }

  /** GET /projects/:projectId/obs-tree —— 项目级 OBS 组织分工树。 */
  async obsTree(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeObs(this.user(ctx), organizationId, projectId)

    const tree = await this.departmentService.getProjectObsTree(organizationId, projectId)
    return ctx.response.ok({ data: tree })
  }

  /** GET /projects/:projectId/metrics/evm —— EVM 绩效指标卡。 */
  async evm(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeEvm(this.user(ctx), organizationId, projectId)

    const { asOfDate } = await ctx.request.validateUsing(evmQueryValidator, {
      data: ctx.request.qs(),
    })
    const indicators = await this.evmService.getIndicators(organizationId, projectId, asOfDate)
    return ctx.response.ok({ data: indicators })
  }

  /** GET /projects/:projectId/metrics/evm/s-curve —— EVM S 曲线时序点阵。 */
  async evmSCurve(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeEvm(this.user(ctx), organizationId, projectId)

    const { asOfDate } = await ctx.request.validateUsing(evmQueryValidator, {
      data: ctx.request.qs(),
    })
    const curve = await this.evmService.getSCurve(organizationId, projectId, asOfDate)
    return ctx.response.ok({ data: curve })
  }

  /** GET /projects/:projectId/metrics/burndown —— 燃尽/燃起图日时序聚合。 */
  async burndown(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeBurndown(this.user(ctx), organizationId, projectId)

    const query = await ctx.request.validateUsing(burndownQueryValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.burndownService.getBurndown(organizationId, projectId, query)
    return ctx.response.ok({ data: result })
  }

  /** GET /projects/:projectId/metrics/lob —— 线条平衡图流水工序聚合。 */
  async lob(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeLob(this.user(ctx), organizationId, projectId)

    const result = await this.metricsService.getLobMetrics(organizationId, projectId)
    return ctx.response.ok({ data: result })
  }

  /** GET /projects/:projectId/metrics/control-chart —— SPC 统计过程控制图。 */
  async controlChart(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeSpc(this.user(ctx), organizationId, projectId)

    const query = await ctx.request.validateUsing(spcQueryValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.spcService.getControlChart(
      organizationId,
      projectId,
      query.metric,
      query.limit,
    )
    return ctx.response.ok({ data: result })
  }

  /** GET /projects/:projectId/metrics/pareto —— 帕累托 80/20 二八分析聚合。 */
  async pareto(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizePareto(this.user(ctx), organizationId, projectId)

    const { dimension } = await ctx.request.validateUsing(paretoQueryValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.paretoService.getPareto(organizationId, projectId, dimension)
    return ctx.response.ok({ data: result })
  }
}
