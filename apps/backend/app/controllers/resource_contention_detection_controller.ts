import ResourceContentionDetectionPolicy from '#policies/resource_contention_detection_policy'
import ResourceContentionDetectionService from '#services/resource_contention_detection_service'
import {
  resourceContentionParamsValidator,
  resourceContentionDetailParamsValidator,
  resourceContentionSummaryValidator,
  resourceContentionItemsValidator,
  resourceContentionMatrixValidator,
  resourceContentionDetailValidator,
  resourceContentionSuggestionValidator,
  parseNumericListParam,
} from '#validators/resource_contention_detection'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import { normalizeResourceContentionQuery } from '@aiproj/types'

/**
 * 资源争用检测 Controller（v3-resource-contention-detection §4.1）。
 *
 * 职责：认证 → 参数解析与校验 → Policy 调用 → Service 调用 → 响应格式化。
 * 聚合口径、脱敏与降级逻辑全部在 ResourceContentionDetectionService。
 * 路由：`GET /api/v1/organizations/:organizationId/resource-contentions/*`
 *
 * 只读端点，不创建、更新、删除任何数据。
 */
@inject()
export default class ResourceContentionDetectionController {
  constructor(
    private readonly service: ResourceContentionDetectionService,
    private readonly policy: ResourceContentionDetectionPolicy,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-contentions/summary */
  async summary(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const { organizationId } = await resourceContentionParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const validated = await resourceContentionSummaryValidator.validate(
      ctx.request.qs() as Record<string, unknown>,
    )
    const query = normalizeResourceContentionQuery({
      ...validated,
      projectIds: parseNumericListParam(validated.projectIds),
      resourceIds: parseNumericListParam(validated.resourceIds),
      skillIds: parseNumericListParam(validated.skillIds),
    } as never)
    const access = await this.policy.resolveAccess(user, organizationId)

    const result = await this.service.getSummary(user, organizationId, query, access)
    return ctx.response.ok({ data: result })
  }

  // ── Items ──────────────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-contentions/items */
  async items(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const { organizationId } = await resourceContentionParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const validated = await resourceContentionItemsValidator.validate(
      ctx.request.qs() as Record<string, unknown>,
    )
    const query = normalizeResourceContentionQuery({
      ...validated,
      projectIds: parseNumericListParam(validated.projectIds),
      resourceIds: parseNumericListParam(validated.resourceIds),
      skillIds: parseNumericListParam(validated.skillIds),
    } as never)
    const access = await this.policy.resolveAccess(user, organizationId)

    const { data, meta } = await this.service.listItems(user, organizationId, query, access)
    return ctx.response.ok({ data, meta })
  }

  // ── Matrix ─────────────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-contentions/matrix */
  async matrix(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const { organizationId } = await resourceContentionParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const validated = await resourceContentionMatrixValidator.validate(
      ctx.request.qs() as Record<string, unknown>,
    )
    const query = normalizeResourceContentionQuery({
      ...validated,
      projectIds: parseNumericListParam(validated.projectIds),
      resourceIds: parseNumericListParam(validated.resourceIds),
    } as never)
    const access = await this.policy.resolveAccess(user, organizationId)

    const result = await this.service.getMatrix(user, organizationId, query, access)
    return ctx.response.ok({ data: result })
  }

  // ── Detail ─────────────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-contentions/:contentionId */
  async detail(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const { organizationId, contentionId } = await resourceContentionDetailParamsValidator.validate(
      {
        organizationId: ctx.params.organizationId,
        contentionId: ctx.params.contentionId,
      },
    )

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const validated = await resourceContentionDetailValidator.validate(
      ctx.request.qs() as Record<string, unknown>,
    )
    const query = normalizeResourceContentionQuery(validated as never)
    const access = await this.policy.resolveAccess(user, organizationId)

    const result = await this.service.getDetail(user, organizationId, contentionId, query, access)
    if (!result) {
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '争用记录不存在' },
      })
    }
    return ctx.response.ok({ data: result })
  }

  // ── Evidence ───────────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-contentions/:contentionId/evidence */
  async evidence(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const { organizationId, contentionId } = await resourceContentionDetailParamsValidator.validate(
      {
        organizationId: ctx.params.organizationId,
        contentionId: ctx.params.contentionId,
      },
    )

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const access = await this.policy.resolveAccess(user, organizationId)
    if (!access.canViewEvidence) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无权查看争用证据' },
      })
    }

    const validated = await resourceContentionDetailValidator.validate(
      ctx.request.qs() as Record<string, unknown>,
    )
    const query = normalizeResourceContentionQuery(validated as never)

    const result = await this.service.getEvidence(user, organizationId, contentionId, query, access)
    if (!result) {
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '争用证据不存在' },
      })
    }
    return ctx.response.ok({ data: result })
  }

  // ── Suggestion Preview ─────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-contentions/:contentionId/suggestions */
  async suggestions(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const { organizationId, contentionId } = await resourceContentionDetailParamsValidator.validate(
      {
        organizationId: ctx.params.organizationId,
        contentionId: ctx.params.contentionId,
      },
    )

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const validated = await resourceContentionSuggestionValidator.validate(
      ctx.request.qs() as Record<string, unknown>,
    )
    const query = normalizeResourceContentionQuery({})
    const access = await this.policy.resolveAccess(user, organizationId)

    const result = await this.service.getSuggestionPreview(
      user,
      organizationId,
      contentionId,
      query,
      access,
      validated.kind as 'rule' | 'ai' | undefined,
    )
    return ctx.response.ok({ data: result })
  }
}
